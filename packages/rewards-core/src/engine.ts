import { MAX_AMOUNT_CENTS, rewardCents } from './money.ts';
import { compareV2 } from './engine-v2.ts';
import { integer, rankEstimates, unavailableReason, unique } from './engine-shared.ts';
import type {
  CardEstimate,
  Catalog,
  CatalogV1,
  Comparison,
  Purchase,
  UnavailableComparison,
  Wallet,
} from './types.ts';

/** Defense in depth for typed callers; external JSON must also pass its runtime schema. */
function validate(catalog: CatalogV1, wallet: Wallet, purchase: Purchase, now: number) {
  const verified = Date.parse(catalog.verifiedAt);
  const expires = Date.parse(catalog.expiresAt);
  const eligible = ['eligible', 'ineligible', 'unknown'];
  const date = Date.parse(`${purchase.purchasedOn}T12:00:00Z`);
  if (
    !Number.isFinite(now) ||
    catalog.schemaVersion !== 1 ||
    !catalog.version ||
    !Number.isFinite(verified) ||
    !Number.isFinite(expires) ||
    expires <= verified ||
    !/^\d{4}-\d{2}-\d{2}$/.test(purchase.purchasedOn) ||
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== purchase.purchasedOn ||
    purchase.currency !== 'USD' ||
    !integer(purchase.amountCents, 1, MAX_AMOUNT_CENTS) ||
    !eligible.includes(purchase.eligiblePurchase) ||
    !eligible.includes(purchase.onlineRetail) ||
    !unique(catalog.cards.map((c) => c.id)) ||
    !unique(catalog.sources.map((s) => s.id)) ||
    !unique(wallet.cards.map((c) => c.cardId)) ||
    (wallet.defaultCardId !== null && !wallet.cards.some((c) => c.cardId === wallet.defaultCardId))
  ) {
    throw new Error('Invalid comparison input.');
  }
  for (const card of catalog.cards) {
    const bases = card.rules.filter((r) => r.category === 'all-eligible');
    const bonuses = card.rules.filter((r) => r.category === 'us-online-retail');
    // The first schema supports one non-stacking bonus. Reject extra/unknown rule kinds.
    if (
      bases.length !== 1 ||
      bonuses.length > 1 ||
      bases.length + bonuses.length !== card.rules.length ||
      !unique(card.rules.map((r) => r.id)) ||
      bases[0].annualCapCents !== undefined ||
      bases[0].requiresActivation
    ) {
      throw new Error('Unsupported catalog rules.');
    }
    for (const rule of card.rules) {
      if (
        !integer(rule.rateBps, bases[0].rateBps, 10_000) ||
        !integer(bases[0].rateBps, 0, 10_000) ||
        typeof rule.requiresActivation !== 'boolean' ||
        !rule.sourceIds.length ||
        rule.sourceIds.some((id) => !catalog.sources.some((s) => s.id === id)) ||
        (rule.annualCapCents !== undefined && !integer(rule.annualCapCents, 1, MAX_AMOUNT_CENTS))
      ) {
        throw new Error('Invalid catalog rule.');
      }
    }
  }
  for (const card of wallet.cards) {
    if (
      !unique(card.usage.map((u) => u.ruleId)) ||
      card.usage.some(
        (u) =>
          (u.spentCents !== null && !integer(u.spentCents, 0, MAX_AMOUNT_CENTS)) ||
          !integer(u.calendarYear, 2000, 9999) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(u.recordedOn) ||
          !['active', 'inactive', 'unknown'].includes(u.activation) ||
          (catalog.cards.some((c) => c.id === card.cardId) &&
            !catalog.cards.find((c) => c.id === card.cardId)?.rules.some((r) => r.id === u.ruleId)),
      )
    ) {
      throw new Error('Invalid wallet usage.');
    }
  }
}

/** Compares owned cards for one purchase. Catalog v1 keeps its original rules; v2 is in engine-v2.ts.
 * Catalog v3 is a contract only until the v3 engine (Stage 2 M2), so it fails closed here. */
export function compareRewards(
  catalog: Catalog,
  wallet: Wallet,
  purchase: Purchase,
  now: number,
): Comparison | UnavailableComparison {
  if (catalog.schemaVersion === 3) throw new Error('Catalog schema 3 is not supported by this engine yet.');
  return catalog.schemaVersion === 2
    ? compareV2(catalog, wallet, purchase, now)
    : compareV1(catalog, wallet, purchase, now);
}

function compareV1(
  catalog: CatalogV1,
  wallet: Wallet,
  purchase: Purchase,
  now: number,
): Comparison | UnavailableComparison {
  validate(catalog, wallet, purchase, now);
  const unavailable = unavailableReason(catalog, catalog.merchantIds, wallet, purchase, now);
  if (unavailable) return unavailable;

  const year = Number(purchase.purchasedOn.slice(0, 4));
  const estimates: CardEstimate[] = wallet.cards.map((owned) => {
    const card = catalog.cards.find((c) => c.id === owned.cardId)!;
    const base = card.rules.find((r) => r.category === 'all-eligible')!;
    const bonus = card.rules.find((r) => r.category === 'us-online-retail');
    const estimate: CardEstimate = {
      cardId: card.id,
      minRewardCents: rewardCents(purchase.amountCents, base.rateBps),
      maxRewardCents: rewardCents(purchase.amountCents, base.rateBps),
      baseRateBps: base.rateBps,
      bonusRateBps: bonus?.rateBps ?? null,
      minBonusSpendCents: 0,
      maxBonusSpendCents: 0,
      uncertainties: [],
      sourceIds: [...new Set(card.rules.flatMap((r) => r.sourceIds))],
    };
    if (!bonus || purchase.onlineRetail === 'ineligible') return estimate;

    // Prior-year usage is not evidence of this year's remaining allowance or activation.
    const usage = owned.usage.find(
      (u) => u.ruleId === bonus.id && u.calendarYear === year && u.recordedOn === purchase.purchasedOn,
    );
    if (bonus.requiresActivation && usage?.activation === 'inactive') return estimate;
    let possibleSpend = purchase.amountCents;
    if (bonus.annualCapCents !== undefined) {
      possibleSpend = Math.min(possibleSpend, Math.max(0, bonus.annualCapCents - (usage?.spentCents ?? 0)));
      if (usage?.spentCents == null) estimate.uncertainties.push('annual-usage-unknown');
    }
    if (possibleSpend === 0) {
      estimate.uncertainties = [];
      return estimate;
    }
    if (purchase.onlineRetail === 'unknown') estimate.uncertainties.push('online-category-unknown');
    if (bonus.requiresActivation && usage?.activation !== 'active')
      estimate.uncertainties.push('activation-unknown');
    estimate.minBonusSpendCents = estimate.uncertainties.length ? 0 : possibleSpend;
    estimate.maxBonusSpendCents = possibleSpend;
    estimate.minRewardCents = rewardCents(
      purchase.amountCents,
      base.rateBps,
      estimate.minBonusSpendCents,
      bonus.rateBps,
    );
    estimate.maxRewardCents = rewardCents(purchase.amountCents, base.rateBps, possibleSpend, bonus.rateBps);
    return estimate;
  });
  return rankEstimates(estimates, wallet, catalog.version);
}
