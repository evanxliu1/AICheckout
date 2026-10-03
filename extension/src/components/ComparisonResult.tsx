import { AlertInline, Badge, Card, Disclosure, Link } from '@ai-checkout/ui';
import { ACTIVATION_LABELS, CATEGORY_LABELS, formatUsd, isUnconditionalRuleV3 } from '../domain';
import type {
  Catalog,
  CardEstimate,
  Comparison,
  Purchase,
  RewardRuleV2,
  RewardRuleV3,
  UnavailableComparison,
} from '../domain';
import { merchantName } from '../checkout/merchants';
import {
  notAcceptedLines,
  rankingNote,
  rateText,
  rewardText,
  rowEmphasis,
  statusCopy,
  unavailableCopy,
  uncertaintyCopy,
  valueDetails,
} from './estimates';

const money = (cents: number) => formatUsd(cents);
const periodCopy: Record<string, string> = {
  'calendar-year': 'per calendar year',
  'cardmember-year': 'per card-member year',
  'billing-cycle': 'per billing cycle',
  quarter: 'per quarter',
  month: 'per month',
  'year-unspecified': 'per year',
};
const BASIS_COLORS = { estimate: 'neutral', 'issuer-stated': 'neutral', 'your value': 'highlight' } as const;

/** One card's result: amount and what it is paid as, the rule behind it in the issuer's words, its
 * conditions, the rules that don't apply here, and notes about uncertain inputs. `best` shows it as
 * the clear winner (navy block, large amount and rate); `deltaCents` is how much less it earns than
 * the winner, when both are exact dollar amounts ("est." when either rests on a published estimate). */
export function EstimateRow({
  catalog,
  estimate,
  amountCents,
  best = false,
  deltaCents,
  deltaEstimated = false,
}: {
  catalog: Catalog;
  estimate: CardEstimate;
  amountCents: number;
  best?: boolean;
  deltaCents?: number;
  deltaEstimated?: boolean;
}) {
  const card = catalog.cards.find((c) => c.id === estimate.cardId)!;
  const rules: (RewardRuleV2 | RewardRuleV3)[] =
    catalog.schemaVersion === 1 ? [] : (card.rules as (RewardRuleV2 | RewardRuleV3)[]);
  const applied = rules.find((r) => r.id === estimate.appliedRuleId);
  // v3: the base is the unconditional all-purchases rule (others may need a choice or a gate).
  const base = rules.find(
    (r) => r.category === 'all-purchases' && (!('brandIds' in r) || isUnconditionalRuleV3(r)),
  );
  // v1 catalogs have one bonus kind; name it from the card's own rule rather than assuming it.
  const v1Bonus =
    catalog.schemaVersion === 1
      ? catalog.cards.find((c) => c.id === estimate.cardId)?.rules.find((r) => r.category !== 'all-eligible')
      : undefined;
  const label = CATEGORY_LABELS[applied?.category ?? v1Bonus?.category ?? 'all-purchases'];
  const mayApply = rules.filter((r) =>
    estimate.rules?.some((s) => s.ruleId === r.id && s.status === 'may-apply'),
  );
  const rate = (bps: number) => rateText(bps, catalog, estimate);
  const bonus = estimate.maxBonusSpendCents > 0 && estimate.bonusRateBps !== null;
  const total = bonus ? estimate.bonusRateBps! : estimate.baseRateBps;
  const notApplying = (estimate.rules ?? []).flatMap(({ ruleId, status }) => {
    const rule = rules.find((r) => r.id === ruleId);
    const why = rule && statusCopy(status, rule, catalog);
    return rule && why ? [{ rule, why }] : [];
  });
  const value = valueDetails(estimate, catalog);
  // Exact when the amount shown first (dollars, or units for a program with no value) is one number.
  const exact =
    estimate.unitValue === null
      ? (estimate.minRewardUnits ?? 0) === (estimate.maxRewardUnits ?? 0)
      : estimate.minRewardCents === estimate.maxRewardCents;
  // The unvalued line already says why the card is in units.
  const uncertainties = estimate.uncertainties.filter((code) => code !== 'value-unknown');
  return (
    <li className={best ? 'estimate-row estimate-row--best space-y-2' : 'estimate-row py-3 space-y-2'}>
      {best ? (
        <>
          <h3 className="section-title">{card.shortName}</h3>
          <p
            className={
              exact && estimate.unitValue !== null
                ? 'estimate-amount estimate-amount--hero'
                : 'estimate-amount estimate-amount--hero estimate-amount--range'
            }
          >
            <span>{rewardText(estimate, catalog)}</span>{' '}
            {total > 0 && (
              <span className="estimate-rate">
                {/* The rate covers the whole amount only when the estimate is exact and fully at that rate. */}
                {!exact || (bonus && estimate.maxBonusSpendCents < amountCents)
                  ? `up to ${rate(total)}`
                  : rate(total)}
              </span>
            )}
          </p>
        </>
      ) : (
        <div className="estimate-head flex justify-between gap-4 items-baseline">
          <h3 className="section-title">{card.shortName}</h3>
          <span className="estimate-amount">
            {deltaCents ? (
              <span className="estimate-delta">{`${deltaEstimated ? 'est. ' : ''}${money(deltaCents)} less`}</span>
            ) : null}
            <span>{rewardText(estimate, catalog)}</span>
          </span>
        </div>
      )}
      {(value.lines.length > 0 || value.basis) && (
        <div className="estimate-value space-y-1">
          {value.basis && (
            <Badge size="small" color={BASIS_COLORS[value.basis]}>
              {value.basis === 'estimate'
                ? 'Estimate'
                : value.basis === 'issuer-stated'
                  ? 'Issuer-stated'
                  : 'Your value'}
            </Badge>
          )}
          {value.lines.map((line) => (
            <p key={line} className="supporting">
              {line}
            </p>
          ))}
        </div>
      )}
      {(estimate.unitValue === null
        ? (estimate.minRewardUnits ?? 0) === 0 && (estimate.maxRewardUnits ?? 0) > 0
        : estimate.minRewardCents === 0 && estimate.maxRewardCents > 0) && (
        <p className="supporting">
          Nothing is guaranteed: this card earns here only if the conditions below are met.
        </p>
      )}
      {applied && base ? (
        <p>
          {bonus ? (
            <>
              {rate(applied.rateBps)} on “{applied.issuerWording}”
              {(estimate.minBonusSpendCents !== estimate.maxBonusSpendCents ||
                estimate.maxBonusSpendCents < amountCents) &&
                ` for ${estimate.minBonusSpendCents === estimate.maxBonusSpendCents ? '' : 'up to '}${money(estimate.maxBonusSpendCents)} of this purchase`}
              ; otherwise {rate(base.rateBps)} on “{base.issuerWording}”.
            </>
          ) : (
            <>
              {rate(base.rateBps)} on “{base.issuerWording}”.
            </>
          )}
        </p>
      ) : applied ? (
        // A store card with no base rate: only its own rule can earn.
        <p>
          {rate(applied.rateBps)} on “{applied.issuerWording}”
          {estimate.maxBonusSpendCents > 0 &&
            estimate.maxBonusSpendCents < amountCents &&
            ` for up to ${money(estimate.maxBonusSpendCents)} of this purchase`}
          ; nothing on other purchases.
        </p>
      ) : (
        <p>
          {rate(estimate.baseRateBps)} base rate
          {bonus
            ? `; ${rate(estimate.bonusRateBps!)} on ${estimate.minBonusSpendCents === estimate.maxBonusSpendCents ? '' : 'up to '}${money(estimate.maxBonusSpendCents)} of eligible ${label} spend.`
            : '.'}
        </p>
      )}
      {estimate.paidOnPaymentBps ? (
        <p className="supporting">
          {`${rate(total)} if the balance is paid (${rate(total - estimate.paidOnPaymentBps)} at purchase).`}
        </p>
      ) : null}
      {applied && bonus && (
        <div className="flex flex-wrap gap-2">
          {applied.usMerchantsOnly && <Badge size="small">U.S. merchants only</Badge>}
          {applied.cap.kind === 'spend' && (
            <Badge size="small">
              {`Up to ${money(applied.cap.amountCents)} ${periodCopy[applied.cap.period]}, then ${rate(applied.cap.rateAfterCapBps)}`}
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
      {uncertainties.map((code) => (
        <p key={code} className="supporting">
          {uncertaintyCopy(code, mayApply, catalog, estimate)}
        </p>
      ))}
      {notApplying.length > 0 && (
        <Disclosure title={`Rules that don’t apply here (${notApplying.length})`}>
          <ul className="plain-list space-y-1">
            {notApplying.map(({ rule, why }) => (
              <li key={rule.id}>
                {rate(rule.rateBps)} on “{rule.issuerWording}”: {why}.
              </li>
            ))}
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
  const notAccepted = notAcceptedLines(result, catalog);
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
        {result.rankingMayChange && <p>{rankingNote(result, catalog)}</p>}
        {result.tied && !result.rankingMayChange && (
          <p className="supporting">Your preferred card breaks the tie: {preferred.shortName}.</p>
        )}
        <ul className="estimate-list">
          {result.estimates.map((estimate, i) => (
            <EstimateRow
              key={estimate.cardId}
              catalog={catalog}
              estimate={estimate}
              amountCents={purchase?.amountCents ?? 0}
              {...rowEmphasis(result, i)}
            />
          ))}
        </ul>
        {notAccepted.map((line) => (
          <p key={line} className="supporting">
            {line}
          </p>
        ))}
        <p className="supporting">
          Estimates depend on issuer eligibility and merchant coding. Amounts are rounded down to a cent;
          statement rewards may differ.
          {catalog.schemaVersion === 3 &&
            ' Point values are estimates unless the issuer states one or you set your own.'}{' '}
          Offers, fees and financing are excluded.
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
