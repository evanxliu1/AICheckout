import { MAX_AMOUNT_CENTS } from './money.ts';
import type { CardEstimate, Comparison, Purchase, UnavailableComparison, Wallet } from './types.ts';

export function integer(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function unique(values: string[]) {
  return new Set(values).size === values.length;
}

/** Checks shared by both catalog versions for the purchase and wallet inputs. */
export function validatePurchaseAndWallet(wallet: Wallet, purchase: Purchase, now: number) {
  const eligible = ['eligible', 'ineligible', 'unknown'];
  const date = Date.parse(`${purchase.purchasedOn}T12:00:00Z`);
  if (
    !Number.isFinite(now) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(purchase.purchasedOn) ||
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== purchase.purchasedOn ||
    purchase.currency !== 'USD' ||
    !integer(purchase.amountCents, 1, MAX_AMOUNT_CENTS) ||
    !eligible.includes(purchase.eligiblePurchase) ||
    !eligible.includes(purchase.onlineRetail) ||
    !unique(wallet.cards.map((c) => c.cardId)) ||
    (wallet.defaultCardId !== null && !wallet.cards.some((c) => c.cardId === wallet.defaultCardId))
  ) {
    throw new Error('Invalid comparison input.');
  }
  for (const card of wallet.cards) {
    if (
      !unique(card.usage.map((u) => u.ruleId)) ||
      card.usage.some(
        (u) =>
          (u.spentCents !== null && !integer(u.spentCents, 0, MAX_AMOUNT_CENTS)) ||
          !integer(u.calendarYear, 2000, 9999) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(u.recordedOn) ||
          !['active', 'inactive', 'unknown'].includes(u.activation),
      )
    ) {
      throw new Error('Invalid wallet usage.');
    }
  }
}

/** Unavailable reasons shared by both versions, in the order they are reported. */
export function unavailableReason(
  catalog: { verifiedAt: string; expiresAt: string; cards: { id: string }[] },
  merchantIds: string[],
  wallet: Wallet,
  purchase: Purchase,
  now: number,
): UnavailableComparison | null {
  const reason = (value: UnavailableComparison['reason']): UnavailableComparison => ({
    status: 'unavailable',
    reason: value,
  });
  if (now < Date.parse(catalog.verifiedAt)) return reason('catalog-not-yet-valid');
  if (now >= Date.parse(catalog.expiresAt)) return reason('catalog-expired');
  if (!merchantIds.includes(purchase.merchantId)) return reason('unsupported-merchant');
  if (wallet.cards.length === 0) return reason('no-owned-cards');
  if (wallet.cards.some((c) => !catalog.cards.some((p) => p.id === c.cardId)))
    return reason('unknown-owned-card');
  if (purchase.eligiblePurchase === 'unknown') return reason('purchase-not-confirmed');
  if (purchase.eligiblePurchase === 'ineligible') return reason('ineligible-purchase');
  return null;
}

/** Orders by guaranteed minimum, then the default card, then id; flags possible rank changes. */
export function rankEstimates(estimates: CardEstimate[], wallet: Wallet, catalogVersion: string): Comparison {
  estimates.sort(
    (a, b) =>
      b.minRewardCents - a.minRewardCents ||
      Number(b.cardId === wallet.defaultCardId) - Number(a.cardId === wallet.defaultCardId) ||
      a.cardId.localeCompare(b.cardId, 'en'),
  );
  const first = estimates[0];
  return {
    status: 'ready',
    catalogVersion,
    estimates,
    preferredCardId: first.cardId,
    rankingMayChange: estimates.slice(1).some((e) => e.maxRewardCents > first.minRewardCents),
    tied: estimates.slice(1).some((e) => e.minRewardCents === first.minRewardCents),
  };
}
