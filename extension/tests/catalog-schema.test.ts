import { describe, expect, it } from 'vitest';
import {
  CATALOG_V2,
  catalogSchema,
  catalogV1Schema,
  catalogV2Schema,
  catalogV3Schema,
  compareRewards,
  PILOT_CATALOG,
  redateCatalog,
} from '../src/domain';
import {
  CATALOG_V3_FIXTURE,
  catalogCases,
  catalogV2Cases,
  catalogV3Cases,
} from '../../packages/rewards-core/test-cases';

describe('shared catalog schema', () => {
  it.each(catalogCases)('$name has the intended validity', ({ input, valid }) => {
    expect(catalogSchema.safeParse(input).success).toBe(valid);
  });
  it.each(catalogV2Cases)('$name has the intended validity', ({ input, valid }) => {
    expect(catalogSchema.safeParse(input).success).toBe(valid);
  });
  it.each(catalogV3Cases)('$name has the intended validity', ({ input, valid }) => {
    expect(catalogSchema.safeParse(input).success).toBe(valid);
  });
  it('keys the union on schemaVersion', () => {
    expect(catalogV1Schema.safeParse(CATALOG_V2).success).toBe(false);
    expect(catalogV2Schema.safeParse(PILOT_CATALOG).success).toBe(false);
    expect(catalogV2Schema.safeParse(CATALOG_V3_FIXTURE).success).toBe(false);
    expect(catalogV3Schema.safeParse(CATALOG_V2).success).toBe(false);
    expect(catalogSchema.parse(CATALOG_V2)).toEqual(CATALOG_V2);
    expect(catalogSchema.parse(PILOT_CATALOG)).toEqual(PILOT_CATALOG);
    expect(catalogSchema.parse(CATALOG_V3_FIXTURE)).toEqual(CATALOG_V3_FIXTURE);
  });
  it('re-dates every v3 date, keeping the catalog valid', () => {
    const moved = redateCatalog(CATALOG_V3_FIXTURE, '2027-01-11');
    expect(catalogV3Schema.safeParse(moved).success).toBe(true);
    expect(moved.cards.find((c) => c.id === 'test-rotating')?.rules[2].limitedTime).toEqual({
      startsOn: '2027-04-12',
      endsOn: '2027-07-10',
    });
    expect(moved.programs[1].valuation).toMatchObject({ retrievedOn: '2027-01-10' });
  });
  it('compares a v3 catalog with the v3 engine (Stage 2 M2)', () => {
    expect(
      compareRewards(
        CATALOG_V3_FIXTURE,
        { cards: [{ cardId: 'test-points-card', usage: [] }], defaultCardId: null },
        {
          merchantId: 'best-buy-us',
          currency: 'USD',
          amountCents: 10000,
          purchasedOn: '2026-10-02',
          onlineRetail: 'eligible',
          eligiblePurchase: 'eligible',
        },
        Date.parse('2026-10-02T15:00:00Z'),
      ),
    ).toMatchObject({ status: 'ready', preferredCardId: 'test-points-card', notAccepted: [] });
  });
  it('keeps unknown annual usage separate from confirmed activation', () => {
    const catalog = structuredClone(PILOT_CATALOG);
    catalog.cards[1].rules[1].requiresActivation = true;
    const result = compareRewards(
      catalog,
      {
        cards: [
          {
            cardId: 'amex-blue-cash-everyday',
            usage: [
              {
                ruleId: 'bce-online-retail',
                recordedOn: '2026-09-25',
                calendarYear: 2026,
                spentCents: null,
                activation: 'active',
              },
            ],
          },
        ],
        defaultCardId: null,
      },
      {
        merchantId: 'best-buy-us',
        currency: 'USD',
        amountCents: 10000,
        purchasedOn: '2026-09-25',
        onlineRetail: 'eligible',
        eligiblePurchase: 'eligible',
      },
      Date.parse('2026-09-25T15:00:00Z'),
    );
    expect(result).toMatchObject({
      estimates: [{ minRewardCents: 100, maxRewardCents: 300, uncertainties: ['annual-usage-unknown'] }],
    });
  });
});
