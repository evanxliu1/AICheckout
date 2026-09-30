import { needsActivation } from './engine-v2.ts';
import type {
  Catalog,
  CardProductV2,
  CardProduct,
  CatalogV2,
  RewardCategory,
  RewardRuleV2,
} from './types.ts';

/** Shopper-facing activation wording; `unstated` is shown, not treated as a requirement. */
export const ACTIVATION_LABELS: Record<RewardRuleV2['activation'], string> = {
  none: 'No activation needed',
  'enroll-once': 'Enroll once to earn this rate',
  recurring: 'Activate each period to earn this rate',
  unstated: 'Activation is not mentioned on the issuer’s pages',
};

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
  /** The rule needs enroll-once or recurring activation, so the shopper can confirm it. */
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
        (rule.cap.kind === 'spend' || needsActivation(rule)) &&
        canApplySomewhere(catalog, rule.category),
    )
    .map((rule) => ({
      ruleId: rule.id,
      label: CATEGORY_LABELS[rule.category],
      needsSpend: rule.cap.kind === 'spend',
      needsActivation: needsActivation(rule),
    }));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const shiftInstant = (instant: string, days: number) =>
  new Date(Date.parse(instant) + days * DAY_MS).toISOString().replace('.000Z', 'Z');

/** Test support: moves a catalog's dates (verification, expiry, source checks, promotion ends)
 * so it is verified on `verifiedOn`, keeping every interval. Browser tests use this so they don't
 * expire with the real terms; release builds never re-date the bundled catalog. */
export function redateCatalog<T extends Catalog>(catalog: T, verifiedOn: string): T {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn)) throw new Error('verifiedOn must be YYYY-MM-DD.');
  const days = Math.round(
    (Date.parse(`${verifiedOn}T00:00:00Z`) - Date.parse(`${catalog.verifiedAt.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS,
  );
  const next = structuredClone(catalog);
  next.verifiedAt = shiftInstant(next.verifiedAt, days);
  next.expiresAt = shiftInstant(next.expiresAt, days);
  for (const source of next.sources) source.checkedOn = shiftDate(source.checkedOn, days);
  if (next.schemaVersion === 2)
    for (const card of next.cards)
      for (const rule of card.rules)
        if (rule.limitedTime?.endsOn) rule.limitedTime.endsOn = shiftDate(rule.limitedTime.endsOn, days);
  return next;
}
