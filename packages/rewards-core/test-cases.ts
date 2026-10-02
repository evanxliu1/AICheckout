import { PILOT_CATALOG } from './src/catalog.ts';
import { CATALOG_V2 } from './src/catalog-v2.ts';
import type { CatalogV1 as Catalog, CatalogV2, CatalogV3, RewardRuleV3 } from './src/types.ts';

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
  invalidV2('after-cap rate below the base rate', (c) => {
    const target = rule(c, 'amex-blue-cash-everyday', 'online-retail');
    if (target.cap.kind === 'spend') target.cap.rateAfterCapBps = 50;
  }),
  invalidV2('card as an excluded payment path', (c) => {
    Object.assign(rule(c, 'amex-blue-cash-everyday', 'online-retail'), { excludedPaymentPaths: ['card'] });
  }),
  invalidV2('duplicate excluded payment path', (c) => {
    rule(c, 'amex-blue-cash-everyday', 'online-retail').excludedPaymentPaths = ['bnpl', 'bnpl'];
  }),
  invalidV2('base with an excluded payment path', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').excludedPaymentPaths = ['paypal'];
  }),
  invalidV2('base needing one-time enrollment', (c) => {
    rule(c, 'citi-double-cash', 'all-purchases').activation = 'enroll-once';
  }),
  invalidV2('duplicate MCC source', (c) => {
    c.merchants[0].mcc.sourceIds = [c.merchants[0].mcc.sourceIds[0], c.merchants[0].mcc.sourceIds[0]];
  }),
  invalidV2('verification time with an offset', (c) => {
    c.verifiedAt = c.verifiedAt.replace('Z', '+00:00');
  }),
  invalidV2('extra limited-time field', (c) => {
    rule(c, 'capital-one-savor', 'dining').limitedTime = { endsOn: null, note: 'x' } as never;
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

const v3Rule = (id: string, overrides: Partial<RewardRuleV3> = {}): RewardRuleV3 => ({
  id,
  category: 'all-purchases',
  issuerWording: 'Synthetic test wording',
  rateBps: 100,
  paidOnPaymentBps: 0,
  cap: { kind: 'none' },
  activation: 'none',
  usMerchantsOnly: false,
  excludedPaymentPaths: [],
  limitedTime: null,
  sourceIds: ['test-terms'],
  brandIds: [],
  choice: null,
  requires: [],
  requiredPaymentPaths: [],
  ...overrides,
});
const quarterCap = { kind: 'spend', amountCents: 200_000, period: 'quarter', rateAfterCapBps: 100 } as const;

/** Synthetic catalog v3 covering every v3 feature once: programs with each valuation basis, brands,
 * gates, a closed-loop card, chosen and automatic choices, a rotating rule with a start date, and
 * checkout-method rules. Test data only; not issuer terms. */
export const CATALOG_V3_FIXTURE: CatalogV3 = {
  schemaVersion: 3,
  version: 'test-v3.1',
  verifiedAt: '2026-10-02T00:00:00Z',
  expiresAt: '2026-11-01T00:00:00Z',
  programs: [
    {
      id: 'cash-back',
      name: 'Cash back',
      currency: 'cash-back',
      unitName: 'cents',
      valuation: { basis: 'cash', valueHundredthsOfCent: 100 },
      redemptionBrandIds: [],
    },
    {
      id: 'test-membership-points',
      name: 'Test Membership Points',
      currency: 'points',
      unitName: 'points',
      valuation: {
        basis: 'published-estimate',
        valueHundredthsOfCent: 120,
        publisher: 'Example Valuations',
        url: 'https://valuations.example/points',
        retrievedOn: '2026-10-01',
      },
      redemptionBrandIds: [],
    },
    {
      id: 'test-store-points',
      name: 'Test Store Points',
      currency: 'points',
      unitName: 'points',
      valuation: { basis: 'issuer-stated', valueHundredthsOfCent: 100, sourceIds: ['test-store-terms'] },
      redemptionBrandIds: ['test-store'],
    },
    {
      id: 'test-airline-miles',
      name: 'Test Airline Miles',
      currency: 'points',
      unitName: 'miles',
      valuation: { basis: 'none' },
      redemptionBrandIds: [],
    },
  ],
  brands: [
    { id: 'amazon', name: 'Amazon' },
    { id: 'whole-foods', name: 'Whole Foods Market' },
    { id: 'best-buy', name: 'Best Buy' },
    { id: 'newegg', name: 'Newegg' },
    { id: 'test-store', name: 'Test Store' },
  ],
  gates: [
    {
      id: 'amazon-prime',
      question: 'Do you have an eligible Amazon Prime membership?',
      options: [
        { id: 'member', label: 'Prime member' },
        { id: 'not-member', label: 'No Prime membership' },
      ],
    },
    {
      id: 'test-store-tier',
      question: 'Which Test Store loyalty tier are you in?',
      options: [
        { id: 'silver', label: 'Silver' },
        { id: 'gold', label: 'Gold' },
        { id: 'platinum', label: 'Platinum' },
      ],
    },
  ],
  merchants: [
    {
      id: 'best-buy-us',
      name: 'Best Buy',
      onlineRetail: true,
      physicalGoods: true,
      usMerchant: true,
      expectedCategory: 'electronics',
      mcc: { code: '5732', confidence: 'medium', sourceIds: ['test-mcc'] },
      notes: 'Synthetic test merchant.',
      brandIds: ['best-buy'],
    },
    {
      id: 'amazon-us',
      name: 'Amazon',
      onlineRetail: true,
      physicalGoods: true,
      usMerchant: true,
      expectedCategory: 'general-merchandise',
      mcc: { code: null, confidence: 'low', sourceIds: [] },
      notes: 'Synthetic test merchant.',
      brandIds: ['amazon'],
    },
    {
      id: 'newegg-us',
      name: 'Newegg',
      onlineRetail: true,
      physicalGoods: true,
      usMerchant: true,
      expectedCategory: 'electronics',
      mcc: { code: null, confidence: 'low', sourceIds: [] },
      notes: 'Synthetic test merchant.',
      brandIds: ['newegg'],
    },
  ],
  sources: [
    {
      id: 'test-terms',
      title: 'Synthetic v3 terms',
      url: 'https://issuer.example/v3',
      checkedOn: '2026-10-02',
    },
    {
      id: 'test-store-terms',
      title: 'Synthetic store terms',
      url: 'https://issuer.example/store',
      checkedOn: '2026-10-01',
    },
    {
      id: 'test-mcc',
      title: 'Synthetic MCC lookup',
      url: 'https://mcc.example/best-buy',
      checkedOn: '2026-10-02',
    },
  ],
  cards: [
    {
      id: 'test-prime-visa',
      name: 'Test Prime Visa',
      shortName: 'Prime Visa',
      issuer: 'Test Bank',
      programId: 'cash-back',
      statedValueHundredthsOfCent: null,
      acceptance: { kind: 'open-loop' },
      choices: [],
      rules: [
        v3Rule('prime-base'),
        v3Rule('prime-amazon', {
          category: 'other',
          rateBps: 500,
          brandIds: ['amazon', 'whole-foods'],
          requires: [{ gateId: 'amazon-prime', optionIds: ['member'] }],
        }),
        v3Rule('prime-amazon-no-prime', {
          category: 'other',
          rateBps: 300,
          brandIds: ['amazon', 'whole-foods'],
          requires: [{ gateId: 'amazon-prime', optionIds: ['not-member'] }],
        }),
      ],
      exclusions: ['Balance transfers'],
    },
    {
      id: 'test-amazon-store',
      name: 'Test Amazon Store Card',
      shortName: 'Amazon Store',
      issuer: 'Test Bank',
      programId: 'cash-back',
      statedValueHundredthsOfCent: null,
      acceptance: { kind: 'closed-loop', brandIds: ['amazon'] },
      choices: [],
      rules: [
        v3Rule('store-amazon', {
          category: 'other',
          rateBps: 500,
          brandIds: ['amazon'],
          requires: [{ gateId: 'amazon-prime', optionIds: ['member'] }],
        }),
      ],
      exclusions: [],
    },
    {
      id: 'test-cash-plus',
      name: 'Test Cash Plus',
      shortName: 'Cash Plus',
      issuer: 'Test Bank',
      programId: 'cash-back',
      statedValueHundredthsOfCent: null,
      acceptance: { kind: 'open-loop' },
      choices: [
        {
          id: 'five-percent',
          kind: 'chosen',
          label: 'Two 5% categories, chosen each quarter',
          picks: 2,
          options: [
            { id: 'electronics', label: 'Electronics stores' },
            { id: 'department-stores', label: 'Department stores' },
            { id: 'fast-food', label: 'Fast food' },
          ],
          defaultOptionIds: [],
        },
      ],
      rules: [
        v3Rule('cash-plus-base'),
        v3Rule('cash-plus-electronics', {
          category: 'electronics',
          rateBps: 500,
          cap: quarterCap,
          activation: 'recurring',
          choice: { choiceId: 'five-percent', optionId: 'electronics' },
        }),
        v3Rule('cash-plus-department-stores', {
          category: 'department-stores',
          rateBps: 500,
          cap: quarterCap,
          activation: 'recurring',
          choice: { choiceId: 'five-percent', optionId: 'department-stores' },
        }),
        v3Rule('cash-plus-fast-food', {
          category: 'dining',
          rateBps: 500,
          cap: quarterCap,
          activation: 'recurring',
          choice: { choiceId: 'five-percent', optionId: 'fast-food' },
        }),
      ],
      exclusions: [],
    },
    {
      id: 'test-rotating',
      name: 'Test Rotating Cash',
      shortName: 'Rotating',
      issuer: 'Test Bank',
      programId: 'cash-back',
      statedValueHundredthsOfCent: null,
      acceptance: { kind: 'open-loop' },
      choices: [],
      rules: [
        v3Rule('rotating-base'),
        v3Rule('rotating-q4', {
          category: 'dining',
          rateBps: 500,
          cap: { ...quarterCap, amountCents: 150_000 },
          activation: 'recurring',
          limitedTime: { startsOn: '2026-10-01', endsOn: '2026-12-31' },
        }),
        v3Rule('rotating-q1', {
          category: 'supermarkets',
          rateBps: 500,
          cap: { ...quarterCap, amountCents: 150_000 },
          activation: 'recurring',
          limitedTime: { startsOn: '2027-01-01', endsOn: '2027-03-31' },
        }),
      ],
      exclusions: [],
    },
    {
      id: 'test-paypal-cashback',
      name: 'Test PayPal Cashback',
      shortName: 'PayPal Cashback',
      issuer: 'Test Bank',
      programId: 'cash-back',
      statedValueHundredthsOfCent: null,
      acceptance: { kind: 'open-loop' },
      choices: [],
      rules: [
        v3Rule('paypal-base', { rateBps: 150 }),
        v3Rule('paypal-checkout', { rateBps: 300, requiredPaymentPaths: ['paypal'] }),
      ],
      exclusions: [],
    },
    {
      id: 'test-points-card',
      name: 'Test Points Card',
      shortName: 'Points',
      issuer: 'Test Bank',
      programId: 'test-membership-points',
      statedValueHundredthsOfCent: null,
      acceptance: { kind: 'open-loop' },
      choices: [],
      rules: [
        v3Rule('points-base'),
        v3Rule('points-dining', { category: 'dining', rateBps: 400 }),
        v3Rule('points-online', {
          category: 'online-retail',
          rateBps: 300,
          excludedPaymentPaths: ['paypal', 'venmo', 'digital-wallet'],
        }),
      ],
      exclusions: [],
    },
    {
      id: 'test-store-mastercard',
      name: 'Test Store Mastercard',
      shortName: 'Store Mastercard',
      issuer: 'Test Bank',
      programId: 'test-store-points',
      statedValueHundredthsOfCent: 100,
      acceptance: { kind: 'open-loop' },
      choices: [],
      rules: [
        v3Rule('store-mc-base'),
        v3Rule('store-mc-store', {
          category: 'other',
          rateBps: 500,
          brandIds: ['test-store'],
          requires: [{ gateId: 'test-store-tier', optionIds: ['gold', 'platinum'] }],
          sourceIds: ['test-store-terms'],
        }),
      ],
      exclusions: [],
    },
    {
      id: 'test-auto-top',
      name: 'Test Automatic Top Category',
      shortName: 'Auto Top',
      issuer: 'Test Bank',
      programId: 'test-airline-miles',
      statedValueHundredthsOfCent: null,
      acceptance: { kind: 'open-loop' },
      choices: [
        {
          id: 'top-category',
          kind: 'automatic',
          label: 'Top spend category each month',
          picks: 1,
          options: [
            { id: 'dining', label: 'Dining' },
            { id: 'gas', label: 'Gas stations' },
            { id: 'electronics', label: 'Electronics stores' },
          ],
          defaultOptionIds: [],
        },
      ],
      rules: [
        v3Rule('auto-base'),
        v3Rule('auto-dining', {
          category: 'dining',
          rateBps: 300,
          choice: { choiceId: 'top-category', optionId: 'dining' },
        }),
        v3Rule('auto-gas', {
          category: 'gas',
          rateBps: 300,
          choice: { choiceId: 'top-category', optionId: 'gas' },
        }),
        v3Rule('auto-electronics', {
          category: 'electronics',
          rateBps: 300,
          choice: { choiceId: 'top-category', optionId: 'electronics' },
        }),
      ],
      exclusions: [],
    },
  ],
};

const v3Card = (catalog: CatalogV3, id: string) => catalog.cards.find((c) => c.id === id)!;
const v3RuleOf = (catalog: CatalogV3, cardId: string, ruleId: string) =>
  v3Card(catalog, cardId).rules.find((r) => r.id === ruleId)!;
const caseV3 =
  (valid: boolean) =>
  (name: string, mutate: (catalog: CatalogV3) => unknown): Case => {
    const catalog = structuredClone(CATALOG_V3_FIXTURE);
    const result = mutate(catalog);
    return { name: `v3: ${name}`, input: result ?? catalog, valid };
  };
const validV3 = caseV3(true);
const invalidV3 = caseV3(false);
const copies = (catalog: CatalogV3, count: number, exclusions: string[] = []) =>
  Array.from({ length: count }, (_, i) => {
    const card = structuredClone(v3Card(catalog, 'test-points-card'));
    return {
      ...card,
      id: `copy-${i}`,
      rules: card.rules.map((r) => ({ ...r, id: `copy-${i}-${r.id}` })),
      exclusions,
    };
  });
const longExclusions = Array.from({ length: 20 }, () => 'x'.repeat(600));

/** Catalog v3 contract cases, run against Zod (extension tests, parity script) and SQL (parity script). */
export const catalogV3Cases: Case[] = [
  validV3('synthetic catalog', () => undefined),
  validV3('no brands, gates or choices', (c) => {
    c.brands = [];
    c.gates = [];
    c.programs = c.programs.filter((p) => p.id !== 'test-store-points');
    c.cards = c.cards.filter((card) => card.id === 'test-points-card' || card.id === 'test-paypal-cashback');
    for (const merchant of c.merchants) merchant.brandIds = [];
  }),
  validV3('closed-loop card with a base rule', (c) => {
    v3Card(c, 'test-amazon-store').rules.push(v3Rule('store-amazon-base'));
  }),
  validV3('limited-time all-purchases rule beside the base', (c) => {
    v3Card(c, 'test-points-card').rules.push(
      v3Rule('points-first-year', { rateBps: 150, limitedTime: { startsOn: null, endsOn: '2027-10-01' } }),
    );
  }),
  validV3('rotating rule with only a start date', (c) => {
    v3RuleOf(c, 'test-rotating', 'rotating-q1').limitedTime = { startsOn: '2027-01-01', endsOn: null };
  }),
  validV3('rule starting and ending on one day', (c) => {
    v3RuleOf(c, 'test-rotating', 'rotating-q1').limitedTime = {
      startsOn: '2027-01-01',
      endsOn: '2027-01-01',
    };
  }),
  validV3('published estimate read after verification, before expiry', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') valuation.retrievedOn = '2026-11-01';
  }),
  validV3('published estimate read 30 days before verification', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') valuation.retrievedOn = '2026-09-02';
  }),
  validV3('chosen option with a default', (c) => {
    v3Card(c, 'test-cash-plus').choices[0].defaultOptionIds = ['electronics', 'fast-food'];
  }),
  validV3('card as a required payment path', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-dining').requiredPaymentPaths = ['card'];
  }),
  validV3('larger than the v1/v2 size limit', (c) => {
    c.cards.push(...copies(c, 40, longExclusions));
  }),
  validV3('300 cards', (c) => {
    c.cards.push(...copies(c, 300 - c.cards.length));
  }),
  validV3('30 rules on a card', (c) => {
    const card = v3Card(c, 'test-points-card');
    card.rules.push(
      ...Array.from({ length: 27 }, (_, i) => v3Rule(`points-extra-${i}`, { category: 'gas' })),
    );
  }),
  invalidV3('v2 catalog labelled schema 3', () => ({ ...structuredClone(CATALOG_V2), schemaVersion: 3 })),
  invalidV3('schemaVersion 2', (c) => ({ ...c, schemaVersion: 2 })),
  invalidV3('missing programs', (c) => {
    delete (c as Partial<CatalogV3>).programs;
  }),
  invalidV3('no programs', (c) => {
    c.programs = [];
  }),
  invalidV3('v2 card field on v3', (c) => {
    Object.assign(c.cards[0], { rewardCurrency: 'cash-back' });
  }),
  invalidV3('unknown rule field', (c) => {
    Object.assign(c.cards[0].rules[0], { requiresActivation: false });
  }),
  invalidV3('unknown category', (c) => {
    Object.assign(v3RuleOf(c, 'test-points-card', 'points-dining'), { category: 'restaurants' });
  }),
  invalidV3('unknown merchant category', (c) => {
    Object.assign(c.merchants[0], { expectedCategory: 'computers' });
  }),
  invalidV3('fractional rate', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-dining').rateBps = 399.5;
  }),
  invalidV3('duplicate program', (c) => {
    c.programs.push(c.programs[0]);
  }),
  invalidV3('duplicate brand', (c) => {
    c.brands.push(c.brands[0]);
  }),
  invalidV3('duplicate gate', (c) => {
    c.gates.push(c.gates[0]);
  }),
  invalidV3('duplicate merchant', (c) => {
    c.merchants.push(c.merchants[0]);
  }),
  invalidV3('duplicate card', (c) => {
    c.cards.push(c.cards[0]);
  }),
  invalidV3('duplicate source', (c) => {
    c.sources.push(c.sources[0]);
  }),
  invalidV3('duplicate rule id across cards', (c) => {
    v3RuleOf(c, 'test-rotating', 'rotating-base').id = 'prime-base';
  }),
  invalidV3('cash-back program valued as an estimate', (c) => {
    c.programs[0].valuation = { ...(c.programs[1].valuation as object) } as never;
  }),
  invalidV3('points program valued as cash', (c) => {
    c.programs[1].valuation = { basis: 'cash', valueHundredthsOfCent: 100 };
  }),
  invalidV3('cash valued other than one cent', (c) => {
    c.programs[0].valuation = { basis: 'cash', valueHundredthsOfCent: 120 } as never;
  }),
  invalidV3('zero point value', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') valuation.valueHundredthsOfCent = 0;
  }),
  invalidV3('fractional point value', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') valuation.valueHundredthsOfCent = 120.5;
  }),
  invalidV3('issuer-stated program value without sources', (c) => {
    const valuation = c.programs[2].valuation;
    if (valuation.basis === 'issuer-stated') valuation.sourceIds = [];
  }),
  invalidV3('issuer-stated program value cites an absent source', (c) => {
    const valuation = c.programs[2].valuation;
    if (valuation.basis === 'issuer-stated') valuation.sourceIds = ['absent'];
  }),
  invalidV3('unvalued program with a value', (c) => {
    c.programs[3].valuation = { basis: 'none', valueHundredthsOfCent: 100 } as never;
  }),
  invalidV3('published estimate without a publisher', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') delete (valuation as Partial<typeof valuation>).publisher;
  }),
  invalidV3('published estimate read more than 30 days before verification', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') valuation.retrievedOn = '2026-09-01';
  }),
  invalidV3('published estimate read after expiry', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') valuation.retrievedOn = '2026-11-02';
  }),
  invalidV3('published estimate with a non-HTTPS URL', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate') valuation.url = 'http://valuations.example/points';
  }),
  invalidV3('published estimate with a credential-bearing URL', (c) => {
    const valuation = c.programs[1].valuation;
    if (valuation.basis === 'published-estimate')
      valuation.url = 'https://user:pass@valuations.example/points';
  }),
  invalidV3('program redemption brand absent', (c) => {
    c.programs[2].redemptionBrandIds = ['absent'];
  }),
  invalidV3('gate with one option', (c) => {
    c.gates[0].options = [c.gates[0].options[0]];
  }),
  invalidV3('duplicate gate option', (c) => {
    c.gates[1].options[1].id = 'silver';
  }),
  invalidV3('merchant brand absent', (c) => {
    c.merchants[0].brandIds = ['absent'];
  }),
  invalidV3('duplicate merchant brand', (c) => {
    c.merchants[0].brandIds = ['best-buy', 'best-buy'];
  }),
  invalidV3('merchant MCC cites an absent source', (c) => {
    c.merchants[0].mcc.sourceIds = ['absent'];
  }),
  invalidV3('stated MCC without sources', (c) => {
    c.merchants[0].mcc.sourceIds = [];
  }),
  invalidV3('unknown MCC with high confidence', (c) => {
    c.merchants[1].mcc.confidence = 'high';
  }),
  invalidV3('card program absent', (c) => {
    c.cards[0].programId = 'absent';
  }),
  invalidV3('issuer-stated card value on a cash-back program', (c) => {
    v3Card(c, 'test-prime-visa').statedValueHundredthsOfCent = 100;
  }),
  invalidV3('closed-loop card brand absent', (c) => {
    v3Card(c, 'test-amazon-store').acceptance = { kind: 'closed-loop', brandIds: ['absent'] };
  }),
  invalidV3('closed-loop card without brands', (c) => {
    v3Card(c, 'test-amazon-store').acceptance = { kind: 'closed-loop', brandIds: [] };
  }),
  invalidV3('open-loop card with brands', (c) => {
    v3Card(c, 'test-prime-visa').acceptance = { kind: 'open-loop', brandIds: ['amazon'] } as never;
  }),
  invalidV3('duplicate choice', (c) => {
    const card = v3Card(c, 'test-cash-plus');
    card.choices.push(card.choices[0]);
  }),
  invalidV3('duplicate choice option', (c) => {
    v3Card(c, 'test-cash-plus').choices[0].options[1].id = 'electronics';
  }),
  invalidV3('as many picks as options', (c) => {
    v3Card(c, 'test-cash-plus').choices[0].picks = 3;
  }),
  invalidV3('more defaults than picks', (c) => {
    const choice = v3Card(c, 'test-cash-plus').choices[0];
    choice.picks = 1;
    choice.defaultOptionIds = ['electronics', 'fast-food'];
  }),
  invalidV3('default option absent', (c) => {
    v3Card(c, 'test-cash-plus').choices[0].defaultOptionIds = ['absent'];
  }),
  invalidV3('automatic choice with a default', (c) => {
    v3Card(c, 'test-auto-top').choices[0].defaultOptionIds = ['dining'];
  }),
  invalidV3('open-loop card without a base', (c) => {
    v3Card(c, 'test-points-card').rules.shift();
  }),
  invalidV3('open-loop card with two bases', (c) => {
    v3Card(c, 'test-points-card').rules.push(v3Rule('points-second-base'));
  }),
  invalidV3('closed-loop card with two bases', (c) => {
    v3Card(c, 'test-amazon-store').rules.push(v3Rule('store-base-1'), v3Rule('store-base-2'));
  }),
  invalidV3('only base is brand-scoped', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-base').brandIds = ['amazon'];
  }),
  invalidV3('only base needs a payment path', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-base').requiredPaymentPaths = ['paypal'];
  }),
  invalidV3('only base needs a gate', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-base').requires = [
      { gateId: 'amazon-prime', optionIds: ['member'] },
    ];
  }),
  invalidV3('only base is a choice', (c) => {
    v3RuleOf(c, 'test-cash-plus', 'cash-plus-base').choice = {
      choiceId: 'five-percent',
      optionId: 'electronics',
    };
  }),
  invalidV3('only base has a start date', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-base').limitedTime = { startsOn: '2026-10-01', endsOn: null };
  }),
  invalidV3('only base excludes a payment path', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-base').excludedPaymentPaths = ['venmo'];
  }),
  invalidV3('bonus below base', (c) => {
    v3RuleOf(c, 'test-paypal-cashback', 'paypal-checkout').rateBps = 100;
  }),
  invalidV3('paid-on-payment above rate', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-dining').paidOnPaymentBps = 401;
  }),
  invalidV3('after-cap rate above rule rate', (c) => {
    v3RuleOf(c, 'test-cash-plus', 'cash-plus-electronics').cap = { ...quarterCap, rateAfterCapBps: 501 };
  }),
  invalidV3('after-cap rate below the base rate', (c) => {
    v3RuleOf(c, 'test-paypal-cashback', 'paypal-checkout').cap = { ...quarterCap, rateAfterCapBps: 100 };
  }),
  invalidV3('rule cites an absent source', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-dining').sourceIds = ['absent'];
  }),
  invalidV3('rule without sources', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-dining').sourceIds = [];
  }),
  invalidV3('rule brand absent', (c) => {
    v3RuleOf(c, 'test-prime-visa', 'prime-amazon').brandIds = ['absent'];
  }),
  invalidV3('duplicate rule brand', (c) => {
    v3RuleOf(c, 'test-prime-visa', 'prime-amazon').brandIds = ['amazon', 'amazon'];
  }),
  invalidV3('limited time ends before it starts', (c) => {
    v3RuleOf(c, 'test-rotating', 'rotating-q1').limitedTime = {
      startsOn: '2027-03-31',
      endsOn: '2027-01-01',
    };
  }),
  invalidV3('calendar-invalid start date', (c) => {
    v3RuleOf(c, 'test-rotating', 'rotating-q1').limitedTime = { startsOn: '2027-02-30', endsOn: null };
  }),
  invalidV3('schema 2 limited-time shape', (c) => {
    v3RuleOf(c, 'test-rotating', 'rotating-q1').limitedTime = { endsOn: '2027-03-31' } as never;
  }),
  invalidV3('rule choice absent', (c) => {
    v3RuleOf(c, 'test-cash-plus', 'cash-plus-electronics').choice = {
      choiceId: 'absent',
      optionId: 'electronics',
    };
  }),
  invalidV3('rule choice option absent', (c) => {
    v3RuleOf(c, 'test-cash-plus', 'cash-plus-electronics').choice = {
      choiceId: 'five-percent',
      optionId: 'absent',
    };
  }),
  invalidV3('rule choice from another card', (c) => {
    v3RuleOf(c, 'test-points-card', 'points-dining').choice = {
      choiceId: 'five-percent',
      optionId: 'electronics',
    };
  }),
  invalidV3('required gate absent', (c) => {
    v3RuleOf(c, 'test-prime-visa', 'prime-amazon').requires = [{ gateId: 'absent', optionIds: ['member'] }];
  }),
  invalidV3('required gate option absent', (c) => {
    v3RuleOf(c, 'test-prime-visa', 'prime-amazon').requires = [
      { gateId: 'amazon-prime', optionIds: ['gold'] },
    ];
  }),
  invalidV3('requirement lists every option', (c) => {
    v3RuleOf(c, 'test-prime-visa', 'prime-amazon').requires = [
      { gateId: 'amazon-prime', optionIds: ['member', 'not-member'] },
    ];
  }),
  invalidV3('requirement without options', (c) => {
    v3RuleOf(c, 'test-prime-visa', 'prime-amazon').requires = [{ gateId: 'amazon-prime', optionIds: [] }];
  }),
  invalidV3('same gate required twice', (c) => {
    v3RuleOf(c, 'test-prime-visa', 'prime-amazon').requires = [
      { gateId: 'amazon-prime', optionIds: ['member'] },
      { gateId: 'amazon-prime', optionIds: ['member'] },
    ];
  }),
  invalidV3('payment path both required and excluded', (c) => {
    const target = v3RuleOf(c, 'test-points-card', 'points-online');
    target.requiredPaymentPaths = ['venmo'];
  }),
  invalidV3('card as an excluded payment path', (c) => {
    Object.assign(v3RuleOf(c, 'test-points-card', 'points-online'), { excludedPaymentPaths: ['card'] });
  }),
  invalidV3('unknown required payment path', (c) => {
    Object.assign(v3RuleOf(c, 'test-paypal-cashback', 'paypal-checkout'), {
      requiredPaymentPaths: ['crypto'],
    });
  }),
  invalidV3('duplicate required payment path', (c) => {
    v3RuleOf(c, 'test-paypal-cashback', 'paypal-checkout').requiredPaymentPaths = ['paypal', 'paypal'];
  }),
  invalidV3('future source', (c) => {
    c.sources[0].checkedOn = '2026-10-03';
  }),
  invalidV3('stale source', (c) => {
    c.sources[0].checkedOn = '2026-09-01';
  }),
  invalidV3('long freshness window', (c) => {
    c.expiresAt = '2026-11-02T00:00:00Z';
  }),
  invalidV3('reversed validity', (c) => {
    c.expiresAt = '2026-10-01T00:00:00Z';
  }),
  invalidV3('credential-bearing source URL', (c) => {
    c.sources[0].url = 'https://user:password@issuer.example/v3';
  }),
  invalidV3('31 rules on a card', (c) => {
    const card = v3Card(c, 'test-points-card');
    card.rules.push(
      ...Array.from({ length: 28 }, (_, i) => v3Rule(`points-extra-${i}`, { category: 'gas' })),
    );
  }),
  invalidV3('301 cards', (c) => {
    c.cards.push(...copies(c, 301 - c.cards.length));
  }),
  invalidV3('oversized catalog', (c) => {
    c.cards.push(...copies(c, 100, longExclusions));
  }),
];
