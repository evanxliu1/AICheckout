// Statistics of the reader report (docs/evals/generic-reader-protocol.md#scoring): the exact one-sided 95%
// Clopper–Pearson upper bound, Wilson 95% intervals (z = 1.96), the rule-of-three bound for zero counts and the
// nearest-rank p95. Deterministic, no dependencies.

/** P(X <= x) for X ~ Binomial(n, p), summed in log space. */
export function binomialCdf(x, n, p) {
  if (x < 0) return 0;
  if (x >= n || p <= 0) return 1;
  if (p >= 1) return 0;
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let term = n * lq; // log P(X = 0)
  let max = term;
  const terms = [term];
  for (let k = 0; k < x; k += 1) {
    term += Math.log(n - k) - Math.log(k + 1) + lp - lq;
    terms.push(term);
    if (term > max) max = term;
  }
  const sum = terms.reduce((s, t) => s + Math.exp(t - max), 0);
  return Math.min(1, Math.exp(max) * sum);
}

/**
 * Exact one-sided upper bound of a binomial proportion at level 1 - alpha (default 95%): the p at which
 * P(X <= x) = alpha. x = 0 gives 1 - alpha^(1/n). null when n is 0.
 */
export function clopperPearsonUpper(x, n, alpha = 0.05) {
  if (!Number.isInteger(x) || !Number.isInteger(n) || x < 0 || x > n) throw new Error('need 0 <= x <= n');
  if (n === 0) return null;
  if (x === n) return 1;
  if (x === 0) return 1 - alpha ** (1 / n);
  let lo = x / n;
  let hi = 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(x, n, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Wilson score interval for k of n (z = 1.96): { low, high }, or null when n is 0. */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** Rule-of-three 95% upper bound for a zero count among n: 3/n (null when n is 0). */
export const ruleOfThree = (n) => (n === 0 ? null : 3 / n);

/** Nearest-rank percentile (default p95) of a list of numbers; null when empty. */
export function percentile(values, q = 0.95) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

/** A proportion k of n with its Wilson interval, and the rule-of-three bound when k is zero (6 decimals). */
export function proportion(k, n) {
  const r = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6);
  const w = wilson(k, n);
  return {
    k,
    n,
    rate: n ? r(k / n) : null,
    wilson95: w ? { low: r(w.low), high: r(w.high) } : null,
    ...(k === 0 ? { ruleOfThree: r(ruleOfThree(n)) } : {}),
  };
}
