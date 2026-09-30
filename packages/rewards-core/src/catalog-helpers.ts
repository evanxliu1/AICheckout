import type { Catalog, CardProductV2, CardProduct, CatalogV2, RewardCategory } from './types.ts';

/** Merchant IDs a catalog covers, for either schema version. */
export function catalogMerchantIds(catalog: Catalog): string[] {
  return catalog.schemaVersion === 2 ? catalog.merchants.map((m) => m.id) : catalog.merchantIds;
}

/** Short shopper-facing names for rule categories. */
export const CATEGORY_LABELS: Record<RewardCategory | 'all-eligible' | 'us-online-retail', string> = {
  'all-purchases': 'all purchases',
  'all-eligible': 'all purchases',
  'online-retail': 'online retail',
  'us-online-retail': 'online retail',
  supermarkets: 'supermarket',
  gas: 'gas station',
  'ev-charging': 'EV charging',
  dining: 'dining',
  drugstores: 'drugstore',
  entertainment: 'entertainment',
  streaming: 'streaming',
  transit: 'transit',
  'travel-portal': 'travel portal',
  'entertainment-portal': 'entertainment portal',
  other: 'other',
};

export type UsageInput = {
  ruleId: string;
  label: string;
  /** The rule has a spend cap, so remaining allowance changes the estimate. */
  needsSpend: boolean;
  /** The rule needs activation (or the terms don't say), so the shopper can confirm it. */
  needsActivation: boolean;
};

function canApplySomewhere(catalog: CatalogV2, category: RewardCategory) {
  if (category === 'online-retail') return catalog.merchants.some((m) => m.onlineRetail && m.physicalGoods);
  return catalog.merchants.some((m) => m.expectedCategory === category);
}

/** Rules for which the wallet can record spend or activation, limited to rules that can
 * apply at a merchant this catalog covers. */
export function usageInputs(catalog: Catalog, cardId: string): UsageInput[] {
  if (catalog.schemaVersion === 1) {
    const card: CardProduct | undefined = catalog.cards.find((c) => c.id === cardId);
    return (card?.rules ?? [])
      .filter((rule) => rule.annualCapCents !== undefined || rule.requiresActivation)
      .map((rule) => ({
        ruleId: rule.id,
        label: CATEGORY_LABELS[rule.category],
        needsSpend: rule.annualCapCents !== undefined,
        needsActivation: rule.requiresActivation,
      }));
  }
  const card: CardProductV2 | undefined = catalog.cards.find((c) => c.id === cardId);
  return (card?.rules ?? [])
    .filter(
      (rule) =>
        rule.category !== 'all-purchases' &&
        (rule.cap.kind === 'spend' || rule.activation !== 'none') &&
        canApplySomewhere(catalog, rule.category),
    )
    .map((rule) => ({
      ruleId: rule.id,
      label: CATEGORY_LABELS[rule.category],
      needsSpend: rule.cap.kind === 'spend',
      needsActivation: rule.activation !== 'none',
    }));
}
