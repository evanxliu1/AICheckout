// Bounds of the reader report: exact one-sided Clopper–Pearson, Wilson, rule of three, nearest-rank p95.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { binomialCdf, clopperPearsonUpper, percentile, proportion, ruleOfThree, wilson } from '../stats.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('Clopper–Pearson: 0 of 299 meets the 1% bar, 0 of 298 does not', () => {
  close(clopperPearsonUpper(0, 299), 1 - 0.05 ** (1 / 299));
  assert.ok(clopperPearsonUpper(0, 299) <= 0.01);
  assert.ok(clopperPearsonUpper(0, 298) > 0.01);
});

test('Clopper–Pearson: 1 of 473 is about 1% and meets the bar, 1 of 472 does not', () => {
  const u = clopperPearsonUpper(1, 473);
  close(u, 0.01, 2e-5);
  assert.ok(u <= 0.01);
  assert.ok(clopperPearsonUpper(1, 472) > 0.01);
  // At the bound, P(X <= 1) is 5%.
  close(binomialCdf(1, 473, u), 0.05, 1e-9);
});

test('Clopper–Pearson: textbook values and edges', () => {
  close(clopperPearsonUpper(5, 100), 0.10225, 1e-4);
  close(clopperPearsonUpper(0, 10), 0.258866, 1e-6);
  assert.equal(clopperPearsonUpper(3, 3), 1);
  assert.equal(clopperPearsonUpper(0, 0), null);
  assert.throws(() => clopperPearsonUpper(4, 3));
});

test('Wilson 95%: known intervals', () => {
  const w = wilson(5, 10);
  close(w.low, 0.236590, 1e-5);
  close(w.high, 0.763410, 1e-5);
  const z = wilson(0, 10);
  assert.equal(z.low, 0);
  close(z.high, 0.277540, 1e-5);
  assert.equal(wilson(0, 0), null);
});

test('rule of three, proportion and nearest-rank p95', () => {
  assert.equal(ruleOfThree(300), 0.01);
  assert.equal(ruleOfThree(0), null);
  assert.deepEqual(proportion(0, 300).ruleOfThree, 0.01);
  assert.equal(proportion(1, 4).ruleOfThree, undefined);
  assert.equal(proportion(1, 4).rate, 0.25);
  const ms = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(ms), 95);
  assert.equal(percentile([7]), 7);
  assert.equal(percentile([]), null);
});
