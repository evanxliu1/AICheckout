// Messages and stored shapes for the automatic cart badge. Three callers, three vocabularies:
// the content script reports readings and order pages and learns only whether to show the badge;
// the badge iframe (an extension page) asks for its view and acts on it; nothing else is accepted.
import { z } from 'zod';
import { MAX_AMOUNT_CENTS, PAYMENT_PATHS_V3 } from '../domain';
import type { Catalog, Comparison, PaymentPathV3, UnavailableComparison, Wallet } from '../domain';
import { MERCHANT_IDS } from '../checkout/merchants';
import { GENERIC_MERCHANT_ID } from '@ai-checkout/rewards-core/generic-merchant';
import { probeSchema } from '../checkout/contracts';
import { purchaseSchema } from '../state/contracts';

export const BADGE_TABS_KEY = 'checkoutBadgeTabsV1';
export const SETTINGS_KEY = 'checkoutSettingsV1';
/** How long after a recommendation an order confirmation in the same tab still counts. */
export const ORDER_WINDOW_MS = 3 * 60 * 60 * 1000;
export { BADGE_PAGE, ONBOARDING_PAGE, POPUP_PAGE } from './pages';

const money = z.number().int().min(0).max(MAX_AMOUNT_CENTS);
const merchantId = z.enum(MERCHANT_IDS);
/** A badge tab's store: a legacy store, or the generic profile at any other site (Phase 13c). */
const badgeMerchantId = z.enum([...MERCHANT_IDS, GENERIC_MERCHANT_ID]);
/** A hostname the shopper turned the badge off for (lower case, no port, ≤ 253 chars). */
const host = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/);
/** The badge compares cards' rates at this amount when the cart amount is not read: below every
 * cap in the catalog, so a card's reward here is its rate ($100 × bps / 10,000 = bps cents). */
export const RATES_REFERENCE_CENTS = 10_000;
/** Unavailable readings that still show the badge, in the rates view: the page is a cart or checkout
 * but its amount could not be read with certainty. Loading, empty and non-USD carts hide it. */
export const RATES_VIEW_REASONS = ['withheld', 'summary-missing', 'ambiguous-amount'] as const;

/** From the content script. It carries the adapter's reading only; never card or wallet data. */
export const contentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('cart:reading'),
    reading: probeSchema.shape.reading,
    /** The content script already shows a frame (keep its nonce) or needs a new one. */
    framed: z.boolean(),
  }),
  z.strictObject({ type: z.literal('order:page'), framed: z.boolean() }),
]);
export type ContentMessage = z.infer<typeof contentMessageSchema>;
/** `nonce`: only when a new badge frame should be created; it goes into the frame's URL fragment
 * (inside the closed shadow root) and must accompany every badge:* request from that frame. */
export type ContentReply = { show: boolean; nonce?: string };
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** From the badge iframe. The worker identifies the tab from the sender, never from the message,
 * and accepts only the frame its content script created (the nonce for that tab). */
const nonce = z.string().regex(NONCE_PATTERN);
export const badgeRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('badge:get'), nonce }),
  z.strictObject({ type: z.literal('badge:set-amount'), nonce, amountCents: money.positive().nullable() }),
  z.strictObject({ type: z.literal('badge:set-payment'), nonce, paymentPath: z.enum(PAYMENT_PATHS_V3) }),
  z.strictObject({ type: z.literal('badge:dismiss'), nonce }),
  z.strictObject({ type: z.literal('badge:disable-site'), nonce }),
  z.strictObject({
    type: z.literal('badge:answer-order'),
    nonce,
    answer: z.enum(['yes', 'other', 'unsure']),
    cardId: z.string().min(1).max(100).nullable(),
  }),
  z.strictObject({ type: z.literal('badge:open'), nonce, target: z.enum(['popup', 'onboarding']) }),
]);
/** A badge request as the iframe writes it, before its nonce is attached. */
export type BadgeAction = BadgeRequest extends infer R
  ? R extends { nonce: string }
    ? Omit<R, 'nonce'>
    : never
  : never;
export type BadgeRequest = z.infer<typeof badgeRequestSchema>;

export const MAX_DISABLED_SITES = 500;
export const settingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Legacy stores where the badge never appears (per-site off switch). */
  disabledMerchants: z.array(merchantId).max(MERCHANT_IDS.length),
  /** Phase 13c: the badge at every store without an adapter (on by default; existing installs
   * have no stored value and get the default). */
  showOnOtherStores: z.boolean().default(true),
  /** Hosts of other stores where the shopper chose "Not on this site". */
  disabledSites: z.array(host).max(MAX_DISABLED_SITES).default([]),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => ({
  schemaVersion: 1,
  disabledMerchants: [],
  showOnOtherStores: true,
  disabledSites: [],
});

const recommendationSchema = z.strictObject({
  purchase: purchaseSchema,
  recommendedCardId: z.string().min(1).max(100),
  at: z.number().int().nonnegative(),
});
/** Per-tab badge state in chrome.storage.session (memory only; cleared when the tab closes). */
export const tabEntrySchema = z.strictObject({
  merchantId: badgeMerchantId,
  /** The tab's hostname, for the per-site switch at other stores (never the path). */
  host: z.string().max(253).default(''),
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
  paymentPath: z.enum(PAYMENT_PATHS_V3),
  /** The last recommendation shown in this tab, for order detection. */
  recommendation: recommendationSchema.nullable(),
  /** An order page followed a recommendation: ask once which card paid (until ORDER_WINDOW_MS
   * after the order page, or the next cart reading). */
  orderPrompt: recommendationSchema.nullable(),
  /** The current badge frame's nonce; a new frame replaces it. */
  frameNonce: z.string().regex(NONCE_PATTERN).nullable().default(null),
});
export type TabEntry = z.infer<typeof tabEntrySchema>;
export const tabStoreSchema = z.record(z.string().regex(/^[0-9]{1,10}$/), tabEntrySchema);

/** What the iframe renders. Card data appears only here, inside the extension's own frame. */
export type BadgeView =
  | { kind: 'hidden' }
  | { kind: 'locked'; order: boolean }
  | { kind: 'damaged' }
  | { kind: 'no-cards' }
  /** The cart amount was not read: the owned cards ranked by rate at RATES_REFERENCE_CENTS. */
  | {
      kind: 'rates';
      merchantId: string;
      paymentPath: PaymentPathV3;
      result: Comparison;
      catalog: Catalog;
      wallet: Wallet;
    }
  | { kind: 'unavailable'; merchantId: string; result: UnavailableComparison }
  | {
      kind: 'ready';
      merchantId: string;
      cartAmountCents: number | null;
      amountKind: 'total' | 'estimated-total' | 'subtotal' | null;
      amountCents: number;
      amountEdited: boolean;
      paymentPath: PaymentPathV3;
      result: Comparison;
      /** Only the owned cards, this merchant and what they refer to (`badgeCatalog`). */
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
      /** "cash back" when both cards pay cash back, else "rewards" (`estimates.ts:rewardsWording`). */
      rewardTerm: 'cash back' | 'rewards';
      /** What non-cash rewards were counted at, or why the order is not counted; null for cash back. */
      valueNote: string | null;
    };
export type BadgeReply = { ok: true; view: BadgeView } | { ok: false; error: string };
