// Tests of the derived-label sample check on a synthetic manifest and variant labels file (no capture is read).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { draw, drawSample, sampleSize, verify } from '../sample-check.mjs';
import { sha } from './pages.mjs';

test('sample size: 10% rounded up, at least 10, all when fewer', () => {
  assert.equal(sampleSize(4), 4);
  assert.equal(sampleSize(10), 10);
  assert.equal(sampleSize(99), 10);
  assert.equal(sampleSize(101), 11);
  assert.equal(sampleSize(1000), 100);
});

function setup(n = 120) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'variant-check-'));
  const ids = Array.from(
    { length: n },
    (_, i) => `s${i}.example/cart-1/${i % 2 ? 'promo-row' : 'class-rename'}`,
  );
  const labels = ids.map((id) => ({
    id,
    readable: 'top-frame',
    displayed: [{ kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' }],
    expected: { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
    currencyEvidence: 'c-symbol',
    currencyConflict: false,
  }));
  const labelsFile = path.join(dir, 'development-variant-labels.json');
  writeFileSync(labelsFile, JSON.stringify({ labels }));
  const manifest = {
    schema: 'reader-variants.1',
    split: 'development',
    dataRoot: 'data/variants',
    variantLabels: { path: 'development-variant-labels.json', sha256: sha(JSON.stringify({ labels })) },
    variants: ids.map((id) => {
      const [domain, state, transform] = id.split('/');
      return {
        id,
        transform,
        version: `${transform}.1`,
        path: `development/${domain}/${state}/${transform}/dom.json`,
        domSha256: sha(id),
      };
    }),
  };
  const manifestFile = path.join(dir, 'development-manifest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  return { dir, ids, manifestFile };
}

test('draw: the seeded sample is deterministic, independent of input order, and carries the derived labels', () => {
  const { dir, ids, manifestFile } = setup();
  const a = drawSample(ids);
  assert.equal(a.length, 12);
  assert.deepEqual(drawSample([...ids].reverse()), a);
  const check = draw(manifestFile, { root: dir });
  assert.equal(check.schema, 'reader-variant-check.1');
  assert.deepEqual(
    check.entries.map((e) => e.id),
    a,
  );
  assert.equal(
    check.entries[0].dom,
    `data/variants/${check.entries[0].id.replace(/^([^/]+)\/([^/]+)\/(.+)$/, 'development/$1/$2/$3')}/dom.json`,
  );
  assert.deepEqual(check.entries[0].derived.expected, {
    kind: 'estimatedTotal',
    amountMinor: 2400,
    currency: 'GBP',
  });
  assert.ok(check.entries.every((e) => e.result === null));
});

test('verify: all match passes; a mismatch names the transform version to bump; edits are refused', () => {
  const { dir, manifestFile } = setup();
  const check = draw(manifestFile, { root: dir });
  const file = path.join(dir, 'check.json');
  const fill = (over) =>
    writeFileSync(
      file,
      JSON.stringify({ ...check, labeller: { id: 'labeller-a', model: 'claude-opus-5-5' }, ...over }),
    );

  // Not filled in: refused.
  writeFileSync(file, JSON.stringify(check));
  assert.equal(verify(file, { root: dir }).ok, false);

  fill({ entries: check.entries.map((e) => ({ ...e, result: 'match' })) });
  assert.deepEqual(verify(file, { root: dir }), { ok: true, problems: [], mismatches: [], newVersions: [] });

  const bad = check.entries.findIndex((e) => e.transform === 'promo-row');
  fill({
    entries: check.entries.map((e, i) => ({
      ...e,
      result: i === bad ? 'mismatch' : 'match',
      notes: i === bad ? 'promo row reads as a total' : '',
    })),
  });
  const r = verify(file, { root: dir });
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.newVersions, [
    { transform: 'promo-row', version: 'promo-row.1', ids: [check.entries[bad].id] },
  ]);

  // A dropped entry or an edited derived label is not the seeded sample.
  fill({ entries: check.entries.slice(1).map((e) => ({ ...e, result: 'match' })) });
  assert.match(verify(file, { root: dir }).problems.join(), /not the seeded sample/);
  fill({
    entries: check.entries.map((e, i) => ({
      ...e,
      result: 'match',
      derived: i ? e.derived : { ...e.derived, expected: null },
    })),
  });
  assert.match(verify(file, { root: dir }).problems.join(), /derived label differs/);
});
