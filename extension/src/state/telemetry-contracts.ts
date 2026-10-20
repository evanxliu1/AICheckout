// Consented usage reporting (Phase 15.3): the stored telemetry state, the page requests, the consent copy and
// the small pure helpers the worker's builders use. Shared by the worker and the extension pages; the content
// scripts never import it. The event shapes themselves are the API's contract in
// `@ai-checkout/catalog-review/telemetry`, which the worker validates every event against before queueing.
import { z } from 'zod';
import {
  DAYS_SINCE_INSTALL_BUCKETS,
  TELEMETRY_EVENT_TYPES,
  telemetryEventSchema,
} from '@ai-checkout/catalog-review/telemetry';
import type { TelemetryEventType } from '@ai-checkout/catalog-review/telemetry';

export { TELEMETRY_EVENT_TYPES };
export type { TelemetryEventType };

/** The consent text's version; a change of practice bumps it and asks again (the API accepts 1 only). */
export const TELEMETRY_CONSENT_VERSION = 1;
/** Events kept on the device while they wait to be sent; the oldest are dropped beyond this. */
export const TELEMETRY_QUEUE_MAX = 200;
/** A queue this long is flushed at once instead of waiting for the alarm. */
export const TELEMETRY_FLUSH_AT = 50;
/** The `telemetry-flush` alarm's period while the queue is non-empty. */
export const TELEMETRY_FLUSH_MINUTES = 15;
/** Sending pauses this long after the service answers 410 (the kill switch). */
export const TELEMETRY_PAUSE_MS = 7 * 24 * 60 * 60 * 1000;
/** Back-off after a 429 or 503 without a usable `Retry-After`: wait for the next alarm. */
export const TELEMETRY_RETRY_MS = TELEMETRY_FLUSH_MINUTES * 60 * 1000;
/** Longest back-off a `Retry-After` header can ask for. */
export const TELEMETRY_RETRY_MAX_MS = 24 * 60 * 60 * 1000;
/** `error` events queued per local day; the rest are dropped. */
export const TELEMETRY_ERRORS_PER_DAY = 20;
export const TELEMETRY_FLUSH_ALARM = 'telemetry-flush';
/** A flush request waits at most this long (a Render cold start is left to the next alarm). */
export const TELEMETRY_SEND_TIMEOUT_MS = 20_000;

const millis = z.number().int().nonnegative();
/** `checkoutTelemetryV1` in `chrome.storage.local`, never encrypted (it holds no wallet data). `installId` exists
 * only while sharing is on; Stop sharing and Delete my data clear it. `installedAt` is set at each Share (a new
 * id) and kept after Stop sharing or Delete my data: it anchors `install_month` and `days_since_install` for a
 * tap event sent without an id (or, when the shopper never shared, the time the consent question was first
 * answered or the first tap). Only the month and the day bucket are ever sent, never the time itself. */
export const telemetryStateSchema = z.strictObject({
  consent: z.enum(['granted', 'declined']).nullable(),
  consentVersion: z.literal(TELEMETRY_CONSENT_VERSION),
  installId: z.uuidv4().nullable(),
  installedAt: millis.nullable(),
  queue: z.array(telemetryEventSchema).max(TELEMETRY_QUEUE_MAX),
  /** Sending paused until this time after a 410. */
  pausedUntil: millis.nullable(),
  /** No flush before this time after a 429 or 503. */
  retryAt: millis.nullable(),
  /** `error` events queued today (local date) and the date they count for. */
  errorDay: z.string().nullable(),
  errorCount: z.number().int().nonnegative(),
});
export type TelemetryState = z.infer<typeof telemetryStateSchema>;
export const emptyTelemetryState = (): TelemetryState => ({
  consent: null,
  consentVersion: TELEMETRY_CONSENT_VERSION,
  installId: null,
  installedAt: null,
  queue: [],
  pausedUntil: null,
  retryAt: null,
  errorDay: null,
  errorCount: 0,
});

/** What the popup's read on open found; the dictionary's `popup_opened.read_outcome`. */
export const POPUP_READ_OUTCOMES = [
  'found',
  'withheld',
  'not-a-cart',
  'empty',
  'non-usd',
  'payment-page',
  'non-web',
] as const;
export type PopupReadOutcome = (typeof POPUP_READ_OUTCOMES)[number];
/** The fixed reasons of "Report a problem"; there is no free text (decision 2026-10-19). */
export const PROBLEM_REASONS = {
  'wrong-amount': 'The amount shown is wrong',
  'no-badge': 'No badge appeared on a cart or checkout page',
  'wrong-store': 'The store was recognised as another store',
  'wrong-card': 'The recommended card looks wrong',
  other: 'Something else',
} as const;
export type ProblemReason = keyof typeof PROBLEM_REASONS;
const tabId = z.number().int().nonnegative();
/** Requests from the popup and onboarding page (routed as `page`, like `checkout:*`). */
export const telemetryRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('telemetry:get') }),
  /** Share (true) or Not now / Stop sharing (false); from the onboarding screen or the Settings toggle. */
  z.strictObject({
    type: z.literal('telemetry:consent'),
    granted: z.boolean(),
    source: z.enum(['onboarding', 'settings']),
  }),
  /** Delete my data: the current id goes to `/v1/events/delete`, then sharing stops and the id is cleared. */
  z.strictObject({ type: z.literal('telemetry:delete') }),
  /** The popup opened on a tab and read it (or could not): the worker builds `popup_opened` from the tab. */
  z.strictObject({
    type: z.literal('telemetry:popup-opened'),
    tabId: tabId.nullable(),
    readOutcome: z.enum(POPUP_READ_OUTCOMES),
  }),
  /** The two taps. The worker resolves the tab's URL itself (host permission) and sends its registrable domain. */
  z.strictObject({ type: z.literal('telemetry:suggest-store'), tabId }),
  z.strictObject({
    type: z.literal('telemetry:report-problem'),
    tabId,
    reason: z.enum(Object.keys(PROBLEM_REASONS) as [ProblemReason, ...ProblemReason[]]),
  }),
]);
export type TelemetryRequest = z.infer<typeof telemetryRequestSchema>;
/** What a page learns: whether this build reports at all, and the shopper's answer. */
export const telemetryStatusSchema = z.strictObject({
  enabled: z.boolean(),
  consent: z.enum(['granted', 'declined']).nullable(),
});
export type TelemetryStatus = z.infer<typeof telemetryStatusSchema>;
export const telemetryResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), status: telemetryStatusSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(500) }),
]);
export type TelemetryResponse = z.infer<typeof telemetryResponseSchema>;

/** The consent screen and the Settings toggle say the same thing; `docs/telemetry/events.md` lists what each
 * event carries, and `telemetry-ui.test.tsx` checks that every event type is covered by a line below. Wording
 * rule (decision 2026-10-10): "a random identifier, no name, email or browsing history", never "anonymous". */
export const CONSENT_COPY = {
  title: 'Help improve AI Checkout',
  lead: 'Share usage reports so the reader, the store list and the recommendations get better. The extension works the same either way.',
  sentHeading: 'What is sent, after you choose Share',
  sent: [
    'How you use it: the badge shown, expanded or dismissed, the popup opened and what its read found, a site switched off, when card terms were refreshed, and how far an amount you typed was from the one read (a rough range, not the amount).',
    'Each recommendation: the recommended card, how many cards you have, the store’s category (for example groceries), whether the store is one AI Checkout recognises, whether it was a cart or checkout page, and the exact cart amount read or that it was not read.',
    'The cards you picked, as catalog names (never card numbers, last four digits or balances).',
    'Error codes, without messages or page content.',
    'A random identifier, so repeated reports can be told apart: no name, email or browsing history. Each report also carries the versions of the extension, card terms and store list, and the month you chose Share.',
  ],
  never:
    'No store name, web address or page text is sent with these reports. A store’s domain (for example example.com) is sent only when you tap “Suggest this store” or “Report a problem”, and those work whether you share or not.',
  retention:
    'Reports are kept for 90 days. You can stop sharing or delete your reports any time from Settings in the AI Checkout toolbar button.',
  share: 'Share',
  notNow: 'Not now',
  policy: 'Privacy policy',
} as const;
/** For each event type, a phrase of `CONSENT_COPY` that names what it carries (the agreement test). */
export const CONSENT_COVERAGE: Record<TelemetryEventType, string> = {
  consent_granted: 'A random identifier',
  onboarding_completed: 'how many cards you have',
  wallet_changed: 'The cards you picked, as catalog names',
  recommendation_shown: 'the exact cart amount read or that it was not read',
  badge_expanded: 'the badge shown, expanded or dismissed',
  badge_dismissed: 'the badge shown, expanded or dismissed',
  site_disabled: 'a site switched off',
  amount_typed: 'how far an amount you typed was from the one read',
  popup_opened: 'the popup opened and what its read found',
  release_refresh: 'when card terms were refreshed',
  error: 'Error codes, without messages or page content',
  store_suggested: 'Suggest this store',
  problem_reported: 'Report a problem',
};

/** The privacy policy on the site served by the catalog origin (`/privacy/`), or null in a development build. */
export const PRIVACY_POLICY_URL: string | null = import.meta.env?.VITE_CATALOG_API_URL
  ? new URL('/privacy/', import.meta.env.VITE_CATALOG_API_URL).href
  : null;

/** `install_month` of a time in UTC. */
export const installMonth = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
/** `days_since_install` bucket of `now` against `installedAt`. */
export function daysSinceInstallBucket(
  installedAt: number,
  now: number,
): (typeof DAYS_SINCE_INSTALL_BUCKETS)[number] {
  const days = Math.max(0, Math.floor((now - installedAt) / 86_400_000));
  if (days < 1) return '0';
  if (days < 7) return '1-6';
  if (days < 14) return '7-13';
  if (days < 30) return '14-29';
  if (days < 60) return '30-59';
  return '60+';
}
/** Second-level labels under which a registrable domain takes three labels (`shop.co.uk`), a short list
 * standing in for the public suffix list, which the extension does not carry. */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'ne', 'or']);
/** Shop platforms whose stores are subdomains (public suffix list, private section): the registrable domain is
 * the shop's own name (`shop.myshopify.com`), else every such shop would be suggested as the platform. */
const PLATFORM_SUFFIXES = ['myshopify.com'];
/** The registrable domain of a hostname (`www.shop.example.com` → `example.com`, `shop.example.co.uk` →
 * `example.co.uk`), or null for an IP address, a single label or anything the API's domain rule would refuse.
 * Only the two tap events carry it. */
export function registrableDomain(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length < 2 || !/^[a-z][a-z0-9-]{0,62}$/.test(labels[labels.length - 1]!)) return null;
  const take =
    labels.length >= 3 &&
    ((labels[labels.length - 1]!.length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]!)) ||
      PLATFORM_SUFFIXES.includes(labels.slice(-2).join('.')))
      ? 3
      : 2;
  const domain = labels.slice(-take).join('.');
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(domain) && domain.length <= 253
    ? domain
    : null;
}
/** The dictionary's `page` for a badge reading, from the tab URL the worker already holds (never stored). */
export function pageForUrl(url: string): 'cart' | 'checkout' {
  try {
    const { pathname, search } = new URL(url);
    return /checkout|payment|order/i.test(`${pathname}${search}`) ? 'checkout' : 'cart';
  } catch {
    return 'cart';
  }
}
