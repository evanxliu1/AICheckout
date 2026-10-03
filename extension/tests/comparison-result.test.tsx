import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ComparisonResult from '../src/components/ComparisonResult';
import { lessThanBest, rowEmphasis } from '../src/components/estimates';
import { CATALOG_V2, compareRewards } from '../src/domain';
import type { CardEstimate, Comparison, Purchase } from '../src/domain';
import { CATALOG_V3_FIXTURE } from '../../packages/rewards-core/test-cases';

const now = Date.parse('2026-09-30T15:00:00Z');
const purchase = (extra: Partial<Purchase> = {}): Purchase => ({
  merchantId: 'best-buy-us',
  currency: 'USD',
  amountCents: 10_000,
  purchasedOn: '2026-09-30',
  eligiblePurchase: 'eligible',
  onlineRetail: 'eligible',
  ...extra,
});
afterEach(cleanup);

function result(extra: Partial<Purchase> = {}) {
  const wallet = {
    defaultCardId: null,
    cards: [
      { cardId: 'citi-double-cash', usage: [] },
      {
        cardId: 'amex-blue-cash-everyday',
        usage: [
          {
            ruleId: 'bce-online-retail',
            calendarYear: 2026,
            recordedOn: '2026-09-30',
            spentCents: 597_500,
            activation: 'unknown' as const,
          },
        ],
      },
    ],
  };
  const p = purchase(extra);
  render(
    <ComparisonResult
      catalog={CATALOG_V2}
      purchase={p}
      result={compareRewards(CATALOG_V2, wallet, p, now) as Comparison}
    />,
  );
}

describe('comparison result on catalog v2', () => {
  it('shows each card’s rule in issuer wording, its conditions, the pay-later note, and rules that don’t apply', () => {
    result();
    expect(screen.getByRole('heading', { name: 'Use Double Cash' })).toBeTruthy();
    const bce = screen.getByRole('heading', { name: 'Blue Cash Everyday' }).closest('li')!;
    expect(within(bce).getByText('$1.50')).toBeTruthy();
    expect(bce.textContent).toContain(
      '3% on “U.S. online retail purchases” for $25.00 of this purchase; otherwise 1% on “all other eligible purchases”.',
    );
    expect(within(bce).getByText('U.S. merchants only')).toBeTruthy();
    expect(within(bce).getByText('Up to $6,000.00 per year, then 1%')).toBeTruthy();
    expect(within(bce).getByText('Activation is not mentioned on the issuer’s pages.')).toBeTruthy();
    fireEvent.click(within(bce).getByText('Rules that don’t apply here (2)'));
    expect(
      within(bce).getByText(/3% on “supermarkets located in the U.S.”: Not at this merchant/),
    ).toBeTruthy();
    const citi = screen.getByRole('heading', { name: 'Double Cash' }).closest('li')!;
    expect(within(citi).getByText('2% if the balance is paid (1% at purchase).')).toBeTruthy();
    expect(
      within(citi).getByText(
        /5% on “hotels, car rentals, and attractions booked through the Citi Travel® portal”: Not at this merchant/,
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole('link').every((link) => link.getAttribute('rel') === 'noopener noreferrer'),
    ).toBe(true);
  });
  it('shows the clear winner as the hero with its rate, and how much less each other card earns', () => {
    result();
    const best = screen.getByRole('heading', { name: 'Double Cash' }).closest('li')!;
    expect(best.classList.contains('estimate-row--best')).toBe(true);
    expect(best.querySelector('.estimate-amount--hero')!.textContent).toBe('$2.00 2%');
    const bce = screen.getByRole('heading', { name: 'Blue Cash Everyday' }).closest('li')!;
    expect(bce.classList.contains('estimate-row--best')).toBe(false);
    expect(within(bce).getByText('$0.50 less')).toBeTruthy();
    expect(document.querySelectorAll('.estimate-row--best')).toHaveLength(1);
  });
  it('shows no hero and no differences when the ranking may change', () => {
    const wallet = {
      defaultCardId: null,
      cards: [
        { cardId: 'citi-double-cash', usage: [] },
        { cardId: 'amex-blue-cash-everyday', usage: [] },
      ],
    };
    const comparison = compareRewards(CATALOG_V2, wallet, purchase(), now) as Comparison;
    expect(comparison.rankingMayChange).toBe(true);
    render(<ComparisonResult catalog={CATALOG_V2} purchase={purchase()} result={comparison} />);
    expect(screen.getByRole('heading', { name: 'Compare the conditions' })).toBeTruthy();
    expect(document.querySelector('.estimate-row--best')).toBeNull();
    expect(screen.queryByText(/ less$/)).toBeNull();
  });
  it('says "up to" on the hero rate when a single card’s estimate is a range', () => {
    const wallet = { defaultCardId: null, cards: [{ cardId: 'amex-blue-cash-everyday', usage: [] }] };
    const comparison = compareRewards(CATALOG_V2, wallet, purchase(), now) as Comparison;
    render(<ComparisonResult catalog={CATALOG_V2} purchase={purchase()} result={comparison} />);
    const hero = document.querySelector('.estimate-amount--hero')!;
    expect(hero.classList.contains('estimate-amount--range')).toBe(true);
    expect(hero.textContent).toBe('$1.00–$3.00 up to 3%');
  });
  it('marks BCE online retail as not eligible with buy now, pay later', () => {
    result({ paymentPath: 'bnpl' });
    const bce = screen.getByRole('heading', { name: 'Blue Cash Everyday' }).closest('li')!;
    expect(within(bce).getByText('$1.00')).toBeTruthy();
    expect(bce.textContent).toContain('Not eligible for this purchase');
  });
  it('shows unavailable results as an alert', () => {
    render(
      <ComparisonResult
        catalog={CATALOG_V2}
        purchase={null}
        result={{ status: 'unavailable', reason: 'catalog-expired' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/These card terms have expired/);
  });
});

describe('catalog v3 results', () => {
  it('shows units for an unvalued card and where a store card works', () => {
    const at = Date.parse('2026-10-02T15:00:00Z');
    const comparison = compareRewards(
      CATALOG_V3_FIXTURE,
      {
        defaultCardId: null,
        cards: [
          { cardId: 'test-auto-top', usage: [] },
          { cardId: 'test-amazon-store', usage: [] },
          { cardId: 'test-cash-plus', usage: [] },
        ],
      },
      { ...purchase(), purchasedOn: '2026-10-02' },
      at,
    );
    if (comparison.status !== 'ready') throw new Error('not ready');
    render(<ComparisonResult result={comparison} purchase={purchase()} catalog={CATALOG_V3_FIXTURE} />);
    const auto = comparison.estimates.find((e) => e.cardId === 'test-auto-top')!;
    expect(auto.unitValue).toBeNull();
    const row = screen.getByRole('heading', { name: 'Auto Top' }).closest('li')!;
    expect(
      within(row).getByText(
        `${auto.minRewardUnits!.toLocaleString('en-US')}–${auto.maxRewardUnits!.toLocaleString('en-US')} miles`,
      ),
    ).toBeTruthy();
    expect(row.textContent).toContain('Test Airline Miles has no published value');
    expect(screen.getByText('Amazon Store works only at Amazon, so it is not compared here.')).toBeTruthy();
    expect(screen.getAllByText(/Rules that don’t apply here/).length).toBeGreaterThan(0);
  });
});

describe('lessThanBest', () => {
  const est = (min: number, max = min) => ({ minRewardCents: min, maxRewardCents: max }) as CardEstimate;
  it('is the gap between two exact amounts', () => {
    expect(lessThanBest(est(300), est(200))).toBe(100);
  });
  it('is undefined for ranges, ties and a row that earns as much', () => {
    expect(lessThanBest(est(100, 300), est(50))).toBeUndefined();
    expect(lessThanBest(est(300), est(100, 200))).toBeUndefined();
    expect(lessThanBest(est(200), est(200))).toBeUndefined();
  });
});

describe('rowEmphasis', () => {
  const est = (min: number, max = min) => ({ minRewardCents: min, maxRewardCents: max }) as CardEstimate;
  const cmp = (extra: Partial<Comparison>) =>
    ({ estimates: [est(300), est(200)], tied: false, rankingMayChange: false, ...extra }) as Comparison;
  it('marks the first row of a clear result as best and the rest with their difference', () => {
    expect(rowEmphasis(cmp({}), 0)).toEqual({ best: true });
    expect(rowEmphasis(cmp({}), 1)).toEqual({ best: false, deltaCents: 100 });
  });
  it('emphasizes nothing when tied or when the ranking may change', () => {
    for (const extra of [{ tied: true }, { rankingMayChange: true }]) {
      expect(rowEmphasis(cmp(extra), 0)).toEqual({ best: false });
      expect(rowEmphasis(cmp(extra), 1)).toEqual({ best: false });
    }
  });
});
