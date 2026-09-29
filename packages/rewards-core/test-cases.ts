import { PILOT_CATALOG } from './src/catalog.ts';
import type { Catalog } from './src/types.ts';

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
