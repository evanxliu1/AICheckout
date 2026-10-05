import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  REGION_GROUPS,
  loadFrame,
  pipelineHeldout,
  readerCandidates,
  split,
} from './seeded-selection.mjs';

const { frame: frame1, frameSha256: frame1Sha256 } = loadFrame(1);
const { frame } = loadFrame(2);
const platforms = ['shopify', 'sfcc', 'none-detected', 'adobe-commerce', 'other-detected'];

test('retail-frame.2 keeps every retail-frame.1 domain with its band and probe status', () => {
  const v2 = new Map(frame.domains.map((d) => [d.domain, d]));
  assert.equal(v2.size, frame.domains.length);
  for (const d of frame1.domains) {
    const e = v2.get(d.domain);
    assert.ok(e, d.domain);
    assert.equal(e.band, d.band, d.domain);
    assert.equal(e.probeSite, d.probeSite, d.domain);
    if (d.eligible) assert.ok(e.eligible && e.region === 'US' && e.currency === 'USD', d.domain);
  }
  assert.equal(frame.domains.filter((d) => d.probeSite).length, 25);
});

test('retail-frame.2: every eligible domain has a region, an ISO 4217 code and a region group; bands only', () => {
  for (const d of frame.domains.filter((x) => x.eligible)) {
    assert.match(d.region, /^[A-Z]{2}$/, d.domain);
    assert.match(d.currency, /^[A-Z]{3}$/, d.domain);
    assert.ok(REGION_GROUPS.includes(d.regionGroup), d.domain);
    assert.ok(['top-1k', '1k-10k', '10k-100k'].includes(d.band), d.domain);
    assert.equal(d.exclusion, null, d.domain);
    assert.ok(!['RU', 'BY'].includes(d.region), d.domain);
  }
  assert.ok(frame.domains.every((d) => !('trancoRank' in d) && !('rank' in d)));
});

test('item price bands cover every eligible frame currency', () => {
  const bands = JSON.parse(readFileSync(new URL('../item-price-bands.json', import.meta.url), 'utf8')).currencies;
  for (const d of frame.domains.filter((x) => x.eligible)) assert.ok(bands[d.currency], `${d.domain} ${d.currency}`);
  for (const [cur, [min, max]] of Object.entries(bands)) assert.ok(min > 0 && max > min, cur);
});

test('currency minor-unit table covers every eligible frame currency', () => {
  const units = JSON.parse(readFileSync(new URL('../currency-minor-units.json', import.meta.url), 'utf8')).currencies;
  for (const d of frame.domains.filter((x) => x.eligible)) assert.ok(units[d.currency] !== undefined, d.currency);
  for (const c of ['JPY', 'KRW', 'VND', 'CLP']) assert.equal(units[c], 0, c);
  assert.equal(units.USD, 2);
});

test('retail-frame.2: one eligible storefront per retailer family', () => {
  const seen = new Map();
  for (const d of frame.domains.filter((x) => x.eligible)) {
    assert.ok(d.family, d.domain);
    assert.ok(!seen.has(d.family), `${d.family}: ${seen.get(d.family)} and ${d.domain}`);
    seen.set(d.family, d.domain);
  }
});

test('reader candidates: 200 per stream, every top-1k and 1k-10k eligible domain, all probe sites in the U.S. stream', () => {
  const c = readerCandidates(frame);
  assert.equal(c.length, 400);
  assert.equal(new Set(c.map((x) => x.domain)).size, 400);
  for (const s of ['us', 'non-us']) assert.equal(c.filter((x) => x.stream === s).length, 200);
  const top = frame.domains.filter((d) => d.eligible && d.band !== '10k-100k').map((d) => d.domain);
  for (const d of top) assert.ok(c.some((x) => x.domain === d), d);
  assert.equal(c.filter((x) => x.probeSite && x.stream === 'us').length, 25);
  assert.ok(c.every((x) => (x.regionGroup === 'us') === (x.stream === 'us')));
  assert.equal(readerCandidates(frame, { us: 10, 'non-us': 5 }).length, 415);
  assert.throws(() => readerCandidates(frame1), /retail-frame.2/);
});

test('pipeline held-out list is unchanged: still retail-frame.1, 6 / 27 / 27, file reproduces', () => {
  const h = pipelineHeldout(frame1, frame1Sha256);
  const per = {};
  for (const d of h.domains) per[d.band] = (per[d.band] ?? 0) + 1;
  assert.deepEqual(per, { 'top-1k': 6, '1k-10k': 27, '10k-100k': 27 });
  assert.equal(h.frame, 'retail-frame.1');
  const file = readFileSync(new URL('../pipeline-heldout-domains.json', import.meta.url), 'utf8');
  assert.equal(file, `${JSON.stringify(h, null, 1)}\n`);
});

const captureSample = () => {
  const c = readerCandidates(frame);
  const take = (s) => c.filter((x) => x.stream === s).slice(0, 110);
  return [...take('us'), ...take('non-us')].map((x, i) => ({ domain: x.domain, platform: platforms[i % platforms.length] }));
};

test('split: balanced overall, by stream and by region group; probe sites in development; deterministic', () => {
  const sites = captureSample();
  const a = split(frame, sites);
  const byDomain = (list) => [...list].sort((x, y) => (x.domain < y.domain ? -1 : 1));
  assert.deepEqual(byDomain(split(frame, [...sites].reverse())), byDomain(a));
  const n = (s, f = () => true) => a.filter((x) => x.split === s && f(x)).length;
  for (const s of ['development', 'heldout-a', 'heldout-b']) {
    assert.ok(n(s) >= 70 && n(s) <= 77, `${s} ${n(s)}`);
    assert.ok(n(s, (x) => x.regionGroup !== 'us') >= 35, `${s} non-us ${n(s, (x) => x.regionGroup !== 'us')}`);
  }
  // The 25 probe sites are U.S. and forced into development, so held-out U.S. counts are the balanced remainder.
  for (const s of ['heldout-a', 'heldout-b']) assert.ok(n(s, (x) => x.regionGroup === 'us') >= 35, s);
  for (const g of REGION_GROUPS) {
    const counts = ['heldout-a', 'heldout-b'].map((s) => n(s, (x) => x.regionGroup === g));
    assert.ok(Math.abs(counts[0] - counts[1]) <= 1, `${g} ${counts}`);
  }
  const probe = new Set(frame.domains.filter((d) => d.probeSite).map((d) => d.domain));
  assert.ok(a.filter((x) => probe.has(x.domain)).every((x) => x.split === 'development'));
});

test('split: takes domain and platform only, so nothing else seen in a page can change it', () => {
  const [site] = captureSample();
  assert.throws(() => split(frame, [{ ...site, observedCurrency: 'EUR' }]), /domain and platform only/);
  assert.throws(() => split(frame, [{ ...site, currency: 'EUR' }]), /domain and platform only/);
});

test('split: rejects non-candidates, duplicates and unknown platforms', () => {
  const [c] = readerCandidates(frame);
  assert.throws(() => split(frame, [{ domain: 'amazon.com', platform: 'shopify' }]), /not a reader candidate/);
  assert.throws(() => split(frame, [{ domain: 'example-not-in-frame.com', platform: 'shopify' }]), /not a reader candidate/);
  assert.throws(
    () => split(frame, [{ domain: c.domain, platform: 'shopify' }, { domain: c.domain, platform: 'shopify' }]),
    /duplicate/,
  );
  assert.throws(() => split(frame, [{ domain: c.domain, platform: 'nextjs' }]), /unknown platform/);
});
