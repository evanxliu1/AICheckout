import { describe, expect, it } from 'vitest';
import { catalogSchema, compareRewards, PILOT_CATALOG } from '../src/domain';
import { catalogCases } from '../../packages/rewards-core/test-cases';

describe('shared catalog schema', () => {
  it.each(catalogCases)('$name has the intended validity', ({ input, valid }) => {
    expect(catalogSchema.safeParse(input).success).toBe(valid);
  });
  it('keeps unknown annual usage separate from confirmed activation', () => {
    const catalog = structuredClone(PILOT_CATALOG);
    catalog.cards[1].rules[1].requiresActivation = true;
    const result = compareRewards(catalog, { cards: [{ cardId: 'amex-blue-cash-everyday', usage: [{
      ruleId: 'bce-online-retail', recordedOn: '2026-09-25', calendarYear: 2026, spentCents: null, activation: 'active',
    }] }], defaultCardId: null }, { merchantId: 'best-buy-us', currency: 'USD', amountCents: 10000,
      purchasedOn: '2026-09-25', onlineRetail: 'eligible', eligiblePurchase: 'eligible' }, Date.parse('2026-09-25T15:00:00Z'));
    expect(result).toMatchObject({ estimates: [{ minRewardCents: 100, maxRewardCents: 300, uncertainties: ['annual-usage-unknown'] }] });
  });
});
