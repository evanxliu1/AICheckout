// All-time savings: what a recorded order earned on the card the shopper says they used, compared
// with their default card, both estimated by the same engine as the badge.
import { compareRewards } from '../domain';
import type { Catalog, Purchase, Wallet } from '../domain';
import type { SavingsEntry } from './contracts';
import { localDate } from './service';

/** The guaranteed minimum a card earns on this purchase, or null when it cannot be estimated. */
export function minimumReward(
  catalog: Catalog,
  wallet: Wallet,
  purchase: Purchase,
  cardId: string,
  now: number,
) {
  if (!wallet.cards.some((owned) => owned.cardId === cardId)) return null;
  const comparison = compareRewards(catalog, wallet, purchase, now);
  if (comparison.status !== 'ready') return null;
  return comparison.estimates.find((estimate) => estimate.cardId === cardId)?.minRewardCents ?? null;
}

/**
 * The record for one answered order prompt. `usedCardId` null means "Not sure": the order is kept
 * in the history but adds nothing to the total. With no default card there is no baseline, so the
 * extra amount is unknown rather than counted against nothing.
 */
export function savingsEntry({
  catalog,
  wallet,
  purchase,
  recommendedCardId,
  usedCardId,
  now,
  id = crypto.randomUUID(),
}: {
  catalog: Catalog;
  wallet: Wallet;
  purchase: Purchase;
  recommendedCardId: string;
  usedCardId: string | null;
  now: number;
  id?: string;
}): SavingsEntry {
  const estimated = usedCardId ? minimumReward(catalog, wallet, purchase, usedCardId, now) : null;
  const baseline = wallet.defaultCardId
    ? minimumReward(catalog, wallet, purchase, wallet.defaultCardId, now)
    : null;
  return {
    id,
    date: localDate(now),
    recordedAt: now,
    merchantId: purchase.merchantId,
    cartAmountCents: purchase.amountCents,
    recommendedCardId,
    usedCardId,
    estimatedRewardCents: estimated,
    baselineRewardCents: baseline,
    extraCents: estimated !== null && baseline !== null ? estimated - baseline : null,
  };
}

/** Sum of the known extra amounts (negative when a lower-earning card was used). */
export function totalExtraCents(entries: readonly SavingsEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.extraCents ?? 0), 0);
}
