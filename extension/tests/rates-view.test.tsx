import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { compareRewards, CATALOG_V3, redateCatalog } from '../src/domain';
import type { Comparison, Wallet } from '../src/domain';
import { RATES_REFERENCE_CENTS } from '../src/badge/contracts';
import { rateWording, ratesCapped } from '../src/components/estimates';
import RatesResult, { RATES_CAP_NOTE } from '../src/components/RatesResult';

// The rates view (Phase 13c): the engine compares at $100, below every cap, so each estimate's cents are
// the card's rate in basis points, and the wording is the engine's own (percent, units per $1, ranges).
const catalog = redateCatalog(CATALOG_V3, '2026-10-01');
const now = Date.parse('2026-10-01T15:00:00Z');
const purchase = {
  merchantId: 'generic-us-online',
  currency: 'USD' as const,
  amountCents: RATES_REFERENCE_CENTS,
  purchasedOn: '2026-10-01',
  eligiblePurchase: 'eligible' as const,
  onlineRetail: 'eligible' as const,
  paymentPath: 'card' as const,
};
const rank = (wallet: Wallet) => compareRewards(catalog, wallet, purchase, now) as Comparison;
const estimate = (result: Comparison, cardId: string) => result.estimates.find((e) => e.cardId === cardId)!;

describe('rates view wording', () => {
  it('words cash back as a percent, valued points per $1 with their percent, and a range where a cap is unknown', () => {
    const result = rank({
      defaultCardId: 'citi-double-cash',
      cards: [
        { cardId: 'citi-double-cash', usage: [] },
        { cardId: 'capital-one-venture', usage: [] },
        { cardId: 'amex-blue-cash-everyday', usage: [] },
      ],
    });
    expect(result.status).toBe('ready');
    expect(rateWording(estimate(result, 'citi-double-cash'), catalog)).toBe('2% back');
    expect(rateWording(estimate(result, 'capital-one-venture'), catalog)).toBe('2 miles per $1 (est. 2%)');
    // Online-retail spend toward the $6,000 cap unknown: the base 1% is sure, 3% possible.
    expect(rateWording(estimate(result, 'amex-blue-cash-everyday'), catalog)).toBe('1%–3% back');
    expect(ratesCapped(result, catalog)).toBe(true);
  });
  it('shows a sure capped rate and the cap note, ranks it first, and never asks for an amount', () => {
    const result = rank({
      defaultCardId: 'citi-double-cash',
      cards: [
        { cardId: 'citi-double-cash', usage: [] },
        {
          cardId: 'amex-blue-cash-everyday',
          usage: [
            {
              ruleId: 'bce-online-retail-v2',
              calendarYear: 2026,
              recordedOn: '2026-10-01',
              spentCents: 0,
              activation: 'unknown',
            },
          ],
        },
      ],
    });
    expect(result.preferredCardId).toBe('amex-blue-cash-everyday');
    expect(rateWording(estimate(result, 'amex-blue-cash-everyday'), catalog)).toBe('3% back');
    render(<RatesResult catalog={catalog} result={result} merchantId="generic-us-online" headingId="h" />);
    try {
      expect(screen.getByText(/The cart amount wasn’t read on this page/)).toBeTruthy();
      expect(screen.getByText(RATES_CAP_NOTE)).toBeTruthy();
      const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
      expect(rows).toEqual(['Blue Cash Everyday3% back', 'Double Cash2% back']);
      expect(document.body.textContent).not.toMatch(/enter the amount/i);
      expect(document.querySelector('input')).toBeNull();
    } finally {
      cleanup();
    }
  });
});
