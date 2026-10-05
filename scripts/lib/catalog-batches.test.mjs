// Multi-batch builder tests on synthetic batches: in-memory layers built from a couple of committed corpus cases and
// overlay entries (no captures), stacked on the committed base layer.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CATALOG_V3 } from '../../packages/rewards-core/src/catalog-v3.ts';
import { corpusCases } from './catalog-overlay.mjs';
import { loadCatalogBatches, mergeLayers, sha256Json } from './catalog-batches.mjs';
import {
  buildRelease,
  catalogDates,
  catalogSha256,
  continueRuleIds,
  emptyLedger,
  publishedVersionProblems,
  ruleTermsSha256,
  updateLedger,
} from './catalog-v3.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = await loadCatalogBatches(root);
const ledger = JSON.parse(await readFile(join(root, 'evals/curation/rule-id-ledger.json'), 'utf8'));
const expansion = base.layers[0];
const caseOf = (cardId) => structuredClone(corpusCases(expansion.corpus).get(cardId));
const entryOf = (cardId) => structuredClone(expansion.overlay.cards.find((entry) => entry.cardId === cardId));
const sourcesOf = (item) =>
  structuredClone(expansion.manifest.sources.filter((source) => item.sourceIds.includes(source.id)));

/** A pipeline batch from corpus cases and overlay entries; pairing hashes are stamped unless `pair` is false. */
function batch({
  id = 'test-2026-10',
  cases,
  entries,
  sources = [],
  cards,
  dropped = {},
  mappings,
  overlay = {},
}) {
  const stamped = entries.map((entry) => ({
    ...entry,
    corpusCaseSha256: sha256Json(cases.find((item) => item.cardId === entry.cardId)),
  }));
  return {
    id,
    kind: 'batch',
    dir: `evals/curation/batches/${id}`,
    corpus: { schemaVersion: 2, version: `${id}.v1`, cases },
    manifest: { schemaVersion: 1, sources },
    overlay: { gates: [], programs: [], programDetails: [], cards: stamped, ...overlay },
    notes: { cards: cases.map((item) => ({ cardId: item.cardId, issuer: item.issuer, hints: [] })) },
    cards: { cards: (cards ?? cases.map((item) => item.cardId)).map((cardId) => ({ id: cardId })) },
    rewardPrograms: mappings ? { cards: mappings } : null,
    dropped,
  };
}
const stack = (...layers) => ({
  ...base,
  config: { ...base.config, version: '2026-10-05.test.1' },
  layers: [...base.layers, ...layers],
});

/** A refreshed Amex Gold (base rule reworded) and a new card copied from Chase Freedom Rise. */
function refreshBatch() {
  const gold = caseOf('amex-gold');
  gold.cardName = 'American Express Gold Card (refreshed)';
  gold.reference.rules[0].issuerWording += ' (refreshed)';
  const fresh = caseOf('chase-freedom-rise');
  Object.assign(fresh, {
    id: 'chase-test-new-cash',
    cardId: 'chase-test-new-cash',
    cardName: 'Chase Test New Cash',
  });
  const freshEntry = { ...entryOf('chase-freedom-rise'), cardId: 'chase-test-new-cash' };
  return batch({
    cases: [gold, fresh],
    entries: [entryOf('amex-gold'), freshEntry],
    sources: sourcesOf(gold).map((source) => ({ ...source, capturedOn: '2026-10-05' })),
    mappings: [{ cardId: 'chase-test-new-cash', programId: 'cash-back', statedValueHundredthsOfCent: null }],
  });
}

test('the base layer alone rebuilds the committed CATALOG_V3, with and without the ledger', () => {
  const inputs = mergeLayers(base);
  assert.deepEqual(buildRelease(inputs).catalog, CATALOG_V3);
  const { catalog, continuity } = buildRelease({ ...inputs, ledger });
  assert.deepEqual(catalog, CATALOG_V3);
  assert.equal(continuity.previous, null);
  assert.deepEqual(updateLedger(ledger, catalog), ledger, 'the committed ledger is up to date');
  assert.deepEqual(
    inputs.dropped.map((card) => card.cardId),
    expansion.cards.cards.map((card) => card.id).filter((id) => expansion.dropped[id]),
  );
});

test('newest batch wins per card: replaced cards keep their place, new cards append', () => {
  const inputs = mergeLayers(stack(refreshBatch()));
  const { catalog, continuity, dates } = buildRelease({ ...inputs, ledger });
  const ids = catalog.cards.map((card) => card.id);
  assert.deepEqual(
    ids.slice(0, -1),
    CATALOG_V3.cards.map((card) => card.id),
  );
  assert.equal(ids.at(-1), 'chase-test-new-cash');
  assert.equal(
    catalog.cards.find((card) => card.id === 'amex-gold').name,
    'American Express Gold Card (refreshed)',
  );
  assert.equal(
    inputs.corpora[0].cases.find((item) => item.cardId === 'amex-gold').cardName.endsWith('(refreshed)'),
    true,
  );
  assert.deepEqual(inputs.layers.at(-1), {
    id: 'test-2026-10',
    kind: 'batch',
    dir: 'evals/curation/batches/test-2026-10',
    corpusVersion: 'test-2026-10.v1',
    cards: 2,
    replaced: [],
  });
  assert.deepEqual(inputs.layers[0].replaced, ['amex-gold']);
  // Dates follow the newest capture; the oldest is reported.
  assert.equal(catalog.verifiedAt, '2026-10-05T00:00:00Z');
  assert.equal(catalog.expiresAt, '2026-11-04T00:00:00Z');
  assert.equal(dates.oldest, '2026-09-29');
  // Continuity against the seeded ledger: the reworded base rule gets a new ID, the new card's rules are added.
  assert.equal(continuity.previous.version, '2026-10-02.expansion.1');
  assert.deepEqual(continuity.changed, [{ cardId: 'amex-gold', from: 'gold-base', to: 'gold-base-v2' }]);
  assert.equal(continuity.kept.length, 819);
  assert.deepEqual(
    continuity.added,
    catalog.cards.at(-1).rules.map((rule) => rule.id),
  );
  assert.deepEqual(continuity.dropped, []);
});

test('a later batch can drop a card, which leaves the catalog with its reason', () => {
  const inputs = mergeLayers(
    stack(
      batch({ cases: [], entries: [], cards: ['amex-gold'], dropped: { 'amex-gold': 'card withdrawn' } }),
    ),
  );
  assert.ok(!inputs.cardOrder.includes('amex-gold'));
  assert.deepEqual(
    inputs.dropped.find((card) => card.cardId === 'amex-gold'),
    { cardId: 'amex-gold', layer: 'test-2026-10', reason: 'card withdrawn' },
  );
  const { catalog } = buildRelease(inputs);
  assert.equal(catalog.cards.length, 177);
  // A gate only the dropped card used is pruned (it would otherwise fail the overlay's "unused" check).
  const gate = 'boa-customized-cash-rewards-first-year';
  assert.ok(mergeLayers(base).overlay.gates.some((g) => g.id === gate));
  const pruned = mergeLayers(
    stack(
      batch({
        cases: [],
        entries: [],
        cards: ['boa-customized-cash-rewards'],
        dropped: { 'boa-customized-cash-rewards': 'card withdrawn' },
      }),
    ),
  );
  assert.ok(!pruned.overlay.gates.some((g) => g.id === gate));
  assert.doesNotThrow(() => buildRelease(pruned));
});

test('pairing: a missing or mismatched corpusCaseSha256 is refused', () => {
  const missing = refreshBatch();
  delete missing.overlay.cards[0].corpusCaseSha256;
  assert.throws(() => mergeLayers(stack(missing)), /overlay entry amex-gold has no corpusCaseSha256/);
  const mismatched = refreshBatch();
  mismatched.corpus.cases[0].reference.rules[0].rateBps = 500; // edited after pairing
  assert.throws(() => mergeLayers(stack(mismatched)), /overlay entry amex-gold is not paired/);
  const stray = refreshBatch();
  stray.overlay.cards.push({ ...entryOf('amex-platinum'), corpusCaseSha256: '0'.repeat(64) });
  assert.throws(
    () => mergeLayers(stack(stray)),
    /overlay entry amex-platinum has no corpus case in the layer/,
  );
});

test('dates come from the manifests: newest capture or freshness check, 30 days of validity', () => {
  const checked = refreshBatch();
  checked.manifest.sources[0].checkedOn = '2026-10-07';
  const { catalog } = buildRelease(mergeLayers(stack(checked)));
  assert.equal(catalog.verifiedAt, '2026-10-07T00:00:00Z');
  assert.equal(catalog.expiresAt, '2026-11-06T00:00:00Z');
  const sources = [
    { id: 'a', checkedOn: '2026-09-29' },
    { id: 'm', checkedOn: '2026-09-28' },
    { id: 'b', checkedOn: '2026-12-15' },
  ];
  assert.deepEqual(catalogDates(sources, new Set(['m'])), {
    verifiedAt: '2026-12-15T00:00:00Z',
    expiresAt: '2027-01-14T00:00:00Z',
    newest: '2026-12-15',
    oldest: '2026-09-29',
    issuerSources: 2,
    captureDates: ['2026-09-29', '2026-12-15'],
  });
});

test('completeness: a researched card must be in the corpus or dropped with a reason', () => {
  const ghost = refreshBatch();
  ghost.cards.cards.push({ id: 'chase-ghost' });
  assert.throws(
    () => mergeLayers(stack(ghost)),
    /card chase-ghost is neither in the corpus nor dropped with a reason/,
  );
  ghost.dropped = { 'chase-ghost': 'no rewards page' };
  const inputs = mergeLayers(stack(ghost));
  assert.deepEqual(inputs.dropped.at(-1), {
    cardId: 'chase-ghost',
    layer: 'test-2026-10',
    reason: 'no rewards page',
  });
  const unlisted = refreshBatch();
  unlisted.cards.cards.pop();
  assert.throws(() => mergeLayers(stack(unlisted)), /corpus card chase-test-new-cash is not in cards.json/);
  const real = refreshBatch();
  real.cards.cards.push({ id: 'citi-double-cash' });
  real.dropped = { 'citi-double-cash': 'test' };
  assert.throws(() => mergeLayers(stack(real)), /citi-double-cash is a real.v2.2 card/);
});

test('definitions: a batch may add or repeat a gate, never redefine one; programs must exist', () => {
  const gate = structuredClone(expansion.overlay.gates[0]);
  const same = refreshBatch();
  same.overlay.gates = [gate];
  assert.doesNotThrow(() => mergeLayers(stack(same)));
  const redefined = refreshBatch();
  redefined.overlay.gates = [{ ...gate, question: `${gate.question} Changed?` }];
  assert.throws(
    () => mergeLayers(stack(redefined)),
    new RegExp(`gates ${gate.id} redefines the one in expansion.v1`),
  );
  const store = structuredClone(expansion.overlay.programs[0]);
  const programs = refreshBatch();
  programs.overlay.programs = [{ ...store, name: `${store.name} Changed` }];
  assert.throws(
    () => mergeLayers(stack(programs)),
    new RegExp(`programs ${store.id} redefines the one in expansion.v1`),
  );
  const detail = structuredClone(expansion.overlay.programDetails.find((d) => d.programId === store.id));
  const details = refreshBatch();
  details.overlay.programDetails = [{ ...detail, unitName: 'points' }];
  assert.throws(
    () => mergeLayers(stack(details)),
    new RegExp(`programDetails ${store.id} redefines the one in expansion.v1`),
  );
  const program = refreshBatch();
  program.rewardPrograms.cards[0].programId = 'test-new-points';
  assert.throws(() => mergeLayers(stack(program)), /maps to unknown program test-new-points/);
});

// Rule-ID continuity on synthetic cards.
const rule = (id, rateBps, extra = {}) => ({ id, category: id.split('-')[1], rateBps, ...extra });
const cardWith = (...rules) => ({ id: 'card-a', rules });
function release(version, cards, before = emptyLedger()) {
  const continuity = continueRuleIds(cards, before, version);
  const catalog = {
    version,
    cards: cards.map((card, c) => ({
      ...card,
      rules: card.rules.map((r, i) => ({ ...r, id: continuity.ids[c][i] })),
    })),
  };
  return { continuity, catalog, ledger: updateLedger(before, catalog) };
}

test('continuity: unchanged terms keep the ID, changed terms get a new one, dropped IDs are listed', () => {
  const v1 = release('v1', [cardWith(rule('a-base', 100), rule('a-dining', 300), rule('a-gas', 200))]);
  assert.deepEqual(v1.continuity.added, ['a-base', 'a-dining', 'a-gas']);
  const v2 = release(
    'v2',
    [cardWith(rule('a-base', 100), rule('a-dining', 400), rule('a-travel', 500))],
    v1.ledger,
  );
  assert.deepEqual(v2.continuity.kept, ['a-base']);
  assert.deepEqual(v2.continuity.changed, [{ cardId: 'card-a', from: 'a-dining', to: 'a-dining-v2' }]);
  assert.deepEqual(v2.continuity.added, ['a-travel']);
  assert.deepEqual(v2.continuity.dropped, ['a-gas']);
  assert.deepEqual(
    v2.catalog.cards[0].rules.map((r) => r.id),
    ['a-base', 'a-dining-v2', 'a-travel'],
  );
  assert.deepEqual(
    v2.ledger.catalogs.map((entry) => entry.version),
    ['v1', 'v2'],
  );
  assert.equal(v2.ledger.ids['a-dining'].termsSha256, ruleTermsSha256(rule('a-dining', 300)));
});

test('continuity: an issued ID is never reissued with other terms', () => {
  const v1 = release('v1', [cardWith(rule('a-dining', 300))]);
  const v2 = release('v2', [cardWith(rule('a-dining', 400))], v1.ledger);
  const v3 = release('v3', [cardWith(rule('a-dining', 500))], v2.ledger);
  assert.deepEqual(v3.continuity.changed, [{ cardId: 'card-a', from: 'a-dining-v2', to: 'a-dining-v3' }]);
  assert.deepEqual(v3.continuity.dropped, []);
  // The first terms come back: their own ID is reissued, never another's.
  const v4 = release('v4', [cardWith(rule('a-dining', 300))], v3.ledger);
  assert.equal(v4.catalog.cards[0].rules[0].id, 'a-dining');
  // A generated ID that moved (a collision counter shifted) keeps the previous ID when the terms are unchanged.
  const v5 = release('v5', [cardWith(rule('a-dining-2', 300))], v4.ledger);
  assert.equal(v5.catalog.cards[0].rules[0].id, 'a-dining');
  // Another card cannot take an ID issued for card-a.
  const v6 = release('v6', [{ id: 'card-b', rules: [rule('a-dining', 300)] }], v5.ledger);
  assert.equal(v6.catalog.cards[0].rules[0].id, 'a-dining-v4');
  assert.throws(
    () => updateLedger(v6.ledger, { version: 'v7', cards: [cardWith(rule('a-dining', 999))] }),
    /a-dining was issued for other terms/,
  );
  assert.throws(() => updateLedger(v6.ledger, v1.catalog), /older than the newest/);
});

test('continuity: a terms change is "changed" when the old ID carried a collision counter', () => {
  const v1 = release('v1', [cardWith(rule('a-dining-2', 300))]);
  const v2 = release('v2', [cardWith(rule('a-dining', 250))], v1.ledger);
  assert.deepEqual(v2.continuity.changed, [{ cardId: 'card-a', from: 'a-dining-2', to: 'a-dining' }]);
  assert.deepEqual(v2.continuity.added, []);
  assert.deepEqual(v2.continuity.dropped, []);
});

test('continuity: a rebuild of the same version is compared with the version before it', () => {
  const v1 = release('v1', [cardWith(rule('a-dining', 300))]);
  const draft = release('v2', [cardWith(rule('a-dining', 400))], v1.ledger);
  const rebuilt = release('v2', [cardWith(rule('a-dining', 400))], draft.ledger);
  assert.deepEqual(rebuilt.continuity.changed, draft.continuity.changed);
  assert.deepEqual(rebuilt.ledger, draft.ledger);
});

test('published versions: the same rule IDs and terms leave the ledger as is; anything else is refused', () => {
  const v1 = release('v1', [cardWith(rule('a-base', 100), rule('a-dining', 300))]);
  const v2 = release('v2', [cardWith(rule('a-base', 100), rule('a-dining', 400))], v1.ledger);
  const published = { published: ['v1', 'v2'] };
  // An identical rebuild of v2 returns the ledger unchanged (its entry, bytes included, is never rewritten).
  const same = { ...v2.catalog, cards: structuredClone(v2.catalog.cards) };
  assert.equal(updateLedger(v2.ledger, same, published), v2.ledger);
  assert.deepEqual(publishedVersionProblems(v2.ledger, same), []);
  // Other terms under the same ID, an ID more, an ID fewer, another order: all refused before any write.
  const terms = structuredClone(same);
  terms.cards[0].rules[0].rateBps = 150;
  assert.throws(() => updateLedger(v2.ledger, terms, published), /v2 is published.*with other terms: a-base/);
  const more = structuredClone(same);
  more.cards[0].rules.push({ ...rule('a-gas', 200) });
  assert.match(publishedVersionProblems(v2.ledger, more).join(), /1 rule ID\(s\) not in it: a-gas/);
  const fewer = structuredClone(same);
  fewer.cards[0].rules.pop();
  assert.match(
    publishedVersionProblems(v2.ledger, fewer).join(),
    /1 of its rule ID\(s\) missing: a-dining-v2/,
  );
  // Card-level fields are not in the rule terms: the catalog SHA-256 in the entry catches them.
  const renamed = structuredClone(same);
  renamed.cards[0].name = 'Card A (renamed)';
  assert.deepEqual(publishedVersionProblems(v2.ledger, renamed), [
    'other catalog contents (SHA-256 of the canonical JSON)',
  ]);
  assert.throws(() => updateLedger(v2.ledger, renamed, published), /canonical JSON/);
  const unhashed = structuredClone(v2.ledger);
  delete unhashed.catalogs[1].catalogSha256;
  assert.deepEqual(publishedVersionProblems(unhashed, same), ['its ledger entry has no catalogSha256']);
  const order = structuredClone(same);
  order.cards[0].rules.reverse();
  assert.deepEqual(publishedVersionProblems(v2.ledger, order), [
    'its rule IDs in another order',
    'other catalog contents (SHA-256 of the canonical JSON)',
  ]);
  // A published version the ledger does not know is refused too; an unpublished one is still rebuilt in place.
  assert.throws(() => updateLedger(v2.ledger, { ...same, version: 'v3' }, { published: ['v3'] }), /no entry/);
  assert.deepEqual(updateLedger(v2.ledger, more).catalogs.at(-1).ruleIds, ['a-base', 'a-dining-v2', 'a-gas']);
});

test('the committed config lists its version as published, and the committed build matches its ledger entry', () => {
  assert.ok(base.config.publishedVersions.includes(base.config.version));
  const { catalog } = buildRelease({ ...mergeLayers(base), ledger });
  assert.deepEqual(publishedVersionProblems(ledger, catalog), []);
  assert.equal(updateLedger(ledger, catalog, { published: base.config.publishedVersions }), ledger);
  // The seeded hash is today's CATALOG_V3, the canonical JSON SHA-256 recorded for release 2.
  assert.equal(ledger.catalogs.at(-1).catalogSha256, catalogSha256(CATALOG_V3));
  assert.equal(catalogSha256(CATALOG_V3), '147b48c1a18fa2296d06461b0ae0e647d8c0a8e66f9639ab1cfc10613533eb26');
});

test('quote-limit omissions apply only to cards still on the frozen base layer', () => {
  // Wells Fargo Autograph is on the omission list; a refreshed case without that exclusion must still build.
  const autograph = caseOf('wells-fargo-autograph');
  autograph.reference.exclusions = autograph.reference.exclusions.filter(
    (exclusion) => !exclusion.text.startsWith('Overdraft protection advances'),
  );
  const refreshed = batch({
    cases: [autograph],
    entries: [entryOf('wells-fargo-autograph')],
    sources: sourcesOf(autograph).map((source) => ({ ...source, capturedOn: '2026-10-05' })),
  });
  const inputs = mergeLayers(stack(refreshed));
  assert.equal(inputs.fromBase.includes('wells-fargo-autograph'), false);
  assert.equal(inputs.fromBase.includes('wells-fargo-autograph-journey'), true);
  const { catalog } = buildRelease({ ...inputs, ledger });
  const journey = catalog.cards.find((card) => card.id === 'wells-fargo-autograph-journey');
  assert.equal(
    journey.exclusions.some((text) => text.startsWith('Overdraft protection advances')),
    false,
  );
});
