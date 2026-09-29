import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ProviderFailure, type ExtractionProvider } from './runner.ts';

/**
 * Runs extraction through the Claude Code CLI (`claude -p`) on a claude.ai subscription login.
 * Local evaluation only, like the Codex provider: it uses the developer's own login and must never back a
 * hosted service.
 *
 * Each call runs headless in an empty directory with no tools, no settings, no MCP servers, and no session
 * persistence, so the result is close to one structured completion.
 */
export const CLAUDE_STDOUT_BYTES = 1_048_576;
const METERED_ENV =
  /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX)$/;
const resultSchema = z.looseObject({
  is_error: z.boolean().optional(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  permission_denials: z.array(z.unknown()).optional(),
  api_error_status: z.number().nullable().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().int().min(0),
      cache_creation_input_tokens: z.number().int().min(0).optional(),
      cache_read_input_tokens: z.number().int().min(0).optional(),
      output_tokens: z.number().int().min(0),
    })
    .optional(),
});

const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export interface ClaudeOptions {
  model: string;
  /** The CLI's `--effort`; it bounds thinking, whose tokens the CLI counts as output. Defaults to low. */
  effort?: z.infer<typeof effortSchema>;
  /** Path to the claude binary; defaults to `claude` on PATH. */
  bin?: string;
}

function failureFor(message: string, status: number | null | undefined): ProviderFailure {
  if (status === 429 || /usage limit|rate limit|429|too many requests|overloaded/i.test(message))
    return new ProviderFailure('rate-limit');
  if (status === 401 || status === 403 || /not logged in|unauthorized|authentication|login/i.test(message))
    return new ProviderFailure('permanent');
  return new ProviderFailure('transient');
}

/** Parse `claude -p --output-format json` output into the runner's reply shape. */
export function parseClaudeResult(stdout: string) {
  let parsed: z.infer<typeof resultSchema>;
  try {
    parsed = resultSchema.parse(JSON.parse(stdout));
  } catch {
    throw new ProviderFailure('transient');
  }
  if (parsed.permission_denials?.length) throw new ProviderFailure('permanent'); // A tool was attempted.
  if (parsed.is_error || parsed.structured_output === undefined || !parsed.usage)
    throw failureFor(parsed.result ?? parsed.subtype ?? '', parsed.api_error_status);
  const u = parsed.usage;
  // The CLI sums usage over its turns (structured output is a tool call, so there are at least two), and
  // the second turn re-reads the whole prompt from cache. Count each prompt token once: fresh input plus
  // cache writes, not cache reads, so the harness's input budget applies to the prompt and not to the CLI's
  // turn count.
  return {
    finishReason: 'stop' as const,
    text: JSON.stringify(parsed.structured_output),
    usage: {
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens,
    },
  };
}

export function createClaudeProvider(options: ClaudeOptions): ExtractionProvider {
  const bin = options.bin ?? 'claude';
  const effort = effortSchema.parse(options.effort ?? 'low');
  const model = z
    .string()
    .regex(/^[a-zA-Z0-9._:-]{1,120}$/)
    .parse(options.model);
  // Drop metered credentials so the CLI bills the subscription login, never an API key or cloud account.
  // Extended thinking is off: the CLI counts thinking as output tokens, which blew the harness's output
  // budget (9.7k tokens for a 2 kB answer) and made each call several times slower.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !METERED_ENV.test(name))),
    MAX_THINKING_TOKENS: '0',
  };

  return {
    id: 'claude-cli',
    model,
    mode: 'subscription',
    pricing: { input: 0, output: 0 },
    invoke: async (request) => {
      const work = await mkdtemp(join(tmpdir(), 'aicheckout-claude-'));
      try {
        const args = [
          '-p',
          '--model',
          model,
          '--effort',
          effort,
          '--output-format',
          'json',
          '--json-schema',
          JSON.stringify(request.jsonSchema),
          '--system-prompt',
          request.system,
          '--tools',
          '',
          '--no-session-persistence',
          '--setting-sources',
          '',
          '--strict-mcp-config',
        ];
        const stdout = await new Promise<string>((resolve, reject) => {
          const child = spawn(bin, args, { env, cwd: work, signal: request.signal, stdio: 'pipe' });
          const chunks: Buffer[] = [];
          let bytes = 0;
          child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > CLAUDE_STDOUT_BYTES) child.kill('SIGKILL');
            else chunks.push(chunk);
          });
          child.stderr.resume(); // Diagnostics only; never copied into traces.
          child.on('error', () => reject(new ProviderFailure('permanent')));
          child.on('close', (code) => {
            if (bytes > CLAUDE_STDOUT_BYTES) reject(new ProviderFailure('permanent'));
            else {
              const out = Buffer.concat(chunks).toString('utf8');
              // A non-zero exit usually still carries a JSON result with the real reason.
              if (code !== 0 && !out.trim().startsWith('{')) reject(new ProviderFailure('transient'));
              else resolve(out);
            }
          });
          child.stdin.end(request.user);
        });
        return parseClaudeResult(stdout);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  };
}
