// Messages and stored shapes for the automatic cart badge. Three callers, three vocabularies:
// the content script reports readings and order pages and learns only whether to show the badge;
// the badge iframe (an extension page) asks for its view and acts on it; nothing else is accepted.
import { z } from 'zod';
import { MAX_AMOUNT_CENTS, PAYMENT_PATHS } from '../domain';
import type { Catalog, Comparison, PaymentPath, UnavailableComparison, Wallet } from '../domain';
import { MERCHANT_IDS } from '../checkout/merchants';
import { probeSchema } from '../checkout/contracts';
import { purchaseSchema } from '../state/contracts';

export const BADGE_TABS_KEY = 'checkoutBadgeTabsV1';
export const SETTINGS_KEY = 'checkoutSettingsV1';
/** How long after a recommendation an order confirmation in the same tab still counts. */
export const ORDER_WINDOW_MS = 3 * 60 * 60 * 1000;
export { BADGE_PAGE, ONBOARDING_PAGE, POPUP_PAGE } from './pages';

const money = z.number().int().min(0).max(MAX_AMOUNT_CENTS);
const merchantId = z.enum(MERCHANT_IDS);

/** From the content script. It carries the adapter's reading only; never card or wallet data. */
export const contentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('cart:reading'), reading: probeSchema.shape.reading }),
  z.strictObject({ type: z.literal('order:page') }),
]);
export type ContentMessage = z.infer<typeof contentMessageSchema>;
export type ContentReply = { show: boolean };

/** From the badge iframe. The worker identifies the tab from the sender, never from the message. */
export const badgeRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('badge:get') }),
  z.strictObject({ type: z.literal('badge:set-amount'), amountCents: money.positive().nullable() }),
  z.strictObject({ type: z.literal('badge:set-payment'), paymentPath: z.enum(PAYMENT_PATHS) }),
  z.strictObject({ type: z.literal('badge:dismiss') }),
  z.strictObject({ type: z.literal('badge:disable-site') }),
  z.strictObject({
    type: z.literal('badge:answer-order'),
    answer: z.enum(['yes', 'other', 'unsure']),
    cardId: z.string().min(1).max(100).nullable(),
  }),
  z.strictObject({ type: z.literal('badge:open'), target: z.enum(['popup', 'onboarding']) }),
]);
export type BadgeRequest = z.infer<typeof badgeRequestSchema>;

export const settingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Sites where the badge never appears (per-site off switch). */
  disabledMerchants: z.array(merchantId).max(MERCHANT_IDS.length),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => ({ schemaVersion: 1, disabledMerchants: [] });

const recommendationSchema = z.strictObject({
  purchase: purchaseSchema,
  recommendedCardId: z.string().min(1).max(100),
  at: z.number().int().nonnegative(),
});
/** Per-tab badge state in chrome.storage.session (memory only; cleared when the tab closes). */
export const tabEntrySchema = z.strictObject({
  merchantId,
  reading: z
    .strictObject({
      amountCents: money.positive(),
      kind: z.enum(['total', 'estimated-total', 'subtotal']),
      extractorVersion: z.string().min(1).max(60),
      readAt: z.number().int().nonnegative(),
    })
    .nullable(),
  /** The latest reading was not usable (loading, ambiguous, empty). */
  unreadable: z.boolean(),
  dismissed: z.boolean(),
  amountOverrideCents: money.positive().nullable(),
  paymentPath: z.enum(PAYMENT_PATHS),
  /** The last recommendation shown in this tab, for order detection. */
  recommendation: recommendationSchema.nullable(),
  /** An order page followed a recommendation: ask once which card paid. */
  orderPrompt: recommendationSchema.nullable(),
});
export type TabEntry = z.infer<typeof tabEntrySchema>;
export const tabStoreSchema = z.record(z.string().regex(/^[0-9]{1,10}$/), tabEntrySchema);

/** What the iframe renders. Card data appears only here, inside the extension's own frame. */
export type BadgeView =
  | { kind: 'hidden' }
  | { kind: 'locked'; order: boolean }
  | { kind: 'damaged' }
  | { kind: 'no-cards' }
  | { kind: 'unreadable'; merchantId: string }
  | { kind: 'unavailable'; merchantId: string; result: UnavailableComparison }
  | {
      kind: 'ready';
      merchantId: string;
      cartAmountCents: number | null;
      amountKind: 'total' | 'estimated-total' | 'subtotal' | null;
      amountCents: number;
      amountEdited: boolean;
      paymentPath: PaymentPath;
      result: Comparison;
      catalog: Catalog;
      wallet: Wallet;
    }
  | {
      kind: 'order';
      merchantId: string;
      recommendedCardId: string;
      cards: { id: string; name: string }[];
    }
  | {
      kind: 'recorded';
      extraCents: number | null;
      usedCardName: string | null;
      baselineCardName: string | null;
    };
export type BadgeReply = { ok: true; view: BadgeView } | { ok: false; error: string };
