import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CRUX_BANDS,
  REGION_GROUPS,
  key,
  loadFrame,
  pipelineHeldout,
  readerCandidates,
  split,
  EQUAL_WEIGHTS,
  PROTOCOL_8_WEIGHTS,
  streamOf,
} from './seeded-selection.mjs';

const { frame: frame1, frameSha256: frame1Sha256 } = loadFrame(1);
const { frame } = loadFrame(2); // retail-frame.2: committed, superseded by retail-frame.3 for the reader
const { frame: frame3 } = loadFrame(3);
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

test('retail-frame.2: one eligible storefront per retailer family', () => {
  const seen = new Map();
  for (const d of frame.domains.filter((x) => x.eligible)) {
    assert.ok(d.family, d.domain);
    assert.ok(!seen.has(d.family), `${d.family}: ${seen.get(d.family)} and ${d.domain}`);
    seen.set(d.family, d.domain);
  }
});

test('retail-frame.3: buckets, regions, currencies, one storefront per family per country, legacy and RU/BY excluded', () => {
  const seen = new Set();
  for (const d of frame3.domains.filter((x) => x.eligible)) {
    assert.ok(CRUX_BANDS.includes(d.band), d.domain);
    assert.match(d.region, /^[A-Z]{2}$/, d.domain);
    assert.match(d.currency, /^[A-Z]{3}$/, d.domain);
    assert.ok(REGION_GROUPS.includes(d.regionGroup), d.domain);
    assert.equal(d.homeList, d.region, d.domain);
    assert.equal(d.lists[d.homeList], d.band, d.domain);
    assert.equal(d.exclusion, null, d.domain);
    assert.ok(d.operator, d.domain);
    assert.ok(d.hosts.includes(d.entryHost), d.domain);
    assert.ok(d.family && !seen.has(`${d.family}|${d.region}`), `${d.family} ${d.region}`);
    seen.add(`${d.family}|${d.region}`);
  }
  for (const legacy of ['amazon.com', 'bestbuy.com', 'newegg.com']) {
    const d = frame3.domains.find((x) => x.domain === legacy);
    assert.ok(!d || d.exclusion === 'legacy-named-merchant', legacy);
  }
  assert.ok(frame3.domains.every((d) => !['RU', 'BY'].includes(d.region) || !d.eligible));
  assert.ok(frame3.domains.every((d) => !('rank' in d)));
  // sister brands that share one company's store are one operator
  const op = (dom) => frame3.domains.find((x) => x.domain === dom)?.operator;
  assert.equal(op('potterybarn.com'), op('westelm.com'));
  assert.equal(op('abercrombie.com'), op('hollisterco.com'));
  assert.equal(op('amazon.de'), op('amazon.co.uk'));
});

test('retail-frame.3 persistence: two earlier lists, www./m./mobile. variants only, seasonal spikes out', () => {
  assert.deepEqual(frame3.lists.persistence.yyyymm, ['202602', '202605']);
  assert.deepEqual(frame3.lists.persistence.hostVariants, ['www.', 'm.', 'mobile.']);
  const d = (dom) => frame3.domains.find((x) => x.domain === dom);
  for (const ok of ['dillards.com', 'ardene.com', 'haydigiy.com', 'jdsports.co.uk']) assert.ok(d(ok).eligible, ok);
  for (const out of ['spirithalloween.com', 'playstation.com', 'tiktok.com'])
    assert.equal(d(out).exclusion, 'not-persistently-popular', out);
});

test('item price bands and minor-unit table cover every eligible retail-frame.3 currency', () => {
  const bands = JSON.parse(readFileSync(new URL('../item-price-bands.json', import.meta.url), 'utf8')).currencies;
  const units = JSON.parse(readFileSync(new URL('../currency-minor-units.json', import.meta.url), 'utf8')).currencies;
  for (const d of frame3.domains.filter((x) => x.eligible)) {
    assert.ok(bands[d.currency], `${d.domain} ${d.currency}`);
    assert.ok(units[d.currency] !== undefined, `${d.domain} ${d.currency}`);
  }
});

test('reader candidates: 200 per stream, most popular bucket first, U.S. bucket order by key', () => {
  const c = readerCandidates(frame3);
  assert.equal(c.length, 400);
  assert.equal(new Set(c.map((x) => x.domain)).size, 400);
  for (const s of ['us', 'non-us']) {
    const list = c.filter((x) => x.stream === s);
    assert.equal(list.length, 200);
    const bandIdx = list.map((x) => CRUX_BANDS.indexOf(x.band));
    assert.deepEqual(bandIdx, [...bandIdx].sort((a, b) => a - b), `${s} bucket order`);
    // every eligible domain of a bucket comes before any of a later bucket
    const last = Math.max(...bandIdx);
    const pool = frame3.domains.filter((d) => d.eligible && streamOf(d) === s && CRUX_BANDS.indexOf(d.band) < last);
    for (const d of pool) assert.ok(list.some((x) => x.domain === d.domain), d.domain);
  }
  const us = c.filter((x) => x.stream === 'us' && x.band === 'top-1k').map((x) => key('reader-candidates', x.domain));
  assert.deepEqual(us, [...us].sort());
  assert.ok(c.every((x) => (x.regionGroup === 'us') === (x.stream === 'us')));
  assert.equal(readerCandidates(frame3, { us: 10, 'non-us': 5 }).length, 415);
  assert.throws(() => readerCandidates(frame), /retail-frame.3/);
  assert.throws(() => readerCandidates(frame1), /retail-frame.3/);
});

test('reader candidates: the non-U.S. stream round-robins its countries', () => {
  const list = readerCandidates(frame3).filter((x) => x.stream === 'non-us');
  const per = {};
  for (const x of list) per[x.homeList] = (per[x.homeList] ?? 0) + 1;
  const available = {};
  for (const d of frame3.domains.filter((x) => x.eligible && x.regionGroup !== 'us' && x.band === 'top-1k'))
    available[d.homeList] = (available[d.homeList] ?? 0) + 1;
  const counts = Object.values(per);
  const full = Object.keys(per).filter((cc) => per[cc] < available[cc]);
  // countries not used up differ by at most one; a used-up country has fewer
  const fullCounts = full.map((cc) => per[cc]);
  assert.ok(Math.max(...fullCounts) - Math.min(...fullCounts) <= 1, JSON.stringify(per));
  for (const cc of Object.keys(per)) assert.ok(per[cc] <= Math.max(...counts));
  // within one country, key order
  for (const cc of Object.keys(per)) {
    const keys = list.filter((x) => x.homeList === cc).map((x) => key('reader-candidates', x.domain));
    assert.deepEqual(keys, [...keys].sort(), cc);
  }
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
  const c = readerCandidates(frame3);
  const take = (s) => c.filter((x) => x.stream === s).slice(0, 110);
  return [...take('us'), ...take('non-us')].map((x, i) => ({ domain: x.domain, platform: platforms[i % platforms.length] }));
};

test('split: balanced overall, by stream and by region group; probe sites in development; deterministic', () => {
  const sites = captureSample();
  const a = split(frame3, sites);
  const byDomain = (list) => [...list].sort((x, y) => (x.domain < y.domain ? -1 : 1));
  assert.deepEqual(byDomain(split(frame3, [...sites].reverse())), byDomain(a));
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
  const probe = new Set(frame3.domains.filter((d) => d.probeSite).map((d) => d.domain));
  assert.ok(a.filter((x) => probe.has(x.domain)).every((x) => x.split === 'development'));
});

test('split: an operator never spans two splits', () => {
  const a = split(frame3, captureSample());
  const op = new Map(frame3.domains.map((d) => [d.domain, d.operator]));
  const where = new Map();
  for (const x of a) {
    const o = op.get(x.domain);
    assert.ok(!where.has(o) || where.get(o) === x.split, `${o}: ${where.get(o)} and ${x.split}`);
    where.set(o, x.split);
  }
  assert.ok(a.length > new Set(a.map((x) => op.get(x.domain))).size, 'the sample has an operator with several sites');
});

test('split: takes domain and platform only, so nothing else seen in a page can change it', () => {
  const [site] = captureSample();
  assert.throws(() => split(frame3, [{ ...site, observedCurrency: 'EUR' }]), /domain and platform only/);
  assert.throws(() => split(frame3, [{ ...site, currency: 'EUR' }]), /domain and platform only/);
});

test('split: rejects non-candidates, duplicates and unknown platforms', () => {
  const [c] = readerCandidates(frame3);
  assert.throws(() => split(frame3, [{ domain: 'amazon.com', platform: 'shopify' }]), /not a reader candidate/);
  assert.throws(() => split(frame3, [{ domain: 'example-not-in-frame.com', platform: 'shopify' }]), /not a reader candidate/);
  assert.throws(
    () => split(frame3, [{ domain: c.domain, platform: 'shopify' }, { domain: c.domain, platform: 'shopify' }]),
    /duplicate/,
  );
  assert.throws(() => split(frame3, [{ domain: c.domain, platform: 'nextjs' }]), /unknown platform/);
});

test('split, protocol .8 weights 1 : 2 : 2: held-out A and B take about 40% each, balanced by region group; operators locked', () => {
  const c = readerCandidates(frame3, { us: 225, 'non-us': 800 });
  const sites = c.map((x, i) => ({ domain: x.domain, platform: platforms[i % platforms.length] }));
  const a = split(frame3, sites, { us: 225, 'non-us': 800 }, PROTOCOL_8_WEIGHTS);
  const n = (s, f = () => true) => a.filter((x) => x.split === s && f(x)).length;
  const total = a.length;
  for (const s of ['heldout-a', 'heldout-b']) {
    const share = n(s) / total;
    assert.ok(share > 0.37 && share < 0.42, `${s} ${share}`);
  }
  assert.ok(Math.abs(n('heldout-a') - n('heldout-b')) <= 3, `${n('heldout-a')} ${n('heldout-b')}`);
  for (const g of REGION_GROUPS) {
    const counts = ['heldout-a', 'heldout-b'].map((s) => n(s, (x) => x.regionGroup === g));
    assert.ok(Math.abs(counts[0] - counts[1]) <= 4, `${g} ${counts}`);
  }
  const op = new Map(frame3.domains.map((d) => [d.domain, d.operator]));
  const where = new Map();
  for (const x of a) {
    const o = op.get(x.domain);
    assert.ok(!where.has(o) || where.get(o) === x.split, o);
    where.set(o, x.split);
  }
  // Equal weights reproduce the .1–.7 behaviour exactly.
  assert.deepEqual(split(frame3, captureSample(), {}, EQUAL_WEIGHTS), split(frame3, captureSample()));
  assert.throws(() => split(frame3, [], {}, { development: 0, 'heldout-a': 1, 'heldout-b': 1 }), /must be positive/);
});
