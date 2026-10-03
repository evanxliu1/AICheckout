// All-time savings: what a recorded order earned on the card the shopper says they used, compared
// with their default card, both estimated by the same engine as the badge. Amounts are dollar values:
// cash back at face value, points and miles at the value in effect (estimate, issuer's or the
// shopper's own); a card whose program has no value is not counted.
import { compareRewards } from '../domain';
import type { CardEstimate, Catalog, Purchase, Wallet } from '../domain';
import type { SavingsEntry } from './contracts';
import { localDate } from './keys';

/** An owned card's estimate for this purchase, or null when it cannot be estimated. */
export function cardEstimate(
  catalog: Catalog,
  wallet: Wallet,
  purchase: Purchase,
  cardId: string,
  now: number,
): CardEstimate | null {
  if (!wallet.cards.some((owned) => owned.cardId === cardId)) return null;
  const comparison = compareRewards(catalog, wallet, purchase, now);
  if (comparison.status !== 'ready') return null;
  return comparison.estimates.find((estimate) => estimate.cardId === cardId) ?? null;
}

/** The guaranteed minimum a card earns on this purchase in cents, or null when it cannot be
 * estimated or its program has no value (its cents would read as $0, not as unknown). */
export function minimumReward(
  catalog: Catalog,
  wallet: Wallet,
  purchase: Purchase,
  cardId: string,
  now: number,
) {
  const estimate = cardEstimate(catalog, wallet, purchase, cardId, now);
  return estimate && estimate.unitValue !== null ? estimate.minRewardCents : null;
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
