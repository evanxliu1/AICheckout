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

export interface Catalog {
  schemaVersion: 1;
  version: string;
  verifiedAt: string;
  expiresAt: string;
  merchantIds: string[];
  sources: Source[];
  cards: CardProduct[];
}

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
}

export type Uncertainty = 'online-category-unknown' | 'annual-usage-unknown' | 'activation-unknown';

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
  reason: 'catalog-expired' | 'catalog-not-yet-valid' | 'unsupported-merchant' |
    'no-owned-cards' | 'unknown-owned-card' | 'purchase-not-confirmed' | 'ineligible-purchase';
}
