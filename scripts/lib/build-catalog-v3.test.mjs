// scripts/build-catalog-v3.mjs as a command: a published version that does not match its ledger entry is refused
// with nothing written, and a proposed build (--config, --out-dir) writes only to its directory. The configs are
// synthetic variants of the committed one, written to a temporary directory.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHIPPING = [
  'evals/curation/catalog-batches.json',
  'evals/curation/rule-id-ledger.json',
  'packages/rewards-core/src/catalog-v3.ts',
  'evals/curation/expansion/catalog-build-report.md',
];
const snapshot = async () =>
  Promise.all(SHIPPING.map((path) => readFile(join(root, path), 'utf8').catch(() => null)));
const build = (...args) =>
  new Promise((done) =>
    execFile('node', ['scripts/build-catalog-v3.mjs', ...args], { cwd: root }, (error, stdout, stderr) =>
      done({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    ),
  );
const committed = JSON.parse(await readFile(join(root, 'evals/curation/catalog-batches.json'), 'utf8'));
async function configWith(dir, name, fields) {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify({ ...committed, ...fields }, null, 2) + '\n');
  return path;
}

test('a published version without a matching ledger entry is refused, and nothing is written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'build-catalog-v3-'));
  const config = await configWith(dir, 'published.json', {
    version: '2026-10-01.test.1',
    publishedVersions: [...committed.publishedVersions, '2026-10-01.test.1'],
  });
  const before = await snapshot();
  for (const args of [['--config', config], ['--config', config, '--out-dir', join(dir, 'out')]]) {
    const result = await build(...args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /2026-10-01\.test\.1 is published .*the ledger has no entry/);
  }
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await readdir(dir), ['published.json']);
});

test('a proposed build writes the catalog, report and ledger diff to its directory only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'build-catalog-v3-'));
  const config = await configWith(dir, 'proposed.json', { version: '2026-10-05.test.1' });
  const out = join(dir, 'proposed');
  const before = await snapshot();
  const result = await build('--config', config, '--out-dir', out);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual((await readdir(out)).sort(), ['catalog-build-report.md', 'catalog-v3.json', 'ledger-diff.json']);
  const catalog = JSON.parse(await readFile(join(out, 'catalog-v3.json'), 'utf8'));
  assert.equal(catalog.version, '2026-10-05.test.1');
  const diff = JSON.parse(await readFile(join(out, 'ledger-diff.json'), 'utf8'));
  assert.equal(diff.previous.version, committed.version);
  assert.equal(diff.kept, diff.rules);
  assert.deepEqual([diff.changed, diff.added, diff.dropped, diff.idsIssued], [[], [], [], []]);
  assert.match(await readFile(join(out, 'catalog-build-report.md'), 'utf8'), /\*\*Version\*\* `2026-10-05\.test\.1`/);
  // --check compares the proposed files, not the committed ones.
  assert.equal((await build('--config', config, '--out-dir', out, '--check')).code, 0);
});
