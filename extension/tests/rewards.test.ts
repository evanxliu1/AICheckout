import { describe, expect, it } from 'vitest';
import { compareRewards, formatUsd, parseUsd, PILOT_CATALOG, rewardCents } from '../../packages/rewards-core/src';
import type { Catalog, Comparison, Purchase, Wallet } from '../../packages/rewards-core/src';

const now = Date.parse('2026-09-25T15:00:00Z');
const purchase: Purchase = {
  merchantId: 'best-buy-us', currency: 'USD', amountCents: 10_000,
  purchasedOn: '2026-09-25', eligiblePurchase: 'eligible', onlineRetail: 'eligible',
};
function wallet(spentCents?: number, calendarYear = 2026): Wallet {
  return {
    defaultCardId: 'capital-one-quicksilver',
    cards: [
      { cardId: 'capital-one-quicksilver', usage: [] },
      { cardId: 'amex-blue-cash-everyday', usage: spentCents === undefined ? [] : [{
        ruleId: 'bce-online-retail', spentCents, calendarYear, recordedOn: '2026-09-25', activation: 'unknown',
      }] },
    ],
  };
}
function result(w = wallet(0), p = purchase, c = PILOT_CATALOG): Comparison {
  const comparison = compareRewards(c, w, p, now);
  expect(comparison.status).toBe('ready');
  if (comparison.status !== 'ready') throw new Error(comparison.reason);
  return comparison;
}
function bce(comparison: Comparison) { return comparison.estimates.find(e => e.cardId === 'amex-blue-cash-everyday')!; }

describe('reward calculations', () => {
  it('compares only owned products and ranks a confirmed $100 bonus purchase', () => {
    const comparison = result();
    expect(comparison.preferredCardId).toBe('amex-blue-cash-everyday');
    expect(comparison.estimates.map(e => e.minRewardCents)).toEqual([300, 150]);
    expect(comparison.rankingMayChange).toBe(false);
    const single = wallet(0); single.cards.splice(1);
    expect(result(single).estimates).toHaveLength(1);
  });
  it('splits a purchase at the annual limit instead of granting the full bonus', () => {
    // $20 remaining: $20 × 3% + $80 × 1% = $1.40, below Quicksilver's $1.50.
    const comparison = result(wallet(598_000));
    expect(comparison.preferredCardId).toBe('capital-one-quicksilver');
    expect(bce(comparison)).toMatchObject({ minRewardCents: 140, maxRewardCents: 140, minBonusSpendCents: 2_000 });
  });
  it('uses the base rate when the cap is exhausted or exceeded', () => {
    for (const spent of [600_000, 800_000]) {
      expect(bce(result(wallet(spent)))).toMatchObject({ minRewardCents: 100, maxRewardCents: 100, uncertainties: [] });
    }
  });
  it('does not assume an unused allowance when usage is unknown', () => {
    const comparison = result(wallet());
    expect(comparison.preferredCardId).toBe('capital-one-quicksilver');
    expect(comparison.rankingMayChange).toBe(true);
    expect(bce(comparison)).toMatchObject({ minRewardCents: 100, maxRewardCents: 300, uncertainties: ['annual-usage-unknown'] });
  });
  it('treats previous and future year usage as unknown', () => {
    for (const year of [2025, 2027]) expect(bce(result(wallet(600_000, year))).maxRewardCents).toBe(300);
  });
  it('treats yesterday’s usage as unknown rather than reusing an old allowance', () => {
    const w = wallet(0); w.cards[1].usage[0].recordedOn = '2026-09-24';
    expect(bce(result(w)).minRewardCents).toBe(100);
  });
  it('never infers merchant category from the domain', () => {
    expect(bce(result(wallet(0), { ...purchase, onlineRetail: 'unknown' }))).toMatchObject({
      minRewardCents: 100, maxRewardCents: 300, uncertainties: ['online-category-unknown'],
    });
    expect(bce(result(wallet(), { ...purchase, onlineRetail: 'ineligible' }))).toMatchObject({
      minRewardCents: 100, maxRewardCents: 100, uncertainties: [],
    });
  });
  it('uses the chosen default only to break a monetary tie', () => {
    // $25 left at 3% plus $75 at 1% yields $1.50.
    const w = wallet(597_500);
    expect(result(w)).toMatchObject({ preferredCardId: 'capital-one-quicksilver', tied: true });
    w.defaultCardId = 'amex-blue-cash-everyday';
    expect(result(w)).toMatchObject({ preferredCardId: 'amex-blue-cash-everyday', tied: true });
    expect(result({ ...wallet(0), defaultCardId: 'capital-one-quicksilver' }).preferredCardId).toBe('amex-blue-cash-everyday');
  });
  it('bounds activation uncertainty and respects inactive status in a synthetic rule', () => {
    const catalog: Catalog = structuredClone(PILOT_CATALOG);
    catalog.cards[1].rules[1].requiresActivation = true;
    const w = wallet(0);
    expect(bce(result(w, purchase, catalog)).uncertainties).toEqual(['activation-unknown']);
    w.cards[1].usage[0].activation = 'inactive';
    expect(bce(result(w, purchase, catalog)).maxRewardCents).toBe(100);
    w.cards[1].usage[0].activation = 'active';
    expect(bce(result(w, purchase, catalog)).minRewardCents).toBe(300);
  });
  it('truncates once after summing exact fractional rewards', () => {
    expect(rewardCents(199, 100, 99, 300)).toBe(3); // 1.99 + 1.98 cents -> 3 cents.
    expect(rewardCents(1, 150)).toBe(0);
    expect(rewardCents(10_000_000, 150)).toBe(150_000);
  });
  it('keeps estimates within bounds across amounts and annual balances', () => {
    for (const amountCents of [1, 33, 99, 100, 1_999, 500_000, 10_000_000]) {
      let previous = Infinity;
      for (const spent of [0, 500_000, 599_999, 600_000, 800_000]) {
        const estimate = bce(result(wallet(spent), { ...purchase, amountCents }));
        expect(estimate.minRewardCents).toBeLessThanOrEqual(previous);
        expect(estimate.minRewardCents).toBeGreaterThanOrEqual(rewardCents(amountCents, 100));
        expect(estimate.maxRewardCents).toBeLessThanOrEqual(rewardCents(amountCents, 300));
        previous = estimate.minRewardCents;
      }
    }
  });
});

describe('fail closed', () => {
  it.each([
    ['catalog-expired', Date.parse(PILOT_CATALOG.expiresAt)],
    ['catalog-not-yet-valid', Date.parse(PILOT_CATALOG.verifiedAt) - 1],
  ])('blocks %s snapshots', (reason, time) => {
    expect(compareRewards(PILOT_CATALOG, wallet(), purchase, time as number)).toEqual({ status: 'unavailable', reason });
  });
  it.each([
    [{ ...purchase, merchantId: 'unknown-shop' }, 'unsupported-merchant'],
    [{ ...purchase, eligiblePurchase: 'unknown' }, 'purchase-not-confirmed'],
    [{ ...purchase, eligiblePurchase: 'ineligible' }, 'ineligible-purchase'],
  ])('blocks unsupported or unconfirmed purchases', (p, reason) => {
    expect(compareRewards(PILOT_CATALOG, wallet(), p as Purchase, now)).toEqual({ status: 'unavailable', reason });
  });
  it('handles empty and retired wallets without silently omitting cards', () => {
    expect(compareRewards(PILOT_CATALOG, { cards: [], defaultCardId: null }, purchase, now)).toMatchObject({ reason: 'no-owned-cards' });
    expect(compareRewards(PILOT_CATALOG, { cards: [{ cardId: 'removed', usage: [] }], defaultCardId: null }, purchase, now)).toMatchObject({ reason: 'unknown-owned-card' });
  });
  it.each([-1, 0, NaN, Infinity, 0.1, 10_000_001, Number.MAX_SAFE_INTEGER])('rejects invalid cents %s', amountCents => {
    expect(() => result(wallet(), { ...purchase, amountCents })).toThrow('Invalid comparison input');
  });
  it('rejects invalid dates, unsupported currency, and duplicate cards', () => {
    expect(() => result(wallet(), { ...purchase, purchasedOn: '2026-02-30' })).toThrow();
    expect(() => result(wallet(), { ...purchase, currency: 'CAD' as 'USD' })).toThrow();
    const w = wallet(); w.cards.push(w.cards[0]);
    expect(() => result(w)).toThrow();
  });
  it('rejects stacked rules and absent sources rather than guessing', () => {
    const catalog = structuredClone(PILOT_CATALOG);
    catalog.cards[1].rules.push({ ...catalog.cards[1].rules[1], id: 'another-bonus' });
    expect(() => result(wallet(), purchase, catalog)).toThrow();
    catalog.cards[1].rules.pop(); catalog.sources = [];
    expect(() => result(wallet(), purchase, catalog)).toThrow();
  });
});

describe('USD input', () => {
  it.each([['0', 0], ['$1,299.99', 129_999], ['10.5', 1050], ['100000.00', 10_000_000]])('parses %s into cents', (input, cents) => {
    expect(parseUsd(input as string)).toBe(cents);
  });
  it.each(['', '-1', '1e3', '1.005', '1,00', '01.00', '€20', 'NaN', '100000.01', '1 000', '.5'])('rejects ambiguous %s', input => {
    expect(parseUsd(input)).toBeNull();
  });
  it('formats cents', () => { expect(formatUsd(129_999)).toBe('$1,299.99'); });
});
