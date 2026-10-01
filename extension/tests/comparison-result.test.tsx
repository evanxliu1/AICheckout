import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ComparisonResult from '../src/components/ComparisonResult';
import WalletEditor from '../src/components/WalletEditor';
import { CATALOG_V2, compareRewards } from '../src/domain';
import type { Comparison, Purchase } from '../src/domain';

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

describe('wallet editor on catalog v2', () => {
  it('groups the seven cards by issuer and only asks for rule-derived limits', () => {
    render(
      <WalletEditor
        catalog={CATALOG_V2}
        wallet={{ defaultCardId: null, cards: [] }}
        busy={false}
        onSave={vi.fn(async () => {})}
      />,
    );
    expect(screen.getAllByRole('group').map((g) => g.querySelector('legend')!.textContent)).toEqual([
      'Citi',
      'Wells Fargo',
      'Capital One',
      'Chase',
      'American Express',
    ]);
    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
    fireEvent.click(screen.getByRole('checkbox', { name: 'American Express Blue Cash Preferred' }));
    expect(screen.queryByRole('heading', { name: 'Bonus limits' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'American Express Blue Cash Everyday' }));
    expect(screen.getByLabelText(/Blue Cash Everyday online retail spend in 2026/)).toBeTruthy();
    expect(screen.queryByLabelText(/bonus activation/)).toBeNull();
  });
});
