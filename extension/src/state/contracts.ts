import { z } from 'zod';
import { MAX_AMOUNT_CENTS, PAYMENT_PATHS, UNCERTAINTIES } from '../domain';
import type { Catalog, Comparison, UnavailableComparison } from '../domain';
import { cartSnapshotSchema } from '../checkout/contracts';
import { cachedCatalogSchema, emptyCatalogCache } from './catalog';

const id = z.string().min(1).max(100);
const eligibility = z.enum(['eligible', 'ineligible', 'unknown']);
const money = z.number().int().min(0).max(MAX_AMOUNT_CENTS);
export const walletSchema = z
  .strictObject({
    cards: z
      .array(
        z.strictObject({
          cardId: id,
          usage: z
            .array(
              z.strictObject({
                ruleId: id,
                calendarYear: z.number().int().min(2000).max(9999),
                recordedOn: z.iso.date(),
                spentCents: money.nullable(),
                activation: z.enum(['active', 'inactive', 'unknown']),
              }),
            )
            .max(10)
            .refine((rows) => new Set(rows.map((r) => r.ruleId)).size === rows.length),
        }),
      )
      .max(20)
      .refine((cards) => new Set(cards.map((c) => c.cardId)).size === cards.length),
    defaultCardId: id.nullable(),
  })
  .refine((w) => w.defaultCardId === null || w.cards.some((c) => c.cardId === w.defaultCardId));

export const purchaseSchema = z.strictObject({
  merchantId: id,
  currency: z.literal('USD'),
  amountCents: money.positive(),
  purchasedOn: z.iso.date(),
  eligiblePurchase: eligibility,
  onlineRetail: eligibility,
  paymentPath: z.enum(PAYMENT_PATHS).optional(),
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

const stateFields = {
  revision: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
  wallet: walletSchema,
  purchase: purchaseSchema.nullable(),
  catalog: cachedCatalogSchema.default(emptyCatalogCache),
  cart: cartSnapshotSchema.nullable().default(null),
  /** Orders recorded from the badge's one-tap question, newest first. */
  savings: z.array(savingsEntrySchema).max(MAX_SAVINGS_ENTRIES).default([]),
  /** A notice that must reach the shopper once (e.g. why migration dropped limits); kept until shown. */
  pendingNotice: z.string().min(1).max(300).nullable().default(null),
  comparison: z
    .strictObject({
      inputRevision: z.number().int().nonnegative(),
      catalogVersion: id,
      computedAt: z.number().int().nonnegative(),
      cartId: z.string().uuid().nullable().default(null),
    })
    .nullable(),
};
/** Current state (schema 2: catalog v2 era). Everything written is this shape. */
export const appStateSchema = z.strictObject({ schemaVersion: z.literal(2), ...stateFields });
export type AppState = z.infer<typeof appStateSchema>;
/** State saved by the pilot (catalog v1) releases; migrated on first read by migrateState. */
export const appStateV1Schema = z.strictObject({ schemaVersion: z.literal(1), ...stateFields });
/** Anything the extension may find in storage: current or pilot-era state. */
export const storedAppStateSchema = z.discriminatedUnion('schemaVersion', [appStateSchema, appStateV1Schema]);
export type StoredAppState = z.infer<typeof storedAppStateSchema>;
export const requestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('checkout:get-state') }),
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
      comparison: Comparison | UnavailableComparison | null;
      notice: string | null;
      catalogUpdatesAvailable: boolean;
    }
  | { ok: false; error: string };

const estimateSchema = z.strictObject({
  cardId: id,
  minRewardCents: money,
  maxRewardCents: money,
  baseRateBps: z.number().int().min(0).max(10_000),
  bonusRateBps: z.number().int().min(0).max(10_000).nullable(),
  minBonusSpendCents: money,
  maxBonusSpendCents: money,
  uncertainties: z.array(z.enum(UNCERTAINTIES)).max(UNCERTAINTIES.length),
  sourceIds: z.array(id).max(40),
  appliedRuleId: id.optional(),
  paidOnPaymentBps: z.number().int().min(0).max(10_000).optional(),
  rules: z
    .array(
      z.strictObject({
        ruleId: id,
        status: z.enum([
          'applied',
          'may-apply',
          'base',
          'not-at-merchant',
          'not-eligible',
          'expired',
          'cap-reached',
        ]),
      }),
    )
    .max(20)
    .optional(),
});
export const responseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(1000) }),
  z.strictObject({
    ok: z.literal(true),
    state: appStateSchema,
    notice: z.string().max(1000).nullable(),
    catalogUpdatesAvailable: z.boolean(),
    comparison: z
      .discriminatedUnion('status', [
        z.strictObject({
          status: z.literal('ready'),
          catalogVersion: id,
          estimates: z.array(estimateSchema).min(1).max(20),
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
          ]),
        }),
      ])
      .nullable(),
  }),
]);

export function emptyState(): AppState {
  return {
    schemaVersion: 2,
    revision: 0,
    wallet: { cards: [], defaultCardId: null },
    purchase: null,
    comparison: null,
    cart: null,
    pendingNotice: null,
    savings: [],
    catalog: emptyCatalogCache(),
  };
}
export function validateWallet(wallet: AppState['wallet'], catalog: Catalog) {
  return wallet.cards.every((owned) => {
    const card = catalog.cards.find((c) => c.id === owned.cardId);
    return card && owned.usage.every((u) => card.rules.some((r) => r.id === u.ruleId));
  });
}
