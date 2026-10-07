// score.mjs on synthetic labels and outputs: outcomes, classes, levels, coverage, criterion 1, refusals.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { appendRun, readRuns } from '../lib.mjs';
import { failureClass, outcome, report, score } from '../score.mjs';
import { frozenEnv, label, nullExpected } from './helpers.mjs';

const H = (c) => c.repeat(64);
const shown = (kind, amountMinor, currency = 'GBP') => ({ shown: true, kind, amountMinor, currency });
const withheld = { shown: false, reason: 'not-implemented' };
const out = (output, readMs = [1, 1, 1, 1, 1], extra = {}) => ({
  output,
  stable: true,
  consistent: true,
  crash: null,
  readMs,
  ...extra,
});

const labels = [
  label('a.example/cart-1'),
  label('b.example/cart-1'),
  label('c.example/cart-1'),
  label('d.example/cart-1'),
  label('e.example/cart-1', { readable: 'iframe-only', displayed: [], ...nullExpected('not-readable') }),
  label('f.example/cart-1', {
    displayed: [
      { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
      { kind: 'estimatedTotal', amountMinor: 2500, currency: 'GBP' },
    ],
    ...nullExpected('ambiguous-preferred-kind'),
  }),
  label('g.example/cart-1'),
  label('g.example/cart-other'),
  label('h.example/cart-1'),
  label('i.example/cart-1', {
    displayed: [{ kind: 'subtotal', amountMinor: 1299, currency: 'JPY' }],
    expected: { kind: 'subtotal', amountMinor: 1299, currency: 'JPY' },
  }),
  label('a.example/cart-1/class-rename', { origin: 'variant' }),
];
const outputs = new Map([
  ['a.example/cart-1', out(shown('estimatedTotal', 2400))],
  ['b.example/cart-1', out(shown('estimatedTotal', 240000))],
  ['c.example/cart-1', out(shown('estimatedTotal', 2400, 'EUR'))],
  ['d.example/cart-1', out(shown('subtotal', 2000))],
  ['e.example/cart-1', out(shown('subtotal', 100))],
  ['f.example/cart-1', out(withheld)],
  ['g.example/cart-1', out(withheld, [1, 1, 60, 1, 1])],
  ['g.example/cart-other', out(shown('estimatedTotal', 2400))],
  ['i.example/cart-1', out({ shown: false, reason: 'unstable' }, [1, 1, 1, 1, 1], { stable: false })],
  ['a.example/cart-1/class-rename', out(shown('subtotal', 2000))],
]);
const frame = new Map(
  [
    ['a.example', 'op-ab', 'us'],
    ['b.example', 'op-ab', 'us'],
    ['c.example', 'c', 'us'],
    ['d.example', 'd', 'us'],
    ['e.example', 'e', 'europe'],
    ['f.example', 'f', 'europe'],
    ['g.example', 'g', 'asia-pacific'],
    ['h.example', 'h', 'europe'],
    ['i.example', 'i', 'asia-pacific'],
  ].map(([domain, operator, regionGroup]) => [
    domain,
    { operator, regionGroup, stream: regionGroup === 'us' ? 'us' : 'non-us' },
  ]),
);

test('outcome: shown-correct needs the same amount, kind and currency as E', () => {
  const l = label('a.example/cart-1');
  assert.equal(outcome(l, shown('estimatedTotal', 2400)), 'shown-correct');
  assert.equal(outcome(l, shown('estimatedTotal', 2401)), 'shown-wrong');
  assert.equal(outcome(l, shown('estimatedTotal', 2400, 'USD')), 'shown-wrong');
  // The subtotal row is displayed with that amount, but subtotal is not E's (most preferred) kind.
  assert.equal(outcome(l, shown('subtotal', 2000)), 'shown-wrong');
  assert.equal(outcome(l, withheld), 'withheld');
  const nul = label('x.example/cart-1', nullExpected('no-total-displayed', { displayed: [] }));
  assert.equal(outcome(nul, shown('subtotal', 1)), 'shown-wrong');
  assert.equal(outcome(nul, withheld), 'withheld');
});

test('failure classes from the label and output alone', () => {
  const l = label('a.example/cart-1');
  assert.equal(failureClass(l, shown('estimatedTotal', 2400)), null);
  assert.equal(failureClass(l, shown('estimatedTotal', 2400, 'EUR')), 'currency');
  assert.equal(failureClass(l, shown('subtotal', 2000)), 'kind-wrong');
  assert.equal(failureClass(l, shown('estimatedTotal', 9)), 'needs-analyst');
  assert.equal(failureClass(l, withheld), 'coverage-miss');
  for (const [reason, cls] of [
    ['not-readable', 'unreadable-shown'],
    ['ambiguous-preferred-kind', 'tie-shown'],
    ['currency-undetermined', 'currency'],
    ['no-total-displayed', 'needs-analyst'],
  ]) {
    const n = label('x.example/cart-1', nullExpected(reason));
    assert.equal(failureClass(n, shown('subtotal', 1)), cls);
    assert.equal(failureClass(n, withheld), null);
  }
});

test('report: counts, three levels, coverage without cart-other, variants apart', () => {
  const r = report({ split: 'heldout-a', runId: 'r', labels, outputs, frame });
  assert.deepEqual(r.whole.counts, {
    shownCorrect: 2,
    shownWrong: 4,
    withheld: 3,
    withheldExpected: 2,
    withheldNull: 1,
    missing: 1,
    crash: 0,
    unstable: 1,
  });
  assert.equal(r.whole.pageStates, 10);
  assert.equal(r.whole.pageState.precision.k, 2);
  assert.equal(r.whole.pageState.precision.n, 6);
  assert.equal(r.whole.pageState.wrongRate.k, 4);
  assert.ok(r.whole.pageState.wrongRate.clopperPearsonUpper95 > 0.6);
  // Coverage: E not null and not cart-other: a b c d g h i; only a is shown-correct (g/cart-other is excluded).
  assert.deepEqual([r.whole.pageState.coverage.k, r.whole.pageState.coverage.n], [1, 7]);
  // Sites with a shown amount: a b c d e g; failing b c d e. Operators: op-ab (a, b) fails, c d e fail, g passes.
  assert.deepEqual([r.whole.siteCluster.wrongRate.k, r.whole.siteCluster.wrongRate.n], [4, 6]);
  assert.deepEqual([r.whole.operatorCluster.wrongRate.k, r.whole.operatorCluster.wrongRate.n], [4, 5]);
  assert.deepEqual(Object.keys(r.byStream), ['non-us', 'us']);
  assert.equal(r.byState['cart-other'].pageState.coverage.n, 0);
  assert.equal(r.byState['cart-other'].counts.shownCorrect, 1);
  // GBP has 7 sites; JPY 1 site is below the 5-site minimum.
  assert.deepEqual(Object.keys(r.byCurrency), ['GBP']);
  assert.equal(r.currenciesBelowMinSites, 1);
  assert.equal(r.byUsd['non-USD'].pageStates, 8);
  assert.equal(r.byUsd['no-expected'].pageStates, 2);
  assert.equal(r.variants.labelled, 1);
  assert.equal(r.variants.byTransform['class-rename'].counts.shownWrong, 1);
  assert.equal(r.timing.timedReads, 45);
  assert.equal(r.timing.pageStatesOverBudget, 1);
  assert.equal(r.criterion1.complete, false);
  assert.equal(r.criterion1.passed, false);
  assert.deepEqual(r.classes, {
    us: { 'needs-analyst': 1, currency: 1, 'kind-wrong': 1 },
    'non-us': {
      'unreadable-shown': 1,
      'coverage-miss': 2,
      'over-budget': 1,
      missing: 1,
      stability: 1,
    },
  });
});

function allCorrect(n, readMs = [1, 2, 3, 4, 5]) {
  const ls = [];
  const os = new Map();
  const fr = new Map();
  for (let i = 0; i < n; i += 1) {
    const id = `s${i}.example/cart-1`;
    ls.push(label(id));
    os.set(id, out(shown('estimatedTotal', 2400), readMs));
    fr.set(`s${i}.example`, { operator: `o${i}`, regionGroup: 'europe', stream: 'non-us' });
  }
  return { labels: ls, outputs: os, frame: fr };
}

test('criterion 1: 299 correct of 299 passes on held-out; 298 does not; p95 over 50 ms fails', () => {
  const r = report({ split: 'heldout-a', runId: 'r', ...allCorrect(299) });
  assert.ok(r.criterion1.wrongRateUpper95 <= 0.01);
  assert.equal(r.criterion1.p95Ms, 5);
  assert.equal(r.criterion1.passed, true);
  assert.equal(r.criterion1.evidence, true);
  assert.equal(r.whole.pageState.wrongRate.ruleOfThree, Math.round((3 / 299) * 1e6) / 1e6);
  assert.equal(report({ split: 'heldout-a', runId: 'r', ...allCorrect(298) }).criterion1.passed, false);
  const slow = report({ split: 'heldout-a', runId: 'r', ...allCorrect(299, [1, 1, 1, 1, 51]) });
  assert.equal(slow.criterion1.precisionMet, true);
  assert.equal(slow.criterion1.timeMet, false);
  assert.equal(slow.criterion1.passed, false);
  // On development the same numbers are never criterion-1 evidence.
  assert.equal(report({ split: 'development', runId: 'r', ...allCorrect(299) }).criterion1.evidence, false);
});

function scoredEnv(split = 'development') {
  const env = frozenEnv({
    labels: { [split]: labels.filter((l) => !l.id.includes('class-rename')) },
    frame: [...frame].map(([domain, f]) => ({ domain, ...f })),
  });
  const runId = `20261007T000000Z-${split}-abcdef`;
  const frozenLabelSha256 = JSON.parse(readFileSync(path.join(env.root, env.freezeFile), 'utf8')).files.find(
    (f) => f.role === 'labels' && f.split === split,
  ).sha256;
  const row = {
    runId,
    utc: '2026-10-07T00:00:00.000Z',
    readerCommit: 'abc1234',
    readerDirty: false,
    split,
    heldoutRun: split === 'development' ? null : 1,
    frozenLabelSha256,
    freezeSha256: H('f'),
    readerBundleSha256: H('b'),
    chromium: '140.0',
    pageStates: 9,
    status: 'complete',
  };
  mkdirSync(path.join(env.root, 'runs', runId), { recursive: true });
  writeFileSync(
    path.join(env.root, 'runs', runId, 'outputs.jsonl'),
    [...outputs]
      .filter(([id]) => !id.includes('class-rename'))
      .map(([id, o]) => JSON.stringify({ id, split, method: 'pane', ...o }))
      .join('\n') + '\n',
  );
  return { env, runId, row };
}

test('score: refuses a run not logged in runs.json, and one made on other frozen labels', () => {
  const { env, runId, row } = scoredEnv();
  assert.throws(() => score({ runId, ...env }), /not logged/);
  appendRun(path.join(env.root, 'runs.json'), { ...row, frozenLabelSha256: H('0') });
  assert.throws(() => score({ runId, ...env }), /other frozen labels/);
});

test('score: refuses when the freeze check fails', () => {
  const { env, runId, row } = scoredEnv();
  appendRun(path.join(env.root, 'runs.json'), row);
  writeFileSync(path.join(env.root, 'final-development.json'), '{}');
  assert.throws(() => score({ runId, ...env }), /freeze check failed/);
});

test('score: held-out class-only output has class counts per stream only; --failures refused', () => {
  const { env, runId, row } = scoredEnv('heldout-a');
  appendRun(path.join(env.root, 'runs.json'), row);
  const r = score({ runId, classOnly: true, ...env });
  assert.deepEqual(Object.keys(r), ['runId', 'split', 'classes']);
  assert.ok(!/example|2400|GBP/.test(JSON.stringify(r)), 'no domain, amount or currency text');
  assert.equal(r.classes.us.currency, 1);
  assert.throws(() => score({ runId, failures: true, ...env }), /class only/);
  const full = score({ runId, ...env });
  assert.ok(!/\.example/.test(JSON.stringify(full)), 'the aggregate report names no domain');
});

test('score: --record writes text-free metrics to the run row; errata scored beside', () => {
  const { env, runId, row } = scoredEnv();
  appendRun(path.join(env.root, 'runs.json'), row);
  mkdirSync(path.join(env.root, 'errata'), { recursive: true });
  const fixed = { ...label('b.example/cart-1'), expected: { kind: 'estimatedTotal', amountMinor: 240000, currency: 'GBP' } };
  fixed.displayed = [{ kind: 'estimatedTotal', amountMinor: 240000, currency: 'GBP' }];
  writeFileSync(
    path.join(env.root, 'errata', 'development.json'),
    JSON.stringify({ errata: [{ id: 'b.example/cart-1', new: fixed }] }),
  );
  const r = score({ runId, record: true, errataDir: 'errata', failures: true, ...env });
  assert.equal(r.whole.counts.shownCorrect, 2);
  assert.equal(r.correctedLabels.errata, 1);
  assert.equal(r.correctedLabels.whole.counts.shownCorrect, 3);
  assert.ok(r.failures.some((f) => f.id === 'b.example/cart-1' && f.class === 'needs-analyst'));
  const m = readRuns(path.join(env.root, 'runs.json')).runs[0].metrics;
  assert.equal(m.shownCorrect, 2);
  assert.equal(m.criterion1Passed, false);
});
