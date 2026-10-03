import { z } from 'zod';
import {
  CATALOG_V3_LIMITS,
  MAX_AMOUNT_CENTS,
  PAYMENT_PATHS_V3,
  publishedReleaseSchema,
  RULE_STATUSES_V3,
  UNCERTAINTIES_V3,
} from '../domain';
import type { Catalog, Comparison, UnavailableComparison } from '../domain';
import { cartSnapshotSchema } from '../checkout/contracts';
import type { CardIndexEntry } from './catalog-slice';
import { MAX_WALLET_CARDS } from './keys';

const id = z.string().min(1).max(100);
const eligibility = z.enum(['eligible', 'ineligible', 'unknown']);
const money = z.number().int().min(0).max(MAX_AMOUNT_CENTS);
const unique = (values: string[]) => new Set(values).size === values.length;

/** The published catalog the shopper last accepted, kept under its own unencrypted storage key
 * (`CATALOG_KEY`) since state schema 3: it is public data, and keeping it out of the state keeps the
 * optional vault far below its 512 KiB limit. */
export const catalogCacheSchema = z.strictObject({
  release: publishedReleaseSchema.nullable(),
  lastCheckedAt: z.number().int().nonnegative().nullable(),
});
export type CatalogCache = z.infer<typeof catalogCacheSchema>;
export const emptyCatalogCache = (): CatalogCache => ({ release: null, lastCheckedAt: null });

const usageRowSchema = z.strictObject({
  ruleId: id,
  calendarYear: z.number().int().min(2000).max(9999),
  recordedOn: z.iso.date(),
  spentCents: money.nullable(),
  activation: z.enum(['active', 'inactive', 'unknown']),
});
const usageSchema = (max: number) =>
  z
    .array(usageRowSchema)
    .max(max)
    .refine((rows) => unique(rows.map((r) => r.ruleId)));
const cardsSchema = <T extends z.ZodType<{ cardId: string }>>(card: T) =>
  z
    .array(card)
    .max(MAX_WALLET_CARDS)
    .refine((cards) => unique(cards.map((c) => c.cardId)));
const defaultOwned = (w: { defaultCardId: string | null; cards: { cardId: string }[] }) =>
  w.defaultCardId === null || w.cards.some((c) => c.cardId === w.defaultCardId);

/** Wallet as saved by state schemas 1 and 2 (catalog v1/v2 era): usage rows only. */
const walletV2Schema = z
  .strictObject({
    cards: cardsSchema(z.strictObject({ cardId: id, usage: usageSchema(10) })),
    defaultCardId: id.nullable(),
  })
  .refine(defaultOwned);

/** State schema 3 wallet. Catalog v3 inputs are optional (v1 and v2 catalogs ignore them): per card
 * the chosen categories in effect, per wallet the gate answers (they describe the cardholder) and the
 * shopper's own point values. IDs must exist in the catalog in effect (`reconcileWallet`). */
export const walletSchema = z
  .strictObject({
    cards: cardsSchema(
      z.strictObject({
        cardId: id,
        usage: usageSchema(30),
        choices: z
          .array(
            z.strictObject({
              choiceId: id,
              optionIds: z.array(id).min(1).max(5).refine(unique),
            }),
          )
          .max(5)
          .refine((choices) => unique(choices.map((c) => c.choiceId)))
          .optional(),
      }),
    ),
    defaultCardId: id.nullable(),
    gates: z
      .array(z.strictObject({ gateId: id, optionId: id }))
      .max(100)
      .refine((gates) => unique(gates.map((g) => g.gateId)))
      .optional(),
    valueOverrides: z
      .array(z.strictObject({ programId: id, valueHundredthsOfCent: z.number().int().min(1).max(10_000) }))
      .max(100)
      .refine((overrides) => unique(overrides.map((o) => o.programId)))
      .optional(),
  })
  .refine(defaultOwned);
export type WalletState = z.infer<typeof walletSchema>;

export const purchaseSchema = z.strictObject({
  merchantId: id,
  currency: z.literal('USD'),
  amountCents: money.positive(),
  purchasedOn: z.iso.date(),
  eligiblePurchase: eligibility,
  onlineRetail: eligibility,
  paymentPath: z.enum(PAYMENT_PATHS_V3).optional(),
});

/** One order the shopper confirmed after a badge recommendation. Amounts are estimates: the cart
 * amount is the last cart reading (tax and shipping may differ), rewards are guaranteed minimums. */
export const savingsEntrySchema = z.strictObject({
  id: z.string().uuid(),
  date: z.iso.date(),
  recordedAt: z.number().int().nonnegative(),
  merchantId: id,
  cartAmountCents: money.positive(),
  recommendedCardId: id,
  /** null: the shopper was not sure which card they used. */
  usedCardId: id.nullable(),
  estimatedRewardCents: money.nullable(),
  /** What the default card would have earned; null when no default card was set. */
  baselineRewardCents: money.nullable(),
  /** estimatedRewardCents − baselineRewardCents; null when either is unknown. May be negative. */
  extraCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS).nullable(),
});
export type SavingsEntry = z.infer<typeof savingsEntrySchema>;
export const MAX_SAVINGS_ENTRIES = 500;

const comparisonMetaSchema = z
  .strictObject({
    inputRevision: z.number().int().nonnegative(),
    catalogVersion: id,
    computedAt: z.number().int().nonnegative(),
    cartId: z.string().uuid().nullable().default(null),
  })
  .nullable();
const commonFields = {
  revision: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
  purchase: purchaseSchema.nullable(),
  cart: cartSnapshotSchema.nullable().default(null),
  /** Orders recorded from the badge's one-tap question, newest first. */
  savings: z.array(savingsEntrySchema).max(MAX_SAVINGS_ENTRIES).default([]),
  /** A notice that must reach the shopper once (e.g. why migration dropped limits); kept until shown. */
  pendingNotice: z.string().min(1).max(300).nullable().default(null),
  comparison: comparisonMetaSchema,
};
/** Current state (schema 3: catalog v3 era). Everything written is this shape. The catalog cache
 * is not part of it; it lives under `CATALOG_KEY`. */
export const appStateSchema = z.strictObject({
  schemaVersion: z.literal(3),
  ...commonFields,
  wallet: walletSchema,
  /** The catalog version the wallet's IDs were last checked against. When the catalog in effect
   * differs (a new bundled catalog, a dropped cache), stale wallet inputs are pruned on load. */
  walletCatalogVersion: id.nullable().default(null),
});
export type AppState = z.infer<typeof appStateSchema>;
const legacyFields = {
  ...commonFields,
  wallet: walletV2Schema,
  catalog: catalogCacheSchema.default(emptyCatalogCache),
};
/** State saved by catalog v2 releases (catalog cache inside the state); migrated on first read. */
export const appStateV2Schema = z.strictObject({ schemaVersion: z.literal(2), ...legacyFields });
/** State saved by the pilot (catalog v1) releases; migrated on first read by migrateState. */
export const appStateV1Schema = z.strictObject({ schemaVersion: z.literal(1), ...legacyFields });
/** Anything the extension may find in storage: current, v2-era or pilot-era state. */
export const storedAppStateSchema = z.discriminatedUnion('schemaVersion', [
  appStateSchema,
  appStateV2Schema,
  appStateV1Schema,
]);
export type StoredAppState = z.infer<typeof storedAppStateSchema>;
export const requestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('checkout:get-state') }),
  /** Read-only: the catalog slice with these cards' full terms (the wallet editor adds a card). */
  z.strictObject({
    type: z.literal('checkout:catalog-cards'),
    cardIds: z.array(id).max(MAX_WALLET_CARDS),
  }),
  z.strictObject({
    type: z.literal('checkout:refresh-catalog'),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('checkout:save-wallet'),
    wallet: walletSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal('checkout:read-cart'), expectedRevision: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.literal('checkout:compare'),
    purchase: purchaseSchema,
    expectedRevision: z.number().int().nonnegative(),
    cartId: z.string().uuid().nullable().optional(),
  }),
  z.strictObject({ type: z.literal('checkout:clear') }),
  /** Internal: the worker records an order answered in the badge (never sent by a page). */
  z.strictObject({ type: z.literal('checkout:record-savings'), entry: savingsEntrySchema }),
  z.strictObject({
    type: z.literal('checkout:delete-savings'),
    expectedRevision: z.number().int().nonnegative(),
  }),
]);
export type CheckoutRequest = z.infer<typeof requestSchema>;
export type CheckoutResponse =
  | {
      ok: true;
      state: AppState;
      /** The catalog in effect (the newest valid of the cached release and the bundled one), cut to
       * the owned cards and the cards a request names (`catalogSlice`), with every merchant. Pages use
       * it instead of bundling a catalog of their own. */
      catalog: Catalog;
      /** Every card of the catalog in effect, for search (`cardIndex`). */
      cardIndex: CardIndexEntry[];
      comparison: Comparison | UnavailableComparison | null;
      notice: string | null;
      catalogUpdatesAvailable: boolean;
    }
  | { ok: false; error: string };

const catalogSliceSchema = z.custom<Catalog>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    [1, 2, 3].includes((value as { schemaVersion?: unknown }).schemaVersion as number) &&
    Array.isArray((value as { cards?: unknown }).cards) &&
    Array.isArray((value as { sources?: unknown }).sources) &&
    typeof (value as { expiresAt?: unknown }).expiresAt === 'string',
);
const bps = z.number().int().min(0).max(10_000);
const units = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const estimateSchema = z.strictObject({
  cardId: id,
  minRewardCents: money,
  maxRewardCents: money,
  baseRateBps: bps,
  bonusRateBps: bps.nullable(),
  minBonusSpendCents: money,
  maxBonusSpendCents: money,
  uncertainties: z.array(z.enum(UNCERTAINTIES_V3)).max(UNCERTAINTIES_V3.length),
  // A v3 card cites at most 30 rules × 10 sources.
  sourceIds: z.array(id).max(300),
  appliedRuleId: id.optional(),
  paidOnPaymentBps: bps.optional(),
  rules: z
    .array(z.strictObject({ ruleId: id, status: z.enum(RULE_STATUSES_V3) }))
    .max(30)
    .optional(),
  // Catalog v3 only.
  programId: id.optional(),
  minRewardUnits: units.optional(),
  maxRewardUnits: units.optional(),
  unitValue: z
    .strictObject({
      hundredthsOfCent: z.number().int().min(1).max(10_000),
      basis: z.enum(['override', 'card-stated', 'cash', 'published-estimate', 'issuer-stated']),
    })
    .nullable()
    .optional(),
});
export const responseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(1000) }),
  z.strictObject({
    ok: z.literal(true),
    state: appStateSchema,
    // A slice of a catalog the worker validated; it may hold no cards, so it is checked for shape only.
    catalog: catalogSliceSchema,
    cardIndex: z
      .array(
        z.strictObject({
          id,
          name: z.string().min(1).max(120),
          shortName: z.string().min(1).max(60),
          issuer: z.string().min(1).max(80),
        }),
      )
      .max(CATALOG_V3_LIMITS.cards),
    notice: z.string().max(1000).nullable(),
    catalogUpdatesAvailable: z.boolean(),
    comparison: z
      .discriminatedUnion('status', [
        z.strictObject({
          status: z.literal('ready'),
          catalogVersion: id,
          estimates: z.array(estimateSchema).min(1).max(20),
          notAccepted: z.array(estimateSchema).max(20).optional(),
          preferredCardId: id,
          rankingMayChange: z.boolean(),
          tied: z.boolean(),
        }),
        z.strictObject({
          status: z.literal('unavailable'),
          reason: z.enum([
            'catalog-expired',
            'catalog-not-yet-valid',
            'unsupported-merchant',
            'no-owned-cards',
            'unknown-owned-card',
            'purchase-not-confirmed',
            'ineligible-purchase',
            'no-accepted-card',
          ]),
        }),
      ])
      .nullable(),
  }),
]);

export function emptyState(): AppState {
  return {
    schemaVersion: 3,
    revision: 0,
    wallet: { cards: [], defaultCardId: null },
    purchase: null,
    comparison: null,
    cart: null,
    pendingNotice: null,
    savings: [],
    walletCatalogVersion: null,
  };
}
