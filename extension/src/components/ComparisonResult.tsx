import { AlertInline, Badge, Card, Disclosure, Link } from '@ai-checkout/ui';
import { ACTIVATION_LABELS, CATEGORY_LABELS, formatUsd } from '../domain';
import type {
  Catalog,
  CardEstimate,
  Comparison,
  Purchase,
  RewardRuleV2,
  RuleStatusV3,
  UnavailableComparison,
  UncertaintyV3,
} from '../domain';
import { merchantName } from '../checkout/merchants';
import { amount, unavailableCopy } from './estimates';

const statusCopy: Partial<Record<RuleStatusV3, string>> = {
  'not-at-merchant': 'Not at this merchant',
  'not-eligible': 'Not eligible for this purchase',
  expired: 'Promotion ended',
  'cap-reached': 'Spend limit reached',
  // Catalog v3 statuses (shown once the extension runs v3 catalogs, Stage 2 M7).
  'not-accepted': 'Card not accepted at this merchant',
  'not-started': 'Promotion not started',
  'choice-not-selected': 'Category not selected',
  'condition-not-met': 'Condition not met',
};
const percent = (bps: number) => `${bps / 100}%`;
const money = (cents: number) => formatUsd(cents);
const periodCopy: Record<string, string> = {
  'calendar-year': 'per calendar year',
  'cardmember-year': 'per card-member year',
  'billing-cycle': 'per billing cycle',
  quarter: 'per quarter',
  month: 'per month',
  'year-unspecified': 'per year',
};

function uncertaintyCopy(code: UncertaintyV3, label: string): string {
  return {
    'annual-usage-unknown': `Your ${label} spend toward this year’s bonus limit is unknown.`,
    'cap-usage-unknown': `Your ${label} spend toward this period’s bonus limit is unknown.`,
    'online-category-unknown': 'Online retail eligibility is unconfirmed.',
    'activation-unknown': `Activation of the ${label} bonus is unconfirmed.`,
    'cap-unstated': `The issuer does not state a spend limit for the ${label} bonus.`,
    'payment-path-uncertain': `This payment method may not earn the ${label} bonus.`,
    // Catalog v3 codes (worded in Stage 2 M7).
    'choice-unknown': `Whether you chose the ${label} category is unknown.`,
    'automatic-category': `The ${label} bonus applies only if it is your top spending category.`,
    'condition-unknown': `The ${label} bonus needs a membership or status you have not confirmed.`,
    'value-unknown': 'This card’s points have no value set.',
  }[code];
}

/** One card's result: amount, the rule behind it in the issuer's words, its conditions, the rules
 * that don't apply here, and notes about uncertain inputs. */
export function EstimateRow({
  catalog,
  estimate,
  amountCents,
}: {
  catalog: Catalog;
  estimate: CardEstimate;
  amountCents: number;
}) {
  const card = catalog.cards.find((c) => c.id === estimate.cardId)!;
  const rules: RewardRuleV2[] = catalog.schemaVersion === 2 ? (card.rules as RewardRuleV2[]) : [];
  const applied = rules.find((r) => r.id === estimate.appliedRuleId);
  const base = rules.find((r) => r.category === 'all-purchases');
  // v1 catalogs have one bonus kind; name it from the card's own rule rather than assuming it.
  const v1Bonus =
    catalog.schemaVersion === 1
      ? catalog.cards.find((c) => c.id === estimate.cardId)?.rules.find((r) => r.category !== 'all-eligible')
      : undefined;
  const label = CATEGORY_LABELS[applied?.category ?? v1Bonus?.category ?? 'all-purchases'];
  // Each uncertainty names the category of the rule(s) it comes from.
  const mayApply = rules.filter((r) =>
    estimate.rules?.some((s) => s.ruleId === r.id && s.status === 'may-apply'),
  );
  const sourceOf: Record<UncertaintyV3, (r: RewardRuleV2) => boolean> = {
    'annual-usage-unknown': (r) => r.cap.kind === 'spend',
    'cap-usage-unknown': (r) => r.cap.kind === 'spend',
    'cap-unstated': (r) => r.cap.kind === 'unstated',
    'activation-unknown': (r) => r.activation === 'enroll-once' || r.activation === 'recurring',
    'online-category-unknown': (r) => r.category === 'online-retail',
    'payment-path-uncertain': () => true,
    'choice-unknown': () => true,
    'automatic-category': () => true,
    'condition-unknown': () => true,
    'value-unknown': () => true,
  };
  const labelFor = (code: UncertaintyV3) => {
    const names = [...new Set(mayApply.filter(sourceOf[code]).map((r) => CATEGORY_LABELS[r.category]))];
    return names.length ? names.join(' or ') : label;
  };
  const bonus = estimate.maxBonusSpendCents > 0 && estimate.bonusRateBps !== null;
  const rate = bonus ? estimate.bonusRateBps! : estimate.baseRateBps;
  const notApplying = (estimate.rules ?? []).filter((r) => statusCopy[r.status]);
  return (
    <li className="py-3 space-y-2">
      <div className="flex justify-between gap-4 items-baseline">
        <h3 className="section-title">{card.shortName}</h3>
        <span className="estimate-amount">{amount(estimate)}</span>
      </div>
      {applied && base ? (
        <p>
          {bonus ? (
            <>
              {percent(applied.rateBps)} on “{applied.issuerWording}”
              {(estimate.minBonusSpendCents !== estimate.maxBonusSpendCents ||
                estimate.maxBonusSpendCents < amountCents) &&
                ` for ${estimate.minBonusSpendCents === estimate.maxBonusSpendCents ? '' : 'up to '}${money(estimate.maxBonusSpendCents)} of this purchase`}
              ; otherwise {percent(base.rateBps)} on “{base.issuerWording}”.
            </>
          ) : (
            <>
              {percent(base.rateBps)} on “{base.issuerWording}”.
            </>
          )}
        </p>
      ) : (
        <p>
          {percent(estimate.baseRateBps)} base rate
          {bonus
            ? `; ${percent(estimate.bonusRateBps!)} on ${estimate.minBonusSpendCents === estimate.maxBonusSpendCents ? '' : 'up to '}${money(estimate.maxBonusSpendCents)} of eligible ${label} spend.`
            : '.'}
        </p>
      )}
      {estimate.paidOnPaymentBps ? (
        <p className="supporting">
          {`${percent(rate)} if the balance is paid (${percent(rate - estimate.paidOnPaymentBps)} at purchase).`}
        </p>
      ) : null}
      {applied && bonus && (
        <div className="flex flex-wrap gap-2">
          {applied.usMerchantsOnly && <Badge size="small">U.S. merchants only</Badge>}
          {applied.cap.kind === 'spend' && (
            <Badge size="small">
              {`Up to ${money(applied.cap.amountCents)} ${periodCopy[applied.cap.period]}, then ${percent(applied.cap.rateAfterCapBps)}`}
            </Badge>
          )}
          {(applied.activation === 'enroll-once' || applied.activation === 'recurring') && (
            <Badge size="small" color="warning">
              {applied.activation === 'enroll-once' ? 'Enrollment required' : 'Activation required'}
            </Badge>
          )}
        </div>
      )}
      {applied && bonus && applied.activation === 'unstated' && (
        <p className="supporting">{ACTIVATION_LABELS.unstated}.</p>
      )}
      {estimate.uncertainties.map((code) => (
        <p key={code} className="supporting">
          {uncertaintyCopy(code, labelFor(code))}
        </p>
      ))}
      {notApplying.length > 0 && (
        <Disclosure title={`Rules that don’t apply here (${notApplying.length})`}>
          <ul className="plain-list space-y-1">
            {notApplying.map(({ ruleId, status }) => {
              const rule = rules.find((r) => r.id === ruleId)!;
              return (
                <li key={ruleId}>
                  {percent(rule.rateBps)} on “{rule.issuerWording}”: {statusCopy[status]}.
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}
    </li>
  );
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
      <AlertInline color="critical" role="alert">
        {unavailableCopy[result.reason]}
      </AlertInline>
    );
  const preferred = catalog.cards.find((c) => c.id === result.preferredCardId)!;
  const single = result.estimates.length === 1;
  const sources = catalog.sources.filter((s) => result.estimates.some((e) => e.sourceIds.includes(s.id)));
  return (
    <Card hasBorder>
      <div className="card-body space-y-3">
        <h2 id="comparison-heading" className="section-title">
          {single
            ? 'Your card estimate'
            : result.rankingMayChange
              ? 'Compare the conditions'
              : result.tied
                ? 'Rewards are tied'
                : `Use ${preferred.shortName}`}
        </h2>
        <p className="supporting">
          Saved estimate for a{' '}
          {purchase ? `${money(purchase.amountCents)} ${merchantName(purchase.merchantId)}` : ''}{' '}
          {subtotalOnly ? 'subtotal' : 'purchase'}.
        </p>
        {subtotalOnly && (
          <p className="supporting">
            Subtotal only; tax and shipping are not included. Update the amount when the final charge is
            available.
          </p>
        )}
        {result.rankingMayChange && (
          <p>
            {preferred.shortName} has the highest lower estimate. Another card may earn more once its
            conditions are confirmed.
          </p>
        )}
        {result.tied && !result.rankingMayChange && (
          <p className="supporting">Your preferred card breaks the tie: {preferred.shortName}.</p>
        )}
        <ul className="estimate-list">
          {result.estimates.map((estimate) => (
            <EstimateRow
              key={estimate.cardId}
              catalog={catalog}
              estimate={estimate}
              amountCents={purchase?.amountCents ?? 0}
            />
          ))}
        </ul>
        <p className="supporting">
          Estimates depend on issuer eligibility and merchant coding. Amounts are rounded down to a cent;
          statement rewards may differ. Offers, fees and financing are excluded.
        </p>
        <Disclosure title="Card terms and sources">
          <p>
            Sources checked{' '}
            {new Date(catalog.verifiedAt).toLocaleDateString('en-US', {
              timeZone: 'UTC',
              dateStyle: 'medium',
            })}
            . Terms expire {new Date(catalog.expiresAt).toLocaleString('en-US')}. This saved comparison
            expires within {maxAgeMinutes} minutes and only covers the inputs shown.
          </p>
          <ul className="plain-list mt-2 space-y-1">
            {sources.map((source) => (
              <li key={source.id}>
                <Link href={source.url} isExternal>
                  {source.title}
                </Link>
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </Card>
  );
}
