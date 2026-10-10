// Shopper-facing wording for comparison results, shared by the popup and the badge. Pure functions,
// so the copy is tested without rendering. Catalog v3 wording (Stage 2 M7): units with their cash
// value and its basis ("estimate", "issuer-stated", "your value"), store rewards in dollars with the
// program's name, unvalued programs in units, and the v3 statuses and uncertainties in plain words.
import { CATEGORY_LABELS, formatUsd } from '../domain';
import type {
  Catalog,
  CardEstimate,
  Comparison,
  RewardProgram,
  RewardRuleV2,
  RewardRuleV3,
  RuleStatusV3,
  UnavailableComparison,
  UncertaintyV3,
  PaymentPathV3,
  UnitValue,
} from '../domain';

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
  'no-accepted-card':
    'None of your cards can be used at this store: each is a store card that works only at its own stores. Add a card you can use here to compare.',
};

/** Payment methods in selector order. Venmo exists only in catalog v3 terms (a v2 catalog rejects it),
 * so selectors offer it only then. */
export const PAYMENT_LABELS: Record<PaymentPathV3, string> = {
  card: 'Card entered at checkout',
  paypal: 'PayPal or another payment account',
  venmo: 'Venmo',
  'digital-wallet': 'Digital wallet (Apple Pay, Google Pay)',
  bnpl: 'Buy now, pay later (Affirm, Klarna)',
};

const count = (n: number) => n.toLocaleString('en-US');
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const orList = (items: string[]) =>
  items.length <= 2 ? items.join(' or ') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
const dateCopy = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' });

/** A value per unit in cents, from hundredths of a cent: 120 → "1.2¢", 100 → "1¢", 66 → "0.66¢". */
export function centsEach(hundredthsOfCent: number): string {
  return `${(hundredthsOfCent / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}¢`;
}

/** "$3.00"; "$1.00–$3.00" when conditions are unknown; "up to $5.00" when nothing is guaranteed
 * (a store card whose every rule has a condition). */
export function amount(estimate: Pick<CardEstimate, 'minRewardCents' | 'maxRewardCents'>) {
  const { minRewardCents: min, maxRewardCents: max } = estimate;
  if (min === max) return formatUsd(min);
  if (min === 0) return `up to ${formatUsd(max)}`;
  return `${formatUsd(min)}–${formatUsd(max)}`;
}

function units(estimate: CardEstimate, unitName: string) {
  const min = estimate.minRewardUnits ?? 0,
    max = estimate.maxRewardUnits ?? min;
  if (min === max) return `${count(min)} ${unitName}`;
  if (min === 0) return `up to ${count(max)} ${unitName}`;
  return `${count(min)}–${count(max)} ${unitName}`;
}

export function programOf(estimate: CardEstimate, catalog: Catalog): RewardProgram | undefined {
  return catalog.schemaVersion === 3 ? catalog.programs.find((p) => p.id === estimate.programId) : undefined;
}

/** What a reward is paid as: cash back, store rewards (a cash-back program of one store family),
 * points with a value, or points without one. v1 and v2 results are cash back. */
export type RewardKind = 'cash' | 'store' | 'points' | 'unvalued';
export function rewardKind(estimate: CardEstimate, catalog: Catalog): RewardKind {
  const program = programOf(estimate, catalog);
  if (!program || estimate.unitValue === undefined) return 'cash';
  if (estimate.unitValue === null) return 'unvalued';
  if (program.currency === 'points') return 'points';
  return program.id === 'cash-back' ? 'cash' : 'store';
}

/** The short label of a value's basis. Published estimates are opinions, never issuer facts. */
export function basisLabel(basis: UnitValue['basis']): 'estimate' | 'issuer-stated' | 'your value' | null {
  if (basis === 'published-estimate') return 'estimate';
  if (basis === 'issuer-stated' || basis === 'card-stated') return 'issuer-stated';
  if (basis === 'override') return 'your value';
  return null;
}

/**
 * How a dollar amount compared across cards is named (the badge's recorded-order line): "cash back"
 * when every card involved pays cash back, otherwise "rewards" with what the other rewards were
 * counted at ("Counts Capital One miles at 1¢ each (estimate).", store rewards "at face value") or,
 * for a program with no value,
 * that the order is not counted (`unvalued`).
 */
export function rewardsWording(
  estimates: CardEstimate[],
  catalog: Catalog,
): { term: 'cash back' | 'rewards'; note: string | null; unvalued: boolean } {
  const kinds = estimates.map((e) => rewardKind(e, catalog));
  if (kinds.every((k) => k === 'cash')) return { term: 'cash back', note: null, unvalued: false };
  const unvalued = estimates.find((e, i) => kinds[i] === 'unvalued');
  if (unvalued)
    return {
      term: 'rewards',
      note: `${programOf(unvalued, catalog)!.name} has no published value, so this order is not added to your all-time total.`,
      unvalued: true,
    };
  const counted = new Map<string, string>();
  estimates.forEach((e, i) => {
    const program = programOf(e, catalog);
    if (!program || kinds[i] === 'cash' || counted.has(program.id)) return;
    const basis = basisLabel(e.unitValue!.basis);
    counted.set(
      program.id,
      kinds[i] === 'store'
        ? `${program.name} at face value`
        : `${program.name} at ${centsEach(e.unitValue!.hundredthsOfCent)} each${basis ? ` (${basis})` : ''}`,
    );
  });
  return { term: 'rewards', note: `Counts ${[...counted.values()].join(' and ')}.`, unvalued: false };
}

/** The amount shown first for an estimate: dollars, or for a program without a value its units. */
export function rewardText(estimate: CardEstimate, catalog: Catalog): string {
  if (rewardKind(estimate, catalog) === 'unvalued')
    return capitalize(units(estimate, programOf(estimate, catalog)!.unitName));
  return capitalize(amount(estimate));
}

/** The badge pill's short reward: "$3.00 back", "$5.00 in store rewards", "$4.00 in points" (a value
 * the issuer states or the shopper set), "est. $1.20 in miles" (a published estimate), "1,000 miles". */
export function pillReward(estimate: CardEstimate, catalog: Catalog): string {
  const kind = rewardKind(estimate, catalog);
  const program = programOf(estimate, catalog);
  if (kind === 'unvalued') return units(estimate, program!.unitName);
  if (kind === 'points')
    return `${estimate.unitValue?.basis === 'published-estimate' ? 'est. ' : ''}${amount(estimate)} in ${program!.unitName}`;
  if (kind === 'store') return `${amount(estimate)} in store rewards`;
  return `${amount(estimate)} back`;
}

/** Lines under the amount: what the reward is paid as, its units and the value per unit with its
 * source. `basis` is the short label shown beside them ("estimate", "issuer-stated", "your value"). */
export function valueDetails(
  estimate: CardEstimate,
  catalog: Catalog,
): { lines: string[]; basis: ReturnType<typeof basisLabel> } {
  const kind = rewardKind(estimate, catalog);
  const program = programOf(estimate, catalog);
  if (!program || kind === 'cash') return { lines: [], basis: null };
  if (kind === 'unvalued')
    return {
      lines: [
        `${program.name} has no published value, so this card is listed after cards with one. Set your own value under Point values in Edit cards.`,
      ],
      basis: null,
    };
  if (kind === 'store') {
    const asUnits = program.unitName === 'cents' ? '' : ` (${units(estimate, program.unitName)}, 1¢ each)`;
    const where = program.redemptionBrandIds.length ? ', store rewards you spend with that store' : '';
    return { lines: [`Paid as ${program.name}${asUnits}${where}.`], basis: null };
  }
  const value = estimate.unitValue!;
  const lines = [
    `${capitalize(units(estimate, program.unitName))} at ${centsEach(value.hundredthsOfCent)} each.`,
  ];
  if (value.basis === 'published-estimate' && program.valuation.basis === 'published-estimate')
    lines.push(
      `Value estimated by ${program.valuation.publisher} (read ${dateCopy(program.valuation.retrievedOn)}); what you get depends on how you redeem.`,
    );
  else if (value.basis === 'issuer-stated' || value.basis === 'card-stated')
    lines.push('Value stated by the issuer.');
  else if (value.basis === 'override') lines.push('Your own value, set under Point values in Edit cards.');
  return { lines, basis: basisLabel(value.basis) };
}

/** A rule's rate in the program's terms: "3%" for cash back and store rewards, "4 points per $1" for
 * points (catalog points rates are the card's multiple × 100). */
export function rateText(bps: number, catalog: Catalog, estimate: CardEstimate): string {
  const program = programOf(estimate, catalog);
  if (program?.currency === 'points') {
    const n = bps / 100;
    // "1 point per $1", "1 mile per $1"; other unit names ("Avios", "Rewards") stay as they are.
    const unit =
      n === 1 && /^[a-z]+s$/.test(program.unitName) ? program.unitName.slice(0, -1) : program.unitName;
    return `${count(n)} ${unit} per $1`;
  }
  return `${bps / 100}%`;
}

type AnyRule = RewardRuleV2 | RewardRuleV3;
const isV3 = (rule: AnyRule): rule is RewardRuleV3 => 'requires' in rule;
const gateOf = (catalog: Catalog, id: string | undefined) =>
  catalog.schemaVersion === 3 && id ? catalog.gates.find((g) => g.id === id) : undefined;

/** Why a rule does not apply, in plain words; `null` for statuses that are not listed. */
export function statusCopy(status: RuleStatusV3, rule: AnyRule, catalog: Catalog): string | null {
  switch (status) {
    case 'not-at-merchant':
      return 'Not at this merchant';
    case 'not-eligible':
      return 'Not eligible for this purchase';
    case 'expired':
      return 'Promotion ended';
    case 'cap-reached':
      return 'Spend limit reached';
    case 'not-accepted':
      return 'This card is not accepted at this store';
    case 'not-started': {
      const startsOn = isV3(rule) ? rule.limitedTime?.startsOn : null;
      return startsOn ? `Starts ${dateCopy(startsOn)}` : 'Not started yet';
    }
    case 'choice-not-selected':
      return 'Not one of the categories you chose';
    case 'condition-not-met': {
      const gate = isV3(rule) ? gateOf(catalog, rule.requires[0]?.gateId) : undefined;
      return gate ? `Does not match your answer to “${gate.question}”` : 'Does not match your answers';
    }
    default:
      return null;
  }
}

/** A rule's short name: the brand names of a brand-scoped rule, else its category. */
export function ruleLabel(rule: AnyRule, catalog: Catalog): string {
  if (
    isV3(rule) &&
    catalog.schemaVersion === 3 &&
    (rule.category === 'other' || rule.category === 'all-purchases') &&
    rule.brandIds.length > 0
  )
    return orList(rule.brandIds.map((id) => catalog.brands.find((b) => b.id === id)?.name ?? id));
  return CATEGORY_LABELS[rule.category];
}

const WHERE = 'You can answer it under Edit cards in AI Checkout.';

/** One uncertainty in plain words. `rules` are the card's rules that may still apply (status
 * `may-apply`): they name the categories, chosen options and questions involved. */
export function uncertaintyCopy(
  code: UncertaintyV3,
  rules: AnyRule[],
  catalog: Catalog,
  estimate: CardEstimate,
): string {
  const named = (filter: (r: AnyRule) => boolean) => {
    const names = [...new Set(rules.filter(filter).map((r) => ruleLabel(r, catalog)))];
    return names.length ? orList(names) : 'bonus';
  };
  const card = catalog.schemaVersion === 3 ? catalog.cards.find((c) => c.id === estimate.cardId) : undefined;
  const options = (kind: 'chosen' | 'automatic') =>
    rules.filter(isV3).flatMap((r) => {
      const choice = r.choice ? card?.choices.find((c) => c.id === r.choice!.choiceId) : undefined;
      const option =
        choice?.kind === kind ? choice.options.find((o) => o.id === r.choice!.optionId) : undefined;
      return choice && option ? [{ choice, option: option.label }] : [];
    });
  switch (code) {
    case 'annual-usage-unknown':
      return `Your ${named((r) => r.cap.kind === 'spend')} spend toward this year’s bonus limit is unknown.`;
    case 'cap-usage-unknown':
      return `Your ${named((r) => r.cap.kind === 'spend')} spend toward this period’s bonus limit is unknown.`;
    case 'online-category-unknown':
      return 'Online retail eligibility is unconfirmed.';
    case 'activation-unknown':
      return `The ${named((r) => r.activation === 'enroll-once' || r.activation === 'recurring')} bonus earns only once you activate or enroll. If you have, confirm it under Edit cards.`;
    case 'cap-unstated':
      return `The issuer does not state a spend limit for the ${named((r) => r.cap.kind === 'unstated')} bonus.`;
    case 'payment-path-uncertain':
      return `This payment method may not earn the ${named(() => true)} bonus.`;
    case 'choice-unknown': {
      const picks = options('chosen');
      return picks.length
        ? `Earns more only if ${orList([...new Set(picks.map((p) => p.option))])} is one of your chosen categories (${picks[0].choice.label}). ${WHERE}`
        : `Earns more only in a category you choose. ${WHERE}`;
    }
    case 'automatic-category': {
      const picks = [...new Set(options('automatic').map((p) => p.option))];
      return `Earns more only if ${picks.length ? orList(picks) : 'this category'} is your top spending category, which the issuer works out from your spending, so it can’t be known in advance.`;
    }
    case 'condition-unknown': {
      const questions = [
        ...new Set(
          rules
            .filter(isV3)
            .flatMap((r) => r.requires.map((q) => gateOf(catalog, q.gateId)?.question))
            .filter((q): q is string => !!q),
        ),
      ];
      return questions.length
        ? `Depends on your answer to ${questions.map((q) => `“${q}”`).join(' and ')} ${WHERE}`
        : `Depends on a membership or status you have not confirmed. ${WHERE}`;
    }
    case 'value-unknown':
      return 'Shown in units because this program has no value set.';
  }
}

/** Owned closed-loop cards left out of a v3 ranking, each with where it works. */
export function notAcceptedLines(result: { notAccepted?: CardEstimate[] }, catalog: Catalog): string[] {
  return (result.notAccepted ?? []).map((e) => {
    const card = catalog.cards.find((c) => c.id === e.cardId);
    const name = card?.shortName ?? e.cardId;
    const brands =
      catalog.schemaVersion === 3 && card && 'acceptance' in card && card.acceptance.kind === 'closed-loop'
        ? card.acceptance.brandIds.flatMap((id) => catalog.brands.find((b) => b.id === id)?.name ?? [])
        : [];
    return `${name} works only at ${brands.length ? orList(brands) : 'its own stores'}, so it is not compared here.`;
  });
}

/** Why the first card may not be the best: unanswered conditions, or programs without a value. */
export function rankingNote(
  result: { estimates: CardEstimate[]; preferredCardId: string },
  catalog: Catalog,
): string {
  const preferred = catalog.cards.find((c) => c.id === result.preferredCardId)?.shortName ?? 'The first card';
  const first = result.estimates.find((e) => e.cardId === result.preferredCardId);
  const parts = [`${preferred} is first because its guaranteed estimate is the highest.`];
  // Only when another card's best case beats the first card's guaranteed amount (cards in units are
  // compared in units with each other; valued cards in cents).
  const couldBeat = (e: CardEstimate) =>
    !!first &&
    e.cardId !== first.cardId &&
    ((e.unitValue === null) === (first.unitValue === null)
      ? e.unitValue === null
        ? (e.maxRewardUnits ?? 0) > (first.minRewardUnits ?? 0)
        : e.maxRewardCents > first.minRewardCents
      : first.unitValue === null && e.maxRewardCents > 0);
  if (result.estimates.some(couldBeat))
    parts.push('Another card could earn more if its conditions below are met.');
  if (result.estimates.some((e) => e.unitValue === null && (e.maxRewardUnits ?? 0) > 0))
    parts.push('Cards whose points have no value are listed last; setting a value may move them up.');
  return parts.join(' ');
}

/** How much less `row` earns than `best`, only when both amounts are exact dollar amounts (a
 * program with no value is shown in units, so it has no dollar difference). */
export function lessThanBest(best: CardEstimate, row: CardEstimate): number | undefined {
  if (best.unitValue === null || row.unitValue === null) return undefined;
  if (best.minRewardCents !== best.maxRewardCents || row.minRewardCents !== row.maxRewardCents)
    return undefined;
  const less = best.minRewardCents - row.minRewardCents;
  return less > 0 ? less : undefined;
}

/** How row `index` of a ranked comparison is shown: the clear winner (not tied, ranking stable)
 * as the hero, every other row with how much less it earns when both amounts are exact.
 * `deltaEstimated` marks a difference that rests on a published-estimate point value ("est.", as
 * in the pill). A single card that guarantees nothing is no winner, so it gets no hero. */
export function rowEmphasis(
  result: Comparison,
  index: number,
): { best: boolean; deltaCents?: number; deltaEstimated?: boolean } {
  const clearWinner = !result.tied && !result.rankingMayChange;
  if (!clearWinner) return { best: false };
  const first = result.estimates[0]!;
  if (index === 0) {
    const guaranteesNothing =
      first.unitValue === null ? (first.minRewardUnits ?? 0) === 0 : first.minRewardCents === 0;
    return { best: !(result.estimates.length === 1 && guaranteesNothing) };
  }
  const row = result.estimates[index]!;
  const deltaCents = lessThanBest(first, row);
  if (deltaCents === undefined) return { best: false };
  const estimated = [first, row].some((e) => e.unitValue?.basis === 'published-estimate');
  return estimated ? { best: false, deltaCents, deltaEstimated: true } : { best: false, deltaCents };
}

/** A card's rate when the cart amount is not read (Phase 13c). `estimate` comes from a comparison at
 * `RATES_REFERENCE_CENTS` ($100), below every cap, so its cents are the rate in basis points: "2% back",
 * "1%–3% back" where conditions decide, "3 points per $1 (est. 3.6%)" for valued points (the shopper's
 * or the issuer's value without "est."), "2 miles per $1" for a program without a value. */
export function rateWording(estimate: CardEstimate, catalog: Catalog): string {
  const kind = rewardKind(estimate, catalog);
  const program = programOf(estimate, catalog);
  const pct = (cents: number) => `${Number((cents / 100).toFixed(2))}%`;
  const span = (min: number, max: number, f: (n: number) => string) =>
    min === max ? f(min) : `${f(min)}–${f(max)}`;
  if (kind === 'cash' || kind === 'store')
    return `${span(estimate.minRewardCents, estimate.maxRewardCents, pct)} ${kind === 'store' ? 'in store rewards' : 'back'}`;
  const minUnits = estimate.minRewardUnits ?? 0,
    maxUnits = estimate.maxRewardUnits ?? 0;
  const per = (units: number) => count(units / 100);
  const n = maxUnits / 100;
  const unit =
    n === 1 && minUnits === maxUnits && /^[a-z]+s$/.test(program!.unitName)
      ? program!.unitName.slice(0, -1)
      : program!.unitName;
  const units = `${span(minUnits, maxUnits, per)} ${unit} per $1`;
  if (kind === 'unvalued') return units;
  const estimated = estimate.unitValue?.basis === 'published-estimate' ? 'est. ' : '';
  return `${units} (${estimated}${span(estimate.minRewardCents, estimate.maxRewardCents, pct)})`;
}

/** Whether a spend cap on an owned card's applied rule could change the order at the real amount:
 * the rates view compares at $100, below every cap, so the note is shown when one exists. */
export function ratesCapped(result: { estimates: CardEstimate[] }, catalog: Catalog): boolean {
  if (catalog.schemaVersion === 1) return false;
  return result.estimates.some((e) => {
    const card = catalog.cards.find((c) => c.id === e.cardId);
    const rule = (card?.rules as AnyRule[] | undefined)?.find((r) => r.id === e.appliedRuleId);
    return !!rule && 'cap' in rule && rule.cap.kind === 'spend';
  });
}
