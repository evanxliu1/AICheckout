import { afterAll, beforeAll, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeProvider, parseClaudeResult } from '../src/curation/claude.ts';
import { runExtraction, ProviderFailure } from '../src/curation/runner.ts';
import { extractionFixture } from './curation-fixture.ts';

// A fake `claude` binary: never a real model call. Behavior is chosen by FAKE_CLAUDE_MODE, and it records
// its argv, environment, stdin, and working directory.
let dir: string, bin: string;
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
    args, stdin, cwd: process.cwd(),
    hasKey: Object.keys(process.env).some((k) => /^(ANTHROPIC_|CLAUDE_CODE_USE_)/.test(k)),
    oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    thinking: process.env.MAX_THINKING_TOKENS,
  }));
  const mode = process.env.FAKE_CLAUDE_MODE;
  if (mode === 'hang') return setTimeout(() => {}, 60_000);
  const usage = { input_tokens: 3004, cache_creation_input_tokens: 500, cache_read_input_tokens: 3400, output_tokens: 2000,
    iterations: [
      { input_tokens: 3000, cache_creation_input_tokens: 500, cache_read_input_tokens: 400, output_tokens: 800, type: 'message' },
      { input_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000, output_tokens: 1200, type: 'message' },
    ] };
  if (mode === 'limit') {
    console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true,
      result: "You've hit your usage limit. Try again later.", usage, api_error_status: 429 }));
    process.exit(1);
  }
  if (mode === 'denied') {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'x', usage,
      structured_output: JSON.parse(process.env.FAKE_CLAUDE_TEXT), permission_denials: [{ tool_name: 'Bash' }] }));
    return;
  }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', usage,
    stop_reason: 'tool_use', num_turns: 2, structured_output: JSON.parse(process.env.FAKE_CLAUDE_TEXT),
    permission_denials: [], api_error_status: null, total_cost_usd: 0.01, session_id: 'sess-1',
    modelUsage: { 'claude-haiku-4-5': {} } }));
});
`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-claude-'));
  bin = join(dir, 'claude');
  await writeFile(bin, FAKE);
  await chmod(bin, 0o755);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function run(mode: string, limits = {}) {
  const f = extractionFixture(),
    log = join(dir, `${mode}.json`);
  Object.assign(process.env, {
    FAKE_CLAUDE_MODE: mode,
    FAKE_CLAUDE_LOG: log,
    FAKE_CLAUDE_TEXT: f.reply.text,
    ANTHROPIC_API_KEY: 'sk-ant-SYNTHETIC-NOT-A-KEY',
    ANTHROPIC_BASE_URL: 'https://example.invalid',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-SYNTHETIC',
  });
  try {
    const provider = createClaudeProvider({ model: 'claude-haiku-4-5-20251001', bin });
    const trace = await runExtraction(f.input, provider, { limits });
    const seen = await readFile(log, 'utf8').then(JSON.parse, () => undefined);
    return { f, trace, seen };
  } finally {
    for (const name of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ])
      delete process.env[name];
  }
}

it('runs claude -p as a headless structured extraction and records subscription identity', async () => {
  const { f, trace, seen } = await run('ok');
  expect(trace.status).toBe('evidence_valid');
  expect(trace.provider).toEqual({
    id: 'claude-cli',
    model: 'claude-haiku-4-5-20251001',
    mode: 'subscription',
    pricing: { input: 0, output: 0 },
  });
  expect(trace.accountedMicrousd).toBe(0);
  // Input is the largest turn's prompt (fresh + cache-written + cache-read, so cache reads on turn 1 count);
  // output is the total over the CLI's turns.
  expect(trace.attempts[0].usage).toEqual({ inputTokens: 3900, outputTokens: 2000 });
  // The canonical model the CLI resolved is kept beside the requested one.
  expect(trace.attempts[0].providerResponse).toEqual({ id: 'sess-1', model: 'claude-haiku-4-5' });
  expect(trace.extraction).toEqual(f.output);

  const arg = (name: string) => seen.args[seen.args.indexOf(name) + 1];
  expect(arg('--system-prompt')).toContain('Extract credit-card reward facts');
  expect(JSON.parse(arg('--json-schema'))).toMatchObject({ type: 'object', additionalProperties: false });
  expect(seen.stdin).toContain('"contextVersion"');
  expect(seen.args).toEqual(
    expect.arrayContaining([
      '-p',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--strict-mcp-config',
    ]),
  );
  expect(arg('--tools')).toBe('');
  expect(arg('--effort')).toBe('low');
  expect(arg('--setting-sources')).toBe('');
  // The run happens in an empty scratch directory, and metered credentials never reach the CLI.
  expect(seen.cwd).toMatch(/aicheckout-claude-/);
  expect(seen.hasKey).toBe(false);
  expect(seen.oauth).toBe('oauth-SYNTHETIC');
  expect(seen.thinking).toBe('0');
});

it('classifies usage limits as rate limiting and retries once', async () => {
  const { trace } = await run('limit');
  expect(trace.status).toBe('provider_error');
  expect(trace.attempts.map((attempt) => attempt.outcome)).toEqual(['rate-limit', 'rate-limit']);
});

it('rejects a run in which a tool was attempted', async () => {
  const { trace } = await run('denied');
  expect(trace.status).toBe('provider_error');
  expect(trace.attempts).toHaveLength(1);
});

it('kills a hung CLI at the attempt deadline', async () => {
  const started = Date.now();
  const { trace } = await run('hang', { attemptTimeoutMs: 1500, totalTimeoutMs: 2000, maxAttempts: 1 });
  expect(trace.status).toBe('timeout');
  expect(Date.now() - started).toBeLessThan(5000);
});

it('parses results and classifies failures', () => {
  const usage = { input_tokens: 5, output_tokens: 2 };
  expect(parseClaudeResult(JSON.stringify({ is_error: false, structured_output: { a: 1 }, usage }))).toEqual({
    finishReason: 'stop',
    text: '{"a":1}',
    usage: { inputTokens: 5, outputTokens: 2 },
  });
  const failure = (raw: unknown) => {
    try {
      parseClaudeResult(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (error) {
      return error instanceof ProviderFailure ? error.category : 'other';
    }
    return 'none';
  };
  expect(failure('not json')).toBe('transient');
  expect(failure({ is_error: true, result: 'Rate limit exceeded', usage })).toBe('rate-limit');
  expect(failure({ is_error: true, result: 'x', usage, api_error_status: 429 })).toBe('rate-limit');
  expect(failure({ is_error: true, result: 'Not logged in. Please run claude login', usage })).toBe(
    'permanent',
  );
  expect(failure({ is_error: true, result: 'Internal server error', usage })).toBe('transient');
  expect(failure({ is_error: true, result: 'Overloaded', usage, api_error_status: 529 })).toBe('transient');
  // Only an error result is classified from its text: a successful reply mentioning a limit is not a limit.
  expect(
    parseClaudeResult(JSON.stringify({ is_error: false, result: 'rate limit', structured_output: {}, usage }))
      .text,
  ).toBe('{}');
  // Per-turn prompt tokens, including cache reads on the first turn; output summed over turns.
  const turns = {
    input_tokens: 5,
    cache_read_input_tokens: 100,
    output_tokens: 30,
    iterations: [
      { input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 10 },
      { input_tokens: 0, cache_read_input_tokens: 105, output_tokens: 20 },
    ],
  };
  expect(
    parseClaudeResult(JSON.stringify({ is_error: false, structured_output: {}, usage: turns })).usage,
  ).toEqual({ inputTokens: 105, outputTokens: 30 });
  const two = {
    is_error: false,
    structured_output: {},
    usage,
    session_id: 's',
    modelUsage: { a: {}, b: {} },
  };
  expect(parseClaudeResult(JSON.stringify(two), 'b').providerResponse).toEqual({ id: 's', model: 'b' });
  expect(parseClaudeResult(JSON.stringify(two), 'c').providerResponse).toEqual({ id: 's', model: 'a+b' });
  expect(
    failure({
      is_error: true,
      result: 'API Error: 400 Claude Code does not support this model',
      usage,
      api_error_status: 400,
    }),
  ).toBe('permanent');
  // A text-only reply without structured output is returned as text, for the runner to record as invalid output.
  expect(parseClaudeResult(JSON.stringify({ is_error: false, result: 'not json', usage })).text).toBe(
    'not json',
  );
});
