import { formatUsd } from '../domain';
import type { CardEstimate, UnavailableComparison } from '../domain';

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
