import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { executeTask } from '../../apps/api/src/curation/runner.ts';
import { loadCorpusV2 } from '../../apps/api/src/curation/v2/corpus.ts';
import { referenceProvider } from '../../apps/api/src/curation/v2/evaluate.ts';
import { extractionTaskV2 } from '../../apps/api/src/curation/v2/task.ts';
import { bundleFromTraces, scoreSubsets } from './expansion-traces.mjs';

const FIXTURE = fileURLToPath(new URL('../../evals/curation/fixture.v2/', import.meta.url));
const CONFIG = {
  provider: 'codex',
  model: 'gpt-5.6-luna',
  effort: 'xhigh',
  prompt: 'guided.2',
  selection: 'keyword-window.1',
  outputTokens: 'visible',
};
let dir, loaded, files;

// The fixture corpus in the expansion layout, and one reference-echo trace file per case in the format
// scripts/extract-cards.mjs writes (no model call).
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'expansion-traces-'));
  await mkdir(join(dir, 'captures'));
  await copyFile(join(FIXTURE, 'corpus.v2.json'), join(dir, 'corpus.json'));
  await copyFile(join(FIXTURE, 'manifest.json'), join(dir, 'manifest.json'));
  for (const name of await readdir(join(FIXTURE, 'captures')))
    await copyFile(join(FIXTURE, 'captures', name), join(dir, 'captures', name));
  loaded = await loadCorpusV2(dir, { layout: 'expansion' });
  const task = extractionTaskV2(CONFIG.prompt, CONFIG.selection);
  files = [];
  for (const { item, input } of loaded.cases) {
    const trace = await executeTask(task, input, referenceProvider(item), {
      limits: { maxInputTokens: 64_000 },
    });
    files.push({ cardId: item.id, configuration: CONFIG, cliVersion: 'codex-cli 0.0.0', trace });
  }
});
after(() => rm(dir, { recursive: true, force: true }));

test('scores saved traces on all, drafted and undrafted cards', () => {
  const extra = { ...files[0], cardId: 'dropped-card' };
  const { bundle, skipped, missing } = bundleFromTraces(loaded, [extra, ...files]);
  assert.deepEqual(skipped, ['dropped-card']);
  assert.deepEqual(missing, []);
  assert.equal(bundle.configuration.split, 'heldout');
  assert.deepEqual(bundle.configuration.provider, {
    id: 'codex-cli',
    model: 'gpt-5.6-luna',
    mode: 'subscription',
    cliVersions: ['codex-cli 0.0.0'],
    outputTokens: 'visible',
  });
  const drafted = new Set(loaded.cases.slice(0, 5).map(({ item }) => item.id));
  const result = scoreSubsets(loaded, bundle, drafted);
  assert.equal(result.all.observed, 8);
  assert.equal(result.drafted.observed, 5);
  assert.equal(result.undrafted.observed, 3);
  for (const row of [result.all, result.drafted, result.undrafted]) {
    assert.equal(row.complete, true);
    assert.equal(row.overall.endToEndFieldAccuracy.rate, 1);
  }
  assert.equal(result.byIssuer['Example Bank'].runs, 8);
});

test('rejects traces collected on other text, mixed configurations and duplicates', () => {
  const tampered = structuredClone(files);
  tampered[0].trace.documents[0].contentHash = '0'.repeat(64);
  const { bundle } = bundleFromTraces(loaded, tampered);
  assert.throws(() => scoreSubsets(loaded, bundle, new Set()), /collected on different source text/);

  const mixed = [{ ...files[0], configuration: { ...CONFIG, effort: 'low' } }, ...files.slice(1)];
  assert.throws(() => bundleFromTraces(loaded, mixed), /2 configurations/);
  assert.throws(() => bundleFromTraces(loaded, [files[0], files[0]]), /Two traces/);
  const { missing } = bundleFromTraces(loaded, files.slice(1));
  assert.deepEqual(missing, [files[0].cardId]);
});
