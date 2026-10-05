import { numeratorCents, numeratorUnits, portionNumerator } from './money.ts';
import { integer, unavailableReason, unique, validatePurchaseAndWallet } from './engine-shared.ts';
import { GENERIC_MERCHANT_ID, GENERIC_MERCHANT_PROFILE } from './generic-merchant.ts';
import { isUnconditionalRuleV3 } from './rules-v3.ts';
import {
  PAYMENT_PATHS_V3,
  UNCERTAINTIES_V3,
  type CardEstimate,
  type CardProductV3,
  type CatalogV3,
  type Comparison,
  type MerchantProfileV3,
  type Purchase,
  type RewardProgram,
  type RewardRuleV3,
  type RuleStatusV3,
  type RuleUsage,
  type UnavailableComparison,
  type UncertaintyV3,
  type UnitValue,
  type Wallet,
  type WalletCard,
  type WalletGate,
} from './types.ts';

/*
 * Catalog v3 engine (Stage 2 M2). The v2 rules (engine-v2.ts) carry over: rules do not stack, each
 * card earns its best applicable rule and never less than its base, an uncertain rule contributes a
 * range from the base to the rule, spend past a cap earns rateAfterCapBps, and only usage recorded
 * on the purchase date counts. v3 adds:
 * - Value per unit: the shopper's override for the program, else the card's issuer-stated value,
 *   else the program's valuation. Money is floor(Σ spend × rateBps × value / 1,000,000) in BigInt;
 *   cash back (value 100) gives exactly the v2 amounts. A program with valuation `none` and no
 *   override has no value: the card is estimated in units only (cents 0, `value-unknown`).
 * - Merchant scope: `brandIds` must intersect the merchant's brands and `excludedBrandIds` must
 *   not; a brand-scoped `other` or `all-purchases` rule needs no category match. A closed-loop card
 *   outside its brands is `not-accepted` and left out of the ranking.
 * - Choices: a `chosen` option the shopper selected applies, one they did not select is
 *   `choice-not-selected`, an unanswered choice gives a range (`choice-unknown`); an `automatic`
 *   option always gives a range (`automatic-category`).
 * - Gates: answers are per wallet (they describe the cardholder, not a card). An answer outside the
 *   required options is `condition-not-met`; no answer gives a range (`condition-unknown`) whose
 *   guaranteed minimum is the worst case over the possible answers, not the base.
 * - Payment paths: `requiredPaymentPaths` (PayPal Cashback through PayPal) must include the path,
 *   and a rule that requires the path is not `payment-path-uncertain` for it.
 * - Dates: `startsOn` after the purchase date is `not-started`; `endsOn` as in v2 (`expired`).
 * - Shared caps: rules with the same `sharedCapId` share one spend cap. The spend toward it is
 *   recorded on the group's rule with the smallest ID (`capHolder`), so reordering rules in a
 *   release does not move it; activation stays per rule.
 */

const PORTALS = new Set(['travel-portal', 'entertainment-portal']);
const YEARLY = new Set(['calendar-year', 'cardmember-year', 'year-unspecified']);
const needsActivation = (rule: RewardRuleV3) =>
  rule.activation === 'enroll-once' || rule.activation === 'recurring';

/** An `enroll-once` rule tied to a `chosen` category is enrolled by choosing that category (Bank of
 * America's 3% choice category, U.S. Bank Smartly Self-Select): the choice question is also its
 * activation question, so the shopper is asked once (Stage 2 M7). */
export function enrolledByChoice(card: CardProductV3, rule: RewardRuleV3): boolean {
  if (rule.activation !== 'enroll-once' || rule.choice === null) return false;
  return card.choices.find((c) => c.id === rule.choice!.choiceId)?.kind === 'chosen';
}

/** The card's base: its one unconditional `all-purchases` rule (closed-loop cards may have none). */
export function baseRuleV3(card: CardProductV3): RewardRuleV3 | undefined {
  return card.rules.find((r) => r.category === 'all-purchases' && isUnconditionalRuleV3(r));
}

/** The rule whose usage row records the spend toward a shared cap: the group's rule with the
 * smallest ID (code-unit order), which does not depend on the order of the card's rules. */
export function capHolder(card: CardProductV3, rule: RewardRuleV3): RewardRuleV3 {
  if (rule.sharedCapId === null) return rule;
  return card.rules
    .filter((r) => r.sharedCapId === rule.sharedCapId)
    .reduce((holder, r) => (r.id < holder.id ? r : holder));
}

/** The catalog's merchant profiles plus the generic profile unless the catalog defines that id. */
export function merchantProfilesV3(catalog: CatalogV3): MerchantProfileV3[] {
  return catalog.merchants.some((m) => m.id === GENERIC_MERCHANT_ID)
    ? catalog.merchants
    : [...catalog.merchants, GENERIC_MERCHANT_PROFILE];
}

/** Whether a rule's merchant scope and category cover a merchant, before any purchase detail. */
export function ruleCoversMerchant(rule: RewardRuleV3, merchant: MerchantProfileV3): boolean {
  if (PORTALS.has(rule.category)) return false;
  const brands = new Set(merchant.brandIds);
  if (rule.brandIds.length > 0 && !rule.brandIds.some((id) => brands.has(id))) return false;
  if (rule.excludedBrandIds.some((id) => brands.has(id))) return false;
  if (rule.category === 'all-purchases') return true;
  if (rule.category === 'other') return rule.brandIds.length > 0;
  if (rule.category === 'online-retail') return merchant.onlineRetail && merchant.physicalGoods;
  return rule.category === merchant.expectedCategory;
}

/** Whether a closed-loop card is accepted at the merchant; open-loop cards always are. */
export function cardAcceptedAt(card: CardProductV3, merchant: MerchantProfileV3): boolean {
  return (
    card.acceptance.kind === 'open-loop' ||
    card.acceptance.brandIds.some((id) => merchant.brandIds.includes(id))
  );
}

/** The value per unit for a card: override, then the card's stated value, then the program's. */
export function unitValueFor(
  card: CardProductV3,
  program: RewardProgram,
  overrides: Wallet['valueOverrides'],
): UnitValue | null {
  const override = overrides?.find((o) => o.programId === program.id);
  if (override) return { hundredthsOfCent: override.valueHundredthsOfCent, basis: 'override' };
  if (card.statedValueHundredthsOfCent !== null)
    return { hundredthsOfCent: card.statedValueHundredthsOfCent, basis: 'card-stated' };
  if (program.valuation.basis === 'none') return null;
  return { hundredthsOfCent: program.valuation.valueHundredthsOfCent, basis: program.valuation.basis };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function validateCatalog(catalog: CatalogV3, wallet: Wallet, purchase: Purchase) {
  const sources = new Set(catalog.sources.map((s) => s.id));
  const programs = new Map(catalog.programs.map((p) => [p.id, p]));
  const gates = new Map(catalog.gates.map((g) => [g.id, g]));
  if (
    !catalog.version ||
    !Number.isFinite(Date.parse(catalog.verifiedAt)) ||
    Date.parse(catalog.expiresAt) <= Date.parse(catalog.verifiedAt) ||
    !unique(catalog.cards.map((c) => c.id)) ||
    !unique(catalog.merchants.map((m) => m.id)) ||
    sources.size !== catalog.sources.length ||
    programs.size !== catalog.programs.length ||
    gates.size !== catalog.gates.length ||
    (purchase.paymentPath !== undefined && !PAYMENT_PATHS_V3.includes(purchase.paymentPath))
  )
    throw new Error('Invalid comparison input.');
  for (const program of catalog.programs)
    if (
      (program.valuation.basis !== 'none' && !integer(program.valuation.valueHundredthsOfCent, 1, 10_000)) ||
      (program.currency === 'cash-back') !== (program.valuation.basis === 'cash') ||
      (program.valuation.basis === 'cash' && program.valuation.valueHundredthsOfCent !== 100)
    )
      throw new Error('Invalid catalog program.');
  for (const card of catalog.cards) {
    const bases = card.rules.filter((r) => r.category === 'all-purchases' && isUnconditionalRuleV3(r));
    if (
      !programs.has(card.programId) ||
      (card.statedValueHundredthsOfCent !== null &&
        (!integer(card.statedValueHundredthsOfCent, 1, 10_000) ||
          programs.get(card.programId)!.currency !== 'points')) ||
      (card.acceptance.kind === 'open-loop' ? bases.length !== 1 : bases.length > 1) ||
      !unique(card.rules.map((r) => r.id)) ||
      !unique(card.choices.map((c) => c.id))
    )
      throw new Error('Unsupported catalog rules.');
    const baseBps = bases[0]?.rateBps ?? 0;
    for (const rule of card.rules) {
      const holder = capHolder(card, rule);
      const choice = rule.choice && card.choices.find((c) => c.id === rule.choice!.choiceId);
      if (
        !integer(baseBps, 0, 10_000) ||
        !integer(rule.rateBps, baseBps, 10_000) ||
        !integer(rule.paidOnPaymentBps, 0, rule.rateBps) ||
        (rule.cap.kind === 'spend' &&
          (!integer(rule.cap.amountCents, 1, Number.MAX_SAFE_INTEGER) ||
            !integer(rule.cap.rateAfterCapBps, 0, rule.rateBps))) ||
        (rule.sharedCapId !== null &&
          (rule.cap.kind !== 'spend' ||
            holder.cap.kind !== 'spend' ||
            holder.cap.amountCents !== rule.cap.amountCents ||
            holder.cap.period !== rule.cap.period)) ||
        (rule.choice !== null && !choice?.options.some((o) => o.id === rule.choice!.optionId)) ||
        rule.requires.some((r) => !gates.has(r.gateId)) ||
        !rule.sourceIds.length ||
        rule.sourceIds.some((id) => !sources.has(id))
      )
        throw new Error('Invalid catalog rule.');
    }
  }
  for (const owned of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === owned.cardId);
    if (!card) continue;
    if (owned.usage.some((u) => !card.rules.some((r) => r.id === u.ruleId)))
      throw new Error('Invalid wallet usage.');
    const choices = owned.choices ?? [];
    if (
      !Array.isArray(choices) ||
      !choices.every(
        (c) =>
          isObject(c) &&
          typeof c.choiceId === 'string' &&
          Array.isArray(c.optionIds) &&
          c.optionIds.every((id) => typeof id === 'string'),
      ) ||
      !unique(choices.map((c) => c.choiceId)) ||
      choices.some((picked) => {
        const choice = card.choices.find((c) => c.id === picked.choiceId);
        return (
          choice?.kind !== 'chosen' ||
          !unique(picked.optionIds) ||
          !integer(picked.optionIds.length, 1, choice.picks) ||
          picked.optionIds.some((id) => !choice.options.some((o) => o.id === id))
        );
      })
    )
      throw new Error('Invalid wallet choices.');
  }
  const answers = wallet.gates ?? [];
  if (
    !Array.isArray(answers) ||
    !answers.every((a) => isObject(a) && typeof a.gateId === 'string' && typeof a.optionId === 'string') ||
    !unique(answers.map((a) => a.gateId)) ||
    answers.some((a) => !gates.get(a.gateId)?.options.some((o) => o.id === a.optionId))
  )
    throw new Error('Invalid wallet gates.');
  const overrides = wallet.valueOverrides ?? [];
  if (
    !Array.isArray(overrides) ||
    !overrides.every((o) => isObject(o) && typeof o.programId === 'string') ||
    !unique(overrides.map((o) => o.programId)) ||
    overrides.some(
      (o) => programs.get(o.programId)?.currency !== 'points' || !integer(o.valueHundredthsOfCent, 1, 10_000),
    )
  )
    throw new Error('Invalid value override.');
}

type Context = {
  card: CardProductV3;
  owned: WalletCard;
  merchant: MerchantProfileV3;
  purchase: Purchase;
  verifiedOn: string;
  /** The wallet's gate answers, shared by every card. */
  gates: WalletGate[];
  usageFor: (rule: RewardRuleV3) => RuleUsage | undefined;
  /** Reward numerator in the card's shown measure: cents, or units when unvalued. */
  measure: (numerator: bigint) => number;
};

type Option = {
  rule: RewardRuleV3;
  min: bigint;
  max: bigint;
  minBonusSpend: number;
  maxBonusSpend: number;
  uncertainties: UncertaintyV3[];
  status: RuleStatusV3;
  /** Requirements on gates the shopper has not answered. */
  open: RewardRuleV3['requires'];
  /** `min` and `minBonusSpend` once every open requirement is known to be met. */
  minIfMet: bigint;
  minBonusSpendIfMet: number;
};

const big = {
  max: (a: bigint, b: bigint) => (a > b ? a : b),
  min: (a: bigint, b: bigint) => (a < b ? a : b),
  desc: (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0),
};

/** Returns why a rule cannot apply here, or null when it may. */
function blocked(rule: RewardRuleV3, ctx: Context): RuleStatusV3 | null {
  const { card, owned, merchant, purchase } = ctx;
  if (PORTALS.has(rule.category) || (rule.category === 'other' && rule.brandIds.length === 0))
    return 'not-at-merchant';
  const endsOn = rule.limitedTime?.endsOn;
  if (endsOn && (endsOn < purchase.purchasedOn || endsOn < ctx.verifiedOn)) return 'expired';
  const startsOn = rule.limitedTime?.startsOn;
  if (startsOn && startsOn > purchase.purchasedOn) return 'not-started';
  if (!ruleCoversMerchant(rule, merchant)) return 'not-at-merchant';
  if (rule.category === 'online-retail' && purchase.onlineRetail === 'ineligible') return 'not-eligible';
  if (rule.usMerchantsOnly && !merchant.usMerchant) return 'not-eligible';
  const path = purchase.paymentPath ?? 'card';
  if (path !== 'card' && rule.excludedPaymentPaths.includes(path)) return 'not-eligible';
  if (rule.requiredPaymentPaths.length > 0 && !rule.requiredPaymentPaths.includes(path))
    return 'not-eligible';
  // A chosen category is its own enrollment (`enrolledByChoice`); a leftover activation row is ignored.
  if (needsActivation(rule) && !enrolledByChoice(card, rule) && ctx.usageFor(rule)?.activation === 'inactive')
    return 'not-eligible';
  if (rule.choice) {
    const choice = card.choices.find((c) => c.id === rule.choice!.choiceId)!;
    const picked = owned.choices?.find((c) => c.choiceId === choice.id);
    if (choice.kind === 'chosen' && picked && !picked.optionIds.includes(rule.choice.optionId))
      return 'choice-not-selected';
  }
  for (const requirement of rule.requires) {
    const answer = ctx.gates.find((g) => g.gateId === requirement.gateId);
    if (answer && !requirement.optionIds.includes(answer.optionId)) return 'condition-not-met';
  }
  return null;
}

function evaluate(rule: RewardRuleV3, ctx: Context, baseNumerator: bigint): Option {
  const { card, owned, purchase } = ctx;
  const amount = purchase.amountCents;
  const usage = ctx.usageFor(rule);
  const uncertain: UncertaintyV3[] = [];
  if (rule.category === 'online-retail' && purchase.onlineRetail === 'unknown')
    uncertain.push('online-category-unknown');
  const path = purchase.paymentPath ?? 'card';
  if (path !== 'card' && !rule.requiredPaymentPaths.includes(path)) uncertain.push('payment-path-uncertain');
  // Choosing the category is the enrollment: answered, it applies or is `choice-not-selected`;
  // unanswered, `choice-unknown` already covers it.
  if (needsActivation(rule) && usage?.activation !== 'active' && !enrolledByChoice(card, rule))
    uncertain.push('activation-unknown');
  if (rule.cap.kind === 'unstated') uncertain.push('cap-unstated');
  if (rule.choice) {
    const choice = card.choices.find((c) => c.id === rule.choice!.choiceId)!;
    if (choice.kind === 'automatic') uncertain.push('automatic-category');
    else if (!owned.choices?.some((c) => c.choiceId === choice.id)) uncertain.push('choice-unknown');
  }
  const open = rule.requires.filter((r) => !ctx.gates.some((g) => g.gateId === r.gateId));
  if (open.length > 0) uncertain.push('condition-unknown');

  let minBonus = amount,
    maxBonus = amount,
    afterBps = rule.rateBps;
  const capCodes: UncertaintyV3[] = [];
  if (rule.cap.kind === 'spend') {
    afterBps = rule.cap.rateAfterCapBps;
    // A shared cap's spend is recorded once, on the group's first rule.
    const spent = ctx.usageFor(capHolder(card, rule))?.spentCents ?? null;
    if (spent === null) {
      capCodes.push(YEARLY.has(rule.cap.period) ? 'annual-usage-unknown' : 'cap-usage-unknown');
      minBonus = 0;
      maxBonus = Math.min(amount, rule.cap.amountCents);
    } else minBonus = maxBonus = Math.min(amount, Math.max(0, rule.cap.amountCents - spent));
  }
  const reward = (bonus: number) =>
    portionNumerator([
      { spendCents: bonus, bps: rule.rateBps },
      { spendCents: amount - bonus, bps: afterBps },
    ]);
  const ruleMin = reward(minBonus),
    ruleMax = reward(maxBonus);
  const certain = uncertain.length === 0;
  const certainIfMet = uncertain.length === (open.length > 0 ? 1 : 0);
  const min = certain ? ruleMin : big.min(baseNumerator, ruleMin);
  const max = certain ? ruleMax : big.max(baseNumerator, ruleMax);
  // Report only conditions that can move the shown amount (cents, or units when unvalued).
  const moves = ctx.measure(max) > ctx.measure(min);
  return {
    rule,
    min,
    max,
    minBonusSpend: certain ? minBonus : 0,
    maxBonusSpend: maxBonus,
    uncertainties: moves ? [...uncertain, ...capCodes] : [],
    status: maxBonus === 0 ? 'cap-reached' : moves ? 'may-apply' : 'applied',
    open,
    minIfMet: certainIfMet ? ruleMin : big.min(baseNumerator, ruleMin),
    minBonusSpendIfMet: certainIfMet ? minBonus : 0,
  };
}

/** Most answer combinations enumerated for a card's unanswered gates. Real cards need a handful
 * (one or two gates, two or three distinct answers each); past this the card falls back to the
 * conservative base-to-rule ranges, which keeps a 180-card wallet fast (2026-10-02 review). */
const MAX_GATE_COMBINATIONS = 64;

/**
 * The card's guaranteed numerator and the rule that sets it. With every gate answered (or none
 * involved) that is the best option's minimum. With unanswered gates it is the worst case over the
 * possible answers of the best minimum each answer allows, so a gate whose every answer earns a
 * bonus (Prime member 5%, not a member 3%) does not drop the minimum to the base. Answers are
 * grouped by which requirements they meet, which keeps the enumeration small.
 */
function guaranteed(
  options: Option[],
  baseNumerator: bigint,
  catalog: CatalogV3,
): { min: bigint; floor?: Option; floorBonusSpend: number } {
  const best = (candidates: { option: Option; min: bigint; bonus: number }[]) => {
    const top = candidates.sort(
      (a, b) =>
        big.desc(a.min, b.min) ||
        big.desc(a.option.max, b.option.max) ||
        b.option.rule.rateBps - a.option.rule.rateBps,
    )[0];
    return {
      min: big.max(baseNumerator, top?.min ?? baseNumerator),
      floor: top?.option,
      floorBonusSpend: top?.bonus ?? 0,
    };
  };
  const all = options.map((o) => ({ option: o, min: o.min, bonus: o.minBonusSpend }));
  const gateIds = [...new Set(options.flatMap((o) => o.open.map((r) => r.gateId)))];
  if (gateIds.length === 0) return best(all);
  const answerSets = gateIds.map((gateId) => {
    const requirements = options.flatMap((o) => o.open.filter((r) => r.gateId === gateId));
    const classes = new Map<string, string>();
    for (const { id } of catalog.gates.find((g) => g.id === gateId)!.options) {
      const key = requirements.map((r) => (r.optionIds.includes(id) ? 1 : 0)).join('');
      if (!classes.has(key)) classes.set(key, id);
    }
    return [...classes.values()];
  });
  if (answerSets.reduce((n, set) => n * set.length, 1) > MAX_GATE_COMBINATIONS) return best(all);
  let worst: ReturnType<typeof best> | undefined;
  const visit = (index: number, answers: Map<string, string>) => {
    if (index === gateIds.length) {
      const allowed = options
        .filter((o) => o.open.every((r) => r.optionIds.includes(answers.get(r.gateId)!)))
        .map((o) =>
          o.open.length > 0
            ? { option: o, min: o.minIfMet, bonus: o.minBonusSpendIfMet }
            : { option: o, min: o.min, bonus: o.minBonusSpend },
        );
      const result = best(allowed);
      if (!worst || result.min < worst.min) worst = result;
      return;
    }
    for (const answer of answerSets[index]) visit(index + 1, new Map(answers).set(gateIds[index], answer));
  };
  visit(0, new Map());
  return worst!;
}

function estimateCard(
  catalog: CatalogV3,
  card: CardProductV3,
  program: RewardProgram,
  owned: WalletCard,
  wallet: Wallet,
  merchant: MerchantProfileV3,
  purchase: Purchase,
  verifiedOn: string,
): CardEstimate {
  const year = Number(purchase.purchasedOn.slice(0, 4));
  const value = unitValueFor(card, program, wallet.valueOverrides);
  const ctx: Context = {
    card,
    owned,
    merchant,
    purchase,
    verifiedOn,
    gates: wallet.gates ?? [],
    // Only same-day usage for this year counts; stale usage is unknown, not zero.
    usageFor: (rule) =>
      owned.usage.find(
        (u) => u.ruleId === rule.id && u.calendarYear === year && u.recordedOn === purchase.purchasedOn,
      ),
    measure: (n) => (value ? numeratorCents(n, value.hundredthsOfCent) : numeratorUnits(n)),
  };
  const base = baseRuleV3(card);
  const baseNumerator = base
    ? portionNumerator([{ spendCents: purchase.amountCents, bps: base.rateBps }])
    : 0n;
  const statuses: { ruleId: string; status: RuleStatusV3 }[] = [];
  const options: Option[] = [];
  for (const rule of card.rules) {
    if (rule === base) {
      statuses.push({ ruleId: rule.id, status: 'base' });
      continue;
    }
    const why = blocked(rule, ctx);
    if (why) {
      statuses.push({ ruleId: rule.id, status: why });
      continue;
    }
    const option = evaluate(rule, ctx, baseNumerator);
    options.push(option);
    statuses.push({ ruleId: rule.id, status: option.status });
  }
  const byMax = [...options].sort(
    (a, b) => big.desc(a.max, b.max) || big.desc(a.min, b.min) || b.rule.rateBps - a.rule.rateBps,
  );
  const ceiling = byMax[0];
  // The base is always an option: no rule (e.g. a low after-cap rate) can pull a card below it.
  const { min, floor, floorBonusSpend } = guaranteed(options, baseNumerator, catalog);
  const max = big.max(baseNumerator, ceiling?.max ?? baseNumerator);
  const codes = new Set(
    options.filter((o) => ctx.measure(o.max) > ctx.measure(min)).flatMap((o) => o.uncertainties),
  );
  const maxUnits = numeratorUnits(max);
  if (!value && maxUnits > 0) codes.add('value-unknown');
  const shown = ceiling && ceiling.maxBonusSpend > 0 ? ceiling : undefined;
  const applied = shown?.rule ?? base;
  return {
    cardId: card.id,
    minRewardCents: value ? numeratorCents(min, value.hundredthsOfCent) : 0,
    maxRewardCents: value ? numeratorCents(max, value.hundredthsOfCent) : 0,
    baseRateBps: base?.rateBps ?? 0,
    bonusRateBps: shown?.rule.rateBps ?? null,
    minBonusSpendCents: shown && shown === floor ? floorBonusSpend : 0,
    maxBonusSpendCents: shown?.maxBonusSpend ?? 0,
    uncertainties: UNCERTAINTIES_V3.filter((code) => codes.has(code)),
    sourceIds: [
      ...new Set([...(base ? [base] : []), ...options.map((o) => o.rule)].flatMap((r) => r.sourceIds)),
    ],
    appliedRuleId: applied?.id,
    paidOnPaymentBps: applied?.paidOnPaymentBps ?? 0,
    rules: statuses,
    programId: program.id,
    minRewardUnits: numeratorUnits(min),
    maxRewardUnits: maxUnits,
    unitValue: value,
  };
}

function notAcceptedEstimate(card: CardProductV3, program: RewardProgram, wallet: Wallet): CardEstimate {
  return {
    cardId: card.id,
    minRewardCents: 0,
    maxRewardCents: 0,
    baseRateBps: baseRuleV3(card)?.rateBps ?? 0,
    bonusRateBps: null,
    minBonusSpendCents: 0,
    maxBonusSpendCents: 0,
    uncertainties: [],
    sourceIds: [...new Set(card.rules.flatMap((r) => r.sourceIds))],
    rules: card.rules.map((r) => ({ ruleId: r.id, status: 'not-accepted' })),
    programId: program.id,
    minRewardUnits: 0,
    maxRewardUnits: 0,
    unitValue: unitValueFor(card, program, wallet.valueOverrides),
  };
}

/** Orders valued cards by guaranteed minimum cents, then unvalued cards by guaranteed minimum
 * units, each with the default card and then the card ID breaking ties. Exception: a valued card
 * whose maximum is $0 ranks below an unvalued card that guarantees units, since any positive value
 * beats $0 (no value is assumed); it stays above unvalued cards that guarantee none. An unvalued
 * card that earns any units may beat a valued leader once the shopper sets a value, so it sets
 * `rankingMayChange`; among unvalued cards only the same program's units are comparable. */
function rankV3(
  estimates: CardEstimate[],
  notAccepted: CardEstimate[],
  wallet: Wallet,
  catalogVersion: string,
): Comparison {
  const valued = (e: CardEstimate) => e.unitValue != null;
  // 0: valued and may earn cents; 1: unvalued with guaranteed units; 2: valued, $0 at most;
  // 3: unvalued with no guaranteed units.
  const tier = (e: CardEstimate) =>
    valued(e) ? (e.maxRewardCents > 0 ? 0 : 2) : e.minRewardUnits! > 0 ? 1 : 3;
  estimates.sort(
    (a, b) =>
      tier(a) - tier(b) ||
      (valued(a) ? b.minRewardCents - a.minRewardCents : b.minRewardUnits! - a.minRewardUnits!) ||
      Number(b.cardId === wallet.defaultCardId) - Number(a.cardId === wallet.defaultCardId) ||
      a.cardId.localeCompare(b.cardId, 'en'),
  );
  const first = estimates[0];
  const others = estimates.slice(1);
  const comparable = (e: CardEstimate) =>
    valued(first) ? valued(e) : !valued(e) && e.programId === first.programId;
  const mayBeat = (e: CardEstimate) =>
    comparable(e)
      ? valued(e)
        ? e.maxRewardCents > first.minRewardCents
        : e.maxRewardUnits! > first.minRewardUnits!
      : e.maxRewardUnits! > 0;
  const ties = (e: CardEstimate) =>
    comparable(e) &&
    (valued(e) ? e.minRewardCents === first.minRewardCents : e.minRewardUnits === first.minRewardUnits);
  return {
    status: 'ready',
    catalogVersion,
    estimates,
    notAccepted,
    preferredCardId: first.cardId,
    rankingMayChange: others.some(mayBeat),
    tied: others.some(ties),
  };
}

export function compareV3(
  catalog: CatalogV3,
  wallet: Wallet,
  purchase: Purchase,
  now: number,
): Comparison | UnavailableComparison {
  validatePurchaseAndWallet(wallet, purchase, now);
  validateCatalog(catalog, wallet, purchase);
  const merchants = merchantProfilesV3(catalog);
  const unavailable = unavailableReason(
    catalog,
    merchants.map((m) => m.id),
    wallet,
    purchase,
    now,
  );
  if (unavailable) return unavailable;
  const merchant = merchants.find((m) => m.id === purchase.merchantId)!;
  const verifiedOn = catalog.verifiedAt.slice(0, 10);
  const estimates: CardEstimate[] = [],
    notAccepted: CardEstimate[] = [];
  for (const owned of wallet.cards) {
    const card = catalog.cards.find((c) => c.id === owned.cardId)!;
    const program = catalog.programs.find((p) => p.id === card.programId)!;
    if (cardAcceptedAt(card, merchant))
      estimates.push(estimateCard(catalog, card, program, owned, wallet, merchant, purchase, verifiedOn));
    else notAccepted.push(notAcceptedEstimate(card, program, wallet));
  }
  if (estimates.length === 0) return { status: 'unavailable', reason: 'no-accepted-card' };
  return rankV3(estimates, notAccepted, wallet, catalog.version);
}
