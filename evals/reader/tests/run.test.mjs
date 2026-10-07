// run.mjs refusals without a browser: missing or failing freeze, held-out run limit and confirmation, and the
// reader bundle checks (only packages/cart-reader/src, no data-pane-* cue).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { bundleReader } from '../bundle.mjs';
import { appendRun, checkRunAllowed, readRuns } from '../lib.mjs';
import { run } from '../run.mjs';
import { frozenEnv, label } from './helpers.mjs';

const H = (c) => c.repeat(64);
const env = () =>
  frozenEnv({
    labels: { development: [label('d.example/cart-1')], 'heldout-a': [label('h.example/cart-1')] },
    frame: [
      { domain: 'd.example', operator: 'd', regionGroup: 'us' },
      { domain: 'h.example', operator: 'h', regionGroup: 'europe' },
    ],
  });
const row = (n, split = 'heldout-a') => ({
  runId: `20261007T00000${n}Z-${split}-00000${n}`,
  utc: '2026-10-07T00:00:00.000Z',
  readerCommit: 'abc1234',
  readerDirty: false,
  split,
  heldoutRun: split === 'development' ? null : n,
  frozenLabelSha256: H('a'),
  frozenVariantLabelSha256: H('a'),
  freezeSha256: H('f'),
  readerBundleSha256: H('b'),
  legacyBundleSha256: H('c'),
  chromium: '140.0',
  pageStates: 1,
  variants: 0,
  // A run that crashed still counts.
  status: n === 1 ? 'failed' : 'complete',
});

test('run refuses without evals/merchants/freeze.json', async () => {
  const e = env();
  rmSync(path.join(e.root, 'freeze.json'));
  await assert.rejects(run({ split: 'development', ...e }), /no freeze file/);
});

test('run refuses when freeze.mjs --check fails (a frozen file changed)', async () => {
  const e = env();
  writeFileSync(path.join(e.root, 'final-heldout-a.json'), '{"changed":true}');
  await assert.rejects(run({ split: 'development', ...e }), /freeze check failed.*SHA-256 differs/);
});

test('run refuses when a pane snapshot of the freeze changed', async () => {
  const e = frozenEnv({
    pages: { 'd.example/cart-1': { format: 'pane-dom.2', root: { t: 'html' } } },
    labels: { development: [label('d.example/cart-1')] },
    frame: [{ domain: 'd.example', operator: 'd', regionGroup: 'us' }],
  });
  writeFileSync(path.join(e.root, 'data', 'pane', 'd.example', 'cart-1', 'full.png'), 'x');
  await assert.rejects(run({ split: 'development', ...e }), /fullSha256 differs/);
});

test('held-out: needs --confirm-heldout-run with this run number; at most two runs in total', async () => {
  const e = env();
  const runs = path.join(e.root, 'runs.json');
  await assert.rejects(run({ split: 'heldout-a', ...e }), /needs --confirm-heldout-run 1/);
  await assert.rejects(run({ split: 'heldout-a', confirmHeldoutRun: '2', ...e }), /not this run's number 1/);
  await assert.rejects(run({ split: 'development', confirmHeldoutRun: '1', ...e }), /held-out splits only/);
  appendRun(runs, row(1));
  appendRun(runs, row(1, 'development'));
  assert.throws(() => checkRunAllowed(readRuns(runs), 'heldout-a', '1'), /not this run's number 2/);
  assert.equal(checkRunAllowed(readRuns(runs), 'heldout-a', '2'), 2);
  appendRun(runs, row(2));
  await assert.rejects(run({ split: 'heldout-a', confirmHeldoutRun: '3', ...e }), /used 2 of 2 runs/);
  assert.equal(checkRunAllowed(readRuns(runs), 'development', null), null);
});

test('runs.json rows are text-free and validated', () => {
  const e = env();
  const runs = path.join(e.root, 'runs.json');
  assert.throws(() => appendRun(runs, { ...row(1), domain: 'h.example' }));
  assert.throws(() => appendRun(runs, { ...row(1), runId: 'h.example' }));
  appendRun(runs, row(1));
  assert.throws(() => appendRun(runs, row(1)), /already logged/);
});

function readerRoot(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-bundle-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('bundle: the placeholder bundles from packages/cart-reader/src only', async () => {
  const b = await bundleReader();
  assert.deepEqual(b.inputs, ['packages/cart-reader/src/index.ts', 'packages/cart-reader/src/types.ts']);
  assert.match(b.code, /__aiCheckoutCartReader/);
});

test('bundle: refuses a reader that reads data-pane-* attributes', async () => {
  const root = readerRoot({
    'packages/cart-reader/src/index.ts':
      "export const readCart = (d: Document) => d.querySelector('[data-pane-box]') ? { shown: false, reason: 'x' } : { shown: false, reason: 'y' };",
  });
  await assert.rejects(bundleReader({ root }), /data-pane/);
  const viaDataset = readerRoot({
    'packages/cart-reader/src/index.ts':
      "export const readCart = (d: Document) => ({ shown: false, reason: (d.body as HTMLElement).dataset.paneBox ?? 'x' });",
  });
  await assert.rejects(bundleReader({ root: viaDataset }), /data-pane/);
});

test('bundle: refuses a reader that imports a file outside packages/cart-reader/src (e.g. a frame)', async () => {
  const root = readerRoot({
    'evals/merchants/retail-frame-3.json': '{"domains":[]}',
    'packages/cart-reader/src/index.ts':
      "import frame from '../../../evals/merchants/retail-frame-3.json';\nexport const readCart = () => ({ shown: false, reason: String(frame.domains.length) });",
  });
  await assert.rejects(bundleReader({ root }), /may only contain packages\/cart-reader\/src/);
});

test('review 8: heldout-fresh (or any other split) is refused', async () => {
  const e = env();
  await assert.rejects(
    run({ split: 'heldout-fresh', confirmHeldoutRun: '1', ...e }),
    /unknown split heldout-fresh/,
  );
  await assert.rejects(run({ split: 'heldout-b', ...e }), /unknown split/);
});

test('review 4: appendRun holds an O_EXCL lock and re-checks the run limit inside it', () => {
  const e = env();
  const runs = path.join(e.root, 'runs.json');
  appendRun(runs, row(1), { confirm: '1' });
  // Another run took the last run between this run's check and its append.
  appendRun(runs, row(2));
  assert.throws(() => appendRun(runs, { ...row(3), heldoutRun: 2 }, { confirm: '2' }), /used 2 of 2/);
  writeFileSync(`${runs}.lock`, '');
  assert.throws(() => appendRun(runs, row(3, 'development')), /lock exists/);
  rmSync(`${runs}.lock`);
  appendRun(runs, row(3, 'development'), { confirm: null });
  assert.equal(readRuns(runs).runs.length, 3);
});

test('review 3: answer-lookup tripwire refuses a bundle with a split domain or many frame domains', async () => {
  const root = readerRoot({
    'packages/cart-reader/src/index.ts':
      "const M: Record<string, string> = { 'shop.example': 'CAD' };\nexport const readCart = (_d: Document, o: { url: string }) => ({ shown: false, reason: M[new URL(o.url).hostname] ? 'a' : 'b' });",
  });
  await assert.rejects(
    bundleReader({ root, splitDomains: ['shop.example'], frameDomains: ['shop.example'] }),
    /domain\(s\) of the split being run/,
  );
  // A domain of another split: allowed up to three, refused beyond.
  await bundleReader({ root, splitDomains: ['other.example'], frameDomains: ['shop.example'] });
  const many = readerRoot({
    'packages/cart-reader/src/index.ts':
      "const L = ['a1.example', 'a2.example', 'a3.example', 'a4.example'];\nexport const readCart = () => ({ shown: false, reason: String(L.length) });",
  });
  const frameDomains = ['a1.example', 'a2.example', 'a3.example', 'a4.example'];
  await assert.rejects(bundleReader({ root: many, frameDomains }), /4 retail-frame-3 domains/);
  // Parts of longer host names don't count.
  await bundleReader({ root: many, frameDomains: ['1.example', 'example'] });
});

test('re-check A: a browser-free preflight refuses a rebuild mismatch before the run is logged', async () => {
  const e = frozenEnv({
    pages: { 'd.example/cart-1': { format: 'pane-dom.2', root: { t: 'html' } } },
    labels: { development: [label('d.example/cart-1')] },
    frame: [{ domain: 'd.example', operator: 'd', regionGroup: 'us' }],
    staleRebuild: ['d.example/cart-1'],
  });
  await assert.rejects(
    run({ split: 'development', ...e, testOnlyReaderCommit: 'abc1234' }),
    /d\.example\/cart-1: the rebuild differs from the frozen rebuilt\.html/,
  );
  assert.deepEqual(readRuns(path.join(e.root, 'runs.json')).runs, [], 'no row in runs.json');
});

test('re-check E: a development run refuses a reader that names a held-out domain', async () => {
  const e = env();
  const src = readerRoot({
    'packages/cart-reader/src/index.ts':
      "export const readCart = (_d: Document, o: { url: string }) => ({ shown: false, reason: o.url.includes('h.example') ? 'a' : 'b' });",
  });
  await assert.rejects(
    run({ split: 'development', ...e, readerRoot: src, testOnlyReaderCommit: 'abc1234' }),
    /domain\(s\) of the split being run/,
  );
  assert.deepEqual(readRuns(path.join(e.root, 'runs.json')).runs, []);
});

test('review 2: the legacy bundle holds the three extension adapters only', async () => {
  const b = await bundleReader({ mode: 'legacy' });
  assert.ok(b.inputs.includes('extension/src/checkout/page-reader.ts'));
  assert.ok(b.inputs.includes('extension/src/checkout/adapters/amazon-us.json'));
  assert.ok(
    b.inputs.every((p) =>
      /^(evals\/reader\/legacy-entry\.ts|extension\/src\/checkout\/|packages\/rewards-core\/src\/)/.test(p),
    ),
  );
});
