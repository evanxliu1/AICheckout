import { formatUsd } from '../domain';
import type { CardEstimate, Comparison, UnavailableComparison } from '../domain';

export const unavailableCopy: Record<UnavailableComparison['reason'], string> = {
  'catalog-expired':
    'These card terms have expired. Check for updated terms or an extension update before comparing again.',
  'catalog-not-yet-valid': 'These card terms are not yet valid. Check your device’s date.',
  'unsupported-merchant':
    'These card terms do not cover this merchant. Check for updated terms or an extension update.',
  'no-owned-cards': 'Add a card you own before comparing rewards.',
  'unknown-owned-card': 'A saved card is missing from this catalog. Review your cards before comparing.',
  'purchase-not-confirmed': 'Confirm that the amount covers eligible purchases before comparing.',
  'ineligible-purchase': 'This purchase is not eligible for these reward estimates.',
};

/** "$3.00", or "$1.00–$3.00" when conditions are unknown. */
export function amount(estimate: CardEstimate) {
  return estimate.minRewardCents === estimate.maxRewardCents
    ? formatUsd(estimate.minRewardCents)
    : `${formatUsd(estimate.minRewardCents)}–${formatUsd(estimate.maxRewardCents)}`;
}

/** How much less `row` earns than `best`, only when both amounts are exact. */
export function lessThanBest(best: CardEstimate, row: CardEstimate): number | undefined {
  if (best.minRewardCents !== best.maxRewardCents || row.minRewardCents !== row.maxRewardCents)
    return undefined;
  const less = best.minRewardCents - row.minRewardCents;
  return less > 0 ? less : undefined;
}

/** How row `index` of a ranked comparison is shown: the clear winner (not tied, ranking stable)
 * as the hero, every other row with how much less it earns when both amounts are exact. */
export function rowEmphasis(result: Comparison, index: number): { best: boolean; deltaCents?: number } {
  const clearWinner = !result.tied && !result.rankingMayChange;
  if (!clearWinner) return { best: false };
  if (index === 0) return { best: true };
  return { best: false, deltaCents: lessThanBest(result.estimates[0]!, result.estimates[index]!) };
}
