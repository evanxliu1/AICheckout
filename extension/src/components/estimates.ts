import { formatUsd } from '../domain';
import type { Catalog, CardEstimate, UnavailableComparison } from '../domain';

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
  'no-accepted-card': 'None of your cards is accepted at this store.',
};

/** "$3.00", or "$1.00–$3.00" when conditions are unknown. */
export function amount(estimate: CardEstimate) {
  return estimate.minRewardCents === estimate.maxRewardCents
    ? formatUsd(estimate.minRewardCents)
    : `${formatUsd(estimate.minRewardCents)}–${formatUsd(estimate.maxRewardCents)}`;
}

/** The amount shown for an estimate: cents, or for a catalog v3 card whose program has no value,
 * its reward units ("1,000–3,000 miles"). Plain rendering until Stage 2 M7 words the v3 results. */
export function rewardText(estimate: CardEstimate, catalog: Catalog) {
  if (estimate.unitValue !== null || estimate.minRewardUnits === undefined) return amount(estimate);
  const min = estimate.minRewardUnits,
    max = estimate.maxRewardUnits ?? min;
  const unit =
    (catalog.schemaVersion === 3 && catalog.programs.find((p) => p.id === estimate.programId)?.unitName) ||
    'points';
  const count = (n: number) => n.toLocaleString('en-US');
  return `${min === max ? count(min) : `${count(min)}–${count(max)}`} ${unit}`;
}

/** Owned closed-loop cards left out of a v3 ranking because this merchant does not accept them. */
export function notAcceptedNames(result: { notAccepted?: CardEstimate[] }, catalog: Catalog) {
  return (result.notAccepted ?? []).map(
    (e) => catalog.cards.find((c) => c.id === e.cardId)?.shortName ?? e.cardId,
  );
}
