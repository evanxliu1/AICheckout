import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
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
/** API keys, auth tokens, base URLs, and cloud-provider switches: anything that could bill a metered account. */
const METERED_ENV = /^(ANTHROPIC_|CLAUDE_CODE_USE_)/;
const KEEP_ENV = new Set(['CLAUDE_CODE_OAUTH_TOKEN']);
const resultSchema = z.looseObject({
  is_error: z.boolean().optional(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  permission_denials: z.array(z.unknown()).optional(),
  api_error_status: z.number().nullable().optional(),
  session_id: z.string().optional(),
  /** Keyed by the canonical model name the CLI resolved (an alias such as `opus` resolves here). */
  modelUsage: z.record(z.string(), z.unknown()).optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().int().min(0),
      cache_creation_input_tokens: z.number().int().min(0).optional(),
      cache_read_input_tokens: z.number().int().min(0).optional(),
      output_tokens: z.number().int().min(0),
      /** Per-message usage, one entry per CLI turn. */
      iterations: z
        .array(
          z.looseObject({
            input_tokens: z.number().int().min(0).optional(),
            cache_creation_input_tokens: z.number().int().min(0).optional(),
            cache_read_input_tokens: z.number().int().min(0).optional(),
            output_tokens: z.number().int().min(0),
          }),
        )
        .optional(),
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

/** Classify an `is_error` result. An overloaded API (529) is transient; usage and rate limits are not. */
function failureFor(message: string, status: number | null | undefined): ProviderFailure {
  if (status === 529 || /overloaded/i.test(message)) return new ProviderFailure('transient');
  if (status === 429 || /usage limit|rate limit|429|too many requests/i.test(message))
    return new ProviderFailure('rate-limit');
  // Bad requests (an unknown model, a CLI too old for the model) will not succeed on retry.
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    /not logged in|unauthorized|authentication|login|does not support this model|unrecognized/i.test(message)
  )
    return new ProviderFailure('permanent');
  return new ProviderFailure('transient');
}

/**
 * Parse `claude -p --output-format json` output into the runner's reply shape.
 *
 * The CLI sums usage over its turns (structured output is a tool call, so there are at least two), and each
 * turn re-reads the prompt, mostly from cache. Input tokens are the largest single turn's prompt (fresh +
 * cache-written + cache-read), which is the prompt size; output tokens are the total over turns.
 */
export function parseClaudeResult(stdout: string, requestedModel?: string) {
  let parsed: z.infer<typeof resultSchema>;
  try {
    parsed = resultSchema.parse(JSON.parse(stdout));
  } catch {
    throw new ProviderFailure('transient');
  }
  if (parsed.permission_denials?.length) throw new ProviderFailure('permanent'); // A tool was attempted.
  if (parsed.is_error) throw failureFor(parsed.result ?? parsed.subtype ?? '', parsed.api_error_status);
  if (!parsed.usage) throw new ProviderFailure('transient');
  const u = parsed.usage;
  const turns = u.iterations?.length ? u.iterations : [u];
  const prompt = (t: (typeof turns)[number]) =>
    (t.input_tokens ?? 0) + (t.cache_creation_input_tokens ?? 0) + (t.cache_read_input_tokens ?? 0);
  const keys = Object.keys(parsed.modelUsage ?? {});
  // The trace schema allows 120 characters for a model name.
  const canonical = (
    keys.find((k) => k === requestedModel) ?? (keys.length ? keys.join('+') : undefined)
  )?.slice(0, 120);
  return {
    finishReason: 'stop' as const,
    // Without structured output the reply is whatever text the model gave; the runner records it as
    // invalid output rather than a provider failure.
    text:
      parsed.structured_output === undefined
        ? (parsed.result ?? '')
        : JSON.stringify(parsed.structured_output),
    usage: {
      inputTokens: Math.max(...turns.map(prompt)),
      outputTokens: u.iterations?.length
        ? u.iterations.reduce((n, t) => n + t.output_tokens, 0)
        : u.output_tokens,
    },
    ...(parsed.session_id && canonical
      ? { providerResponse: { id: parsed.session_id, model: canonical } }
      : {}),
  };
}

/** The installed CLI's version string, or "unknown" when it cannot be read. */
export async function cliVersion(bin: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(bin, ['--version'], { timeout: 15_000 });
    return stdout.trim().split('\n')[0].slice(0, 80) || 'unknown';
  } catch {
    return 'unknown';
  }
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
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => KEEP_ENV.has(name) || !METERED_ENV.test(name)),
    ),
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
        return parseClaudeResult(stdout, model);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  };
}
