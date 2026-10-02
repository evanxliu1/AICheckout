export type Eligibility = 'eligible' | 'ineligible' | 'unknown';

export interface Source {
  id: string;
  title: string;
  url: string;
  checkedOn: string;
}

/** Rates are hundredths of one percent: 150 basis points = 1.5%. */
export interface RewardRule {
  id: string;
  category: 'all-eligible' | 'us-online-retail';
  rateBps: number;
  annualCapCents?: number;
  requiresActivation: boolean;
  sourceIds: string[];
}

export interface CardProduct {
  id: string;
  name: string;
  shortName: string;
  rules: RewardRule[];
}

/** Catalog schema 1: the pilot shape (base + one U.S. online retail bonus). Kept readable for
 * cached releases and v1 drafts. */
export interface CatalogV1 {
  schemaVersion: 1;
  version: string;
  verifiedAt: string;
  expiresAt: string;
  merchantIds: string[];
  sources: Source[];
  cards: CardProduct[];
}

/** Shared reward categories, identical to extraction v2 (apps/api/src/curation/v2/schema.ts). */
export const REWARD_CATEGORIES = [
  'all-purchases',
  'online-retail',
  'supermarkets',
  'gas',
  'ev-charging',
  'dining',
  'drugstores',
  'entertainment',
  'streaming',
  'transit',
  'travel-portal',
  'entertainment-portal',
  'other',
] as const;
export type RewardCategory = (typeof REWARD_CATEGORIES)[number];
/** Categories a merchant profile can be expected to code as (MCC-group rules match on these). */
export const MERCHANT_CATEGORIES = [
  'electronics',
  'general-merchandise',
  'supermarkets',
  'gas',
  'ev-charging',
  'dining',
  'drugstores',
  'entertainment',
  'streaming',
  'transit',
] as const;
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];
export const CAP_PERIODS = [
  'calendar-year',
  'cardmember-year',
  'billing-cycle',
  'quarter',
  'month',
  'year-unspecified',
] as const;
export type CapPeriod = (typeof CAP_PERIODS)[number];
export const PAYMENT_PATHS = ['card', 'paypal', 'digital-wallet', 'bnpl'] as const;
/** How the shopper pays at checkout; non-card paths make channel/category bonuses uncertain. */
export type PaymentPath = (typeof PAYMENT_PATHS)[number];
/** Paths a rule can exclude; a card payment is the baseline and can't be excluded. */
export const EXCLUDABLE_PAYMENT_PATHS = ['paypal', 'digital-wallet', 'bnpl'] as const;

export type RuleCap =
  | { kind: 'none' }
  | { kind: 'spend'; amountCents: number; period: CapPeriod; rateAfterCapBps: number }
  | { kind: 'unstated' };

/** A reviewed earning rule. `rateBps` is the total rate, including any paid-on-payment part. */
export interface RewardRuleV2 {
  id: string;
  category: RewardCategory;
  /** The issuer's own name for the category, shown to shoppers. */
  issuerWording: string;
  rateBps: number;
  /** Portion of rateBps earned only when the balance is paid (Citi "1% as you pay"). */
  paidOnPaymentBps: number;
  cap: RuleCap;
  /** `unstated`: the issuer's pages don't mention activation; treated like `none`. */
  activation: 'none' | 'enroll-once' | 'recurring' | 'unstated';
  usMerchantsOnly: boolean;
  /** Payment paths the issuer excludes from this rule (Amex online retail excludes BNPL). */
  excludedPaymentPaths: (typeof EXCLUDABLE_PAYMENT_PATHS)[number][];
  /** Promotional rule; an `endsOn` before the purchase date means it never applies. */
  limitedTime: { endsOn: string | null } | null;
  sourceIds: string[];
}

export interface CardProductV2 {
  id: string;
  name: string;
  shortName: string;
  issuer: string;
  rewardCurrency: 'cash-back' | 'points';
  /** Cash value of one point in hundredths of a cent; null for cash back. */
  pointValueHundredthsOfCent: number | null;
  rules: RewardRuleV2[];
  /** Purchases that never earn rewards, as the issuer states them. */
  exclusions: string[];
}

export interface MerchantProfile {
  id: string;
  name: string;
  onlineRetail: boolean;
  physicalGoods: boolean;
  usMerchant: boolean;
  expectedCategory: MerchantCategory;
  /** Expected merchant category code; `code` is null when no evidence exists. */
  mcc: { code: string | null; confidence: 'low' | 'medium' | 'high'; sourceIds: string[] };
  notes: string;
}

/** Catalog schema 2: reviewed values the engine computes with (not the extraction schema). */
export interface CatalogV2 {
  schemaVersion: 2;
  version: string;
  verifiedAt: string;
  expiresAt: string;
  merchants: MerchantProfile[];
  sources: Source[];
  cards: CardProductV2[];
}

/** Catalog schema 3 adds these to the shared categories. Provisional (Stage 2 M1): only categories
 * that a chosen, automatic or rotating option names and that a retail checkout can code as.
 * The overlay milestone (M4) finalizes the list; the SQL mirror is
 * `catalog_private.catalog_v3_reward_categories()`, replaced in the same change. */
export const REWARD_CATEGORIES_V3 = [
  ...REWARD_CATEGORIES,
  'electronics',
  'department-stores',
  'home-improvement',
  'wholesale-clubs',
] as const;
export type RewardCategoryV3 = (typeof REWARD_CATEGORIES_V3)[number];
/** Merchant categories for catalog schema 3 (SQL: `catalog_v3_merchant_categories()`). */
export const MERCHANT_CATEGORIES_V3 = [
  ...MERCHANT_CATEGORIES,
  'department-stores',
  'home-improvement',
  'wholesale-clubs',
] as const;
export type MerchantCategoryV3 = (typeof MERCHANT_CATEGORIES_V3)[number];
/** Catalog schema 3 payment paths: schema 2's plus Venmo. */
export const PAYMENT_PATHS_V3 = ['card', 'paypal', 'venmo', 'digital-wallet', 'bnpl'] as const;
export type PaymentPathV3 = (typeof PAYMENT_PATHS_V3)[number];
export const EXCLUDABLE_PAYMENT_PATHS_V3 = ['paypal', 'venmo', 'digital-wallet', 'bnpl'] as const;
export const RULE_STATUSES_V3 = [
  'applied',
  'may-apply',
  'base',
  'not-at-merchant',
  'not-eligible',
  'expired',
  'cap-reached',
  /** A closed-loop card is not accepted at this merchant. */
  'not-accepted',
  /** The rule's `limitedTime.startsOn` is after the purchase date. */
  'not-started',
  /** The shopper chose a different option. */
  'choice-not-selected',
  /** The shopper said they do not meet a gate the rule requires. */
  'condition-not-met',
] as const;
export type RuleStatusV3 = (typeof RULE_STATUSES_V3)[number];

/** How a program's reward units convert to cents, in hundredths of a cent per unit. */
export type ProgramValuation =
  /** Cash back: one unit is one cent. */
  | { basis: 'cash'; valueHundredthsOfCent: 100 }
  /** A published cents-per-point estimate: an opinion, labelled with its publisher and date. */
  | {
      basis: 'published-estimate';
      valueHundredthsOfCent: number;
      publisher: string;
      url: string;
      retrievedOn: string;
    }
  /** A fixed value the issuer states in a captured source. */
  | { basis: 'issuer-stated'; valueHundredthsOfCent: number; sourceIds: string[] }
  /** No value: the card shows units only until the shopper sets one. */
  | { basis: 'none' };

export interface RewardProgram {
  id: string;
  name: string;
  currency: 'cash-back' | 'points';
  /** Plural unit name shown with amounts ("points", "miles", "Reward Dollars"). */
  unitName: string;
  valuation: ProgramValuation;
  /** Brands where the rewards can be redeemed; empty when not limited to a store. */
  redemptionBrandIds: string[];
}

/** A merchant brand that rules and closed-loop cards are scoped to (Amazon, Whole Foods, Gap). */
export interface Brand {
  id: string;
  name: string;
}

/** A question about the cardholder (membership, tier, relationship) that rules can require. */
export interface Gate {
  id: string;
  question: string;
  options: { id: string; label: string }[];
}

/** Categories the cardholder picks (`chosen`) or the issuer determines from spend (`automatic`). */
export interface CardChoice {
  id: string;
  kind: 'chosen' | 'automatic';
  label: string;
  /** How many options earn at the same time (Cash+ two 5% categories: 2). */
  picks: number;
  options: { id: string; label: string }[];
  /** Options in effect until the cardholder changes them; always empty for `automatic`. */
  defaultOptionIds: string[];
}

export interface RewardRuleV3 extends Omit<
  RewardRuleV2,
  'category' | 'excludedPaymentPaths' | 'limitedTime'
> {
  category: RewardCategoryV3;
  excludedPaymentPaths: (typeof EXCLUDABLE_PAYMENT_PATHS_V3)[number][];
  /** Promotional or rotating rule: applies from `startsOn` through `endsOn`, where each is set. */
  limitedTime: { startsOn: string | null; endsOn: string | null } | null;
  /** Merchant scope: when non-empty, the rule applies only at merchants with one of these brands. */
  brandIds: string[];
  /** The rule earns only while this option of one of the card's choices is in effect. */
  choice: { choiceId: string; optionId: string } | null;
  /** Every listed gate must be answered with one of its `optionIds`. */
  requires: { gateId: string; optionIds: string[] }[];
  /** When non-empty, the rule applies only when paying through one of these paths. */
  requiredPaymentPaths: PaymentPathV3[];
}

export interface CardProductV3 {
  id: string;
  name: string;
  shortName: string;
  issuer: string;
  programId: string;
  /** Issuer-stated cash value of one unit for this card (corpus `pointValueHundredthsOfCent`);
   * only on points programs. */
  statedValueHundredthsOfCent: number | null;
  /** `closed-loop` cards are accepted only at merchants with one of `brandIds`. */
  acceptance: { kind: 'open-loop' } | { kind: 'closed-loop'; brandIds: string[] };
  choices: CardChoice[];
  rules: RewardRuleV3[];
  exclusions: string[];
}

export interface MerchantProfileV3 extends Omit<MerchantProfile, 'expectedCategory'> {
  expectedCategory: MerchantCategoryV3;
  brandIds: string[];
}

/** Catalog schema 3: programs and point values, brands, gates, chosen categories, closed-loop
 * cards and larger limits (decision 2026-10-02-catalog-v3-schema). */
export interface CatalogV3 {
  schemaVersion: 3;
  version: string;
  verifiedAt: string;
  expiresAt: string;
  programs: RewardProgram[];
  brands: Brand[];
  gates: Gate[];
  merchants: MerchantProfileV3[];
  sources: Source[];
  cards: CardProductV3[];
}

export type Catalog = CatalogV1 | CatalogV2 | CatalogV3;

export interface RuleUsage {
  ruleId: string;
  calendarYear: number;
  recordedOn: string;
  spentCents: number | null;
  activation: 'active' | 'inactive' | 'unknown';
}

export interface WalletCard {
  cardId: string;
  usage: RuleUsage[];
}

export interface Wallet {
  cards: WalletCard[];
  defaultCardId: string | null;
}

export interface Purchase {
  merchantId: string;
  currency: 'USD';
  amountCents: number;
  /** Local purchase date, supplied by the caller; never inferred from item names. */
  purchasedOn: string;
  eligiblePurchase: Eligibility;
  onlineRetail: Eligibility;
  /** Catalog v2 only; defaults to `card`. */
  paymentPath?: PaymentPath;
}

export const UNCERTAINTIES = [
  'online-category-unknown',
  'annual-usage-unknown',
  'activation-unknown',
  'cap-usage-unknown',
  'cap-unstated',
  'payment-path-uncertain',
] as const;
export type Uncertainty = (typeof UNCERTAINTIES)[number];
/** Schema 2's uncertainty codes plus the ones the v3 engine (Stage 2 M2) reports. */
export const UNCERTAINTIES_V3 = [
  ...UNCERTAINTIES,
  /** The rule earns only on a chosen option and the shopper has not said which one is chosen. */
  'choice-unknown',
  /** The rule earns on an automatically determined top category; it cannot be known in advance. */
  'automatic-category',
  /** The rule needs a membership, tier or relationship the shopper has not confirmed. */
  'condition-unknown',
] as const;
export type UncertaintyV3 = (typeof UNCERTAINTIES_V3)[number];

/** Why a v2 rule did or did not count for this purchase. */
export type RuleStatus =
  'applied' | 'may-apply' | 'base' | 'not-at-merchant' | 'not-eligible' | 'expired' | 'cap-reached';

export interface CardEstimate {
  cardId: string;
  minRewardCents: number;
  maxRewardCents: number;
  baseRateBps: number;
  bonusRateBps: number | null;
  minBonusSpendCents: number;
  maxBonusSpendCents: number;
  uncertainties: Uncertainty[];
  sourceIds: string[];
  /** Catalog v2 only: the rule this estimate is about. That is the bonus rule with the highest
   * possible reward here (it sets `maxRewardCents`, `bonusRateBps` and the bonus spend), or the
   * base rule when no bonus can add anything. */
  appliedRuleId?: string;
  /** Catalog v2 only: the part of `appliedRuleId`'s rate earned when the balance is paid
   * (Citi Double Cash: 100 of 200). */
  paidOnPaymentBps?: number;
  rules?: { ruleId: string; status: RuleStatus }[];
}

export interface Comparison {
  status: 'ready';
  catalogVersion: string;
  /** Ordered by conservative estimate; the default card breaks exact ties. */
  estimates: CardEstimate[];
  preferredCardId: string;
  /** True when missing information could produce a different best card. */
  rankingMayChange: boolean;
  tied: boolean;
}

export interface UnavailableComparison {
  status: 'unavailable';
  reason:
    | 'catalog-expired'
    | 'catalog-not-yet-valid'
    | 'unsupported-merchant'
    | 'no-owned-cards'
    | 'unknown-owned-card'
    | 'purchase-not-confirmed'
    | 'ineligible-purchase';
}
