import { describe, expect, it } from 'vitest';
import { CATALOG_V2, CATALOG_V3, catalogV3Schema, compareRewards } from '../src/domain';
import type { CardEstimate, Comparison, Purchase, RuleUsage, Wallet, WalletCard } from '../src/domain';

/* Golden ranking ladders on the real 178-card catalog v3 (Stage 2 M5). Every expectation was computed by hand
 * from the catalog rules and the engine v3 semantics (rules do not stack; an uncertain rule gives a range from
 * the base; an unstated cap is uncertain; an unanswered gate guarantees its worst answer's best rule; unvalued
 * programs rank after valued cards) and reviewed against the issuer captures by an independent subagent
 * (agent-verified). A $100 purchase on 2026-10-15, paid by card unless stated. A ladder row is
 * `cardId min..max` in cents, or `cardId Nu..Mu` in units for a card whose program has no value. */

const now = Date.parse('2026-10-15T12:00:00Z');
const today = '2026-10-15';
const MERCHANTS = ['amazon-us', 'best-buy-us', 'newegg-us'] as const;
type MerchantId = (typeof MERCHANTS)[number];

const usage = (ruleId: string, extra: Partial<RuleUsage> = {}): RuleUsage => ({
  ruleId,
  calendarYear: 2026,
  recordedOn: today,
  spentCents: null,
  activation: 'unknown',
  ...extra,
});
const owned = (cardId: string, extra: Partial<WalletCard> = {}): WalletCard => ({
  cardId,
  usage: [],
  ...extra,
});

function compare(wallet: Wallet, merchantId: MerchantId, extra: Partial<Purchase> = {}) {
  return compareRewards(
    CATALOG_V3,
    wallet,
    {
      merchantId,
      currency: 'USD',
      amountCents: 10_000,
      purchasedOn: today,
      eligiblePurchase: 'eligible',
      onlineRetail: 'eligible',
      ...extra,
    },
    now,
  );
}
const row = (e: CardEstimate) =>
  e.unitValue
    ? `${e.cardId} ${e.minRewardCents}..${e.maxRewardCents}`
    : `${e.cardId} ${e.minRewardUnits}u..${e.maxRewardUnits}u`;

type Expected = {
  ladder: string[];
  notAccepted?: string[];
  rankingMayChange: boolean;
  tied: boolean;
};
function expectLadder(result: ReturnType<typeof compare>, expected: Expected) {
  expect(result.status).toBe('ready');
  const ready = result as Comparison;
  expect(ready.estimates.map(row)).toEqual(expected.ladder);
  expect(ready.preferredCardId).toBe(expected.ladder[0].split(' ')[0]);
  expect((ready.notAccepted ?? []).map((e) => e.cardId)).toEqual(expected.notAccepted ?? []);
  expect(ready.rankingMayChange).toBe(expected.rankingMayChange);
  expect(ready.tied).toBe(expected.tied);
  return ready;
}
const wallet = (cards: WalletCard[], extra: Partial<Wallet> = {}): Wallet => ({
  cards,
  defaultCardId: null,
  ...extra,
});
const estimate = (result: ReturnType<typeof compare>, cardId: string) =>
  (result as Comparison).estimates.find((e) => e.cardId === cardId)!;

const REAL_CARDS = CATALOG_V2.cards.map((card) => card.id);
const bceUsed = owned('amex-blue-cash-everyday', { usage: [usage('bce-online-retail', { spentCents: 0 })] });

describe('catalog v3 build', () => {
  it('is the release catalog and parses', () => {
    expect(catalogV3Schema.parse(CATALOG_V3)).toEqual(CATALOG_V3);
    expect(CATALOG_V3.version).toBe('2026-10-02.expansion.1');
    expect(CATALOG_V3.cards).toHaveLength(178);
    expect(CATALOG_V3.merchants.map((m) => m.id)).toEqual(['best-buy-us', 'newegg-us', 'amazon-us']);
  });
});

describe('real cards: catalog v3 gives release 1 (catalog v2) results', () => {
  const purchases: Partial<Purchase>[] = [
    {},
    { amountCents: 123_457 },
    { onlineRetail: 'unknown' },
    { paymentPath: 'paypal' },
    { paymentPath: 'bnpl' },
    { paymentPath: 'digital-wallet' },
  ];
  const keep = (e: CardEstimate) => [
    e.cardId,
    e.minRewardCents,
    e.maxRewardCents,
    e.baseRateBps,
    e.bonusRateBps,
    e.appliedRuleId,
    e.uncertainties,
  ];
  for (const merchantId of MERCHANTS)
    for (const extra of purchases)
      it(`${merchantId} ${JSON.stringify(extra)}`, () => {
        const cards = REAL_CARDS.map((id) => owned(id));
        const v2 = compareRewards(
          CATALOG_V2,
          wallet(cards),
          {
            merchantId,
            currency: 'USD',
            amountCents: 10_000,
            purchasedOn: today,
            eligiblePurchase: 'eligible',
            onlineRetail: 'eligible',
            ...extra,
          },
          Date.parse('2026-10-15T12:00:00Z'),
        ) as Comparison;
        const v3 = compare(wallet(cards), merchantId, extra) as Comparison;
        expect(v3.estimates.map(keep)).toEqual(v2.estimates.map(keep));
        expect([v3.preferredCardId, v3.rankingMayChange, v3.tied]).toEqual([
          v2.preferredCardId,
          v2.rankingMayChange,
          v2.tied,
        ]);
      });
});

describe('golden ladders on catalog v3', () => {
  it('W1 the seven release-1 cards, no usage: same ladder at all three merchants', () => {
    for (const merchantId of MERCHANTS)
      expectLadder(compare(wallet(REAL_CARDS.map((id) => owned(id))), merchantId), {
        ladder: [
          'citi-double-cash 200..200',
          'wells-fargo-active-cash 200..200',
          'capital-one-quicksilver 150..150',
          'chase-freedom-unlimited 150..150',
          // 3% U.S. online retail up to $6,000 a year; no usage recorded, so the cap may be spent.
          'amex-blue-cash-everyday 100..300',
          'amex-blue-cash-preferred 100..100',
          'capital-one-savor 100..100',
        ],
        rankingMayChange: true,
        tied: true,
      });
  });

  const amazonCards = (bce: WalletCard = owned('amex-blue-cash-everyday')) => [
    owned('prime-visa'),
    owned('synchrony-amazon-store-card'),
    bce,
    owned('citi-double-cash'),
  ];
  it('W2 Prime member: Prime Visa 5% at Amazon; the store card is not accepted elsewhere', () => {
    const w = wallet(amazonCards(bceUsed), { gates: [{ gateId: 'amazon-prime', optionId: 'member' }] });
    const amazon = expectLadder(compare(w, 'amazon-us'), {
      ladder: [
        'prime-visa 500..500',
        'amex-blue-cash-everyday 300..300',
        'citi-double-cash 200..200',
        // 5% with Prime, cap unstated: guaranteed nothing (no base on a closed-loop card).
        'synchrony-amazon-store-card 0..500',
      ],
      rankingMayChange: false,
      tied: false,
    });
    expect(estimate(amazon, 'prime-visa').appliedRuleId).toBe('prime-amazon-member');
    expect(estimate(amazon, 'synchrony-amazon-store-card').uncertainties).toEqual(['cap-unstated']);
    for (const merchantId of ['best-buy-us', 'newegg-us'] as const)
      expectLadder(compare(w, merchantId), {
        ladder: ['amex-blue-cash-everyday 300..300', 'citi-double-cash 200..200', 'prime-visa 100..100'],
        notAccepted: ['synchrony-amazon-store-card'],
        rankingMayChange: false,
        tied: false,
      });
  });

  it('W3 not a Prime member: Prime Visa 3% at Amazon, the store card earns nothing', () => {
    const w = wallet(amazonCards(), { gates: [{ gateId: 'amazon-prime', optionId: 'not-member' }] });
    const amazon = expectLadder(compare(w, 'amazon-us'), {
      ladder: [
        'prime-visa 300..300',
        'citi-double-cash 200..200',
        'amex-blue-cash-everyday 100..300',
        'synchrony-amazon-store-card 0..0',
      ],
      rankingMayChange: false,
      tied: false,
    });
    expect(estimate(amazon, 'prime-visa').appliedRuleId).toBe('prime-amazon-not-member');
    for (const merchantId of ['best-buy-us', 'newegg-us'] as const)
      expectLadder(compare(w, merchantId), {
        ladder: ['citi-double-cash 200..200', 'amex-blue-cash-everyday 100..300', 'prime-visa 100..100'],
        notAccepted: ['synchrony-amazon-store-card'],
        rankingMayChange: true,
        tied: false,
      });
  });

  it('W4 Prime unanswered: Prime Visa guarantees the non-member 3%, may earn 5%', () => {
    const amazon = expectLadder(compare(wallet(amazonCards()), 'amazon-us'), {
      ladder: [
        'prime-visa 300..500',
        'citi-double-cash 200..200',
        'amex-blue-cash-everyday 100..300',
        'synchrony-amazon-store-card 0..500',
      ],
      rankingMayChange: true,
      tied: false,
    });
    expect(estimate(amazon, 'prime-visa').uncertainties).toEqual(['condition-unknown']);
  });

  const bestBuyShopper = () => [
    owned('citi-my-best-buy-visa'),
    owned('us-bank-cash-plus', {
      choices: [
        { choiceId: 'five-percent-categories', optionIds: ['electronic-stores', 'department-stores'] },
        { choiceId: 'two-percent-category', optionIds: ['grocery'] },
      ],
      // The shared quarterly cap's spend sits on the group's smallest rule ID.
      usage: [
        usage('cash-plus-department-stores', { spentCents: 0, activation: 'active' }),
        usage('cash-plus-electronic-stores', { activation: 'active' }),
      ],
    }),
    owned('citi-double-cash'),
    owned('capital-one-quicksilver'),
  ];
  it('W5 Cash+ with electronics stores chosen and activated: 5% at Best Buy and Newegg', () => {
    const w = wallet(bestBuyShopper());
    const bestBuy = expectLadder(compare(w, 'best-buy-us'), {
      ladder: [
        'us-bank-cash-plus 500..500',
        'citi-double-cash 200..200',
        'capital-one-quicksilver 150..150',
        // 5% in My Best Buy certificates, cap unstated.
        'citi-my-best-buy-visa 100..500',
      ],
      rankingMayChange: false,
      tied: false,
    });
    expect(estimate(bestBuy, 'us-bank-cash-plus').appliedRuleId).toBe('cash-plus-electronic-stores');
    expect(estimate(bestBuy, 'citi-my-best-buy-visa').programId).toBe('my-best-buy-rewards');
    expectLadder(compare(w, 'newegg-us'), {
      ladder: [
        'us-bank-cash-plus 500..500',
        'citi-double-cash 200..200',
        'capital-one-quicksilver 150..150',
        'citi-my-best-buy-visa 100..100',
      ],
      rankingMayChange: false,
      tied: false,
    });
    expectLadder(compare(w, 'amazon-us'), {
      ladder: [
        'citi-double-cash 200..200',
        'capital-one-quicksilver 150..150',
        'citi-my-best-buy-visa 100..100',
        'us-bank-cash-plus 100..100',
      ],
      rankingMayChange: false,
      tied: false,
    });
  });

  it('W6 Newegg store card and Cash+ with nothing answered', () => {
    const w = wallet([
      owned('synchrony-newegg-store-credit-card'),
      owned('us-bank-cash-plus'),
      owned('capital-one-quicksilver'),
    ]);
    const newegg = expectLadder(compare(w, 'newegg-us'), {
      ladder: [
        'capital-one-quicksilver 150..150',
        'us-bank-cash-plus 100..500',
        'synchrony-newegg-store-credit-card 0..400',
      ],
      rankingMayChange: true,
      tied: false,
    });
    expect(estimate(newegg, 'us-bank-cash-plus').uncertainties).toEqual([
      'activation-unknown',
      'cap-usage-unknown',
      'choice-unknown',
    ]);
    expectLadder(compare(w, 'best-buy-us'), {
      ladder: ['capital-one-quicksilver 150..150', 'us-bank-cash-plus 100..500'],
      notAccepted: ['synchrony-newegg-store-credit-card'],
      rankingMayChange: true,
      tied: false,
    });
    expectLadder(compare(w, 'amazon-us'), {
      ladder: ['capital-one-quicksilver 150..150', 'us-bank-cash-plus 100..100'],
      notAccepted: ['synchrony-newegg-store-credit-card'],
      rankingMayChange: false,
      tied: false,
    });
  });

  const pointsCards = () =>
    [
      'capital-one-venture-x',
      'chase-sapphire-preferred',
      'amex-gold',
      'citi-strata-premier',
      'wells-fargo-active-cash',
    ].map((id) => owned(id));
  it('W7 points cards at published values (1¢ each): Venture X 2X ties Active Cash 2%', () => {
    for (const merchantId of MERCHANTS)
      expectLadder(compare(wallet(pointsCards()), merchantId), {
        ladder: [
          'capital-one-venture-x 200..200',
          'wells-fargo-active-cash 200..200',
          'amex-gold 100..100',
          'chase-sapphire-preferred 100..100',
          'citi-strata-premier 100..100',
        ],
        rankingMayChange: false,
        tied: true,
      });
  });

  it('W8 shopper overrides reorder points cards (override beats the card-stated value)', () => {
    const w = wallet(pointsCards(), {
      valueOverrides: [
        { programId: 'chase-ultimate-rewards', valueHundredthsOfCent: 205 },
        { programId: 'amex-membership-rewards', valueHundredthsOfCent: 150 },
        { programId: 'capital-one-miles', valueHundredthsOfCent: 90 },
      ],
    });
    for (const merchantId of MERCHANTS) {
      const result = expectLadder(compare(w, merchantId), {
        ladder: [
          'chase-sapphire-preferred 205..205',
          'wells-fargo-active-cash 200..200',
          'capital-one-venture-x 180..180',
          'amex-gold 150..150',
          'citi-strata-premier 100..100',
        ],
        rankingMayChange: false,
        tied: false,
      });
      expect(estimate(result, 'chase-sapphire-preferred').unitValue).toEqual({
        hundredthsOfCent: 205,
        basis: 'override',
      });
    }
  });

  const unvalued = () => ['us-bank-altitude-go', 'us-bank-skypass-visa-signature', 'capital-one-quicksilver'];
  it('W9 unvalued programs rank after valued cards, in units', () => {
    for (const merchantId of MERCHANTS) {
      const result = expectLadder(compare(wallet(unvalued().map((id) => owned(id))), merchantId), {
        ladder: [
          'capital-one-quicksilver 150..150',
          'us-bank-altitude-go 100u..100u',
          'us-bank-skypass-visa-signature 100u..100u',
        ],
        rankingMayChange: true,
        tied: false,
      });
      expect(estimate(result, 'us-bank-altitude-go').uncertainties).toEqual(['value-unknown']);
    }
  });

  it('W10 a value set for Altitude points makes it comparable: 1.5¢ ties Quicksilver 1.5%', () => {
    const w = wallet(
      unvalued().map((id) => owned(id)),
      { valueOverrides: [{ programId: 'us-bank-altitude-points', valueHundredthsOfCent: 150 }] },
    );
    for (const merchantId of MERCHANTS)
      expectLadder(compare(w, merchantId), {
        ladder: [
          'capital-one-quicksilver 150..150',
          'us-bank-altitude-go 150..150',
          'us-bank-skypass-visa-signature 100u..100u',
        ],
        rankingMayChange: true,
        tied: true,
      });
  });

  const customizedCash = (firstYear: boolean) =>
    wallet(
      [
        owned('boa-customized-cash-rewards', {
          choices: [{ choiceId: 'choice-category', optionIds: ['online-shopping'] }],
          usage: [
            // Shared quarterly $2,500 cap: spend on the group's smallest rule ID.
            usage('customized-cash-rewards-club', { spentCents: 0 }),
            usage(
              firstYear
                ? 'customized-cash-rewards-online-shopping-first-year'
                : 'customized-cash-rewards-online-shopping',
              { activation: 'active' },
            ),
          ],
        }),
        owned('citi-double-cash'),
      ],
      {
        gates: [
          {
            gateId: 'boa-customized-cash-rewards-first-year',
            optionId: firstYear ? 'first-year' : 'after-first-year',
          },
        ],
      },
    );
  it('W11 Customized Cash online shopping after the first year: 3% online', () => {
    for (const merchantId of MERCHANTS)
      expectLadder(compare(customizedCash(false), merchantId), {
        ladder: ['boa-customized-cash-rewards 300..300', 'citi-double-cash 200..200'],
        rankingMayChange: false,
        tied: false,
      });
  });

  it('W12 Customized Cash online shopping in the first year: 6% online', () => {
    for (const merchantId of MERCHANTS) {
      const result = expectLadder(compare(customizedCash(true), merchantId), {
        ladder: ['boa-customized-cash-rewards 600..600', 'citi-double-cash 200..200'],
        rankingMayChange: false,
        tied: false,
      });
      expect(estimate(result, 'boa-customized-cash-rewards').appliedRuleId).toBe(
        'customized-cash-rewards-online-shopping-first-year',
      );
    }
  });

  const checkoutCards = () =>
    wallet([
      owned('synchrony-paypal-cashback-mastercard'),
      owned('synchrony-venmo-credit-card'),
      owned('citi-double-cash'),
      bceUsed,
    ]);
  it('W13 PayPal Cashback and Venmo cards by checkout method', () => {
    for (const merchantId of MERCHANTS)
      expectLadder(compare(checkoutCards(), merchantId), {
        ladder: [
          'amex-blue-cash-everyday 300..300',
          'citi-double-cash 200..200',
          'synchrony-paypal-cashback-mastercard 150..150',
          'synchrony-venmo-credit-card 100..100',
        ],
        rankingMayChange: false,
        tied: false,
      });
    expectLadder(compare(checkoutCards(), 'amazon-us', { paymentPath: 'paypal' }), {
      ladder: [
        'synchrony-paypal-cashback-mastercard 300..300',
        'citi-double-cash 200..200',
        // Amex may not code a PayPal checkout as online retail.
        'amex-blue-cash-everyday 100..300',
        'synchrony-venmo-credit-card 100..100',
      ],
      rankingMayChange: false,
      tied: false,
    });
    expectLadder(compare(checkoutCards(), 'amazon-us', { paymentPath: 'venmo' }), {
      ladder: [
        'synchrony-venmo-credit-card 300..300',
        'citi-double-cash 200..200',
        'synchrony-paypal-cashback-mastercard 150..150',
        'amex-blue-cash-everyday 100..300',
      ],
      rankingMayChange: false,
      tied: false,
    });
  });

  const smartly = (extra: Partial<WalletCard> = {}, gates: Wallet['gates'] = []) =>
    wallet([owned('us-bank-smartly', extra), owned('wells-fargo-active-cash'), owned('citi-double-cash')], {
      gates,
    });
  it('W14 Smartly with the balance tier unanswered guarantees its 2% base', () => {
    for (const merchantId of MERCHANTS) {
      const result = expectLadder(compare(smartly(), merchantId), {
        ladder: ['citi-double-cash 200..200', 'us-bank-smartly 200..400', 'wells-fargo-active-cash 200..200'],
        rankingMayChange: true,
        tied: true,
      });
      expect(estimate(result, 'us-bank-smartly').uncertainties).toEqual([
        'cap-usage-unknown',
        'condition-unknown',
      ]);
    }
  });

  it('W15 Smartly at the $100,000 tier with cap room: 4%', () => {
    const w = smartly({ usage: [usage('smartly-all-100k-plus', { spentCents: 0 })] }, [
      { gateId: 'us-bank-smartly-balance-tier', optionId: '100k-plus' },
    ]);
    for (const merchantId of MERCHANTS)
      expectLadder(compare(w, merchantId), {
        ladder: ['us-bank-smartly 400..400', 'citi-double-cash 200..200', 'wells-fargo-active-cash 200..200'],
        rankingMayChange: false,
        tied: false,
      });
  });

  it('W16 only closed-loop store cards: accepted at their own store only', () => {
    const w = wallet([owned('synchrony-amazon-store-card'), owned('synchrony-newegg-store-credit-card')], {
      gates: [{ gateId: 'amazon-prime', optionId: 'member' }],
    });
    expectLadder(compare(w, 'amazon-us'), {
      ladder: ['synchrony-amazon-store-card 0..500'],
      notAccepted: ['synchrony-newegg-store-credit-card'],
      rankingMayChange: false,
      tied: false,
    });
    expectLadder(compare(w, 'newegg-us'), {
      ladder: ['synchrony-newegg-store-credit-card 0..400'],
      notAccepted: ['synchrony-amazon-store-card'],
      rankingMayChange: false,
      tied: false,
    });
    expect(compare(w, 'best-buy-us')).toEqual({ status: 'unavailable', reason: 'no-accepted-card' });
  });
});
