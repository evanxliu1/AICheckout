// Tests of agreement.mjs on synthetic labeller and adjudication files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare, currencyAgrees, merge, stopRules } from '../agreement.mjs';
import { label, labellerFile, nullExpected } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Ten page-states; B differs on two (expected amount; readable) and on tags of one.
const base = () => [
  ...Array.from({ length: 8 }, (_, i) => label(`s${i}.example/cart-1`)),
  label('abercrombie.com/cart-1', { currencyEvidence: 'd-frame' }),
  label('0101.co.jp/cart-1', {
    displayed: [{ kind: 'subtotal', amountMinor: 1299, currency: 'JPY' }],
    expected: { kind: 'subtotal', amountMinor: 1299, currency: 'JPY' },
    observedTags: ['zero-decimal-currency'],
  }),
];
function files() {
  const a = base();
  const b = base();
  b[0] = label('s0.example/cart-1', {
    displayed: [{ kind: 'estimatedTotal', amountMinor: 2500, currency: 'GBP' }],
    expected: { kind: 'estimatedTotal', amountMinor: 2500, currency: 'GBP' },
  });
  b[1] = label('s1.example/cart-1', { readable: 'open-shadow', observedTags: ['summary-in-open-shadow'] });
  b[9] = { ...b[9], observedTags: ['zero-decimal-currency', 'non-english-labels'], confidence: 'low' };
  return [labellerFile('labeller-1', a), labellerFile('labeller-2', b)];
}
const adjudication = (decisions) => ({
  schema: 'reader-adjudication.1',
  split: 'development',
  adjudicator: { id: 'adjudicator-1', model: 'claude-opus-5-5' },
  decisions,
});

test('agreement: counts, rates, disagreement ids and tag agreement', () => {
  const r = compare(...files());
  assert.equal(r.n, 10);
  assert.deepEqual(r.expected, { agree: 9, n: 10, rate: 0.9 });
  assert.deepEqual(r.rows, { agree: 9, n: 10, rate: 0.9 });
  assert.deepEqual(r.readable, { agree: 9, n: 10, rate: 0.9 });
  // s0: no row with the same kind and amount in both, so not comparable
  assert.deepEqual(r.currency, { agree: 9, n: 9, rate: 1, notComparable: 1 });
  assert.deepEqual(r.disagreements, ['s0.example/cart-1', 's1.example/cart-1']);
  assert.deepEqual(r.tags['non-english-labels'], { both: 0, onlyA: 0, onlyB: 1, neither: 9, rate: 0.9 });
  assert.deepEqual(r.tags['zero-decimal-currency'], { both: 1, onlyA: 0, onlyB: 0, neither: 9, rate: 1 });
  assert.equal(r.currencyUndetermined.a.realCart1, 10);
  assert.equal(r.currencyUndetermined.a.perStream.us['d-frame'], 1);
  assert.equal(r.currencyUndetermined.a.perStream['non-us']['c-symbol'], 1);
  assert.deepEqual(stopRules(r), []);
  assert.equal(
    currencyAgrees(
      label('x.example/cart-1'),
      label('x.example/cart-1', {
        displayed: [{ kind: 'subtotal', amountMinor: 2000, currency: 'USD' }],
        expected: { kind: 'subtotal', amountMinor: 2000, currency: 'USD' },
      }),
    ),
    false,
  );
});

test('agreement: refuses files that do not label the same page-states or snapshots', () => {
  const [a, b] = files();
  assert.throws(() => compare(a, labellerFile('labeller-2', b.labels.slice(1))), /different page-states/);
  assert.throws(() => compare(a, labellerFile('labeller-1', b.labels)), /same labeller/);
  const c = labellerFile(
    'labeller-2',
    b.labels.map((l, i) => (i === 2 ? { ...l, domSha256: 'c'.repeat(64) } : l)),
  );
  assert.throws(() => compare(a, c), /domSha256 differs/);
  assert.throws(() => compare(a, labellerFile('labeller-2', b.labels, 'heldout-a')), /splits differ/);
});

test('agreement: stop rules below 90% expected agreement and above 10% currency-undetermined cart-1', () => {
  const [a, b] = files();
  const undetermined = (id) =>
    JSON.parse(
      JSON.stringify(
        label(
          id,
          nullExpected('currency-undetermined', {
            displayed: [{ kind: 'subtotal', amountMinor: 2000, currency: null }],
          }),
        ),
      ),
    );
  b.labels[2] = undetermined('s2.example/cart-1');
  const r = compare(a, b);
  assert.equal(r.expected.rate, 0.8);
  assert.equal(r.currencyUndetermined.b.share, 0.1);
  assert.deepEqual(stopRules(r), ['expected-agreement-below-90']);
  b.labels[3] = undetermined('s3.example/cart-1');
  assert.deepEqual(stopRules(compare(a, b)), [
    'expected-agreement-below-90',
    'currency-undetermined-above-10',
  ]);
});

test('review L1: stop rules on raw counts, not rounded rates', () => {
  const cu = (realCart1, undetermined) => ({
    realCart1,
    undetermined,
    share: Math.round((undetermined / realCart1) * 1e4) / 1e4,
  });
  const report = (agree, n, u) => ({
    expected: { agree, n, rate: Math.round((agree / n) * 1e4) / 1e4 },
    currencyUndetermined: { a: u, b: cu(100000, 0) },
  });
  // 89,999 / 100,000 rounds to 0.9 but is below 90%; 10,001 / 100,000 rounds to 0.1 but is above 10%.
  assert.deepEqual(stopRules(report(89999, 100000, cu(100000, 10001))), [
    'expected-agreement-below-90',
    'currency-undetermined-above-10',
  ]);
  assert.deepEqual(stopRules(report(90000, 100000, cu(100000, 10000))), []);
});

test('review L6: labeller files carry real page-states only', () => {
  const [a, b] = files();
  const v = label('s2.example/cart-1/class-rename');
  assert.throws(
    () => compare(labellerFile('labeller-1', [...a.labels, v]), labellerFile('labeller-2', [...b.labels, v])),
    /variant/,
  );
});

test('adjudication: merges agreed labels and decisions; refuses extra or missing decisions', () => {
  const [a, b] = files();
  const r = compare(a, b);
  const d0 = { id: 's0.example/cart-1', label: a.labels[0], reason: 'estimated total row in the summary' };
  const d1 = { id: 's1.example/cart-1', label: b.labels[1], reason: 'summary is in an open shadow root' };
  const final = merge(a, b, adjudication([d0, d1]), r);
  assert.equal(final.role, 'final');
  assert.deepEqual(final.adjudicated, ['s0.example/cart-1', 's1.example/cart-1']);
  assert.equal(final.labels.length, 10);
  const jp = final.labels.find((l) => l.id === '0101.co.jp/cart-1');
  assert.deepEqual(jp.observedTags, ['zero-decimal-currency', 'non-english-labels']);
  assert.equal(jp.confidence, 'low');
  assert.equal(final.labels.find((l) => l.id === 's1.example/cart-1').readable, 'open-shadow');
  assert.throws(() => merge(a, b, adjudication([d0]), r), /without a decision: s1.example\/cart-1/);
  const extra = { id: 's5.example/cart-1', label: a.labels[5], reason: 'x' };
  assert.throws(() => merge(a, b, adjudication([d0, d1, extra]), r), /not a disagreement/);
  assert.throws(() => merge(a, b, adjudication([d0, d0, d1]), r), /decided twice/);
  const self = { ...adjudication([d0, d1]), adjudicator: { id: 'labeller-2', model: 'm' } };
  assert.throws(() => merge(a, b, self, r), /one of the labellers/);
  const moved = { ...d0, label: { ...d0.label, snapshotSha256: 'f'.repeat(64) } };
  assert.throws(() => merge(a, b, adjudication([moved, d1]), r), /snapshotSha256/);
});

test('agreement.mjs CLI: writes the final labels and report; exit 3 on a stop rule', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agreement-'));
  const cli = path.join(here, '..', 'agreement.mjs');
  const [a, b] = files();
  const pa = path.join(dir, 'a.json');
  const pb = path.join(dir, 'b.json');
  const pj = path.join(dir, 'adj.json');
  const out = path.join(dir, 'final.json');
  writeFileSync(pa, JSON.stringify(a));
  writeFileSync(pb, JSON.stringify(b));
  writeFileSync(
    pj,
    JSON.stringify(
      adjudication([
        { id: 's0.example/cart-1', label: a.labels[0], reason: 'x' },
        { id: 's1.example/cart-1', label: a.labels[1], reason: 'y' },
      ]),
    ),
  );
  const report = JSON.parse(
    execFileSync('node', [cli, pa, pb, '--adjudication', pj, '--out', out], { encoding: 'utf8' }),
  );
  assert.deepEqual(report.stop, []);
  assert.equal(report.currencyUndetermined.final.realCart1, 10);
  const final = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(final.sources.adjudication.file, 'adj.json');
  assert.match(final.sources.labellerA.sha256, /^[0-9a-f]{64}$/);
  b.labels[2] = JSON.parse(
    JSON.stringify(
      label('s2.example/cart-1', nullExpected('not-readable', { readable: 'iframe-only', displayed: [] })),
    ),
  );
  writeFileSync(pb, JSON.stringify(b));
  let err;
  try {
    execFileSync('node', [cli, pa, pb], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.status, 3);
  assert.match(err.stderr, /expected-agreement-below-90/);
});

test('agreement.mjs --single: final labels from one labeller; report with the currency stop rule only', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agreement-single-'));
  const cli = path.join(here, '..', 'agreement.mjs');
  const [a] = files();
  a.labels[9] = { ...a.labels[9], confidence: 'low', notes: 'unsure row' };
  const pa = path.join(dir, 'a.json');
  const out = path.join(dir, 'final.json');
  const rep = path.join(dir, 'report.json');
  writeFileSync(pa, JSON.stringify(a));
  const report = JSON.parse(
    execFileSync('node', [cli, '--single', pa, '--out', out, '--report', rep], { encoding: 'utf8' }),
  );
  assert.equal(report.labelling, 'single');
  assert.deepEqual(report.stop, []);
  assert.equal(report.lowConfidence.length, 1);
  const final = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(final.role, 'final');
  assert.equal(final.labels.length, 10);
  assert.equal(final.labels.find((l) => l.confidence === 'low').notes, 'unsure row');
  assert.equal(final.sources.labeller.file, 'a.json');
  assert.equal(report.final.sha256, JSON.parse(readFileSync(rep, 'utf8')).final.sha256);
  // More than 10% of real cart-1 currency-undetermined stops.
  for (const i of [0, 1])
    a.labels[i] = label(`s${i}.example/cart-1`, nullExpected('currency-undetermined', { displayed: [{ kind: 'subtotal', amountMinor: 100, currency: null }] }));
  writeFileSync(pa, JSON.stringify(a));
  let err;
  try {
    execFileSync('node', [cli, '--single', pa, '--out', out], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.status, 3);
  assert.match(err.stderr, /currency-undetermined-above-10/);
});
