import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLayout, loadCorpusV2 } from '../src/curation/v2/corpus.ts';
import { runEvaluationV2Cli } from '../src/curation/v2/eval-cli.ts';

const FIXTURE = resolve(import.meta.dirname, '../../../evals/curation/fixture.v2');
const ROOT = resolve(import.meta.dirname, '../../..');
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

let dir: string, corpus: string, captures: string;
/** The fixture corpus laid out like evals/curation/expansion: corpus.json, captures in another folder. */
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-expansion-'));
  corpus = join(dir, 'corpus');
  captures = join(dir, 'captures-elsewhere');
  await mkdir(corpus);
  await mkdir(captures);
  await copyFile(join(FIXTURE, 'corpus.v2.json'), join(corpus, 'corpus.json'));
  await copyFile(join(FIXTURE, 'manifest.json'), join(corpus, 'manifest.json'));
  for (const name of await readdir(join(FIXTURE, 'captures')))
    await copyFile(join(FIXTURE, 'captures', name), join(captures, name));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Pad the manifest with unused sources up to `count`. */
async function padManifest(path: string, count: number) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const template = manifest.sources[0];
  for (let i = manifest.sources.length; i < count; i++)
    manifest.sources.push({ ...template, id: `padding-${i}` });
  await writeFile(path, JSON.stringify(manifest));
}

describe('expansion corpus layout', () => {
  it('reads corpus.json and a captures folder elsewhere, and makes every case held-out', async () => {
    expect(await detectLayout(corpus)).toBe('expansion');
    expect(await detectLayout(FIXTURE)).toBe('v2');
    const loaded = await loadCorpusV2(corpus, { layout: 'expansion', captures });
    const fixture = await loadCorpusV2(FIXTURE);
    expect(loaded.cases.map(({ item }) => item.id)).toEqual(fixture.cases.map(({ item }) => item.id));
    expect(new Set(loaded.cases.map(({ item }) => item.split))).toEqual(new Set(['heldout']));
    expect(fixture.cases.some(({ item }) => item.split === 'dev')).toBe(true);
    // Same documents, so saved traces keep their document hashes.
    expect(loaded.cases.map((c) => c.input)).toEqual(fixture.cases.map((c) => c.input));
    // Without --captures it looks in <dir>/captures, which this layout does not have.
    await expect(loadCorpusV2(corpus, { layout: 'expansion' })).rejects.toThrow(/is missing/);
  });

  it('allows a manifest of up to 400 sources for the expansion only', async () => {
    await padManifest(join(corpus, 'manifest.json'), 321);
    await expect(loadCorpusV2(corpus, { layout: 'expansion', captures })).resolves.toBeTruthy();
    await padManifest(join(corpus, 'manifest.json'), 401);
    await expect(loadCorpusV2(corpus, { layout: 'expansion', captures })).rejects.toThrow();

    const v2 = join(dir, 'v2');
    await mkdir(v2);
    await copyFile(join(FIXTURE, 'corpus.v2.json'), join(v2, 'corpus.v2.json'));
    await copyFile(join(FIXTURE, 'manifest.json'), join(v2, 'manifest.json'));
    await padManifest(join(v2, 'manifest.json'), 101);
    await expect(loadCorpusV2(v2, { captures })).rejects.toThrow();
  });

  it('runs the cross-model command path on a fake codex: held-out only, gpt-5.5 low guided.2', async () => {
    const bin = join(dir, 'codex'),
      log = join(dir, 'args.jsonl');
    await writeFile(bin, FAKE);
    await chmod(bin, 0o755);
    Object.assign(process.env, { AICHECKOUT_CODEX_BIN: bin, FAKE_CODEX_LOG: log });
    const args = (output: string, extra: string[]) => [
      ...['--provider', 'codex', '--model', 'gpt-5.5', '--effort', 'low', '--prompt', 'guided.2'],
      ...['--selection', 'keyword-window.1', '--codex-output-tokens', 'visible'],
      ...['--corpus', corpus, '--captures', captures, '--concurrency', '8', '--output', join(dir, output)],
      ...extra,
    ];
    try {
      await expect(runEvaluationV2Cli(args('a', []), ROOT)).rejects.toThrow(/no dev cases/);
      await expect(runEvaluationV2Cli(args('b', ['--split', 'heldout']), ROOT)).rejects.toThrow(
        /--allow-heldout/,
      );
      const report = await runEvaluationV2Cli(args('c', ['--split', 'heldout', '--allow-heldout']), ROOT);
      expect(report!.configuration).toMatchObject({
        provider: { id: 'codex-cli', model: 'gpt-5.5', outputTokens: 'visible' },
        effort: 'low',
        prompt: 'guided.2',
        selection: 'keyword-window.1',
        split: 'heldout',
      });
      expect(report!.observed).toBe(8);
      expect(report!.corpus.version).toBe('fixture.v2.1');
      const calls = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(calls).toHaveLength(8);
      expect(calls[0]).toEqual(expect.arrayContaining(['gpt-5.5', 'model_reasoning_effort="low"']));
      process.exitCode = 0;
    } finally {
      delete process.env.AICHECKOUT_CODEX_BIN;
      delete process.env.FAKE_CODEX_LOG;
    }
  });
});
