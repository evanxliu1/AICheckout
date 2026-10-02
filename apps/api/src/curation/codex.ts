import { spawn, execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ProviderFailure, type ExtractionProvider } from './runner.ts';

/**
 * Runs extraction through the Codex CLI (`codex exec`) so a local ChatGPT subscription pays for it.
 * Local evaluation only: the CLI uses the developer's own login, so this must never back a hosted service.
 *
 * Codex is an agent harness, not a raw completion API. To keep the call close to a single structured
 * completion, each run uses an empty read-only working directory, replaces Codex's base instructions with
 * our system prompt, ignores user config/rules, and disables every optional tool the installed CLI reports.
 */
export const CODEX_STDOUT_BYTES = 1_048_576;
const DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'remote_plugin',
  'plugin_sharing',
  'multi_agent',
  'image_generation',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
  'code_mode_host',
  'skill_search',
  'skill_mcp_dependency_install',
  'tool_suggest',
  'tool_call_mcp_elicitation',
  'goals',
  'hooks',
  'personality',
  'auth_elicitation',
  'shell_snapshot',
  'workspace_dependencies',
  'mentions_v2',
  'fast_mode',
  'guardian_approval',
];
const TOOL_ITEMS = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search']);
const effortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);
const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('item.completed'),
    item: z.object({ type: z.string(), text: z.string().optional() }),
  }),
  z.object({
    type: z.literal('turn.completed'),
    usage: z.object({
      input_tokens: z.number().int().min(0),
      output_tokens: z.number().int().min(0),
      /** The part of output_tokens spent on hidden reasoning (newer CLIs report it). */
      reasoning_output_tokens: z.number().int().min(0).optional(),
    }),
  }),
  z.object({ type: z.literal('turn.failed'), error: z.object({ message: z.string() }).optional() }),
  z.object({ type: z.literal('error'), message: z.string().optional() }),
]);

export interface CodexOptions {
  model: string;
  reasoningEffort?: z.infer<typeof effortSchema>;
  /** Path to the codex binary; defaults to `codex` on PATH. */
  bin?: string;
  /**
   * `total` (default) reports output tokens as the CLI does, hidden reasoning included. `visible` subtracts the
   * reported reasoning tokens, like the Claude provider (thinking off) counts only the final message, so a
   * high-effort model's reasoning does not trip the runner's output-token limit. Record the choice with results.
   */
  outputTokens?: 'total' | 'visible';
}

/** Feature names the installed CLI accepts; unknown `--disable` flags are hard errors. */
async function supportedFeatures(bin: string): Promise<Set<string>> {
  const { stdout } = await promisify(execFile)(bin, ['features', 'list'], { timeout: 15_000 });
  return new Set(stdout.split('\n').map((line) => line.trim().split(/\s+/)[0]));
}

function failureFor(message: string): ProviderFailure {
  if (/usage limit|rate limit|429|too many requests/i.test(message)) return new ProviderFailure('rate-limit');
  if (/not logged in|unauthorized|401|403|login/i.test(message)) return new ProviderFailure('permanent');
  return new ProviderFailure('transient');
}

/** Parse `codex exec --json` output into the runner's reply shape. */
export function parseCodexEvents(stdout: string, outputTokens: 'total' | 'visible' = 'total') {
  let text: string | undefined, usage: { inputTokens: number; outputTokens: number } | undefined;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let event: z.infer<typeof eventSchema>;
    try {
      const parsed = eventSchema.safeParse(JSON.parse(line));
      if (!parsed.success) continue; // Progress events we don't use.
      event = parsed.data;
    } catch {
      continue;
    }
    if (event.type === 'item.completed' && event.item.type === 'agent_message') text = event.item.text;
    else if (event.type === 'item.completed' && TOOL_ITEMS.has(event.item.type))
      throw new ProviderFailure('permanent'); // A tool ran; the run is no longer a pure extraction.
    else if (event.type === 'turn.completed')
      usage = {
        inputTokens: event.usage.input_tokens,
        outputTokens:
          outputTokens === 'visible'
            ? Math.max(0, event.usage.output_tokens - (event.usage.reasoning_output_tokens ?? 0))
            : event.usage.output_tokens,
      };
    else if (event.type === 'turn.failed') throw failureFor(event.error?.message ?? '');
    else if (event.type === 'error') throw failureFor(event.message ?? '');
  }
  if (text === undefined || !usage) throw new ProviderFailure('transient');
  return { finishReason: 'stop' as const, text, usage };
}

export async function createCodexProvider(options: CodexOptions): Promise<ExtractionProvider> {
  const bin = options.bin ?? 'codex';
  const effort = effortSchema.parse(options.reasoningEffort ?? 'low');
  const model = z
    .string()
    .regex(/^[a-zA-Z0-9._:-]{1,120}$/)
    .parse(options.model);
  const supported = await supportedFeatures(bin);
  const disable = DISABLED_FEATURES.filter((name) => supported.has(name)).flatMap((name) => [
    '--disable',
    name,
  ]);
  // Drop API keys so the CLI bills the ChatGPT login, never a metered key that happens to be exported.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(OPENAI_API_KEY|CODEX_API_KEY)$/.test(name)),
  );

  return {
    id: 'codex-cli',
    model,
    mode: 'subscription',
    pricing: { input: 0, output: 0 },
    invoke: async (request) => {
      const dir = await mkdtemp(join(tmpdir(), 'aicheckout-codex-'));
      try {
        const work = join(dir, 'work');
        await writeFile(join(dir, 'instructions.md'), request.system);
        await writeFile(join(dir, 'schema.json'), JSON.stringify(request.jsonSchema));
        await mkdir(work);
        const args = [
          'exec',
          '--json',
          '--ephemeral',
          '--skip-git-repo-check',
          '--ignore-user-config',
          '--ignore-rules',
          '--sandbox',
          'read-only',
          '--cd',
          work,
          '--model',
          model,
          '--output-schema',
          join(dir, 'schema.json'),
          '-c',
          `model_instructions_file=${JSON.stringify(join(dir, 'instructions.md'))}`,
          '-c',
          `model_reasoning_effort=${JSON.stringify(effort)}`,
          '-c',
          'web_search="disabled"',
          ...disable,
          '-',
        ];
        const stdout = await new Promise<string>((resolve, reject) => {
          const child = spawn(bin, args, { env, cwd: work, signal: request.signal, stdio: 'pipe' });
          const chunks: Buffer[] = [];
          let bytes = 0;
          child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > CODEX_STDOUT_BYTES) child.kill('SIGKILL');
            else chunks.push(chunk);
          });
          child.stderr.resume(); // Diagnostics only; never copied into traces.
          child.on('error', () => reject(new ProviderFailure('permanent')));
          child.on('close', (code) => {
            if (bytes > CODEX_STDOUT_BYTES) reject(new ProviderFailure('permanent'));
            else {
              const out = Buffer.concat(chunks).toString('utf8');
              // Non-zero exits usually still carry a turn.failed event with the real reason.
              if (code !== 0 && !out.includes('"turn.')) reject(new ProviderFailure('transient'));
              else resolve(out);
            }
          });
          child.stdin.end(request.user);
        });
        return parseCodexEvents(stdout, options.outputTokens ?? 'total');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
