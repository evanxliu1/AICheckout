import { afterAll, beforeAll, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexProvider, parseCodexEvents } from '../src/curation/codex.ts';
import { runExtraction, ProviderFailure } from '../src/curation/runner.ts';
import { extractionFixture } from './curation-fixture.ts';

// A fake `codex` binary: never a real model call. Behavior is chosen by FAKE_CODEX_MODE, and it
// records its argv, environment, stdin, and the instruction/schema files it was given.
let dir: string, bin: string;
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'features') {
  console.log('shell_tool   stable  true\\napps   stable  true\\nweb_search_cached  deprecated  false');
  process.exit(0);
}
let stdin = '';
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  const arg = (name) => args[args.indexOf(name) + 1];
  const instructions = args.find((a) => a.startsWith('model_instructions_file=')).split('=').slice(1).join('=');
  fs.writeFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({
    args, stdin, cwd: process.cwd(), hasApiKey: 'OPENAI_API_KEY' in process.env,
    instructions: fs.readFileSync(JSON.parse(instructions), 'utf8'),
    schema: JSON.parse(fs.readFileSync(arg('--output-schema'), 'utf8')),
  }));
  const emit = (event) => console.log(JSON.stringify(event));
  const mode = process.env.FAKE_CODEX_MODE;
  emit({ type: 'thread.started', thread_id: 't' });
  if (mode === 'hang') return setTimeout(() => {}, 60_000);
  if (mode === 'limit') {
    emit({ type: 'turn.failed', error: { message: "You've hit your usage limit." } });
    process.exit(1);
  }
  if (mode === 'tool') emit({ type: 'item.completed', item: { type: 'command_execution', command: 'ls' } });
  emit({ type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } });
  emit({ type: 'item.completed', item: { type: 'agent_message', text: process.env.FAKE_CODEX_TEXT } });
  emit({ type: 'turn.completed', usage: { input_tokens: 3900, cached_input_tokens: 0, output_tokens: 1200 } });
});
`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-codex-'));
  bin = join(dir, 'codex');
  await writeFile(bin, FAKE);
  await chmod(bin, 0o755);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function run(mode: string, limits = {}) {
  const f = extractionFixture(),
    log = join(dir, `${mode}.json`);
  Object.assign(process.env, {
    FAKE_CODEX_MODE: mode,
    FAKE_CODEX_LOG: log,
    FAKE_CODEX_TEXT: f.reply.text,
    OPENAI_API_KEY: 'sk-SYNTHETIC-NOT-A-KEY',
  });
  try {
    const provider = await createCodexProvider({ model: 'gpt-5.5', bin });
    const trace = await runExtraction(f.input, provider, { limits });
    const seen = await readFile(log, 'utf8').then(JSON.parse, () => undefined);
    return { f, trace, seen };
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
}

it('runs codex exec as a sandboxed structured extraction and records subscription identity', async () => {
  const { f, trace, seen } = await run('ok');
  expect(trace.status).toBe('evidence_valid');
  expect(trace.provider).toEqual({
    id: 'codex-cli',
    model: 'gpt-5.5',
    mode: 'subscription',
    pricing: { input: 0, output: 0 },
  });
  expect(trace.accountedMicrousd).toBe(0);
  expect(trace.attempts[0].usage).toEqual({ inputTokens: 3900, outputTokens: 1200 });
  expect(trace.extraction).toEqual(f.output);

  // The system prompt replaces Codex's instructions; the user envelope arrives on stdin.
  expect(seen.instructions).toContain('Extract credit-card reward facts');
  expect(seen.stdin).toContain('"contextVersion"');
  expect(seen.schema).toMatchObject({ type: 'object', additionalProperties: false });
  expect(seen.args).toEqual(
    expect.arrayContaining(['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', 'read-only']),
  );
  // Only features the installed CLI reports are disabled (unknown flags are hard errors).
  expect(seen.args.filter((value: string, i: number) => seen.args[i - 1] === '--disable')).toEqual([
    'shell_tool',
    'apps',
  ]);
  // A metered key in the environment must not switch billing away from the subscription.
  expect(seen.hasApiKey).toBe(false);
});

it('classifies usage limits as rate limiting and retries once', async () => {
  const { trace } = await run('limit');
  expect(trace.status).toBe('provider_error');
  expect(trace.attempts.map((attempt) => attempt.outcome)).toEqual(['rate-limit', 'rate-limit']);
});

it('rejects a run in which the agent executed a tool', async () => {
  const { trace } = await run('tool');
  expect(trace.status).toBe('provider_error');
  expect(trace.attempts).toHaveLength(1);
});

it('kills a hung CLI at the attempt deadline', async () => {
  const started = Date.now();
  const { trace } = await run('hang', { attemptTimeoutMs: 1500, totalTimeoutMs: 2000, maxAttempts: 1 });
  expect(trace.status).toBe('timeout');
  expect(Date.now() - started).toBeLessThan(5000);
});

it('requires both a final message and usage', () => {
  expect(() =>
    parseCodexEvents('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'),
  ).toThrow(ProviderFailure);
  expect(
    parseCodexEvents(
      'not json\n{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}',
    ),
  ).toEqual({
    finishReason: 'stop',
    text: '{}',
    usage: { inputTokens: 5, outputTokens: 2 },
  });
});
