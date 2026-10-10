// detect.mjs without a browser: the quick loop is development-only, a scored held-out run needs its own
// confirmation and has its own one-run limit (apart from the reader's two), detector rows validate in runs.json,
// and the summary's metrics (recall, false shows per state, amount vs rates, times by hint).
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { badgeShows, detectRun, metricsOf, summarizeDetection } from '../detect.mjs';
import { appendRun, checkRunAllowed, readRuns } from '../lib.mjs';
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
const row = (n, kind, split = 'heldout-a') => ({
  runId: `20261010T00000${n}Z-${split}-00000${n}`,
  utc: '2026-10-10T00:00:00.000Z',
  readerCommit: 'abc1234',
  readerDirty: false,
  split,
  heldoutRun: split === 'development' ? null : n,
  frozenLabelSha256: H('a'),
  frozenVariantLabelSha256: H('a'),
  freezeSha256: H('f'),
  readerBundleSha256: H('b'),
  ...(kind === 'detector' ? {} : { legacyBundleSha256: H('c') }),
  chromium: '140.0',
  pageStates: 1,
  variants: 0,
  status: 'complete',
  ...(kind ? { kind } : {}),
});

test('the quick loop runs development only', async () => {
  const e = env();
  await assert.rejects(detectRun({ split: 'heldout-a', ...e }), /quick loop runs development only/);
});

test('a scored held-out run needs --confirm-heldout-run 1 and the detector gets one run in total', async () => {
  const e = env();
  const runs = path.join(e.root, 'runs.json');
  await assert.rejects(detectRun({ split: 'heldout-a', scored: true, ...e }), /detector run 1 of 1 needs --confirm-heldout-run 1/);
  await assert.rejects(detectRun({ split: 'heldout-a', scored: true, confirmHeldoutRun: '2', ...e }), /not this run's number 1 of 1/);
  // Two reader runs do not use the detector's run, and the detector's run does not use the reader's.
  appendRun(runs, row(1, null));
  appendRun(runs, row(2, null));
  assert.equal(checkRunAllowed(readRuns(runs), 'heldout-a', '1', 'detector'), 1);
  appendRun(runs, { ...row(3, 'detector'), heldoutRun: 1 }, { confirm: '1' });
  assert.throws(() => checkRunAllowed(readRuns(runs), 'heldout-a', '2', 'detector'), /detector has used 1 of 1 runs/);
  await assert.rejects(detectRun({ split: 'heldout-a', scored: true, confirmHeldoutRun: '2', ...e }), /used 1 of 1 runs/);
  assert.throws(() => checkRunAllowed(readRuns(runs), 'heldout-a', '3'), /used 2 of 2 runs/);
  assert.equal(readRuns(runs).runs.filter((r) => r.kind === 'detector').length, 1);
});

test('detector rows are text-free and validated; a reader row without kind still parses', () => {
  const e = env();
  const runs = path.join(e.root, 'runs.json');
  appendRun(runs, row(1, 'detector'));
  appendRun(runs, row(2, null));
  assert.throws(() => appendRun(runs, { ...row(3, 'detector'), url: 'https://h.example/cart' }));
  assert.throws(() => appendRun(runs, { ...row(3, 'other') }));
  assert.deepEqual(
    readRuns(runs).runs.map((r) => r.kind ?? 'reader'),
    ['detector', 'reader'],
  );
});

const page = (id, state, detection, reading, { hinted = true, ms = [5] } = {}) => ({
  id,
  state,
  url: `https://${id.split('/')[0]}/x`,
  detection,
  reading,
  hinted,
  ms,
  consistent: true,
  show: badgeShows(detection, reading),
});
const cart = { page: 'cart', reason: 'url-summary' };
const none = { page: 'none', reason: 'no-hint' };
const shown = { shown: true, kind: 'estimatedTotal', amountMinor: 1200, currency: 'USD' };
const zero = { shown: true, kind: 'estimatedTotal', amountMinor: 0, currency: 'USD' };
const withheld = { shown: false, reason: 'no-summary' };

test('badgeShows: a positive detection unless the reader shows a zero amount', () => {
  assert.equal(badgeShows(cart, shown), true);
  assert.equal(badgeShows(cart, withheld), true);
  assert.equal(badgeShows(cart, zero), false);
  assert.equal(badgeShows({ page: 'checkout', reason: 'url-summary' }, withheld), true);
  assert.equal(badgeShows(none, shown), false);
});

test('summarizeDetection: recall, false shows per state with bounds, amount vs rates, times by hint', () => {
  const rows = [
    page('a.example/cart-1', 'cart-1', cart, shown, { ms: [8] }),
    page('a.example/cart-qty2', 'cart-qty2', cart, withheld, { ms: [12] }),
    page('b.example/cart-1', 'cart-1', none, withheld, { hinted: false, ms: [0.2] }),
    page('b.example/cart-other', 'cart-other', cart, zero, { ms: [30] }),
    page('c.example/cart-2items', 'cart-2items', { page: 'checkout', reason: 'url-items' }, shown, { ms: [6] }),
    page('a.example/minicart-1', 'minicart-1', none, withheld, { hinted: false, ms: [0.1] }),
    page('b.example/minicart-1', 'minicart-1', cart, shown, { ms: [9] }),
    page('a.example/empty-cart', 'empty-cart', cart, zero, { ms: [7] }),
    page('b.example/empty-cart', 'empty-cart', none, withheld, { ms: [4] }),
  ];
  const s = summarizeDetection(rows);
  assert.equal(s.pages, 9);
  assert.deepEqual([s.recall.k, s.recall.n, s.recall.rate], [3, 5, 0.6]);
  assert.deepEqual(s.recall.byState, {
    'cart-1': { n: 2, shown: 1 },
    'cart-qty2': { n: 1, shown: 1 },
    'cart-2items': { n: 1, shown: 1 },
    'cart-other': { n: 1, shown: 0 },
  });
  assert.deepEqual(s.recall.stores, { n: 3, allShown: 2 });
  assert.deepEqual([s.falseShows['minicart-1'].k, s.falseShows['minicart-1'].n], [1, 2]);
  assert.deepEqual(s.falseShows['minicart-1'].stores, { n: 2, withFalseShow: 1 });
  assert.deepEqual([s.falseShows['empty-cart'].k, s.falseShows['empty-cart'].n], [0, 2]);
  assert.equal(s.falseShows['empty-cart'].ruleOfThree, 1.5);
  assert.ok(s.falseShows['empty-cart'].clopperPearsonUpper95 > 0.77 && s.falseShows['empty-cart'].clopperPearsonUpper95 < 0.78);
  assert.deepEqual(s.shownPositives, { amountView: 2, ratesView: 1 });
  assert.deepEqual(s.detectMs.unhinted, { n: 2, p95: 0.2, max: 0.2 });
  assert.deepEqual(s.detectMs.hinted, { n: 7, p95: 30, max: 30 });
  assert.equal(s.errors, 0);
  const m = metricsOf(s);
  assert.deepEqual(
    [m.positives, m.positivesShown, m.recall, m.minicartFalseShows, m.emptyCartFalseShows, m.amountView, m.ratesView],
    [5, 3, 0.6, 1, 0, 2, 1],
  );
  for (const v of Object.values(m)) assert.ok(typeof v === 'number' || v === null, 'metrics are numbers');
});
