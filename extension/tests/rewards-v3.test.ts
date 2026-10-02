import { describe, expect, it } from 'vitest';
import {
  CATALOG_V2,
  MAX_AMOUNT_CENTS,
  RULE_STATUSES_V3,
  UNCERTAINTIES_V3,
  catalogV3Schema,
  compareRewards,
  usageInputs,
} from '../src/domain';
import type {
  CardEstimate,
  CatalogV3,
  Comparison,
  Purchase,
  RewardRuleV3,
  RuleStatusV3,
  RuleUsage,
  UncertaintyV3,
  Wallet,
  WalletCard,
} from '../src/domain';
import { CATALOG_V3_FIXTURE } from '../../packages/rewards-core/test-cases';

/* Catalog v3 engine (Stage 2 M2). The catalog is the M1 synthetic fixture plus the cards the ladders
 * need (BCE, My Best Buy Visa, Freedom Flex, an unstated cap) and two merchants. Test data only;
 * rates and terms are synthetic, not issuer terms. */

const rule = (id: string, overrides: Partial<RewardRuleV3> = {}): RewardRuleV3 => ({
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
  excludedBrandIds: [],
  sharedCapId: null,
  choice: null,
  requires: [],
  requiredPaymentPaths: [],
  ...overrides,
});
const flexCap = { kind: 'spend', amountCents: 150_000, period: 'quarter', rateAfterCapBps: 100 } as const;
const card = (id: string, programId: string, rules: RewardRuleV3[]): CatalogV3['cards'][number] => ({
  id,
  name: id,
  shortName: id,
  issuer: 'Test Bank',
  programId,
  statedValueHundredthsOfCent: null,
  acceptance: { kind: 'open-loop' },
  choices: [],
  rules,
  exclusions: [],
});

const CATALOG: CatalogV3 = structuredClone(CATALOG_V3_FIXTURE);
CATALOG.programs.push({
  id: 'test-best-buy-rewards',
  name: 'Test Best Buy certificates',
  currency: 'cash-back',
  unitName: 'cents',
  valuation: { basis: 'cash', valueHundredthsOfCent: 100 },
  redemptionBrandIds: ['best-buy'],
});
CATALOG.gates.push({
  id: 'my-best-buy-tier',
  question: 'Which My Best Buy membership do you have?',
  options: [
    { id: 'core', label: 'My Best Buy (free)' },
    { id: 'plus', label: 'My Best Buy Plus' },
    { id: 'total', label: 'My Best Buy Total' },
  ],
});
CATALOG.merchants.push(
  {
    ...structuredClone(CATALOG.merchants[1]),
    id: 'test-department-us',
    name: 'Department store',
    expectedCategory: 'department-stores',
    brandIds: [],
  },
  {
    ...structuredClone(CATALOG.merchants[1]),
    id: 'test-store-us',
    name: 'Test Store',
    brandIds: ['test-store'],
  },
);
CATALOG.cards.push(
  card('test-bce', 'cash-back', [
    rule('bce-base'),
    rule('bce-online', {
      category: 'online-retail',
      rateBps: 300,
      cap: { kind: 'spend', amountCents: 600_000, period: 'calendar-year', rateAfterCapBps: 100 },
      usMerchantsOnly: true,
      excludedPaymentPaths: ['bnpl'],
    }),
  ]),
  card('test-my-best-buy-visa', 'test-best-buy-rewards', [
    rule('mbb-base'),
    rule('mbb-best-buy', { category: 'other', rateBps: 500, brandIds: ['best-buy'] }),
    rule('mbb-best-buy-elite', {
      category: 'other',
      rateBps: 600,
      brandIds: ['best-buy'],
      requires: [{ gateId: 'my-best-buy-tier', optionIds: ['plus', 'total'] }],
    }),
  ]),
  card('test-freedom-flex', 'cash-back', [
    rule('flex-base'),
    rule('flex-q4-electronics', {
      category: 'electronics',
      rateBps: 500,
      cap: flexCap,
      activation: 'recurring',
      limitedTime: { startsOn: '2026-10-01', endsOn: '2026-12-31' },
      sharedCapId: 'flex-q4',
    }),
    rule('flex-q4-department', {
      category: 'department-stores',
      rateBps: 500,
      cap: flexCap,
      activation: 'recurring',
      limitedTime: { startsOn: '2026-10-01', endsOn: '2026-12-31' },
      sharedCapId: 'flex-q4',
    }),
    rule('flex-q1-online', {
      category: 'online-retail',
      rateBps: 500,
      cap: flexCap,
      activation: 'recurring',
      limitedTime: { startsOn: '2027-01-01', endsOn: '2027-03-31' },
      excludedBrandIds: ['amazon'],
    }),
  ]),
  card('test-unstated-cap', 'cash-back', [
    rule('unstated-base'),
    rule('unstated-online', { category: 'online-retail', rateBps: 200, cap: { kind: 'unstated' } }),
  ]),
);

const now = Date.parse('2026-10-15T15:00:00Z');
const today = '2026-10-15';
const purchase = (extra: Partial<Purchase> = {}): Purchase => ({
  merchantId: 'best-buy-us',
  currency: 'USD',
  amountCents: 10_000,
  purchasedOn: today,
  eligiblePurchase: 'eligible',
  onlineRetail: 'eligible',
  ...extra,
});
const usage = (ruleId: string, extra: Partial<RuleUsage> = {}, on = today): RuleUsage => ({
  ruleId,
  calendarYear: Number(on.slice(0, 4)),
  recordedOn: on,
  spentCents: null,
  activation: 'unknown',
  ...extra,
});
const known = (ruleId: string, spentCents = 0, on = today) =>
  usage(ruleId, { activation: 'active', spentCents }, on);
const owned = (cardId: string, extra: Partial<WalletCard> = {}): WalletCard => ({
  cardId,
  usage: [],
  ...extra,
});

type Setup = {
  cards: WalletCard[];
  purchase?: Partial<Purchase>;
  wallet?: Partial<Wallet>;
  catalog?: CatalogV3;
  /** Comparison time; defaults to `now`. */
  at?: number;
};
function compare({ cards, purchase: extra = {}, wallet = {}, catalog = CATALOG, at = now }: Setup) {
  return compareRewards(catalog, { cards, defaultCardId: null, ...wallet }, purchase(extra), at);
}
function ready(setup: Setup): Comparison {
  const result = compare(setup);
  if (result.status !== 'ready') throw new Error(`unavailable: ${result.reason}`);
  return result;
}
const only = (setup: Setup) => ready(setup).estimates[0];
const statusOf = (e: CardEstimate, ruleId: string) => e.rules!.find((r) => r.ruleId === ruleId)!.status;
const order = (c: Comparison) => c.estimates.map((e) => e.cardId);
const cents = (e: CardEstimate) => [e.minRewardCents, e.maxRewardCents];
const units = (e: CardEstimate) => [e.minRewardUnits, e.maxRewardUnits];

/** The same catalog verified on another date (engine-only: source ages are not re-checked here). */
function datedCatalog(verifiedOn: string, expiresOn: string): CatalogV3 {
  const catalog = structuredClone(CATALOG);
  catalog.verifiedAt = `${verifiedOn}T00:00:00Z`;
  catalog.expiresAt = `${expiresOn}T00:00:00Z`;
  return catalog;
}
const december = datedCatalog('2026-12-01', '2026-12-31');
const january = datedCatalog('2027-01-02', '2027-02-01');
const atDay = (day: string) => Date.parse(`${day}T15:00:00Z`);

describe('catalog v3 engine: test catalog', () => {
  it('is a valid catalog v3', () => {
    expect(catalogV3Schema.safeParse(CATALOG).success).toBe(true);
  });
});

describe('catalog v3 engine: rule statuses', () => {
  const cashPlusElectronics = { choices: [{ choiceId: 'five-percent', optionIds: ['electronics'] }] };
  const rows: [string, Setup, string, RuleStatusV3][] = [
    [
      'applied: a rule that requires the PayPal path, paid through PayPal',
      {
        cards: [owned('test-paypal-cashback')],
        purchase: { merchantId: 'newegg-us', paymentPath: 'paypal' },
      },
      'paypal-checkout',
      'applied',
    ],
    [
      'may-apply: a gated rule with the gate unanswered',
      { cards: [owned('test-prime-visa')], purchase: { merchantId: 'amazon-us' } },
      'prime-amazon',
      'may-apply',
    ],
    [
      'base: the unconditional all-purchases rule',
      { cards: [owned('test-prime-visa')] },
      'prime-base',
      'base',
    ],
    [
      'not-at-merchant: brand scope outside the merchant brands',
      { cards: [owned('test-prime-visa')] },
      'prime-amazon',
      'not-at-merchant',
    ],
    [
      'not-at-merchant: an excluded brand',
      {
        cards: [owned('test-freedom-flex')],
        purchase: { merchantId: 'amazon-us', purchasedOn: '2027-01-05' },
        catalog: january,
        at: atDay('2027-01-05'),
      },
      'flex-q1-online',
      'not-at-merchant',
    ],
    [
      'not-eligible: a required payment path not used',
      { cards: [owned('test-paypal-cashback')], purchase: { merchantId: 'newegg-us' } },
      'paypal-checkout',
      'not-eligible',
    ],
    [
      'not-eligible: an excluded payment path (Venmo)',
      { cards: [owned('test-points-card')], purchase: { merchantId: 'newegg-us', paymentPath: 'venmo' } },
      'points-online',
      'not-eligible',
    ],
    [
      'expired: a rotating rule after its end date',
      {
        cards: [owned('test-freedom-flex')],
        purchase: { purchasedOn: '2027-01-05' },
        catalog: january,
        at: atDay('2027-01-05'),
      },
      'flex-q4-electronics',
      'expired',
    ],
    [
      'cap-reached: the shared cap is used up',
      {
        cards: [
          owned('test-cash-plus', {
            ...cashPlusElectronics,
            usage: [known('cash-plus-electronics', 200_000)],
          }),
        ],
      },
      'cash-plus-electronics',
      'cap-reached',
    ],
    [
      'not-accepted: a closed-loop card outside its brands',
      { cards: [owned('test-amazon-store'), owned('test-bce')] },
      'store-amazon',
      'not-accepted',
    ],
    [
      'not-started: a rotating rule before its start date',
      { cards: [owned('test-freedom-flex')], purchase: { merchantId: 'newegg-us' } },
      'flex-q1-online',
      'not-started',
    ],
    [
      'choice-not-selected: the shopper chose other options',
      {
        cards: [
          owned('test-cash-plus', {
            choices: [{ choiceId: 'five-percent', optionIds: ['department-stores', 'fast-food'] }],
          }),
        ],
      },
      'cash-plus-electronics',
      'choice-not-selected',
    ],
    [
      'condition-not-met: the shopper answered a gate outside the required options',
      {
        cards: [owned('test-prime-visa', { gates: [{ gateId: 'amazon-prime', optionId: 'not-member' }] })],
        purchase: { merchantId: 'amazon-us' },
      },
      'prime-amazon',
      'condition-not-met',
    ],
  ];
  it.each(rows)('%s', (_, setup, ruleId, status) => {
    const result = ready(setup);
    const estimate = [...result.estimates, ...result.notAccepted!].find((e) =>
      e.rules!.some((r) => r.ruleId === ruleId),
    )!;
    expect(statusOf(estimate, ruleId)).toBe(status);
  });
  it('covers every v3 rule status', () => {
    expect(new Set(rows.map((r) => r[3]))).toEqual(new Set(RULE_STATUSES_V3));
  });
});

describe('catalog v3 engine: uncertainties', () => {
  const rows: [UncertaintyV3, Setup, [number, number]][] = [
    [
      'online-category-unknown',
      { cards: [owned('test-points-card')], purchase: { merchantId: 'newegg-us', onlineRetail: 'unknown' } },
      [120, 360],
    ],
    [
      'annual-usage-unknown',
      { cards: [owned('test-bce')], purchase: { merchantId: 'newegg-us' } },
      [100, 300],
    ],
    [
      'cap-usage-unknown',
      {
        cards: [
          owned('test-cash-plus', {
            choices: [{ choiceId: 'five-percent', optionIds: ['electronics'] }],
            usage: [usage('cash-plus-electronics', { activation: 'active' })],
          }),
        ],
      },
      [100, 500],
    ],
    [
      'activation-unknown',
      {
        cards: [
          owned('test-cash-plus', {
            choices: [{ choiceId: 'five-percent', optionIds: ['electronics'] }],
            usage: [usage('cash-plus-electronics', { spentCents: 0 })],
          }),
        ],
      },
      [100, 500],
    ],
    ['cap-unstated', { cards: [owned('test-unstated-cap')] }, [100, 200]],
    [
      'payment-path-uncertain',
      {
        cards: [owned('test-bce', { usage: [known('bce-online')] })],
        purchase: { merchantId: 'newegg-us', paymentPath: 'digital-wallet' },
      },
      [100, 300],
    ],
    [
      'choice-unknown',
      { cards: [owned('test-cash-plus', { usage: [known('cash-plus-electronics')] })] },
      [100, 500],
    ],
    [
      'automatic-category',
      {
        cards: [owned('test-auto-top')],
        wallet: { valueOverrides: [{ programId: 'test-airline-miles', valueHundredthsOfCent: 150 }] },
      },
      [150, 450],
    ],
    [
      'condition-unknown',
      { cards: [owned('test-prime-visa')], purchase: { merchantId: 'amazon-us' } },
      [100, 500],
    ],
    ['value-unknown', { cards: [owned('test-auto-top')] }, [0, 0]],
  ];
  it.each(rows)('%s', (code, setup, range) => {
    const estimate = only(setup);
    expect(estimate.uncertainties).toContain(code);
    expect(cents(estimate)).toEqual(range);
  });
  it('covers every v3 uncertainty code', () => {
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(UNCERTAINTIES_V3));
  });
  it('reports nothing once the conditions are answered', () => {
    const estimate = only({
      cards: [
        owned('test-cash-plus', {
          choices: [{ choiceId: 'five-percent', optionIds: ['electronics', 'department-stores'] }],
          usage: [known('cash-plus-electronics')],
        }),
      ],
    });
    expect(estimate.uncertainties).toEqual([]);
    expect(cents(estimate)).toEqual([500, 500]);
    expect(statusOf(estimate, 'cash-plus-electronics')).toBe('applied');
    expect(estimate.appliedRuleId).toBe('cash-plus-electronics');
  });
  it('gives the base-to-best range for a gate with two rated answers', () => {
    // Prime Visa: 5% with Prime, 3% without; the gate unanswered spans base to 5%.
    const estimate = only({ cards: [owned('test-prime-visa')], purchase: { merchantId: 'amazon-us' } });
    expect(statusOf(estimate, 'prime-amazon-no-prime')).toBe('may-apply');
    expect(estimate.uncertainties).toEqual(['condition-unknown']);
  });
});

describe('catalog v3 engine: value per unit and money', () => {
  const points = (wallet: Partial<Wallet> = {}, extra: Partial<Purchase> = {}) =>
    only({ cards: [owned('test-points-card')], purchase: { merchantId: 'newegg-us', ...extra }, wallet });
  it('converts units with the program’s published estimate', () => {
    const e = points();
    expect(units(e)).toEqual([300, 300]);
    expect(cents(e)).toEqual([360, 360]);
    expect(e.unitValue).toEqual({ hundredthsOfCent: 120, basis: 'published-estimate' });
    expect(e.programId).toBe('test-membership-points');
  });
  it('prefers the card’s issuer-stated value, and the shopper’s override over both', () => {
    const store = (wallet: Partial<Wallet> = {}) => only({ cards: [owned('test-store-mastercard')], wallet });
    expect(store().unitValue).toEqual({ hundredthsOfCent: 100, basis: 'card-stated' });
    const overridden = store({
      valueOverrides: [{ programId: 'test-store-points', valueHundredthsOfCent: 50 }],
    });
    expect(overridden.unitValue).toEqual({ hundredthsOfCent: 50, basis: 'override' });
    expect(units(overridden)).toEqual([100, 100]);
    expect(cents(overridden)).toEqual([50, 50]);
  });
  it('cash back is one cent per unit, as in v2', () => {
    const e = only({
      cards: [owned('test-bce', { usage: [known('bce-online')] })],
      purchase: { amountCents: 999 },
    });
    expect(e.unitValue).toEqual({ hundredthsOfCent: 100, basis: 'cash' });
    expect(cents(e)).toEqual([29, 29]);
    expect(units(e)).toEqual([29, 29]);
  });
  it('truncates once: floor(spend × rate × value / 1,000,000), not floor(units) × value', () => {
    // 999 × 300 × 120 / 1,000,000 = 35.964 → 35; floor(29.97 units) × 1.2 would give 34.
    const e = points({}, { amountCents: 999 });
    expect(units(e)).toEqual([29, 29]);
    expect(cents(e)).toEqual([35, 35]);
  });
  it('reports a condition when it moves the cents, even below one unit', () => {
    // 1 cent at 1X–3X: 0 units either way, but 1–3 cents at $1 per point.
    const e = points(
      { valueOverrides: [{ programId: 'test-membership-points', valueHundredthsOfCent: 10_000 }] },
      { amountCents: 1, onlineRetail: 'unknown' },
    );
    expect(units(e)).toEqual([0, 0]);
    expect(cents(e)).toEqual([1, 3]);
    expect(e.uncertainties).toEqual(['online-category-unknown']);
    expect(statusOf(e, 'points-online')).toBe('may-apply');
  });
  it('keeps every amount an exact safe integer at the limits', () => {
    const e = points(
      { valueOverrides: [{ programId: 'test-membership-points', valueHundredthsOfCent: 10_000 }] },
      { amountCents: MAX_AMOUNT_CENTS },
    );
    // 10,000,000 × 300 × 10,000 / 1,000,000 = 30,000,000 cents.
    expect(cents(e)).toEqual([30_000_000, 30_000_000]);
    for (const value of [...cents(e), ...units(e)]) expect(Number.isSafeInteger(value)).toBe(true);
  });
  it.each([
    ['a cash-back program', { programId: 'cash-back', valueHundredthsOfCent: 120 }],
    ['an unknown program', { programId: 'nope', valueHundredthsOfCent: 120 }],
    ['zero', { programId: 'test-membership-points', valueHundredthsOfCent: 0 }],
    ['a fraction', { programId: 'test-membership-points', valueHundredthsOfCent: 1.5 }],
    ['above $1 per unit', { programId: 'test-membership-points', valueHundredthsOfCent: 10_001 }],
  ])('rejects an override for %s', (_, override) => {
    expect(() => points({ valueOverrides: [override] })).toThrow('Invalid value override.');
  });
});

describe('catalog v3 engine: unvalued programs', () => {
  it('lists an unvalued card after valued ones, in units, and flags that the ranking may change', () => {
    const result = ready({
      cards: [owned('test-auto-top'), owned('test-bce', { usage: [known('bce-online')] })],
    });
    expect(order(result)).toEqual(['test-bce', 'test-auto-top']);
    const miles = result.estimates[1];
    expect(miles.unitValue).toBeNull();
    expect(cents(miles)).toEqual([0, 0]);
    expect(units(miles)).toEqual([100, 300]);
    expect(miles.uncertainties).toEqual(['automatic-category', 'value-unknown']);
    expect(result.preferredCardId).toBe('test-bce');
    expect(result.rankingMayChange).toBe(true);
    expect(result.tied).toBe(false);
  });
  it('puts a valued card first even when the unvalued card earns more units than it earns cents', () => {
    // Prime Visa at Best Buy: 100 cents. Automatic top category: 100–300 miles, no value.
    const result = ready({ cards: [owned('test-auto-top'), owned('test-prime-visa')] });
    expect(order(result)).toEqual(['test-prime-visa', 'test-auto-top']);
    expect(result.rankingMayChange).toBe(true);
  });
  it('puts a valued card that earns nothing before an unvalued card, even the default one', () => {
    const result = ready({
      cards: [
        owned('test-auto-top'),
        owned('test-amazon-store', { gates: [{ gateId: 'amazon-prime', optionId: 'not-member' }] }),
      ],
      purchase: { merchantId: 'amazon-us' },
      wallet: { defaultCardId: 'test-auto-top' },
    });
    expect(order(result)).toEqual(['test-amazon-store', 'test-auto-top']);
    expect(result.rankingMayChange).toBe(true);
  });
  it('names an unvalued card when it is the only one, without a cent amount', () => {
    const result = ready({ cards: [owned('test-auto-top')] });
    expect(result.preferredCardId).toBe('test-auto-top');
    expect(result.rankingMayChange).toBe(false);
  });
  it('ranks it by cents once the shopper sets a value', () => {
    const result = ready({
      cards: [owned('test-auto-top'), owned('test-bce', { usage: [known('bce-online')] })],
      wallet: { valueOverrides: [{ programId: 'test-airline-miles', valueHundredthsOfCent: 150 }] },
    });
    expect(order(result)).toEqual(['test-bce', 'test-auto-top']);
    expect(cents(result.estimates[1])).toEqual([150, 450]);
    expect(result.estimates[1].unitValue).toEqual({ hundredthsOfCent: 150, basis: 'override' });
    expect(result.rankingMayChange).toBe(true); // 450 > 300: the automatic category is unknown
  });
});

describe('catalog v3 engine: ranking ladders', () => {
  const amazonWallet = (gate?: 'member' | 'not-member', defaultCardId: string | null = null): Setup => {
    const gates = gate ? [{ gateId: 'amazon-prime', optionId: gate }] : [];
    return {
      cards: [
        owned('test-prime-visa', { gates }),
        owned('test-amazon-store', { gates }),
        owned('test-bce', { usage: gate ? [known('bce-online')] : [] }),
      ],
      purchase: { merchantId: 'amazon-us' },
      wallet: { defaultCardId },
    };
  };
  it('amazon-us, Prime unknown: ranges for Prime Visa and the store card, BCE named on the tie', () => {
    const result = ready(amazonWallet());
    expect(result.estimates.map((e) => [e.cardId, ...cents(e)])).toEqual([
      ['test-bce', 100, 300],
      ['test-prime-visa', 100, 500],
      ['test-amazon-store', 0, 500],
    ]);
    expect(result.preferredCardId).toBe('test-bce');
    expect(result.rankingMayChange).toBe(true);
    expect(result.tied).toBe(true);
    expect(result.notAccepted).toEqual([]);
  });
  it('amazon-us, Prime member: Prime Visa and the store card tie at 5%; the default card breaks it', () => {
    const result = ready(amazonWallet('member'));
    expect(result.estimates.map((e) => [e.cardId, ...cents(e)])).toEqual([
      ['test-amazon-store', 500, 500],
      ['test-prime-visa', 500, 500],
      ['test-bce', 300, 300],
    ]);
    expect(result.rankingMayChange).toBe(false);
    expect(result.tied).toBe(true);
    expect(ready(amazonWallet('member', 'test-prime-visa')).preferredCardId).toBe('test-prime-visa');
  });
  it('amazon-us, no Prime: Prime Visa 3%, the store card earns nothing', () => {
    const result = ready(amazonWallet('not-member', 'test-prime-visa'));
    expect(result.estimates.map((e) => [e.cardId, ...cents(e)])).toEqual([
      ['test-prime-visa', 300, 300],
      ['test-bce', 300, 300],
      ['test-amazon-store', 0, 0],
    ]);
    expect(statusOf(result.estimates[0], 'prime-amazon-no-prime')).toBe('applied');
    expect(statusOf(result.estimates[2], 'store-amazon')).toBe('condition-not-met');
    expect(result.estimates[2].appliedRuleId).toBeUndefined();
  });

  const bestBuyCards = (extra: { tier?: string; cashPlus?: string[] } = {}) => [
    owned('test-my-best-buy-visa', {
      gates: extra.tier ? [{ gateId: 'my-best-buy-tier', optionId: extra.tier }] : [],
    }),
    owned('test-cash-plus', {
      choices: extra.cashPlus ? [{ choiceId: 'five-percent', optionIds: extra.cashPlus }] : [],
      usage: extra.cashPlus ? [known('cash-plus-electronics')] : [],
    }),
    owned('test-amazon-store'),
    owned('test-bce'),
    owned('test-freedom-flex'),
  ];
  it('best-buy-us, nothing answered: My Best Buy Visa named, the Amazon store card left out', () => {
    const result = ready({ cards: bestBuyCards() });
    expect(result.estimates.map((e) => [e.cardId, ...cents(e)])).toEqual([
      ['test-my-best-buy-visa', 500, 600],
      ['test-bce', 100, 300],
      ['test-cash-plus', 100, 500],
      ['test-freedom-flex', 100, 500],
    ]);
    expect(result.preferredCardId).toBe('test-my-best-buy-visa');
    expect(result.rankingMayChange).toBe(false);
    expect(result.notAccepted!.map((e) => e.cardId)).toEqual(['test-amazon-store']);
    expect(result.estimates[0].uncertainties).toEqual(['condition-unknown']);
    expect(result.estimates[0].programId).toBe('test-best-buy-rewards');
  });
  it('best-buy-us, Cash+ with electronics chosen and a Plus membership', () => {
    const result = ready({ cards: bestBuyCards({ tier: 'plus', cashPlus: ['electronics', 'fast-food'] }) });
    expect(result.estimates.slice(0, 2).map((e) => [e.cardId, ...cents(e)])).toEqual([
      ['test-my-best-buy-visa', 600, 600],
      ['test-cash-plus', 500, 500],
    ]);
    expect(result.rankingMayChange).toBe(false);
  });
  it('best-buy-us, free membership: Cash+ ties My Best Buy Visa at 5%, the default card wins', () => {
    const cards = bestBuyCards({ tier: 'core', cashPlus: ['electronics'] });
    const result = ready({ cards, wallet: { defaultCardId: 'test-cash-plus' } });
    expect(order(result).slice(0, 2)).toEqual(['test-cash-plus', 'test-my-best-buy-visa']);
    expect(result.tied).toBe(true);
    expect(statusOf(result.estimates[1], 'mbb-best-buy-elite')).toBe('condition-not-met');
  });
  it('best-buy-us with only the Amazon store card is unavailable', () => {
    expect(compare({ cards: [owned('test-amazon-store')] })).toEqual({
      status: 'unavailable',
      reason: 'no-accepted-card',
    });
  });

  const neweggCards = [
    owned('test-paypal-cashback'),
    owned('test-points-card'),
    owned('test-bce', { usage: [known('bce-online')] }),
  ];
  it('newegg-us through PayPal: PayPal Cashback 3% with no path uncertainty', () => {
    const result = ready({
      cards: neweggCards,
      purchase: { merchantId: 'newegg-us', paymentPath: 'paypal' },
    });
    expect(result.estimates.map((e) => [e.cardId, ...cents(e), e.uncertainties])).toEqual([
      ['test-paypal-cashback', 300, 300, []],
      ['test-points-card', 120, 120, []],
      ['test-bce', 100, 300, ['payment-path-uncertain']],
    ]);
    expect(result.rankingMayChange).toBe(false);
  });
  it('newegg-us by card: points at the published estimate beat 3% cash back', () => {
    const result = ready({ cards: neweggCards, purchase: { merchantId: 'newegg-us' } });
    expect(result.estimates.map((e) => [e.cardId, ...cents(e)])).toEqual([
      ['test-points-card', 360, 360],
      ['test-bce', 300, 300],
      ['test-paypal-cashback', 150, 150],
    ]);
  });
  it('newegg-us by card: a lower override puts cash back first', () => {
    const result = ready({
      cards: neweggCards,
      purchase: { merchantId: 'newegg-us' },
      wallet: { valueOverrides: [{ programId: 'test-membership-points', valueHundredthsOfCent: 80 }] },
    });
    expect(result.estimates.map((e) => [e.cardId, ...cents(e)])).toEqual([
      ['test-bce', 300, 300],
      ['test-points-card', 240, 240],
      ['test-paypal-cashback', 150, 150],
    ]);
  });
});

describe('catalog v3 engine: Freedom Flex quarters and shared caps', () => {
  const flex = (setup: Partial<Setup>, catalog: CatalogV3, on: string) =>
    only({
      cards: setup.cards ?? [owned('test-freedom-flex')],
      catalog,
      purchase: { purchasedOn: on, ...setup.purchase },
      at: atDay(on),
    });
  it('before 2026-12-31: the Q4 electronics rule applies and Q1 has not started', () => {
    const e = flex(
      { cards: [owned('test-freedom-flex', { usage: [known('flex-q4-electronics', 0, '2026-12-15')] })] },
      december,
      '2026-12-15',
    );
    expect(cents(e)).toEqual([500, 500]);
    expect(statusOf(e, 'flex-q4-electronics')).toBe('applied');
    expect(statusOf(e, 'flex-q1-online')).toBe('not-started');
  });
  it('after 2026-12-31: Q4 has expired and Q1 online retail applies, except at Amazon', () => {
    const rows = [usage('flex-q1-online', { activation: 'active', spentCents: 0 }, '2027-01-05')];
    const newegg = flex(
      { cards: [owned('test-freedom-flex', { usage: rows })], purchase: { merchantId: 'newegg-us' } },
      january,
      '2027-01-05',
    );
    expect(statusOf(newegg, 'flex-q4-electronics')).toBe('expired');
    expect(statusOf(newegg, 'flex-q1-online')).toBe('applied');
    expect(cents(newegg)).toEqual([500, 500]);
    const amazon = flex(
      { cards: [owned('test-freedom-flex', { usage: rows })], purchase: { merchantId: 'amazon-us' } },
      january,
      '2027-01-05',
    );
    expect(statusOf(amazon, 'flex-q1-online')).toBe('not-at-merchant');
    expect(cents(amazon)).toEqual([100, 100]);
  });
  it('splits a purchase at the remaining shared cap', () => {
    // $200 with $100 of the $1,500 left: $100 at 5% + $100 at 1% = $6.00.
    const e = flex(
      {
        cards: [owned('test-freedom-flex', { usage: [known('flex-q4-electronics', 140_000, '2026-12-15')] })],
        purchase: { amountCents: 20_000 },
      },
      december,
      '2026-12-15',
    );
    expect(cents(e)).toEqual([600, 600]);
    expect([e.minBonusSpendCents, e.maxBonusSpendCents]).toEqual([10_000, 10_000]);
  });
  it('counts spend recorded on the group’s first rule against every rule sharing the cap', () => {
    const e = flex(
      {
        cards: [
          owned('test-freedom-flex', {
            usage: [
              known('flex-q4-electronics', 150_000, '2026-12-15'),
              // The department rule's own spend row is not where the shared cap is recorded.
              known('flex-q4-department', 0, '2026-12-15'),
            ],
          }),
        ],
        purchase: { merchantId: 'test-department-us' },
      },
      december,
      '2026-12-15',
    );
    expect(statusOf(e, 'flex-q4-department')).toBe('cap-reached');
    expect(cents(e)).toEqual([100, 100]);
  });
});

describe('catalog v3 engine: inputs and compatibility', () => {
  it.each([
    [
      'an automatic choice',
      { choices: [{ choiceId: 'top-category', optionIds: ['dining'] }] },
      'test-auto-top',
    ],
    [
      'an unknown option',
      { choices: [{ choiceId: 'five-percent', optionIds: ['travel'] }] },
      'test-cash-plus',
    ],
    [
      'more options than picks',
      {
        choices: [{ choiceId: 'five-percent', optionIds: ['electronics', 'department-stores', 'fast-food'] }],
      },
      'test-cash-plus',
    ],
    ['no options', { choices: [{ choiceId: 'five-percent', optionIds: [] }] }, 'test-cash-plus'],
  ])('rejects wallet choices with %s', (_, extra, cardId) => {
    expect(() => compare({ cards: [owned(cardId, extra)] })).toThrow('Invalid wallet choices.');
  });
  it.each([
    ['an unknown gate', [{ gateId: 'nope', optionId: 'member' }]],
    ['an unknown option', [{ gateId: 'amazon-prime', optionId: 'gold' }]],
    [
      'a repeated gate',
      [
        { gateId: 'amazon-prime', optionId: 'member' },
        { gateId: 'amazon-prime', optionId: 'not-member' },
      ],
    ],
  ])('rejects wallet gates with %s', (_, gates) => {
    expect(() => compare({ cards: [owned('test-prime-visa', { gates })] })).toThrow('Invalid wallet gates.');
  });
  it('accepts Venmo for v3 but not for a v2 catalog', () => {
    expect(only({ cards: [owned('test-bce')], purchase: { paymentPath: 'venmo' } }).uncertainties).toContain(
      'payment-path-uncertain',
    );
    const v2Wallet: Wallet = { cards: [{ cardId: CATALOG_V2.cards[0].id, usage: [] }], defaultCardId: null };
    expect(() =>
      compareRewards(
        CATALOG_V2,
        v2Wallet,
        purchase({ paymentPath: 'venmo' }),
        Date.parse('2026-09-30T15:00:00Z'),
      ),
    ).toThrow('Invalid comparison input.');
  });
  it('shares the v2 unavailable reasons', () => {
    expect(compare({ cards: [owned('test-bce')], at: Date.parse('2026-11-01T00:00:00Z') })).toEqual({
      status: 'unavailable',
      reason: 'catalog-expired',
    });
    expect(compare({ cards: [owned('test-bce')], purchase: { merchantId: 'nowhere' } })).toEqual({
      status: 'unavailable',
      reason: 'unsupported-merchant',
    });
  });
});

describe('catalog v3 usageInputs', () => {
  const inputs = (cardId: string) => usageInputs(CATALOG, cardId);
  it('records a shared cap once, on the group’s first rule, and activation per rule', () => {
    expect(inputs('test-cash-plus')).toEqual([
      {
        ruleId: 'cash-plus-electronics',
        label: 'combined electronics store and department store',
        needsSpend: true,
        needsActivation: true,
      },
      {
        ruleId: 'cash-plus-department-stores',
        label: 'department store',
        needsSpend: false,
        needsActivation: true,
      },
    ]);
  });
  it('lists rotating rules and capped bonuses, and nothing for uncapped brand rules', () => {
    expect(inputs('test-freedom-flex').map((i) => [i.ruleId, i.needsSpend, i.needsActivation])).toEqual([
      ['flex-q4-electronics', true, true],
      ['flex-q4-department', false, true],
      ['flex-q1-online', true, true],
    ]);
    expect(inputs('test-bce')).toEqual([
      { ruleId: 'bce-online', label: 'online retail', needsSpend: true, needsActivation: false },
    ]);
    expect(inputs('test-prime-visa')).toEqual([]);
    expect(inputs('test-my-best-buy-visa')).toEqual([]);
    expect(inputs('missing')).toEqual([]);
  });
  it('omits rules that cover no catalog merchant', () => {
    // The fixture's Q4 dining and Q1 supermarket rules: no dining or supermarket merchant.
    expect(inputs('test-rotating')).toEqual([]);
  });
});
