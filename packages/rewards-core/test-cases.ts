import { PILOT_CATALOG } from './src/catalog.ts';
import { CATALOG_V2 } from './src/catalog-v2.ts';
import type { CatalogV1 as Catalog, CatalogV2 } from './src/types.ts';

type Case = { name: string; input: unknown; valid: boolean };
const invalid = (name: string, mutate: (catalog: Catalog) => unknown): Case => {
  const catalog = structuredClone(PILOT_CATALOG);
  const result = mutate(catalog);
  return { name, input: result ?? catalog, valid: false };
};
export const catalogCases: Case[] = [
  { name: 'pilot catalog', input: PILOT_CATALOG, valid: true },
  {
    name: 'previous single-merchant catalog remains compatible',
    input: { ...PILOT_CATALOG, version: '2026-09-25.pilot.1', merchantIds: ['best-buy-us'] },
    valid: true,
  },
  { name: 'null', input: null, valid: false },
  { name: 'unknown shape', input: { cards: [] }, valid: false },
  invalid('unknown fields', (c) => ({ ...c, script: 'execute' })),
  invalid('fractional rate', (c) => {
    c.cards[0].rules[0].rateBps = 1.5;
  }),
  invalid('negative rate', (c) => {
    c.cards[0].rules[0].rateBps = -1;
  }),
  invalid('excessive rate', (c) => {
    c.cards[0].rules[0].rateBps = 10001;
  }),
  invalid('missing source', (c) => {
    c.cards[0].rules[0].sourceIds = ['missing'];
  }),
  invalid('duplicate rule source', (c) => {
    c.cards[0].rules[0].sourceIds.push(c.cards[0].rules[0].sourceIds[0]);
  }),
  invalid('duplicate source', (c) => {
    c.sources.push(c.sources[0]);
  }),
  invalid('duplicate card', (c) => {
    c.cards.push(c.cards[0]);
  }),
  invalid('duplicate global rule id', (c) => {
    c.cards[1].rules[0].id = c.cards[0].rules[0].id;
  }),
  invalid('missing base', (c) => {
    c.cards[1].rules.shift();
  }),
  invalid('two bonuses', (c) => {
    c.cards[1].rules.push({ ...c.cards[1].rules[1], id: 'second-bonus' });
  }),
  invalid('capped base', (c) => {
    c.cards[0].rules[0].annualCapCents = 100;
  }),
  invalid('activated base', (c) => {
    c.cards[0].rules[0].requiresActivation = true;
  }),
  invalid('bonus below base', (c) => {
    c.cards[1].rules[1].rateBps = 1;
  }),
  invalid('invalid calendar date', (c) => {
    c.sources[0].checkedOn = '2026-02-30';
  }),
  invalid('future source', (c) => {
    c.sources[0].checkedOn = '2026-09-26';
  }),
  invalid('stale source', (c) => {
    c.sources[0].checkedOn = '2026-08-01';
  }),
  invalid('long freshness window', (c) => {
    c.expiresAt = '2026-10-26T00:00:00Z';
  }),
  invalid('reversed validity', (c) => {
    c.expiresAt = '2026-09-24T00:00:00Z';
  }),
  invalid('unsafe source URL', (c) => {
    c.sources[0].url = 'javascript:alert(1)';
  }),
  invalid('credential-bearing URL', (c) => {
    c.sources[0].url = 'https://user:password@example.com/terms';
  }),
  invalid('invalid URL', (c) => {
    c.sources[0].url = 'invalid';
  }),
  invalid('empty cards', (c) => {
    c.cards = [];
  }),
  invalid('duplicate merchants', (c) => {
    c.merchantIds.push(c.merchantIds[0]);
  }),
];

const invalidV2 = (name: string, mutate: (catalog: CatalogV2) => unknown): Case => {
  const catalog = structuredClone(CATALOG_V2);
  const result = mutate(catalog);
  return { name: `v2: ${name}`, input: result ?? catalog, valid: false };
};
const card = (catalog: CatalogV2, id: string) => catalog.cards.find((c) => c.id === id)!;
const rule = (catalog: CatalogV2, cardId: string, category: string) =>
  card(catalog, cardId).rules.find((r) => r.category === category)!;
const validV2 = (name: string, mutate: (catalog: CatalogV2) => void): Case => {
  const catalog = structuredClone(CATALOG_V2);
  mutate(catalog);
  return { name: `v2: ${name}`, input: catalog, valid: true };
};

/** Catalog v2 contract cases, run against Zod (extension, parity script) and SQL (parity script). */
export const catalogV2Cases: Case[] = [
  { name: 'v2: real 7-card catalog', input: CATALOG_V2, valid: true },
  validV2('expired limited-time rule is allowed', (c) => {
    rule(c, 'capital-one-savor', 'dining').limitedTime = { endsOn: '2026-01-31' };
  }),
  validV2('unknown MCC with low confidence and no sources', (c) => {
    c.merchants[0].mcc = { code: null, confidence: 'low', sourceIds: [] };
  }),
  invalidV2('schemaVersion 3', (c) => ({ ...c, schemaVersion: 3 })),
  invalidV2('v1 field on v2', (c) => ({ ...c, merchantIds: ['best-buy-us'] })),
  invalidV2('unknown rule field', (c) => {
    Object.assign(rule(c, 'citi-double-cash', 'all-purchases'), { requiresActivation: false });
  }),
  invalidV2('unknown category', (c) => {
    Object.assign(rule(c, 'capital-one-savor', 'dining'), { category: 'restaurants' });
  }),
  invalidV2('fractional rate', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').rateBps = 199.5;
  }),
  invalidV2('rate above 100%', (c) => {
    rule(c, 'capital-one-savor', 'entertainment-portal').rateBps = 10_001;
  }),
  invalidV2('duplicate rule id across cards', (c) => {
    rule(c, 'wells-fargo-active-cash', 'all-purchases').id = rule(c, 'citi-double-cash', 'all-purchases').id;
  }),
  invalidV2('duplicate card', (c) => {
    c.cards.push(c.cards[0]);
  }),
  invalidV2('duplicate merchant', (c) => {
    c.merchants.push(c.merchants[0]);
  }),
  invalidV2('duplicate source', (c) => {
    c.sources.push(c.sources[0]);
  }),
  invalidV2('missing all-purchases rule', (c) => {
    card(c, 'wells-fargo-active-cash').rules.push({
      ...rule(c, 'wells-fargo-active-cash', 'all-purchases'),
      id: 'active-cash-dining',
      category: 'dining',
    });
    card(c, 'wells-fargo-active-cash').rules.shift();
  }),
  invalidV2('two all-purchases rules', (c) => {
    card(c, 'citi-double-cash').rules.push({
      ...rule(c, 'citi-double-cash', 'all-purchases'),
      id: 'second-base',
    });
  }),
  invalidV2('base with a spend cap', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').cap = {
      kind: 'spend',
      amountCents: 100_000,
      period: 'calendar-year',
      rateAfterCapBps: 100,
    };
  }),
  invalidV2('base needing activation', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').activation = 'recurring';
  }),
  invalidV2('limited-time base', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').limitedTime = { endsOn: null };
  }),
  invalidV2('bonus below base', (c) => {
    rule(c, 'citi-double-cash', 'travel-portal').rateBps = 150;
  }),
  invalidV2('paid-on-payment above rate', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').paidOnPaymentBps = 201;
  }),
  invalidV2('after-cap rate above rule rate', (c) => {
    const target = rule(c, 'amex-blue-cash-everyday', 'online-retail');
    if (target.cap.kind === 'spend') target.cap.rateAfterCapBps = 301;
  }),
  invalidV2('negative after-cap rate', (c) => {
    const target = rule(c, 'amex-blue-cash-everyday', 'online-retail');
    if (target.cap.kind === 'spend') target.cap.rateAfterCapBps = -1;
  }),
  invalidV2('spend cap without amount', (c) => {
    rule(c, 'amex-blue-cash-everyday', 'online-retail').cap = {
      kind: 'spend',
      period: 'calendar-year',
      rateAfterCapBps: 100,
    } as never;
  }),
  invalidV2('unknown cap period', (c) => {
    const target = rule(c, 'amex-blue-cash-everyday', 'online-retail');
    if (target.cap.kind === 'spend') Object.assign(target.cap, { period: 'decade' });
  }),
  invalidV2('extra field on unstated cap', (c) => {
    rule(c, 'amex-blue-cash-preferred', 'streaming').cap = { kind: 'unstated', amountCents: 1 } as never;
  }),
  invalidV2('unknown activation', (c) => {
    Object.assign(rule(c, 'chase-freedom-unlimited', 'dining'), { activation: 'maybe' });
  }),
  invalidV2('unknown payment path', (c) => {
    Object.assign(rule(c, 'amex-blue-cash-everyday', 'online-retail'), { excludedPaymentPaths: ['crypto'] });
  }),
  invalidV2('invalid limited-time date', (c) => {
    rule(c, 'capital-one-savor', 'dining').limitedTime = { endsOn: '2026-02-30' };
  }),
  invalidV2('rule cites an absent source', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').sourceIds = ['absent'];
  }),
  invalidV2('rule without sources', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').sourceIds = [];
  }),
  invalidV2('merchant MCC cites an absent source', (c) => {
    c.merchants[0].mcc.sourceIds = ['absent'];
  }),
  invalidV2('stated MCC without sources', (c) => {
    c.merchants[0].mcc.sourceIds = [];
  }),
  invalidV2('malformed MCC', (c) => {
    c.merchants[0].mcc.code = '57';
  }),
  invalidV2('unknown MCC with high confidence', (c) => {
    c.merchants[2].mcc.confidence = 'high';
  }),
  invalidV2('unknown merchant category', (c) => {
    Object.assign(c.merchants[0], { expectedCategory: 'computers' });
  }),
  invalidV2('points card without point value', (c) => {
    card(c, 'citi-double-cash').pointValueHundredthsOfCent = null;
  }),
  invalidV2('cash-back card with point value', (c) => {
    card(c, 'wells-fargo-active-cash').pointValueHundredthsOfCent = 100;
  }),
  invalidV2('future source', (c) => {
    c.sources[0].checkedOn = '2026-09-30';
  }),
  invalidV2('stale source', (c) => {
    c.sources[0].checkedOn = '2026-08-01';
  }),
  invalidV2('long freshness window', (c) => {
    c.expiresAt = '2026-10-30T00:00:00Z';
  }),
  invalidV2('reversed validity', (c) => {
    c.expiresAt = '2026-09-28T00:00:00Z';
  }),
  invalidV2('credential-bearing source URL', (c) => {
    c.sources[0].url = 'https://user:password@example.com/terms';
  }),
  invalidV2('non-HTTPS source URL', (c) => {
    c.sources[0].url = 'http://example.com/terms';
  }),
  invalidV2('no merchants', (c) => {
    c.merchants = [];
  }),
  invalidV2('oversized catalog', (c) => {
    card(c, 'citi-double-cash').exclusions = Array.from({ length: 20 }, () => 'x'.repeat(600));
    for (const other of c.cards) other.exclusions = card(c, 'citi-double-cash').exclusions;
    c.cards.push(
      ...Array.from({ length: 23 }, (_, i) => ({
        ...structuredClone(c.cards[0]),
        id: `copy-${i}`,
        rules: c.cards[0].rules.map((r) => ({ ...r, id: `copy-${i}-${r.id}` })),
      })),
    );
  }),
];
