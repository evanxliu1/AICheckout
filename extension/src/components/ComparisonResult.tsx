import { CATEGORY_LABELS, formatUsd } from '../domain';
import type {
  Catalog,
  CardEstimate,
  Comparison,
  Purchase,
  UnavailableComparison,
  Uncertainty,
} from '../domain';
import { merchantName } from '../checkout/merchants';

const unavailableCopy: Record<UnavailableComparison['reason'], string> = {
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
const uncertaintyCopy: Record<Uncertainty, string> = {
  'annual-usage-unknown': 'Annual online retail spend is unknown.',
  'online-category-unknown': 'Online retail eligibility is unconfirmed.',
  'activation-unknown': 'Bonus activation is unconfirmed.',
  'cap-usage-unknown': 'Spend toward the bonus limit this period is unknown.',
  'cap-unstated': 'The issuer does not state a limit for this bonus.',
  'payment-path-uncertain': 'This payment method may not earn the bonus.',
};
/** Shopper label for the bonus behind an estimate (v1: online retail; v2: the applied rule). */
function bonusLabel(catalog: Catalog, estimate: CardEstimate) {
  if (catalog.schemaVersion === 1) return 'online retail';
  const rule = catalog.cards
    .find((c) => c.id === estimate.cardId)
    ?.rules.find((r) => r.id === estimate.appliedRuleId);
  return rule ? CATEGORY_LABELS[rule.category] : 'bonus';
}
function amount(estimate: CardEstimate) {
  return estimate.minRewardCents === estimate.maxRewardCents
    ? formatUsd(estimate.minRewardCents)
    : `${formatUsd(estimate.minRewardCents)}–${formatUsd(estimate.maxRewardCents)}`;
}

export default function ComparisonResult({
  result,
  purchase,
  catalog,
  subtotalOnly = false,
  maxAgeMinutes = 15,
}: {
  result: Comparison | UnavailableComparison;
  purchase: Purchase | null;
  catalog: Catalog;
  subtotalOnly?: boolean;
  maxAgeMinutes?: number;
}) {
  if (result.status === 'unavailable')
    return (
      <p role="alert" className="error-message">
        {unavailableCopy[result.reason]}
      </p>
    );
  const preferred = catalog.cards.find((c) => c.id === result.preferredCardId)!;
  const single = result.estimates.length === 1;
  return (
    <section aria-labelledby="comparison-heading" className="surface" aria-live="polite">
      <h2 id="comparison-heading" className="text-lg font-semibold">
        {single
          ? 'Your card estimate'
          : result.rankingMayChange
            ? 'Compare the conditions'
            : result.tied
              ? 'Rewards are tied'
              : `Use ${preferred.shortName}`}
      </h2>
      <p className="supporting mt-1">
        Saved estimate for a{' '}
        {purchase ? `${formatUsd(purchase.amountCents)} ${merchantName(purchase.merchantId)}` : ''}{' '}
        {subtotalOnly ? 'subtotal' : 'purchase'}.
      </p>
      {subtotalOnly && (
        <p className="supporting mt-2">
          Subtotal only; tax and shipping are not included. Update the amount when the final charge is
          available.
        </p>
      )}
      {result.rankingMayChange && (
        <p className="text-sm mt-3">
          {preferred.shortName} has the highest lower estimate. Another card may earn more once its conditions
          are confirmed.
        </p>
      )}
      {result.tied && !result.rankingMayChange && (
        <p className="supporting mt-3">Your preferred card breaks the tie: {preferred.shortName}.</p>
      )}
      <ul className="mt-4 divide-y divide-gray-200">
        {result.estimates.map((estimate) => {
          const card = catalog.cards.find((c) => c.id === estimate.cardId)!;
          return (
            <li key={card.id} className="py-3 first:pt-0">
              <div className="flex justify-between gap-4 items-baseline">
                <h3 className="font-medium text-sm">{card.shortName}</h3>
                <span className="font-semibold text-base whitespace-nowrap tabular-nums">
                  {amount(estimate)}
                </span>
              </div>
              <p className="supporting mt-1">
                {estimate.baseRateBps / 100}% base rate
                {estimate.maxBonusSpendCents > 0
                  ? `; ${estimate.bonusRateBps! / 100}% on ${estimate.minBonusSpendCents === estimate.maxBonusSpendCents ? '' : 'up to '}${formatUsd(estimate.maxBonusSpendCents)} of eligible ${bonusLabel(catalog, estimate)} spend.`
                  : '.'}
              </p>
              {estimate.paidOnPaymentBps ? (
                <p className="supporting mt-1">
                  {`${(estimate.maxBonusSpendCents > 0 ? estimate.bonusRateBps! : estimate.baseRateBps) / 100}% if the balance is paid (${((estimate.maxBonusSpendCents > 0 ? estimate.bonusRateBps! : estimate.baseRateBps) - estimate.paidOnPaymentBps) / 100}% at purchase).`}
                </p>
              ) : null}
              {estimate.uncertainties.map((code) => (
                <p key={code} className="supporting mt-1">
                  {uncertaintyCopy[code]}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
      <p className="supporting mt-3">
        Estimates depend on issuer eligibility and merchant coding. Amounts are rounded down to a cent;
        statement rewards may differ. Offers, fees and financing are excluded.
      </p>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-primary-700 underline">Card terms and sources</summary>
        <p className="supporting mt-2">
          Sources checked{' '}
          {new Date(catalog.verifiedAt).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' })}
          . Terms expire {new Date(catalog.expiresAt).toLocaleString('en-US')}. This saved comparison expires
          within {maxAgeMinutes} minutes and only covers the inputs shown.
        </p>
        <ul className="mt-2 space-y-2">
          {catalog.sources
            .filter((s) => result.estimates.some((e) => e.sourceIds.includes(s.id)))
            .map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer" className="text-primary-700 underline">
                  {source.title}
                </a>
              </li>
            ))}
        </ul>
      </details>
    </section>
  );
}
