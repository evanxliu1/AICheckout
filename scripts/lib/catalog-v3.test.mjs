import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CATALOG_V2 } from '../../packages/rewards-core/src/catalog-v2.ts';
import { CATALOG_V3 } from '../../packages/rewards-core/src/catalog-v3.ts';
import { catalogV3Schema } from '../../packages/rewards-core/src/schema.ts';
import { loadCatalogBatches, mergeLayers } from './catalog-batches.mjs';
import {
  CATALOG_V3_BYTE_BUDGET,
  buildCatalogV3,
  buildRelease,
  catalogStats,
  checkRealCards,
  jsonbTextBytes,
  ruleIdsFor,
  rulePrefixOf,
  shortNameOf,
} from './catalog-v3.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const loaded = await loadCatalogBatches(root);
const ledger = JSON.parse(await readFile(join(root, 'evals/curation/rule-id-ledger.json'), 'utf8'));
const committed = mergeLayers(loaded);
// Rule IDs as the builder derives them, before ledger continuity renames changed rules.
const built = buildCatalogV3(committed);
// The frozen base layer alone, as release 2 was built: no pipeline batch, no freshness record.
const baseBuilt = buildCatalogV3(
  mergeLayers({
    ...loaded,
    config: { ...loaded.config, version: '2026-10-02.expansion.1' },
    layers: loaded.layers.filter((layer) => layer.kind === 'base'),
    freshness: [],
  }),
);

test('the committed CATALOG_V3 is the build of the committed inputs', () => {
  const { catalog } = buildRelease({ ...committed, ledger });
  assert.deepEqual(CATALOG_V3, catalog);
  assert.equal(catalog.version, loaded.config.version);
  assert.equal(catalog.version, '2026-10-05.renewal.1');
  assert.equal(catalog.verifiedAt, '2026-10-05T00:00:00Z');
  assert.equal(catalog.expiresAt, '2026-11-04T00:00:00Z');
  assert.ok(catalogV3Schema.safeParse(catalog).success);
  // Real cards a batch refreshed are checked by rule-ID continuity instead; the others still match release 1.
  assert.deepEqual(checkRealCards(catalog, CATALOG_V2, { replaced: committed.replacedReal }), []);
});

test('every corpus card is in the catalog except the two the overlay holds out', () => {
  const ids = new Set(built.cards.map((card) => card.id));
  const held = committed.overlay.cards.filter((card) => card.heldOut).map((card) => card.cardId);
  assert.deepEqual(held.sort(), ['marriott-bonvoy-bold', 'us-bank-shield']);
  for (const corpus of committed.corpora)
    for (const item of corpus.cases)
      assert.equal(ids.has(item.cardId), !held.includes(item.cardId), item.cardId);
  assert.equal(built.cards.length, 178);
});

test('the real cards keep release 1 names, rule IDs and rule semantics', () => {
  assert.deepEqual(checkRealCards(baseBuilt, CATALOG_V2), []);
  const changed = structuredClone(baseBuilt);
  const card = changed.cards.find((c) => c.id === 'amex-blue-cash-everyday');
  card.rules.find((r) => r.id === 'bce-online-retail').excludedPaymentPaths = [];
  changed.cards.find((c) => c.id === 'citi-double-cash').statedValueHundredthsOfCent = 150;
  assert.deepEqual(checkRealCards(changed, CATALOG_V2), [
    'citi-double-cash unit value 150 ≠ 100',
    'amex-blue-cash-everyday rule bce-online-retail differs',
  ]);
  const points = structuredClone(baseBuilt);
  points.cards.find((c) => c.id === 'citi-double-cash').programId = 'citi-thankyou';
  assert.deepEqual(checkRealCards(points, CATALOG_V2), [
    'citi-double-cash program citi-thankyou is not cash back',
  ]);
});

test('rule IDs are short, unique and derived from the rule, not its position', () => {
  const ids = built.cards.flatMap((card) => card.rules.map((rule) => rule.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Math.max(...ids.map((id) => id.length)) <= 80);
  for (const card of built.cards) {
    const base = card.rules.filter((r) => r.id.endsWith('-base'));
    assert.equal(base.length, card.acceptance.kind === 'open-loop' ? 1 : 0, card.id);
    if (base.length) assert.equal(card.rules[0], base[0], `${card.id}: base first`);
  }
  const card = built.cards.find((c) => c.id === 'prime-visa');
  const isBase = (rule) => rule.id === 'prime-base';
  const reversed = [...card.rules].reverse();
  const forward = new Map(card.rules.map((rule, i) => [rule, ruleIdsFor('prime', card.rules, isBase)[i]]));
  const backward = new Map(reversed.map((rule, i) => [rule, ruleIdsFor('prime', reversed, isBase)[i]]));
  for (const rule of card.rules) assert.equal(forward.get(rule), backward.get(rule), rule.id);
  assert.deepEqual(
    card.rules.map((r) => r.id).filter((id) => id.includes('amazon')),
    ['prime-amazon-member', 'prime-amazon-not-member'],
  );
});

test('rule prefixes and short names drop issuer and network words', () => {
  assert.equal(rulePrefixOf('capital-one-williams-sonoma-key-rewards-visa'), 'williams-sonoma-key-rewards');
  assert.equal(rulePrefixOf('synchrony-newegg-store-credit-card'), 'newegg-store');
  assert.equal(rulePrefixOf('amex-gold'), 'gold');
  assert.equal(shortNameOf('x', 'U.S. Bank Cash+ Visa Signature Card'), 'Cash+ Visa Signature');
  assert.equal(shortNameOf('x', 'Citi / AAdvantage Globe Mastercard'), 'AAdvantage Globe Mastercard');
  assert.equal(shortNameOf('x', 'Hilton Honors American Express Surpass Card'), 'Hilton Honors Surpass');
  assert.equal(
    shortNameOf('x', 'Bank of America Travel Rewards credit card for Students'),
    'Travel Rewards for Students',
  );
  assert.equal(
    shortNameOf('x', 'AARP Travel Rewards Mastercard from Barclays'),
    'AARP Travel Rewards Mastercard',
  );
  const names = built.cards.map((card) => card.shortName);
  assert.equal(new Set(names).size, names.length, 'short names are unique');
});

test('size stays within 75% of 1 MiB, as JSON and as JSONB text', () => {
  const stats = catalogStats(built);
  assert.ok(stats.jsonBytes <= CATALOG_V3_BYTE_BUDGET, `${stats.jsonBytes}`);
  assert.ok(stats.jsonbTextBytes <= CATALOG_V3_BYTE_BUDGET, `${stats.jsonbTextBytes}`);
  // JSONB text adds a space after every colon and comma: {"a": [1, 2], "b": "x"}.
  assert.equal(jsonbTextBytes({ a: [1, 2], b: 'x' }), '{"a": [1, 2], "b": "x"}'.length);
  assert.equal(jsonbTextBytes({ a: { b: [] }, c: [{}] }), '{"a": {"b": []}, "c": [{}]}'.length);
});

test('only programs, brands, gates and sources the catalog uses are kept', () => {
  const programIds = new Set(built.cards.map((c) => c.programId));
  assert.ok(built.programs.every((p) => programIds.has(p.id)));
  const gateIds = new Set(
    built.cards.flatMap((c) => c.rules.flatMap((r) => r.requires.map((q) => q.gateId))),
  );
  assert.ok(built.gates.every((g) => gateIds.has(g.id)));
  const sourceIds = new Set([
    ...built.cards.flatMap((c) => c.rules.flatMap((r) => r.sourceIds)),
    ...built.programs.flatMap((p) => p.valuation.sourceIds ?? []),
    ...built.merchants.flatMap((m) => m.mcc.sourceIds),
  ]);
  assert.ok(built.sources.every((s) => sourceIds.has(s.id)));
});

test('the build refuses an overlay that fails its coverage check', () => {
  const state = structuredClone(committed);
  state.overlay.cards.find((card) => card.cardId === 'prime-visa').rules = [];
  assert.throws(() => buildCatalogV3(state), /overlay check fails/);
});
