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

export type Catalog = CatalogV1 | CatalogV2;

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
