import { describe, expect, it } from 'vitest';
import { CATALOG_V2, catalogSchema, compareRewards, redateCatalog, usageInputs } from '../src/domain';
import type {
  CatalogV2,
  CardEstimate,
  Comparison,
  MerchantProfile,
  PaymentPath,
  Purchase,
  RuleUsage,
  Wallet,
} from '../src/domain';

const now = Date.parse('2026-09-30T15:00:00Z');
const today = '2026-09-30';
const purchase = (extra: Partial<Purchase> = {}): Purchase => ({
  merchantId: 'best-buy-us',
  currency: 'USD',
  amountCents: 10_000,
  purchasedOn: today,
  eligiblePurchase: 'eligible',
  onlineRetail: 'eligible',
  ...extra,
});
const usage = (ruleId: string, extra: Partial<RuleUsage> = {}): RuleUsage => ({
  ruleId,
  calendarYear: 2026,
  recordedOn: today,
  spentCents: null,
  activation: 'unknown',
  ...extra,
});
const wallet = (cards: Wallet['cards'], defaultCardId: string | null = null): Wallet => ({
  cards,
  defaultCardId,
});
const owned = (cardId: string, rows: RuleUsage[] = []) => ({ cardId, usage: rows });
const ALL = CATALOG_V2.cards.map((card) => card.id);

function ready(result: ReturnType<typeof compareRewards>): Comparison {
  if (result.status !== 'ready') throw new Error(`unavailable: ${result.reason}`);
  return result;
}
function estimate(
  cardId: string,
  rows: RuleUsage[] = [],
  extra: Partial<Purchase> = {},
  catalog: CatalogV2 = CATALOG_V2,
): CardEstimate {
  return ready(compareRewards(catalog, wallet([owned(cardId, rows)]), purchase(extra), now)).estimates[0];
}
function statuses(e: CardEstimate) {
  return Object.fromEntries(e.rules!.map((r) => [r.ruleId, r.status]));
}
/** The catalog plus synthetic merchants whose expected category matches MCC-group rules. */
function withMerchants(...profiles: Partial<MerchantProfile>[]): CatalogV2 {
  const catalog = structuredClone(CATALOG_V2);
  for (const profile of profiles)
    catalog.merchants.push({
      ...structuredClone(catalog.merchants[0]),
      mcc: { code: null, confidence: 'low', sourceIds: [] },
      notes: 'Synthetic test merchant.',
      ...profile,
    } as MerchantProfile);
  return catalog;
}
const bceActive = (extra: Partial<RuleUsage> = {}) => [
  usage('bce-online-retail', { activation: 'active', spentCents: 0, ...extra }),
];

describe('catalog v2 engine: applicability per rule kind and merchant profile', () => {
  const catalog = withMerchants(
    {
      id: 'grocer-us',
      name: 'Grocer',
      onlineRetail: false,
      physicalGoods: true,
      expectedCategory: 'supermarkets',
    },
    { id: 'diner-us', name: 'Diner', onlineRetail: false, physicalGoods: false, expectedCategory: 'dining' },
    {
      id: 'stream-us',
      name: 'Stream',
      onlineRetail: false,
      physicalGoods: false,
      expectedCategory: 'streaming',
    },
    { id: 'shop-ca', name: 'Shop CA', usMerchant: false, expectedCategory: 'general-merchandise' },
  );
  it.each([
    // [merchant, card, expected statuses]
    [
      'best-buy-us',
      'amex-blue-cash-everyday',
      {
        'bce-base': 'base',
        'bce-online-retail': 'applied',
        'bce-supermarkets': 'not-at-merchant',
        'bce-gas': 'not-at-merchant',
      },
    ],
    [
      'amazon-us',
      'amex-blue-cash-everyday',
      { 'bce-online-retail': 'applied', 'bce-supermarkets': 'not-at-merchant' },
    ],
    [
      'grocer-us',
      'amex-blue-cash-everyday',
      { 'bce-online-retail': 'not-at-merchant', 'bce-supermarkets': 'may-apply' },
    ],
    ['shop-ca', 'amex-blue-cash-everyday', { 'bce-online-retail': 'not-eligible' }],
    [
      'best-buy-us',
      'citi-double-cash',
      { 'double-cash-base': 'base', 'double-cash-travel-portal': 'not-at-merchant' },
    ],
    [
      'best-buy-us',
      'capital-one-quicksilver',
      {
        'quicksilver-travel-portal': 'not-at-merchant',
        'quicksilver-entertainment-portal': 'not-at-merchant',
      },
    ],
    [
      'diner-us',
      'capital-one-savor',
      {
        'savor-dining': 'applied',
        'savor-supermarkets': 'not-at-merchant',
        'savor-entertainment-portal': 'not-at-merchant',
      },
    ],
    [
      'diner-us',
      'chase-freedom-unlimited',
      { 'freedom-unlimited-dining': 'may-apply', 'freedom-unlimited-drugstores': 'not-at-merchant' },
    ],
    [
      'stream-us',
      'amex-blue-cash-preferred',
      { 'bcp-streaming': 'may-apply', 'bcp-transit': 'not-at-merchant' },
    ],
    ['best-buy-us', 'wells-fargo-active-cash', { 'active-cash-base': 'base' }],
  ] as const)('%s × %s', (merchantId, cardId, expected) => {
    const rows = cardId === 'amex-blue-cash-everyday' ? bceActive() : [];
    expect(statuses(estimate(cardId, rows, { merchantId }, catalog))).toMatchObject(expected);
  });

  it('never applies `other` rules and marks portals as not at this merchant', () => {
    const custom = structuredClone(CATALOG_V2);
    const savor = custom.cards.find((c) => c.id === 'capital-one-savor')!;
    savor.rules.push({ ...savor.rules[1], id: 'savor-other', category: 'other', rateBps: 900 });
    const e = estimate('capital-one-savor', [], {}, custom);
    expect(statuses(e)['savor-other']).toBe('not-at-merchant');
    expect([e.minRewardCents, e.maxRewardCents]).toEqual([100, 100]);
  });

  it('applies MCC-group rules only on an expected-category match, with an unstated cap as a range', () => {
    // BCP 6% streaming: cap unstated → minimum falls back to base.
    const e = estimate(
      'amex-blue-cash-preferred',
      [usage('bcp-streaming', { activation: 'active' })],
      {
        merchantId: 'stream-us',
      },
      catalog,
    );
    expect(e).toMatchObject({ minRewardCents: 100, maxRewardCents: 600, uncertainties: ['cap-unstated'] });
    // BCP 6% supermarkets has a known $6,000 calendar-year cap then 1%.
    const g = estimate(
      'amex-blue-cash-preferred',
      [usage('bcp-supermarkets', { activation: 'active', spentCents: 0 })],
      { merchantId: 'grocer-us' },
      catalog,
    );
    expect(g).toMatchObject({
      minRewardCents: 600,
      maxRewardCents: 600,
      appliedRuleId: 'bcp-supermarkets',
      uncertainties: [],
    });
  });
});

describe('catalog v2 engine: amounts', () => {
  it('Citi Double Cash counts paid-on-payment toward the estimate and reports the split', () => {
    expect(estimate('citi-double-cash')).toMatchObject({
      minRewardCents: 200,
      maxRewardCents: 200,
      baseRateBps: 200,
      bonusRateBps: null,
      appliedRuleId: 'double-cash-base',
      paidOnPaymentBps: 100,
      uncertainties: [],
    });
  });

  it.each([
    ['nothing spent', 0, 300, 'applied'],
    ['$5,950 spent: $50 at 3%, $50 at 1%', 595_000, 200, 'applied'],
    ['exactly at the cap', 600_000, 100, 'cap-reached'],
    ['past the cap', 700_000, 100, 'cap-reached'],
  ] as const)('BCE online retail cap boundary: %s', (_, spentCents, cents, status) => {
    const e = estimate('amex-blue-cash-everyday', bceActive({ spentCents }));
    expect([e.minRewardCents, e.maxRewardCents]).toEqual([cents, cents]);
    expect(statuses(e)['bce-online-retail']).toBe(status);
    expect(e.uncertainties).toEqual([]);
  });

  it('BCE with unknown cap usage ranges from the after-cap rate to the full bonus', () => {
    const e = estimate('amex-blue-cash-everyday', bceActive({ spentCents: null }));
    expect(e).toMatchObject({
      minRewardCents: 100,
      maxRewardCents: 300,
      uncertainties: ['annual-usage-unknown'],
    });
    expect([e.minBonusSpendCents, e.maxBonusSpendCents]).toEqual([0, 10_000]);
  });

  it('a large purchase spans the cap: remaining allowance at 3%, the rest at 1%', () => {
    const e = estimate('amex-blue-cash-everyday', bceActive({ spentCents: 550_000 }), {
      amountCents: 10_000_000,
    });
    // 50,000¢ × 3% + 9,950,000¢ × 1% = 1,500 + 99,500
    expect([e.minRewardCents, e.maxRewardCents]).toEqual([101_000, 101_000]);
  });

  it('unstated activation needs no confirmation: BCE at Best Buy is 3% once cap usage is known', () => {
    // No usage recorded: only the annual cap allowance is unknown.
    expect(estimate('amex-blue-cash-everyday')).toMatchObject({
      minRewardCents: 100,
      maxRewardCents: 300,
      uncertainties: ['annual-usage-unknown'],
    });
    // Spend recorded below the cap, activation never confirmed: a guaranteed 3%.
    expect(
      estimate('amex-blue-cash-everyday', [usage('bce-online-retail', { spentCents: 0 })]),
    ).toMatchObject({ minRewardCents: 300, maxRewardCents: 300, uncertainties: [] });
    // `inactive` is meaningless for a rule that needs no activation.
    const inactive = estimate('amex-blue-cash-everyday', [
      usage('bce-online-retail', { activation: 'inactive', spentCents: 0 }),
    ]);
    expect(statuses(inactive)['bce-online-retail']).toBe('applied');
  });

  it('enroll-once and recurring rules need confirmation; inactive never applies', () => {
    for (const activation of ['enroll-once', 'recurring'] as const) {
      const catalog = structuredClone(CATALOG_V2);
      catalog.cards
        .find((c) => c.id === 'amex-blue-cash-everyday')!
        .rules.find((r) => r.id === 'bce-online-retail')!.activation = activation;
      expect(
        estimate('amex-blue-cash-everyday', [usage('bce-online-retail', { spentCents: 0 })], {}, catalog),
      ).toMatchObject({ minRewardCents: 100, maxRewardCents: 300, uncertainties: ['activation-unknown'] });
      expect(estimate('amex-blue-cash-everyday', bceActive(), {}, catalog).minRewardCents).toBe(300);
      const inactive = estimate(
        'amex-blue-cash-everyday',
        [usage('bce-online-retail', { activation: 'inactive', spentCents: 0 })],
        {},
        catalog,
      );
      expect(inactive).toMatchObject({ minRewardCents: 100, maxRewardCents: 100, uncertainties: [] });
      expect(statuses(inactive)['bce-online-retail']).toBe('not-eligible');
    }
  });

  it('never estimates below the base, even with an after-cap rate under it', () => {
    // The schema forbids this; the engine floors at the base as defense in depth.
    const catalog = structuredClone(CATALOG_V2);
    const rule = catalog.cards
      .find((c) => c.id === 'amex-blue-cash-everyday')!
      .rules.find((r) => r.id === 'bce-online-retail')!;
    rule.cap = { kind: 'spend', amountCents: 600_000, period: 'calendar-year', rateAfterCapBps: 0 };
    const atCap = estimate('amex-blue-cash-everyday', bceActive({ spentCents: 600_000 }), {}, catalog);
    expect([atCap.minRewardCents, atCap.maxRewardCents]).toEqual([100, 100]);
    const unknown = estimate('amex-blue-cash-everyday', bceActive({ spentCents: null }), {}, catalog);
    expect([unknown.minRewardCents, unknown.maxRewardCents]).toEqual([100, 300]);
  });

  it('stale usage (another day) is unknown, not zero', () => {
    const e = estimate('amex-blue-cash-everyday', bceActive({ recordedOn: '2026-09-29' }));
    expect(e).toMatchObject({ minRewardCents: 100, maxRewardCents: 300 });
    expect(e.uncertainties).toEqual(['annual-usage-unknown']);
  });

  it.each([
    ['card', [300, 300], [], 'applied'],
    ['paypal', [100, 300], ['payment-path-uncertain'], 'may-apply'],
    ['digital-wallet', [100, 300], ['payment-path-uncertain'], 'may-apply'],
    ['bnpl', [100, 100], [], 'not-eligible'],
  ] as const)('payment path %s at Best Buy for BCE', (paymentPath, amounts, codes, status) => {
    const e = estimate('amex-blue-cash-everyday', bceActive(), { paymentPath: paymentPath as PaymentPath });
    expect([e.minRewardCents, e.maxRewardCents]).toEqual(amounts);
    expect(e.uncertainties).toEqual(codes);
    expect(statuses(e)['bce-online-retail']).toBe(status);
  });

  it('BNPL does not change cards without an exclusion', () => {
    expect(estimate('citi-double-cash', [], { paymentPath: 'bnpl' })).toMatchObject({
      minRewardCents: 200,
      maxRewardCents: 200,
    });
  });

  it('online retail eligibility: unknown is a range, ineligible never applies', () => {
    expect(estimate('amex-blue-cash-everyday', bceActive(), { onlineRetail: 'unknown' })).toMatchObject({
      minRewardCents: 100,
      maxRewardCents: 300,
      uncertainties: ['online-category-unknown'],
    });
    const out = estimate('amex-blue-cash-everyday', bceActive(), { onlineRetail: 'ineligible' });
    expect(statuses(out)['bce-online-retail']).toBe('not-eligible');
    expect(out.maxRewardCents).toBe(100);
  });

  it('expired promotions are flagged and never applied; current ones apply', () => {
    const catalog = structuredClone(CATALOG_V2);
    const rule = catalog.cards
      .find((c) => c.id === 'amex-blue-cash-everyday')!
      .rules.find((r) => r.id === 'bce-online-retail')!;
    rule.limitedTime = { endsOn: '2026-09-29' };
    const expired = estimate('amex-blue-cash-everyday', bceActive(), {}, catalog);
    expect(statuses(expired)['bce-online-retail']).toBe('expired');
    expect(expired.maxRewardCents).toBe(100);
    rule.limitedTime = { endsOn: today };
    expect(estimate('amex-blue-cash-everyday', bceActive(), {}, catalog).minRewardCents).toBe(300);
  });

  it('a promotion that ended before the catalog was verified is expired even for an earlier purchase date', () => {
    const catalog = structuredClone(CATALOG_V2);
    catalog.cards
      .find((c) => c.id === 'amex-blue-cash-everyday')!
      .rules.find((r) => r.id === 'bce-online-retail')!.limitedTime = { endsOn: '2026-09-28' };
    const e = estimate(
      'amex-blue-cash-everyday',
      [usage('bce-online-retail', { spentCents: 0, recordedOn: '2026-09-28' })],
      { purchasedOn: '2026-09-28' },
      catalog,
    );
    expect(statuses(e)['bce-online-retail']).toBe('expired');
    expect(e.maxRewardCents).toBe(100);
  });

  it('a short-period cap with unknown usage reports cap-usage-unknown', () => {
    const catalog = structuredClone(CATALOG_V2);
    const rule = catalog.cards
      .find((c) => c.id === 'amex-blue-cash-everyday')!
      .rules.find((r) => r.id === 'bce-online-retail')!;
    rule.cap = { kind: 'spend', amountCents: 50_000, period: 'quarter', rateAfterCapBps: 100 };
    rule.activation = 'none';
    expect(estimate('amex-blue-cash-everyday', [], {}, catalog).uncertainties).toEqual(['cap-usage-unknown']);
  });
});

describe('catalog v2 engine: ranking', () => {
  const everyCard = (defaultCardId: string | null = null) =>
    wallet(
      ALL.map((id) => owned(id, id === 'amex-blue-cash-everyday' ? bceActive() : [])),
      defaultCardId,
    );
  it('ranks the seven cards at Best Buy by guaranteed minimum', () => {
    const result = ready(compareRewards(CATALOG_V2, everyCard(), purchase(), now));
    expect(result.estimates.map((e) => [e.cardId, e.minRewardCents])).toEqual([
      ['amex-blue-cash-everyday', 300],
      ['citi-double-cash', 200],
      ['wells-fargo-active-cash', 200],
      ['capital-one-quicksilver', 150],
      ['chase-freedom-unlimited', 150],
      ['amex-blue-cash-preferred', 100],
      ['capital-one-savor', 100],
    ]);
    expect(result).toMatchObject({
      preferredCardId: 'amex-blue-cash-everyday',
      rankingMayChange: false,
      tied: false,
    });
  });
  it('breaks exact ties by the default card, then by id', () => {
    const cards = [owned('wells-fargo-active-cash'), owned('citi-double-cash')];
    expect(ready(compareRewards(CATALOG_V2, wallet(cards), purchase(), now))).toMatchObject({
      preferredCardId: 'citi-double-cash',
      tied: true,
    });
    expect(
      ready(compareRewards(CATALOG_V2, wallet(cards, 'wells-fargo-active-cash'), purchase(), now))
        .preferredCardId,
    ).toBe('wells-fargo-active-cash');
  });
  it('flags a possible rank change when an unconfirmed bonus could win', () => {
    const cards = [owned('citi-double-cash'), owned('amex-blue-cash-everyday')];
    expect(ready(compareRewards(CATALOG_V2, wallet(cards), purchase(), now))).toMatchObject({
      preferredCardId: 'citi-double-cash',
      rankingMayChange: true,
    });
  });
});

describe('catalog v2 engine: bounds and validation', () => {
  it('matches exact BigInt arithmetic and keeps min ≤ max across a sweep', () => {
    const cap = 600_000;
    for (const amountCents of [1, 7, 99, 101, 3_333, 10_000, 123_457, 600_001, 9_999_999, 10_000_000])
      for (const spent of [null, 0, 1, 299_999, 599_999, 600_000, 9_000_000]) {
        const e = estimate('amex-blue-cash-everyday', bceActive({ spentCents: spent }), { amountCents });
        const reward = (bonus: number) =>
          Number((BigInt(bonus) * 300n + BigInt(amountCents - bonus) * 100n) / 10_000n);
        const maxBonus = Math.min(amountCents, Math.max(0, cap - (spent ?? 0)));
        expect(e.maxRewardCents).toBe(reward(maxBonus));
        expect(e.minRewardCents).toBe(spent === null ? reward(0) : reward(maxBonus));
        expect(e.minRewardCents).toBeLessThanOrEqual(e.maxRewardCents);
      }
  });
  it('rejects unsupported merchants and structurally invalid catalogs', () => {
    expect(
      compareRewards(
        CATALOG_V2,
        wallet([owned('citi-double-cash')]),
        purchase({ merchantId: 'walmart-us' }),
        now,
      ),
    ).toEqual({
      status: 'unavailable',
      reason: 'unsupported-merchant',
    });
    // The engine's generic store profile is a catalog v3 feature.
    expect(
      compareRewards(
        CATALOG_V2,
        wallet([owned('citi-double-cash')]),
        purchase({ merchantId: 'generic-us-online' }),
        now,
      ),
    ).toEqual({ status: 'unavailable', reason: 'unsupported-merchant' });
    const broken = structuredClone(CATALOG_V2);
    broken.cards[0].rules = broken.cards[0].rules.filter((r) => r.category !== 'all-purchases');
    expect(() => compareRewards(broken, wallet([owned('citi-double-cash')]), purchase(), now)).toThrow();
    expect(() =>
      compareRewards(
        CATALOG_V2,
        wallet([owned('citi-double-cash', [usage('bce-online-retail')])]),
        purchase(),
        now,
      ),
    ).toThrow('Invalid wallet usage.');
    expect(() =>
      compareRewards(
        CATALOG_V2,
        wallet([owned('citi-double-cash')]),
        purchase({ paymentPath: 'cash' as PaymentPath }),
        now,
      ),
    ).toThrow();
  });
  it('reports expiry and not-yet-valid like v1', () => {
    const cards = wallet([owned('citi-double-cash')]);
    expect(compareRewards(CATALOG_V2, cards, purchase(), Date.parse(CATALOG_V2.expiresAt))).toEqual({
      status: 'unavailable',
      reason: 'catalog-expired',
    });
    expect(compareRewards(CATALOG_V2, cards, purchase(), Date.parse(CATALOG_V2.verifiedAt) - 1)).toEqual({
      status: 'unavailable',
      reason: 'catalog-not-yet-valid',
    });
  });
});

describe('wallet usage inputs', () => {
  it('asks only for rules that can apply at a covered merchant', () => {
    expect(usageInputs(CATALOG_V2, 'amex-blue-cash-everyday')).toEqual([
      { ruleId: 'bce-online-retail', label: 'online retail', needsSpend: true, needsActivation: false },
    ]);
    expect(usageInputs(CATALOG_V2, 'citi-double-cash')).toEqual([]);
    expect(usageInputs(CATALOG_V2, 'amex-blue-cash-preferred')).toEqual([]);
  });
});

describe('redateCatalog (browser-test support)', () => {
  it('moves every date by the same number of days and stays schema-valid', () => {
    const moved = redateCatalog(CATALOG_V2, '2027-03-01');
    expect(moved.verifiedAt).toBe('2027-03-01T00:00:00Z');
    expect(Date.parse(moved.expiresAt) - Date.parse(moved.verifiedAt)).toBe(
      Date.parse(CATALOG_V2.expiresAt) - Date.parse(CATALOG_V2.verifiedAt),
    );
    expect(moved.sources.find((s) => s.id === 'check-mcc-best-buy')?.checkedOn).toBe('2027-02-28');
    expect(catalogSchema.safeParse(moved).success).toBe(true);
    expect(CATALOG_V2.verifiedAt).toBe('2026-09-29T00:00:00Z');
  });
});
