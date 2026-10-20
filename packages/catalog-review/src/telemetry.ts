import { z } from 'zod';
import { MERCHANT_CATEGORIES_V3 } from '@ai-checkout/rewards-core';

/**
 * Release A telemetry contract (Phase 15.2, wiki/product/phase-15-release-a.md §5): the envelope every
 * event carries and the fields of each event type. Mirrored in SQL by `telemetry.valid_event_v1`
 * (migration 20261020004702_telemetry_events); scripts/test-catalog-parity.mjs runs the shared
 * `telemetryEventCases` through both. No automatic event carries a domain, merchant name, URL, page text
 * or card number; a registrable domain travels only on the two tap events, which are the only events
 * whose `install_id` may be null (a shopper who declined sharing). The `.describe()` texts are the source
 * of the generated dictionary `docs/telemetry/events.md` (15.3).
 */
export const TELEMETRY_LIMITS = {
  /** Events in one `POST /v1/events` body and one `ingest_events` call. */
  batchEvents: 50,
  /** Largest `POST /v1/events` body on the wire. The database measures the batch as JSONB text, which
   * adds a space after every `:` and `,`, so its own cap is twice this. */
  batchBytes: 65_536,
  /** Events one install may store per UTC day; the rest of the day's events are dropped. */
  installDay: 500,
  /** Raw rows and per-install day counters older than this are pruned on every ingest call. */
  retentionDays: 90,
  /** Rows pruned per ingest call. */
  pruneRows: 1000,
  /** Catalog card ids on `wallet_changed` (the extension's `MAX_WALLET_CARDS`). */
  cardIds: 20,
  /** Store suggestions returned to a reviewer. */
  suggestions: 500,
  /** Longest window of the reviewer summary, in days. */
  summaryDays: 90,
} as const;

const uuidV4 = z.uuidv4();
const catalogId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
/** A short machine code: a reader reason, an error code or an error surface. Never free text. */
const code = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const releaseVersion = z
  .string()
  .max(80)
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+\.[0-9]+$/);
/** A registrable domain, lower case, as the merchant release spells hosts. */
const domain = z
  .string()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/)
  .describe('Registrable domain of the tab (for example shop.example), sent only on this tap');
const count = z.number().int().min(0).max(TELEMETRY_LIMITS.cardIds);
const view = z.enum(['amount', 'rates']).describe('Which view the badge or popup showed');
const page = z.enum(['cart', 'checkout', 'popup-read']).describe('Where the reading came from');
const storeKind = z
  .enum(['named', 'generic'])
  .describe('Whether the merchant release named the store or the generic profile applied');
const withheldReason = code
  .nullable()
  .describe('Reader code when the amount was withheld (rates view); null in the amount view');

export const DAYS_SINCE_INSTALL_BUCKETS = ['0', '1-6', '7-13', '14-29', '30-59', '60+'] as const;
export const TELEMETRY_EVENT_TYPES = [
  'consent_granted',
  'onboarding_completed',
  'wallet_changed',
  'recommendation_shown',
  'badge_expanded',
  'badge_dismissed',
  'site_disabled',
  'amount_typed',
  'popup_opened',
  'release_refresh',
  'error',
  'store_suggested',
  'problem_reported',
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];
/** The two shopper-initiated events; the only ones that carry a domain and may carry no install id. */
export const TAP_EVENT_TYPES = [
  'store_suggested',
  'problem_reported',
] as const satisfies TelemetryEventType[];

const envelopeFields = {
  event_id: uuidV4.describe('Client-generated id; a repeated id is stored once'),
  client_at: z.iso.datetime().describe('When the extension built the event (UTC)'),
  install_month: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
    .describe('Month the random identifier was created (YYYY-MM)'),
  days_since_install: z
    .enum(DAYS_SINCE_INSTALL_BUCKETS)
    .describe('Days since the identifier was created, bucketed'),
  consent_version: z.literal(1).describe('Version of the consent text the shopper accepted'),
  schema_version: z.literal(1).describe('Version of this event dictionary'),
  extension_version: z
    .string()
    .max(20)
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/)
    .describe('Extension version'),
  catalog_version: releaseVersion.describe('Card catalog in effect'),
  merchants_version: releaseVersion.describe('Merchant release in effect'),
  reader_version: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .describe('Cart reader version (generic-reader-v1)'),
};
const installId = uuidV4.describe(
  'Random identifier created at consent; reset by Stop sharing and Delete my data',
);
const automatic = { ...envelopeFields, install_id: installId };
const tap = {
  ...envelopeFields,
  install_id: installId.nullable().describe('The random identifier, or null when the shopper is not sharing'),
};

export const consentGrantedSchema = z.strictObject({ ...automatic, type: z.literal('consent_granted') });
export const onboardingCompletedSchema = z.strictObject({
  ...automatic,
  type: z.literal('onboarding_completed'),
  cards_count: count.describe('Cards picked during onboarding'),
});
export const walletChangedSchema = z.strictObject({
  ...automatic,
  type: z.literal('wallet_changed'),
  card_ids: z
    .array(catalogId)
    .max(TELEMETRY_LIMITS.cardIds)
    .refine((ids) => new Set(ids).size === ids.length)
    .describe('Catalog ids of the owned cards (never numbers, last four or balances)'),
});
export const recommendationShownSchema = z
  .strictObject({
    ...automatic,
    type: z.literal('recommendation_shown'),
    surface: z.enum(['badge', 'popup']).describe('Where the recommendation appeared'),
    view,
    withheld_reason: withheldReason,
    page,
    store_kind: storeKind,
    evidence_basis: z
      .enum(['issuer', 'mcc', 'corroborated', 'definition', 'default', 'none'])
      .describe('Evidence behind the store category'),
    category: z.enum(MERCHANT_CATEGORIES_V3).describe('Merchant category used for the comparison'),
    amount_cents: z
      .number()
      .int()
      .min(0)
      .max(99_999_999)
      .nullable()
      .describe('Cart amount read, in integer cents (amount view only); never with a domain'),
    amount_kind: z
      .enum(['total', 'estimated-total', 'subtotal'])
      .nullable()
      .describe('Which amount was read (amount view only)'),
    top_card_id: catalogId.describe('Catalog id of the recommended card'),
    cards_count: z.number().int().min(1).max(TELEMETRY_LIMITS.cardIds).describe('Cards in the wallet'),
    ranking_may_change: z.boolean().describe('Whether an unanswered choice or gate could change the ranking'),
  })
  .refine(
    (event) =>
      event.view === 'amount'
        ? event.amount_cents !== null && event.amount_kind !== null && event.withheld_reason === null
        : event.amount_cents === null && event.amount_kind === null && event.withheld_reason !== null,
    'The amount view carries an amount and no reason; the rates view a reason and no amount.',
  );
export const badgeExpandedSchema = z.strictObject({ ...automatic, type: z.literal('badge_expanded'), view });
export const badgeDismissedSchema = z.strictObject({
  ...automatic,
  type: z.literal('badge_dismissed'),
  view,
});
export const siteDisabledSchema = z.strictObject({
  ...automatic,
  type: z.literal('site_disabled'),
  store_kind: storeKind,
});
export const amountTypedSchema = z.strictObject({
  ...automatic,
  type: z.literal('amount_typed'),
  relative_difference_bucket: z
    .enum(['<1%', '1-5%', '5-20%', '>20%', 'no-read'])
    .describe('How far the typed amount was from the read one, bucketed'),
});
export const popupOpenedSchema = z.strictObject({
  ...automatic,
  type: z.literal('popup_opened'),
  read_outcome: z
    .enum(['found', 'withheld', 'not-a-cart', 'empty', 'non-usd', 'payment-page', 'non-web'])
    .describe('What the reader found on the open tab'),
  store_kind: storeKind,
});
export const releaseRefreshSchema = z.strictObject({
  ...automatic,
  type: z.literal('release_refresh'),
  kind: z.enum(['catalog', 'merchants']).describe('Which release was refreshed'),
  outcome: z.enum(['ok', 'skipped', 'failed']).describe('Outcome of the refresh'),
  from_version: releaseVersion.nullable().describe('Version before the refresh'),
  to_version: releaseVersion.nullable().describe('Version after the refresh, when it changed'),
  trigger: z.enum(['install', 'weekly', 'manual']).describe('What started the refresh'),
});
export const errorSchema = z.strictObject({
  ...automatic,
  type: z.literal('error'),
  code: code.describe('Error code; never a message or stack trace'),
  surface: code.describe('Where it happened (badge, popup, onboarding, worker)'),
});
export const storeSuggestedSchema = z.strictObject({
  ...tap,
  type: z.literal('store_suggested'),
  domain,
  page,
});
export const problemReportedSchema = z.strictObject({
  ...tap,
  type: z.literal('problem_reported'),
  domain,
  reason: z
    .enum(['wrong-amount', 'no-badge', 'wrong-store', 'wrong-card', 'other'])
    .describe('Fixed reason; there is no free text'),
  view: view.nullable().describe('The view shown, or null when there was no badge'),
  withheld_reason: withheldReason,
});

export const telemetryEventSchema = z.discriminatedUnion('type', [
  consentGrantedSchema,
  onboardingCompletedSchema,
  walletChangedSchema,
  recommendationShownSchema,
  badgeExpandedSchema,
  badgeDismissedSchema,
  siteDisabledSchema,
  amountTypedSchema,
  popupOpenedSchema,
  releaseRefreshSchema,
  errorSchema,
  storeSuggestedSchema,
  problemReportedSchema,
]);
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/** `POST /v1/events` body. */
export const eventBatchSchema = z.strictObject({
  events: z.array(telemetryEventSchema).min(1).max(TELEMETRY_LIMITS.batchEvents),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;
/** `ingest_events` result: `dropped` counts repeated ids and events over the install's day cap. */
export const ingestResultSchema = z.strictObject({
  accepted: z.number().int().min(0).max(TELEMETRY_LIMITS.batchEvents),
  dropped: z.number().int().min(0).max(TELEMETRY_LIMITS.batchEvents),
});
/** `POST /v1/events/delete` body: the install whose rows are deleted. */
export const deleteInstallInputSchema = z.strictObject({ install_id: uuidV4 });
export const deleteInstallResultSchema = z.strictObject({ deleted: z.number().int().min(0) });

const timestamp = z.iso.datetime({ offset: true });
/** `telemetry_store_suggestions`: the growth list for the merchant pipeline, most suggested first. */
export const storeSuggestionsSchema = z
  .array(
    z.strictObject({
      domain,
      count: z.number().int().min(1),
      installs: z.number().int().min(0),
      last_seen: timestamp,
    }),
  )
  .max(TELEMETRY_LIMITS.suggestions);
/** `telemetry_summary(days)`: counts over the last `days` days (UTC). */
export const telemetrySummarySchema = z.strictObject({
  days: z.number().int().min(1).max(TELEMETRY_LIMITS.summaryDays),
  events: z.number().int().min(0),
  installs: z.number().int().min(0),
  by_type: z.array(z.strictObject({ type: z.enum(TELEMETRY_EVENT_TYPES), count: z.number().int().min(1) })),
  by_day: z
    .array(
      z.strictObject({
        day: z.iso.date(),
        events: z.number().int().min(1),
        installs: z.number().int().min(0),
      }),
    )
    .max(TELEMETRY_LIMITS.summaryDays + 1),
});
export type StoreSuggestions = z.infer<typeof storeSuggestionsSchema>;
export type TelemetrySummary = z.infer<typeof telemetrySummarySchema>;
