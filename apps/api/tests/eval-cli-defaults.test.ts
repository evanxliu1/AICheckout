import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CURATION_DEFAULTS } from '../src/curation/curation-model.ts';
import { defaultsFor, runEvaluationV2Cli } from '../src/curation/v2/eval-cli.ts';

const FIXTURE = resolve(import.meta.dirname, '../../../evals/curation/fixture.v2');
// A fake `codex` that logs its argv and answers with an empty extraction; never a real model call.
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
if (args[0] === 'features') { console.log('shell_tool   stable  true'); process.exit(0); }
process.stdin.resume();
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(args) + '\\n');
  const emit = (event) => console.log(JSON.stringify(event));
  emit({ type: 'item.completed', item: { type: 'agent_message', text: '{}' } });
  emit({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 10 } });
});
`;

it('starts Codex runs from the curation model unless --model names another', () => {
  expect(defaultsFor('codex', undefined)).toBe(CURATION_DEFAULTS);
  expect(defaultsFor('codex', 'gpt-5.6-luna')).toBe(CURATION_DEFAULTS);
  expect(defaultsFor('codex', 'gpt-5.5')).toMatchObject({
    effort: 'low',
    prompt: 'guided.1',
    selection: 'full',
    codexOutputTokens: 'total',
  });
  expect(defaultsFor('claude', undefined).model).toBeUndefined();
});

it('runs gpt-5.6-luna xhigh with visible output tokens and long deadlines by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eval-defaults-'));
  const bin = join(dir, 'codex'),
    log = join(dir, 'args.jsonl');
  await writeFile(bin, FAKE);
  await chmod(bin, 0o755);
  Object.assign(process.env, { AICHECKOUT_CODEX_BIN: bin, FAKE_CODEX_LOG: log });
  const root = resolve(import.meta.dirname, '../../..');
  try {
    const run = (name: string, extra: string[]) =>
      runEvaluationV2Cli(
        ['--provider', 'codex', '--corpus', FIXTURE, '--limit', '1', '--output', join(dir, name), ...extra],
        root,
      );
    const report = await run('default', []);
    expect(report!.configuration).toMatchObject({
      provider: { id: 'codex-cli', model: 'gpt-5.6-luna', outputTokens: 'visible' },
      effort: 'xhigh',
      prompt: 'guided.2',
      selection: 'keyword-window.1',
    });
    const saved = JSON.parse(await readFile(join(dir, 'default', 'observations.json'), 'utf8'));
    expect(saved.observations[0].trace.limits).toMatchObject({
      attemptTimeoutMs: 600_000,
      totalTimeoutMs: 900_000,
    });
    const args = JSON.parse((await readFile(log, 'utf8')).trim().split('\n')[0]);
    expect(args).toEqual(expect.arrayContaining(['gpt-5.6-luna', 'model_reasoning_effort="xhigh"']));

    // Flags still override, and another model keeps the older defaults.
    const other = await run('other', ['--model', 'gpt-5.5', '--attempt-timeout-ms', '1000']);
    expect(other!.configuration).toMatchObject({
      provider: { model: 'gpt-5.5' },
      effort: 'low',
      prompt: 'guided.1',
      selection: 'full',
    });
    expect(other!.configuration.provider).not.toHaveProperty('outputTokens');
    const otherSaved = JSON.parse(await readFile(join(dir, 'other', 'observations.json'), 'utf8'));
    expect(otherSaved.observations[0].trace.limits).toMatchObject({
      attemptTimeoutMs: 1000,
      totalTimeoutMs: 480_000,
    });
    process.exitCode = 0;
  } finally {
    delete process.env.AICHECKOUT_CODEX_BIN;
    delete process.env.FAKE_CODEX_LOG;
    await rm(dir, { recursive: true, force: true });
  }
});
