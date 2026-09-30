import { portionRewardCents } from './money.ts';
import {
  integer,
  rankEstimates,
  unavailableReason,
  unique,
  validatePurchaseAndWallet,
} from './engine-shared.ts';
import {
  PAYMENT_PATHS,
  type CardEstimate,
  type CardProductV2,
  type CatalogV2,
  type Comparison,
  type MerchantProfile,
  type Purchase,
  type RewardRuleV2,
  type RuleStatus,
  type RuleUsage,
  type UnavailableComparison,
  type Uncertainty,
  type Wallet,
  UNCERTAINTIES,
} from './types.ts';

/*
 * Catalog v2 engine. Rule applicability at a checkout:
 * - all-purchases: always (the base).
 * - online-retail: merchant is online retail selling physical goods (and U.S. when the rule is
 *   U.S.-only), the shopper has not ruled the purchase out, and the payment path is not excluded.
 * - MCC-group categories (supermarkets, gas, dining, ...): only when the merchant profile's
 *   expected category equals the rule category.
 * - travel-portal, entertainment-portal, other: never at a retail checkout ("not at this merchant").
 * - A promotion is expired (never applied) when its end date is before the purchase date or before
 *   the catalog's verification date.
 * Rules do not stack: each card earns its best applicable rule, and never less than its base.
 * A rule whose applicability is uncertain (category unconfirmed, enroll-once/recurring activation
 * not confirmed, non-card payment path, cap unstated) contributes a range from the base reward to
 * its bonus. Spend beyond a cap earns rateAfterCapBps. Activation `unstated` means the issuer's
 * pages don't mention activation; issuers state enrollment requirements explicitly, so it is
 * treated like `none` (product decision) and never asks the shopper to confirm.
 */

const PORTAL_OR_OTHER = new Set(['travel-portal', 'entertainment-portal', 'other']);
const YEARLY = new Set(['calendar-year', 'cardmember-year', 'year-unspecified']);
/** Activation the shopper must confirm; `none` and `unstated` never need it. */
export const needsActivation = (rule: RewardRuleV2) =>
  rule.activation === 'enroll-once' || rule.activation === 'recurring';

function validateCatalog(catalog: CatalogV2, wallet: Wallet, purchase: Purchase) {
  const sources = new Set(catalog.sources.map((s) => s.id));
  if (
    !catalog.version ||
    !Number.isFinite(Date.parse(catalog.verifiedAt)) ||
    Date.parse(catalog.expiresAt) <= Date.parse(catalog.verifiedAt) ||
    !unique(catalog.cards.map((c) => c.id)) ||
    !unique(catalog.merchants.map((m) => m.id)) ||
    !unique([...sources]) ||
    sources.size !== catalog.sources.length ||
    (purchase.paymentPath !== undefined && !PAYMENT_PATHS.includes(purchase.paymentPath))
  )
    throw new Error('Invalid comparison input.');
  for (const card of catalog.cards) {
    const bases = card.rules.filter((r) => r.category === 'all-purchases');
    if (bases.length !== 1 || !unique(card.rules.map((r) => r.id)))
      throw new Error('Unsupported catalog rules.');
    const base = bases[0];
    if (base.cap.kind === 'spend' || base.activation === 'enroll-once' || base.activation === 'recurring')
      throw new Error('Unsupported catalog rules.');
    for (const rule of card.rules) {
      if (
        !integer(base.rateBps, 0, 10_000) ||
        !integer(rule.rateBps, base.rateBps, 10_000) ||
        !integer(rule.paidOnPaymentBps, 0, rule.rateBps) ||
        (rule.cap.kind === 'spend' &&
          (!integer(rule.cap.amountCents, 1, Number.MAX_SAFE_INTEGER) ||
            !integer(rule.cap.rateAfterCapBps, 0, rule.rateBps))) ||
        !rule.sourceIds.length ||
        rule.sourceIds.some((id) => !sources.has(id))
      )
        throw new Error('Invalid catalog rule.');
    }
  }
  for (const owned of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === owned.cardId);
    if (card && owned.usage.some((u) => !card.rules.some((r) => r.id === u.ruleId)))
      throw new Error('Invalid wallet usage.');
  }
}

type Option = {
  rule: RewardRuleV2;
  min: number;
  max: number;
  minBonusSpend: number;
  maxBonusSpend: number;
  uncertainties: Uncertainty[];
  status: RuleStatus;
};

/** Returns why a rule cannot apply here, or null when it may. */
function blocked(
  rule: RewardRuleV2,
  merchant: MerchantProfile,
  purchase: Purchase,
  usage: RuleUsage | undefined,
  verifiedOn: string,
): RuleStatus | null {
  if (PORTAL_OR_OTHER.has(rule.category)) return 'not-at-merchant';
  const endsOn = rule.limitedTime?.endsOn;
  if (endsOn && (endsOn < purchase.purchasedOn || endsOn < verifiedOn)) return 'expired';
  if (rule.category === 'online-retail') {
    if (!merchant.onlineRetail || !merchant.physicalGoods) return 'not-at-merchant';
    if (purchase.onlineRetail === 'ineligible') return 'not-eligible';
  } else if (rule.category !== merchant.expectedCategory) return 'not-at-merchant';
  if (rule.usMerchantsOnly && !merchant.usMerchant) return 'not-eligible';
  const path = purchase.paymentPath ?? 'card';
  if (path !== 'card' && rule.excludedPaymentPaths.includes(path)) return 'not-eligible';
  if (needsActivation(rule) && usage?.activation === 'inactive') return 'not-eligible';
  return null;
}

function evaluate(
  rule: RewardRuleV2,
  purchase: Purchase,
  usage: RuleUsage | undefined,
  baseReward: number,
): Option {
  const amount = purchase.amountCents;
  const uncertain: Uncertainty[] = [];
  if (rule.category === 'online-retail' && purchase.onlineRetail === 'unknown')
    uncertain.push('online-category-unknown');
  if ((purchase.paymentPath ?? 'card') !== 'card') uncertain.push('payment-path-uncertain');
  if (needsActivation(rule) && usage?.activation !== 'active') uncertain.push('activation-unknown');
  if (rule.cap.kind === 'unstated') uncertain.push('cap-unstated');

  let minBonus = amount,
    maxBonus = amount,
    afterBps = rule.rateBps;
  const capCodes: Uncertainty[] = [];
  if (rule.cap.kind === 'spend') {
    afterBps = rule.cap.rateAfterCapBps;
    const spent = usage?.spentCents ?? null;
    if (spent === null) {
      capCodes.push(YEARLY.has(rule.cap.period) ? 'annual-usage-unknown' : 'cap-usage-unknown');
      minBonus = 0;
      maxBonus = Math.min(amount, rule.cap.amountCents);
    } else minBonus = maxBonus = Math.min(amount, Math.max(0, rule.cap.amountCents - spent));
  }
  const reward = (bonus: number) =>
    portionRewardCents([
      { spendCents: bonus, bps: rule.rateBps },
      { spendCents: amount - bonus, bps: afterBps },
    ]);
  const ruleMin = reward(minBonus),
    ruleMax = reward(maxBonus);
  const certain = uncertain.length === 0;
  const min = certain ? ruleMin : Math.min(baseReward, ruleMin);
  const max = certain ? ruleMax : Math.max(baseReward, ruleMax);
  return {
    rule,
    min,
    max,
    minBonusSpend: certain ? minBonus : 0,
    maxBonusSpend: maxBonus,
    // Report only conditions that can move this card's estimate.
    uncertainties: max > min ? [...uncertain, ...capCodes] : [],
    status: maxBonus === 0 ? 'cap-reached' : max > min ? 'may-apply' : 'applied',
  };
}

function estimateCard(
  card: CardProductV2,
  usage: RuleUsage[],
  merchant: MerchantProfile,
  purchase: Purchase,
  verifiedOn: string,
): CardEstimate {
  const year = Number(purchase.purchasedOn.slice(0, 4));
  // Only same-day usage for this year counts; stale usage is unknown, not zero.
  const usageFor = (rule: RewardRuleV2) =>
    usage.find(
      (u) => u.ruleId === rule.id && u.calendarYear === year && u.recordedOn === purchase.purchasedOn,
    );
  const base = card.rules.find((r) => r.category === 'all-purchases')!;
  const baseReward = portionRewardCents([{ spendCents: purchase.amountCents, bps: base.rateBps }]);
  const statuses: { ruleId: string; status: RuleStatus }[] = [];
  const options: Option[] = [];
  for (const rule of card.rules) {
    if (rule === base) {
      statuses.push({ ruleId: rule.id, status: 'base' });
      continue;
    }
    const why = blocked(rule, merchant, purchase, usageFor(rule), verifiedOn);
    if (why) {
      statuses.push({ ruleId: rule.id, status: why });
      continue;
    }
    const option = evaluate(rule, purchase, usageFor(rule), baseReward);
    options.push(option);
    statuses.push({ ruleId: rule.id, status: option.status });
  }
  const byMin = [...options].sort(
    (a, b) => b.min - a.min || b.max - a.max || b.rule.rateBps - a.rule.rateBps,
  );
  const byMax = [...options].sort(
    (a, b) => b.max - a.max || b.min - a.min || b.rule.rateBps - a.rule.rateBps,
  );
  const floor = byMin[0],
    ceiling = byMax[0];
  // The base is always an option: no rule (e.g. a low after-cap rate) can pull a card below it.
  const min = Math.max(baseReward, floor?.min ?? baseReward),
    max = Math.max(baseReward, ceiling?.max ?? baseReward);
  const codes = new Set(options.filter((o) => o.max > min).flatMap((o) => o.uncertainties));
  const shown = ceiling && ceiling.maxBonusSpend > 0 ? ceiling : undefined;
  const applied = shown?.rule ?? base;
  return {
    cardId: card.id,
    minRewardCents: min,
    maxRewardCents: max,
    baseRateBps: base.rateBps,
    bonusRateBps: shown?.rule.rateBps ?? null,
    minBonusSpendCents: shown && shown === floor ? shown.minBonusSpend : 0,
    maxBonusSpendCents: shown?.maxBonusSpend ?? 0,
    uncertainties: UNCERTAINTIES.filter((code) => codes.has(code)),
    sourceIds: [...new Set([base, ...options.map((o) => o.rule)].flatMap((r) => r.sourceIds))],
    appliedRuleId: applied.id,
    paidOnPaymentBps: applied.paidOnPaymentBps,
    rules: statuses,
  };
}

export function compareV2(
  catalog: CatalogV2,
  wallet: Wallet,
  purchase: Purchase,
  now: number,
): Comparison | UnavailableComparison {
  validatePurchaseAndWallet(wallet, purchase, now);
  validateCatalog(catalog, wallet, purchase);
  const unavailable = unavailableReason(
    catalog,
    catalog.merchants.map((m) => m.id),
    wallet,
    purchase,
    now,
  );
  if (unavailable) return unavailable;
  const merchant = catalog.merchants.find((m) => m.id === purchase.merchantId)!;
  const estimates = wallet.cards.map((owned) =>
    estimateCard(
      catalog.cards.find((c) => c.id === owned.cardId)!,
      owned.usage,
      merchant,
      purchase,
      catalog.verifiedAt.slice(0, 10),
    ),
  );
  return rankEstimates(estimates, wallet, catalog.version);
}
