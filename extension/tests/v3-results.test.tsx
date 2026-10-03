import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ComparisonResult from '../src/components/ComparisonResult';
import {
  amount,
  basisLabel,
  centsEach,
  pillReward,
  rankingNote,
  rateText,
  rewardText,
  unavailableCopy,
} from '../src/components/estimates';
import { CATALOG_V3 as BUNDLED_V3, compareRewards } from '../src/domain';
import type { CardEstimate, CatalogV3, Comparison, Purchase, Wallet } from '../src/domain';
import { CATALOG_V3_FIXTURE } from '../../packages/rewards-core/test-cases';

/* Catalog v3 wording (Stage 2 M7) on the synthetic fixture: units with cash value and its basis,
 * store rewards, unvalued programs, store-card ranges and the v3 statuses and uncertainties. */
afterEach(cleanup);
const at = Date.parse('2026-10-15T15:00:00Z');
const purchase = (extra: Partial<Purchase> = {}): Purchase => ({
  merchantId: 'best-buy-us',
  currency: 'USD',
  amountCents: 10_000,
  purchasedOn: '2026-10-15',
  eligiblePurchase: 'eligible',
  onlineRetail: 'eligible',
  ...extra,
});
function compare(
  cards: string[],
  extra: Partial<Purchase> = {},
  wallet: Partial<Wallet> = {},
  catalog: CatalogV3 = CATALOG_V3_FIXTURE,
) {
  const p = purchase(extra);
  const result = compareRewards(
    catalog,
    { defaultCardId: null, cards: cards.map((cardId) => ({ cardId, usage: [] })), ...wallet },
    p,
    at,
  );
  return { result, p };
}
function show(cards: string[], extra: Partial<Purchase> = {}, wallet: Partial<Wallet> = {}) {
  const { result, p } = compare(cards, extra, wallet);
  if (result.status !== 'ready') throw new Error(`unavailable: ${result.reason}`);
  render(<ComparisonResult result={result} purchase={p} catalog={CATALOG_V3_FIXTURE} />);
  return result;
}
const row = (name: string) => screen.getByRole('heading', { name }).closest('li')!;

describe('catalog v3 amounts and value basis', () => {
  it('shows points in dollars with units, the per-unit value and the estimate’s publisher', () => {
    show(['test-points-card']);
    const points = row('Points');
    // Best Buy: online retail 3 points per $1 on $100 = 300 points at 1.2¢.
    expect(within(points).getByText('$3.60')).toBeTruthy();
    expect(within(points).getByText('Estimate')).toBeTruthy();
    expect(points.textContent).toContain('300 points at 1.2¢ each.');
    expect(points.textContent).toContain(
      'Value estimated by Example Valuations (read Oct 1, 2026); what you get depends on how you redeem.',
    );
    expect(points.textContent).toContain('3 points per $1 on “');
    expect(points.textContent).toContain('otherwise 1 point per $1 on “');
  });
  it('labels issuer-stated values and the shopper’s own value', () => {
    show(['test-store-mastercard']);
    expect(within(row('Store Mastercard')).getByText('Issuer-stated')).toBeTruthy();
    expect(row('Store Mastercard').textContent).toContain('Value stated by the issuer.');
    cleanup();
    show(
      ['test-points-card'],
      {},
      { valueOverrides: [{ programId: 'test-membership-points', valueHundredthsOfCent: 200 }] },
    );
    expect(within(row('Points')).getByText('Your value')).toBeTruthy();
    expect(within(row('Points')).getByText('$6.00')).toBeTruthy();
    expect(row('Points').textContent).toContain('300 points at 2¢ each.');
  });
  it('shows an unvalued program in units and says how to set a value', () => {
    const result = show(['test-auto-top', 'test-paypal-cashback']);
    const auto = row('Auto Top');
    expect(within(auto).getByText('100–300 miles')).toBeTruthy();
    expect(auto.textContent).toContain(
      'Test Airline Miles has no published value, so this card is listed after cards with one.',
    );
    expect(auto.textContent).toContain(
      'Earns more only if Electronics stores is your top spending category, which the issuer works out from your spending',
    );
    expect(result.rankingMayChange).toBe(true);
    expect(screen.getByText(/Cards whose points have no value are listed last/)).toBeTruthy();
  });
  it('words a store card that earns only with a condition as “up to”, with nothing guaranteed', () => {
    show(['test-amazon-store', 'test-prime-visa'], { merchantId: 'amazon-us' });
    const store = row('Amazon Store');
    expect(within(store).getByText('Up to $5.00')).toBeTruthy();
    expect(store.textContent).toContain(
      'Nothing is guaranteed: this card earns here only if the conditions below are met.',
    );
    expect(store.textContent).toContain('5% on “');
    expect(store.textContent).toContain('nothing on other purchases.');
    expect(store.textContent).toContain(
      'Depends on your answer to “Do you have an eligible Amazon Prime membership?” You can answer it under Edit cards in AI Checkout.',
    );
    expect(
      screen.getByText(
        /Prime Visa is first because its guaranteed estimate is the highest\. Another card could earn more/,
      ),
    ).toBeTruthy();
  });
  it('names the chosen category a range depends on, and why other rules don’t apply', () => {
    show(['test-cash-plus']);
    const plus = row('Cash Plus');
    expect(plus.textContent).toContain(
      'Earns more only if Electronics stores is one of your chosen categories (Two 5% categories, chosen each quarter).',
    );
    cleanup();
    show(
      ['test-cash-plus', 'test-prime-visa', 'test-rotating'],
      { merchantId: 'amazon-us' },
      {
        gates: [{ gateId: 'amazon-prime', optionId: 'not-member' }],
      },
    );
    fireEvent.click(within(row('Prime Visa')).getByText(/Rules that don’t apply here/));
    expect(row('Prime Visa').textContent).toContain(
      'Does not match your answer to “Do you have an eligible Amazon Prime membership?”',
    );
    cleanup();
    // A chosen category the shopper did not pick.
    const p = purchase();
    const chose = compareRewards(
      CATALOG_V3_FIXTURE,
      {
        defaultCardId: null,
        cards: [
          {
            cardId: 'test-cash-plus',
            usage: [],
            choices: [{ choiceId: 'five-percent', optionIds: ['fast-food'] }],
          },
        ],
      },
      p,
      at,
    ) as Comparison;
    render(<ComparisonResult result={chose} purchase={p} catalog={CATALOG_V3_FIXTURE} />);
    fireEvent.click(within(row('Cash Plus')).getByText(/Rules that don’t apply here/));
    expect(row('Cash Plus').textContent).toContain('Not one of the categories you chose');
  });
  it('dates a rule that has not started', () => {
    // The fixture's next-quarter rule is for supermarkets; move it to electronics so Best Buy shows it.
    const catalog = structuredClone(CATALOG_V3_FIXTURE);
    const rule = catalog.cards
      .find((c) => c.id === 'test-rotating')!
      .rules.find((r) => r.id === 'rotating-q1')!;
    rule.category = 'electronics';
    const { result, p } = compare(['test-rotating'], {}, {}, catalog);
    render(<ComparisonResult result={result as Comparison} purchase={p} catalog={catalog} />);
    fireEvent.click(within(row('Rotating')).getByText(/Rules that don’t apply here/));
    expect(row('Rotating').textContent).toContain('Starts Jan 1, 2027');
  });
  it('explains when no owned card is accepted', () => {
    const { result } = compare(['test-amazon-store']);
    expect(result).toEqual({ status: 'unavailable', reason: 'no-accepted-card' });
    expect(unavailableCopy['no-accepted-card']).toMatch(/^None of your cards can be used at this store/);
  });
});

const estimate = (extra: Partial<CardEstimate>): CardEstimate => ({
  cardId: 'test-points-card',
  minRewardCents: 360,
  maxRewardCents: 360,
  baseRateBps: 100,
  bonusRateBps: null,
  minBonusSpendCents: 0,
  maxBonusSpendCents: 0,
  uncertainties: [],
  sourceIds: [],
  programId: 'test-membership-points',
  minRewardUnits: 300,
  maxRewardUnits: 300,
  unitValue: { hundredthsOfCent: 120, basis: 'published-estimate' },
  ...extra,
});

describe('result wording helpers', () => {
  it('formats amounts, units and the pill', () => {
    expect([120, 100, 66, 125].map(centsEach)).toEqual(['1.2¢', '1¢', '0.66¢', '1.25¢']);
    expect(amount({ minRewardCents: 0, maxRewardCents: 500 })).toBe('up to $5.00');
    expect(amount({ minRewardCents: 100, maxRewardCents: 500 })).toBe('$1.00–$5.00');
    expect(pillReward(estimate({}), CATALOG_V3_FIXTURE)).toBe('est. $3.60 in points');
    expect(
      pillReward(estimate({ unitValue: { hundredthsOfCent: 120, basis: 'override' } }), CATALOG_V3_FIXTURE),
    ).toBe('$3.60 in points');
    expect(
      pillReward(
        estimate({ programId: 'cash-back', unitValue: { hundredthsOfCent: 100, basis: 'cash' } }),
        CATALOG_V3_FIXTURE,
      ),
    ).toBe('$3.60 back');
    expect(
      pillReward(
        estimate({
          programId: 'test-airline-miles',
          unitValue: null,
          minRewardCents: 0,
          maxRewardCents: 0,
          minRewardUnits: 1000,
          maxRewardUnits: 3000,
        }),
        CATALOG_V3_FIXTURE,
      ),
    ).toBe('1,000–3,000 miles');
    expect(rewardText(estimate({ minRewardCents: 0, maxRewardCents: 500 }), CATALOG_V3_FIXTURE)).toBe(
      'Up to $5.00',
    );
    expect(basisLabel('card-stated')).toBe('issuer-stated');
    expect(basisLabel('cash')).toBeNull();
  });
  it('words store rewards with the program’s name', () => {
    const catalog = structuredClone(CATALOG_V3_FIXTURE);
    catalog.programs.push({
      id: 'test-store-rewards',
      name: 'Test Store Dollars',
      currency: 'cash-back',
      unitName: 'cents',
      valuation: { basis: 'cash', valueHundredthsOfCent: 100 },
      redemptionBrandIds: ['test-store'],
    });
    const store = estimate({
      programId: 'test-store-rewards',
      unitValue: { hundredthsOfCent: 100, basis: 'cash' },
    });
    expect(pillReward(store, catalog)).toBe('$3.60 in store rewards');
  });
  it('explains a ranking that may change', () => {
    expect(
      rankingNote(
        {
          preferredCardId: 'test-points-card',
          estimates: [
            estimate({}),
            estimate({ cardId: 'test-auto-top', unitValue: null, minRewardUnits: 100, maxRewardUnits: 100 }),
          ],
        },
        CATALOG_V3_FIXTURE,
      ),
    ).toBe(
      'Points is first because its guaranteed estimate is the highest. Cards whose points have no value are listed last; setting a value may move them up.',
    );
  });
});

describe('Citi Double Cash on the bundled catalog: cash back (general rule 1)', () => {
  const real = BUNDLED_V3;
  it('reads as 2% cash back with no point value, and a ThankYou value does not change it', () => {
    const { result, p } = compare(
      ['citi-double-cash'],
      {},
      { valueOverrides: [{ programId: 'citi-thankyou', valueHundredthsOfCent: 300 }] },
      real,
    );
    if (result.status !== 'ready') throw new Error(`unavailable: ${result.reason}`);
    render(<ComparisonResult result={result} purchase={p} catalog={real} />);
    const e = result.estimates[0];
    expect(e.programId).toBe('cash-back');
    expect(e.minRewardCents).toBe(200);
    expect(rateText(200, real, e)).toBe('2%');
    expect(pillReward(e, real)).toBe('$2.00 back');
    const card = row('Double Cash');
    expect(card.textContent).toContain('2% on “every purchase”.');
    expect(card.textContent).toContain('2% if the balance is paid (1% at purchase).');
    expect(card.textContent).not.toMatch(/points|Issuer-stated|ThankYou/);
  });
  it('keeps points wording for a points card the issuer values at 1¢', () => {
    const { result } = compare(['chase-sapphire-preferred'], {}, {}, real);
    if (result.status !== 'ready') throw new Error('unavailable');
    expect(result.estimates[0].unitValue?.basis).toBe('card-stated');
    expect(rateText(300, real, result.estimates[0])).toBe('3 points per $1');
  });
});

describe('ranking note', () => {
  it('says another card could earn more only when one’s best case beats the first card’s guarantee', () => {
    const first = estimate({ cardId: 'test-points-card', minRewardCents: 500, maxRewardCents: 500 });
    const lower = estimate({ cardId: 'test-cash-plus', minRewardCents: 100, maxRewardCents: 400 });
    const higher = estimate({ cardId: 'test-cash-plus', minRewardCents: 100, maxRewardCents: 600 });
    const note = (other: CardEstimate) =>
      rankingNote({ preferredCardId: 'test-points-card', estimates: [first, other] }, CATALOG_V3_FIXTURE);
    expect(note(lower)).toBe('Points is first because its guaranteed estimate is the highest.');
    expect(note(higher)).toContain('Another card could earn more if its conditions below are met.');
  });
});
