import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFrame, pipelineHeldout, readerCandidates, split } from './seeded-selection.mjs';

const { frame } = loadFrame();
const platforms = ['shopify', 'sfcc', 'none-detected', 'adobe-commerce', 'other-detected'];

test('reader candidates: 300, every top-1k and 1k-10k eligible domain, all probe sites', () => {
  const c = readerCandidates(frame);
  assert.equal(c.length, 300);
  assert.equal(new Set(c.map((x) => x.domain)).size, 300);
  const eligible = frame.domains.filter((d) => d.eligible && d.band !== '10k-100k').map((d) => d.domain);
  for (const d of eligible) assert.ok(c.some((x) => x.domain === d), d);
  assert.equal(c.filter((x) => x.probeSite).length, 25);
  assert.equal(readerCandidates(frame, 10).length, 310);
});

test('pipeline held-out: 6 / 27 / 27 eligible domains, no duplicates', () => {
  const h = pipelineHeldout(frame, 'x');
  const per = {};
  for (const d of h.domains) per[d.band] = (per[d.band] ?? 0) + 1;
  assert.deepEqual(per, { 'top-1k': 6, '1k-10k': 27, '10k-100k': 27 });
  assert.equal(new Set(h.domains.map((d) => d.domain)).size, 60);
  assert.ok(h.domains.every((d) => !('trancoRank' in d)));
});

test('split: balanced, probe sites in development, deterministic, bands from the frame', () => {
  const sites = readerCandidates(frame)
    .slice(0, 195)
    .map((c, i) => ({ domain: c.domain, platform: platforms[i % platforms.length] }));
  const a = split(frame, sites);
  const byDomain = (list) => [...list].sort((x, y) => (x.domain < y.domain ? -1 : 1));
  assert.deepEqual(byDomain(split(frame, [...sites].reverse())), byDomain(a));
  const n = (s) => a.filter((x) => x.split === s).length;
  for (const s of ['development', 'heldout-a', 'heldout-b']) assert.ok(n(s) >= 60 && n(s) <= 70, `${s} ${n(s)}`);
  const probe = new Set(frame.domains.filter((d) => d.probeSite).map((d) => d.domain));
  assert.ok(a.filter((x) => probe.has(x.domain)).every((x) => x.split === 'development'));
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
