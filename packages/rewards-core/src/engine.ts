import { MAX_AMOUNT_CENTS, rewardCents } from './money.ts';
import type { CardEstimate, Catalog, Comparison, Purchase, UnavailableComparison, Wallet } from './types.ts';

function integer(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function unique(values: string[]) { return new Set(values).size === values.length; }

/** Defense in depth for typed callers; external JSON must also pass its runtime schema. */
function validate(catalog: Catalog, wallet: Wallet, purchase: Purchase, now: number) {
  const verified = Date.parse(catalog.verifiedAt);
  const expires = Date.parse(catalog.expiresAt);
  const eligible = ['eligible', 'ineligible', 'unknown'];
  const date = Date.parse(`${purchase.purchasedOn}T12:00:00Z`);
  if (!Number.isFinite(now) || catalog.schemaVersion !== 1 || !catalog.version ||
      !Number.isFinite(verified) || !Number.isFinite(expires) || expires <= verified ||
      !/^\d{4}-\d{2}-\d{2}$/.test(purchase.purchasedOn) || !Number.isFinite(date) ||
      new Date(date).toISOString().slice(0, 10) !== purchase.purchasedOn ||
      purchase.currency !== 'USD' || !integer(purchase.amountCents, 1, MAX_AMOUNT_CENTS) ||
      !eligible.includes(purchase.eligiblePurchase) || !eligible.includes(purchase.onlineRetail) ||
      !unique(catalog.cards.map(c => c.id)) || !unique(catalog.sources.map(s => s.id)) ||
      !unique(wallet.cards.map(c => c.cardId)) ||
      (wallet.defaultCardId !== null && !wallet.cards.some(c => c.cardId === wallet.defaultCardId))) {
    throw new Error('Invalid comparison input.');
  }
  for (const card of catalog.cards) {
    const bases = card.rules.filter(r => r.category === 'all-eligible');
    const bonuses = card.rules.filter(r => r.category === 'us-online-retail');
    // The first schema supports one non-stacking bonus. Reject extra/unknown rule kinds.
    if (bases.length !== 1 || bonuses.length > 1 || bases.length + bonuses.length !== card.rules.length ||
        !unique(card.rules.map(r => r.id)) || bases[0].annualCapCents !== undefined || bases[0].requiresActivation) {
      throw new Error('Unsupported catalog rules.');
    }
    for (const rule of card.rules) {
      if (!integer(rule.rateBps, bases[0].rateBps, 10_000) || !integer(bases[0].rateBps, 0, 10_000) ||
          typeof rule.requiresActivation !== 'boolean' || !rule.sourceIds.length ||
          rule.sourceIds.some(id => !catalog.sources.some(s => s.id === id)) ||
          (rule.annualCapCents !== undefined && !integer(rule.annualCapCents, 1, MAX_AMOUNT_CENTS))) {
        throw new Error('Invalid catalog rule.');
      }
    }
  }
  for (const card of wallet.cards) {
    if (!unique(card.usage.map(u => u.ruleId)) || card.usage.some(u =>
      (u.spentCents !== null && !integer(u.spentCents, 0, MAX_AMOUNT_CENTS)) || !integer(u.calendarYear, 2000, 9999) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(u.recordedOn) ||
      !['active', 'inactive', 'unknown'].includes(u.activation) ||
      (catalog.cards.some(c => c.id === card.cardId) && !catalog.cards.find(c => c.id === card.cardId)?.rules.some(r => r.id === u.ruleId)))) {
      throw new Error('Invalid wallet usage.');
    }
  }
}

export function compareRewards(
  catalog: Catalog, wallet: Wallet, purchase: Purchase, now: number,
): Comparison | UnavailableComparison {
  validate(catalog, wallet, purchase, now);
  if (now < Date.parse(catalog.verifiedAt)) return { status: 'unavailable', reason: 'catalog-not-yet-valid' };
  if (now >= Date.parse(catalog.expiresAt)) return { status: 'unavailable', reason: 'catalog-expired' };
  if (!catalog.merchantIds.includes(purchase.merchantId)) return { status: 'unavailable', reason: 'unsupported-merchant' };
  if (wallet.cards.length === 0) return { status: 'unavailable', reason: 'no-owned-cards' };
  if (wallet.cards.some(c => !catalog.cards.some(p => p.id === c.cardId))) return { status: 'unavailable', reason: 'unknown-owned-card' };
  if (purchase.eligiblePurchase === 'unknown') return { status: 'unavailable', reason: 'purchase-not-confirmed' };
  if (purchase.eligiblePurchase === 'ineligible') return { status: 'unavailable', reason: 'ineligible-purchase' };

  const year = Number(purchase.purchasedOn.slice(0, 4));
  const estimates: CardEstimate[] = wallet.cards.map(owned => {
    const card = catalog.cards.find(c => c.id === owned.cardId)!;
    const base = card.rules.find(r => r.category === 'all-eligible')!;
    const bonus = card.rules.find(r => r.category === 'us-online-retail');
    const estimate: CardEstimate = {
      cardId: card.id, minRewardCents: rewardCents(purchase.amountCents, base.rateBps),
      maxRewardCents: rewardCents(purchase.amountCents, base.rateBps),
      baseRateBps: base.rateBps, bonusRateBps: bonus?.rateBps ?? null,
      minBonusSpendCents: 0, maxBonusSpendCents: 0, uncertainties: [],
      sourceIds: [...new Set(card.rules.flatMap(r => r.sourceIds))],
    };
    if (!bonus || purchase.onlineRetail === 'ineligible') return estimate;

    // Prior-year usage is not evidence of this year's remaining allowance or activation.
    const usage = owned.usage.find(u => u.ruleId === bonus.id && u.calendarYear === year && u.recordedOn === purchase.purchasedOn);
    if (bonus.requiresActivation && usage?.activation === 'inactive') return estimate;
    let possibleSpend = purchase.amountCents;
    if (bonus.annualCapCents !== undefined) {
      possibleSpend = Math.min(possibleSpend, Math.max(0, bonus.annualCapCents - (usage?.spentCents ?? 0)));
      if (usage?.spentCents == null) estimate.uncertainties.push('annual-usage-unknown');
    }
    if (possibleSpend === 0) { estimate.uncertainties = []; return estimate; }
    if (purchase.onlineRetail === 'unknown') estimate.uncertainties.push('online-category-unknown');
    if (bonus.requiresActivation && usage?.activation !== 'active') estimate.uncertainties.push('activation-unknown');
    estimate.minBonusSpendCents = estimate.uncertainties.length ? 0 : possibleSpend;
    estimate.maxBonusSpendCents = possibleSpend;
    estimate.minRewardCents = rewardCents(purchase.amountCents, base.rateBps, estimate.minBonusSpendCents, bonus.rateBps);
    estimate.maxRewardCents = rewardCents(purchase.amountCents, base.rateBps, possibleSpend, bonus.rateBps);
    return estimate;
  });
  estimates.sort((a, b) => b.minRewardCents - a.minRewardCents ||
    Number(b.cardId === wallet.defaultCardId) - Number(a.cardId === wallet.defaultCardId) ||
    a.cardId.localeCompare(b.cardId, 'en'));
  const first = estimates[0];
  return {
    status: 'ready', catalogVersion: catalog.version, estimates,
    preferredCardId: first.cardId,
    rankingMayChange: estimates.slice(1).some(e => e.maxRewardCents > first.minRewardCents),
    tied: estimates.slice(1).some(e => e.minRewardCents === first.minRewardCents),
  };
}
