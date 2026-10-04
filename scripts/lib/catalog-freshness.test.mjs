// Phase 9 milestone 3 builder tests: dates from freshness records (in memory, synthetic), the source-window error, the
// byte identity of today's build with no records, and a pipeline batch replacing a real card. No captures, no network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CATALOG_V2 } from '../../packages/rewards-core/src/catalog-v2.ts';
import { CATALOG_V3 } from '../../packages/rewards-core/src/catalog-v3.ts';
import { corpusCases } from './catalog-overlay.mjs';
import { effectiveSources, loadCatalogBatches, mergeLayers, sha256Json } from './catalog-batches.mjs';
import { buildRelease, checkRealCards, citedSourceIds, staleSources } from './catalog-v3.mjs';
import { MERCHANT_LAYER, freshDates, freshnessCounts, freshnessRecordSchema } from './freshness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = await loadCatalogBatches(root);
const ledger = JSON.parse(await readFile(join(root, 'evals/curation/rule-id-ledger.json'), 'utf8'));
const config = { ...base.config, version: '2026-10-20.test.1' };
const real = base.layers.find((layer) => layer.id === 'real.v2.2');

/** A freshness record dated `checkedOn` that found every listed source unchanged, unless `override` says otherwise. */
function record(checkedOn, ids, override = {}) {
  const sources = effectiveSources(base.layers);
  const merchantHashes = new Map(base.merchantManifest.sources.map((source) => [source.id, source.sha256]));
  const entries = ids.map((sourceId) => {
    const manifestSha256 = sources.get(sourceId)?.source.sha256 ?? merchantHashes.get(sourceId);
    return {
      sourceId,
      layer: sources.get(sourceId)?.layer ?? MERCHANT_LAYER,
      manifestSha256,
      sha256: manifestSha256,
      result: 'unchanged',
      flags: [],
      checkedOn,
      ...override[sourceId],
    };
  });
  return freshnessRecordSchema.parse({
    schemaVersion: 1,
    checkedOn,
    catalogVersion: config.version,
    renderer: { captureScriptSha256: 'a'.repeat(64), playwright: '1.63.0', chromium: '140.0.0.0' },
    counts: freshnessCounts(entries),
    sources: entries,
  });
}
const cited = [...citedSourceIds(mergeLayers(base))];

test('with no freshness record the build is today’s catalog, and the cited sources are the catalog’s', () => {
  assert.deepEqual(base.freshness, [], 'evals/curation/freshness/ holds no record yet');
  assert.notEqual(base.merchantManifest, null);
  assert.deepEqual(buildRelease(mergeLayers({ ...base, freshness: [] })).catalog, CATALOG_V3);
  assert.deepEqual(new Set(cited), new Set(CATALOG_V3.sources.map((source) => source.id)));
});

test('a source is dated by the newest record that rendered its manifest hash; merchants by theirs', () => {
  const newer = record('2026-10-20', cited, {
    // Another hash (a changed page) and a flagged render never date the manifest's capture.
    'amex-gold-product': { sha256: 'b'.repeat(64), result: 'changed' },
    'check-mcc-newegg': { sha256: 'c'.repeat(64), result: 'flagged', flags: ['bot-wall'] },
  });
  const older = record('2026-10-10', cited);
  const inputs = mergeLayers({ ...base, config, freshness: [newer, older] });
  const { catalog, dates } = buildRelease({ ...inputs, ledger });
  assert.equal(catalog.verifiedAt, '2026-10-20T00:00:00Z');
  assert.equal(catalog.expiresAt, '2026-11-19T00:00:00Z');
  const checked = new Map(catalog.sources.map((source) => [source.id, source.checkedOn]));
  assert.equal(checked.get('citi-double-cash-product'), '2026-10-20');
  assert.equal(checked.get('amex-gold-product'), '2026-10-10', 'the older record saw the manifest hash');
  assert.equal(checked.get('check-mcc-best-buy'), '2026-10-20', 'merchants.json said 2026-09-28');
  assert.equal(checked.get('check-mcc-newegg'), '2026-10-10');
  assert.equal(dates.oldest, '2026-10-10');
  // Catalog contents other than dates are unchanged.
  const strip = (c) => ({ ...c, version: null, verifiedAt: null, expiresAt: null, sources: null });
  assert.deepEqual(strip(catalog), strip(CATALOG_V3));
  // A changed render dates nothing, not even a capture elsewhere with that hash (it could out-date a newer batch).
  assert.equal(freshDates([newer]).get(`amex-gold-product ${'b'.repeat(64)}`), undefined);
});

test('a cited source older than 30 days before verifiedAt fails the build, naming the stale sources', () => {
  const expansionOnly = cited.filter((id) => !real.manifest.sources.some((source) => source.id === id));
  const inputs = mergeLayers({ ...base, config, freshness: [record('2026-11-05', expansionOnly)] });
  assert.throws(
    () => buildRelease({ ...inputs, ledger }),
    (error) =>
      /cited source\(s\) outside the 30 days before verifiedAt 2026-11-05T00:00:00Z/.test(error.message) &&
      /citi-double-cash-product \(2026-09-29\)/.test(error.message) &&
      !/amex-gold-product/.test(error.message),
  );
  assert.deepEqual(
    staleSources(
      [
        { id: 'a', checkedOn: '2026-10-06' },
        { id: 'b', checkedOn: '2026-10-05' },
        { id: 'c', checkedOn: '2026-11-06' },
      ],
      '2026-11-05T00:00:00Z',
    ),
    [
      { id: 'b', checkedOn: '2026-10-05' },
      { id: 'c', checkedOn: '2026-11-06' },
    ],
  );
});

test('the record schema refuses page text, wrong counts and results that do not fit the hashes', () => {
  const good = record('2026-10-20', cited.slice(0, 2));
  assert.throws(() => freshnessRecordSchema.parse({ ...good, note: 'page text' }));
  assert.throws(() => freshnessRecordSchema.parse({ ...good, counts: { ...good.counts, unchanged: 5 } }));
  const wrong = structuredClone(good);
  wrong.sources[0].result = 'changed';
  assert.throws(() => freshnessRecordSchema.parse(wrong), /does not fit the hashes/);
  const text = structuredClone(good);
  text.sources[0].flags = ['Access denied'];
  assert.throws(() => freshnessRecordSchema.parse(text));
});

/** A pipeline batch with a refreshed copy of a real card (no overlay patches, as the overlay author would start). */
function realBatch(cardId, edit) {
  const item = structuredClone(corpusCases(real.corpus).get(cardId));
  edit(item);
  const entry = {
    cardId,
    issuer: item.issuer,
    heldOut: null,
    programId: null,
    acceptance: { kind: 'open-loop' },
    choices: [],
    rules: [],
    addedRules: [],
    issues: [],
    hints: [],
    corpusCaseSha256: sha256Json(item),
  };
  const id = 'real-refresh-2026-10';
  return {
    id,
    kind: 'batch',
    dir: `evals/curation/batches/${id}`,
    corpus: { schemaVersion: 2, version: `${id}.v1`, cases: [item] },
    manifest: {
      schemaVersion: 1,
      sources: real.manifest.sources
        .filter((source) => item.sourceIds.includes(source.id))
        .map((source) => ({ ...source, capturedOn: '2026-10-05' })),
    },
    overlay: { gates: [], programs: [], programDetails: [], cards: [entry] },
    notes: { cards: [{ cardId, issuer: item.issuer, hints: [] }] },
    cards: { cards: [{ id: cardId }] },
    rewardPrograms: null,
    dropped: {},
  };
}

test('a batch may replace a real card: release-1 names and rule-ID scheme, not pinned to release 1', () => {
  const batch = realBatch('wells-fargo-active-cash', (item) => {
    item.reference.rules[0].issuerWording += ' (refreshed)';
    const first = item.reference.rules[0];
    item.reference.rules.push(
      { ...first, category: 'gas', rateBps: 400, issuerWording: 'A first gas rate' },
      { ...first, category: 'gas', rateBps: 300, issuerWording: 'A second gas rate' },
    );
  });
  const inputs = mergeLayers({ ...base, config, layers: [...base.layers, batch] });
  assert.deepEqual(inputs.replacedReal, ['wells-fargo-active-cash']);
  assert.ok(!inputs.corpora[1].cases.some((item) => item.cardId === 'wells-fargo-active-cash'));
  assert.ok(inputs.corpora[1].cases.some((item) => item.cardId === 'citi-double-cash' && item.variant));
  const { catalog, continuity } = buildRelease({ ...inputs, ledger });
  const card = catalog.cards.find((item) => item.id === 'wells-fargo-active-cash');
  assert.equal(card.name, 'Wells Fargo Active Cash');
  assert.equal(card.shortName, 'Active Cash');
  // Release-1 scheme with a counter for the repeated base; the changed terms take the next -vN (continuity).
  assert.deepEqual(
    card.rules.map((rule) => rule.id),
    ['active-cash-base-v2', 'active-cash-gas', 'active-cash-gas-2'],
  );
  assert.deepEqual(continuity.changed, [
    { cardId: 'wells-fargo-active-cash', from: 'active-cash-base', to: 'active-cash-base-v2' },
  ]);
  // checkRealCards fails for the replaced card, so the build checks only the others.
  assert.ok(
    checkRealCards(catalog, CATALOG_V2).some((problem) => problem.startsWith('wells-fargo-active-cash')),
  );
  assert.deepEqual(checkRealCards(catalog, CATALOG_V2, { replaced: inputs.replacedReal }), []);
  // A base layer still may not replace a real card, and no layer may drop one.
  const asBase = { ...batch, kind: 'base', corpus: { ...batch.corpus, version: batch.id } };
  assert.throws(
    () => mergeLayers({ ...base, layers: [...base.layers, asBase] }),
    /wells-fargo-active-cash is a real.v2.2 card, which only a pipeline batch may replace/,
  );
});

test('a refreshed Amex real card without an overlay patch loses the BNPL exclusion (the overlay must carry it)', () => {
  const batch = realBatch('amex-blue-cash-everyday', () => {});
  const { catalog } = buildRelease(mergeLayers({ ...base, config, layers: [...base.layers, batch] }));
  const online = (c) =>
    c.cards
      .find((card) => card.id === 'amex-blue-cash-everyday')
      .rules.find((r) => r.category === 'online-retail');
  assert.deepEqual(online(CATALOG_V3).excludedPaymentPaths, ['bnpl']);
  assert.deepEqual(online(catalog).excludedPaymentPaths, []);
});
