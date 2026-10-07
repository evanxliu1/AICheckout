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
  freezeSha256: H('f'),
  readerBundleSha256: H('b'),
  chromium: '140.0',
  pageStates: 1,
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
