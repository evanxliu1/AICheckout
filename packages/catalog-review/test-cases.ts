import type { TelemetryEvent } from './src/telemetry.ts';

/** Telemetry event contract cases (Phase 15.2), run against Zod (API tests) and SQL (parity script). */
type Case = { name: string; input: unknown; valid: boolean };

const envelope = {
  event_id: '7f1c2a40-5b7e-4c1d-9a3e-2f6b8c0d1e22',
  client_at: '2026-10-19T12:00:00Z',
  install_id: 'c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d',
  install_month: '2026-10',
  days_since_install: '1-6',
  consent_version: 1,
  schema_version: 1,
  extension_version: '2.1.0',
  catalog_version: '2026-10-05.renewal.1',
  merchants_version: '2026-10-11.mcc.3',
  reader_version: 'generic-reader-v1',
} as const;

/** One valid event of every type; fixture values are not claims about real shoppers or stores. */
export const TELEMETRY_EVENT_FIXTURES: Record<TelemetryEvent['type'], TelemetryEvent> = {
  consent_granted: { ...envelope, type: 'consent_granted' },
  onboarding_completed: { ...envelope, type: 'onboarding_completed', cards_count: 3 },
  wallet_changed: {
    ...envelope,
    type: 'wallet_changed',
    card_ids: ['capital-one-quicksilver', 'amex-blue-cash-everyday'],
  },
  recommendation_shown: {
    ...envelope,
    type: 'recommendation_shown',
    surface: 'badge',
    view: 'amount',
    withheld_reason: null,
    page: 'cart',
    store_kind: 'named',
    evidence_basis: 'issuer',
    category: 'electronics',
    amount_cents: 12999,
    amount_kind: 'total',
    top_card_id: 'capital-one-quicksilver',
    cards_count: 3,
    ranking_may_change: false,
  },
  badge_expanded: { ...envelope, type: 'badge_expanded', view: 'amount' },
  badge_dismissed: { ...envelope, type: 'badge_dismissed', view: 'rates' },
  site_disabled: { ...envelope, type: 'site_disabled', store_kind: 'generic' },
  amount_typed: { ...envelope, type: 'amount_typed', relative_difference_bucket: '1-5%' },
  popup_opened: { ...envelope, type: 'popup_opened', read_outcome: 'found', store_kind: 'named' },
  release_refresh: {
    ...envelope,
    type: 'release_refresh',
    kind: 'catalog',
    outcome: 'ok',
    from_version: '2026-10-05.renewal.1',
    to_version: '2026-10-27.renewal.2',
    trigger: 'weekly',
  },
  error: { ...envelope, type: 'error', code: 'refresh-timeout', surface: 'worker' },
  store_suggested: { ...envelope, type: 'store_suggested', domain: 'shop.example', page: 'cart' },
  problem_reported: {
    ...envelope,
    type: 'problem_reported',
    domain: 'shop.example',
    reason: 'wrong-amount',
    view: 'amount',
    withheld_reason: null,
  },
};

type Fixture = Record<string, unknown>;
const event = (type: TelemetryEvent['type']) => structuredClone(TELEMETRY_EVENT_FIXTURES[type]) as Fixture;
const valid = (name: string, input: unknown): Case => ({ name: `telemetry: ${name}`, input, valid: true });
const invalid = (name: string, input: unknown): Case => ({ name: `telemetry: ${name}`, input, valid: false });
const withField = (type: TelemetryEvent['type'], fields: Fixture) => ({ ...event(type), ...fields });
const without = (type: TelemetryEvent['type'], field: string) => {
  const copy = event(type);
  delete copy[field];
  return copy;
};
const rates = {
  view: 'rates',
  withheld_reason: 'summary-missing',
  amount_cents: null,
  amount_kind: null,
};

export const telemetryEventCases: Case[] = [
  ...Object.keys(TELEMETRY_EVENT_FIXTURES).map((type) =>
    valid(`${type} fixture`, event(type as TelemetryEvent['type'])),
  ),
  valid('fractional seconds', withField('consent_granted', { client_at: '2026-10-19T12:00:00.250Z' })),
  valid('rates view with a reason and no amount', withField('recommendation_shown', rates)),
  valid(
    'generic store with default evidence',
    withField('recommendation_shown', {
      store_kind: 'generic',
      evidence_basis: 'none',
      category: 'general-merchandise',
    }),
  ),
  valid('empty wallet', withField('wallet_changed', { card_ids: [] })),
  valid(
    'twenty cards',
    withField('wallet_changed', {
      card_ids: Array.from({ length: 20 }, (_, i) => `card-${i}`),
    }),
  ),
  valid(
    'failed refresh without versions',
    withField('release_refresh', {
      outcome: 'failed',
      from_version: null,
      to_version: null,
    }),
  ),
  valid('store suggested without an install id', withField('store_suggested', { install_id: null })),
  valid(
    'problem reported without an install id or a badge',
    withField('problem_reported', {
      install_id: null,
      reason: 'no-badge',
      view: null,
      withheld_reason: null,
    }),
  ),
  valid(
    'problem reported on the rates view',
    withField('problem_reported', {
      view: 'rates',
      withheld_reason: 'ambiguous-amount',
    }),
  ),
  invalid('null', null),
  invalid('an array', [event('consent_granted')]),
  invalid('a string', 'consent_granted'),
  invalid('unknown type', withField('consent_granted', { type: 'offer_click' })),
  invalid('missing type', without('consent_granted', 'type')),
  invalid('missing envelope field', without('consent_granted', 'install_month')),
  invalid('unknown field', withField('consent_granted', { url: 'https://shop.example/cart' })),
  invalid('domain on an automatic event', withField('popup_opened', { domain: 'shop.example' })),
  invalid('null install id on an automatic event', withField('consent_granted', { install_id: null })),
  invalid('missing install id on a tap event', without('store_suggested', 'install_id')),
  invalid(
    'event id not a v4 uuid',
    withField('consent_granted', {
      event_id: '7f1c2a40-5b7e-1c1d-9a3e-2f6b8c0d1e22',
    }),
  ),
  valid(
    'upper-case event id (stored lower case)',
    withField('consent_granted', {
      event_id: '7F1C2A40-5B7E-4C1D-9A3E-2F6B8C0D1E22',
    }),
  ),
  invalid('install id not a uuid', withField('consent_granted', { install_id: 'install-1' })),
  invalid(
    'client_at with an offset',
    withField('consent_granted', { client_at: '2026-10-19T12:00:00+00:00' }),
  ),
  invalid('client_at without a time', withField('consent_granted', { client_at: '2026-10-19' })),
  invalid(
    'client_at on an invalid calendar date',
    withField('consent_granted', {
      client_at: '2026-02-30T00:00:00Z',
    }),
  ),
  invalid('client_at as a number', withField('consent_granted', { client_at: 1760875200 })),
  invalid('install month with a day', withField('consent_granted', { install_month: '2026-10-19' })),
  invalid('install month 13', withField('consent_granted', { install_month: '2026-13' })),
  invalid('unknown days bucket', withField('consent_granted', { days_since_install: '90+' })),
  invalid('days bucket as a number', withField('consent_granted', { days_since_install: 0 })),
  invalid('consent version 2', withField('consent_granted', { consent_version: 2 })),
  invalid('schema version 2', withField('consent_granted', { schema_version: 2 })),
  invalid('extension version with a tag', withField('consent_granted', { extension_version: '2.1.0-beta' })),
  invalid('catalog version without a date', withField('consent_granted', { catalog_version: 'seed.1' })),
  invalid('merchants version null', withField('consent_granted', { merchants_version: null })),
  invalid(
    'reader version with upper case',
    withField('consent_granted', { reader_version: 'Generic-Reader' }),
  ),
  invalid('cards count negative', withField('onboarding_completed', { cards_count: -1 })),
  invalid('cards count over twenty', withField('onboarding_completed', { cards_count: 21 })),
  invalid('cards count fractional', withField('onboarding_completed', { cards_count: 1.5 })),
  invalid(
    'twenty-one cards',
    withField('wallet_changed', {
      card_ids: Array.from({ length: 21 }, (_, i) => `card-${i}`),
    }),
  ),
  invalid('repeated card id', withField('wallet_changed', { card_ids: ['card-a', 'card-a'] })),
  invalid('card id with upper case', withField('wallet_changed', { card_ids: ['Card-A'] })),
  invalid('amount view without an amount', withField('recommendation_shown', { amount_cents: null })),
  invalid('amount view without an amount kind', withField('recommendation_shown', { amount_kind: null })),
  invalid(
    'amount view with a withheld reason',
    withField('recommendation_shown', {
      withheld_reason: 'summary-missing',
    }),
  ),
  invalid('rates view with an amount', withField('recommendation_shown', { ...rates, amount_cents: 1200 })),
  invalid(
    'rates view with an amount kind',
    withField('recommendation_shown', {
      ...rates,
      amount_kind: 'subtotal',
    }),
  ),
  invalid(
    'rates view without a reason',
    withField('recommendation_shown', { ...rates, withheld_reason: null }),
  ),
  invalid(
    'withheld reason as free text',
    withField('recommendation_shown', {
      ...rates,
      withheld_reason: 'Order #12345 for Jane',
    }),
  ),
  invalid('negative amount', withField('recommendation_shown', { amount_cents: -1 })),
  invalid('fractional cents', withField('recommendation_shown', { amount_cents: 1299.5 })),
  invalid('amount over the cap', withField('recommendation_shown', { amount_cents: 100_000_000 })),
  invalid('amount as a string', withField('recommendation_shown', { amount_cents: '12999' })),
  invalid('unknown amount kind', withField('recommendation_shown', { amount_kind: 'shipping' })),
  invalid('unknown surface', withField('recommendation_shown', { surface: 'email' })),
  invalid('unknown page', withField('recommendation_shown', { page: 'order' })),
  invalid('unknown store kind', withField('recommendation_shown', { store_kind: 'amazon' })),
  invalid('unknown evidence basis', withField('recommendation_shown', { evidence_basis: 'guess' })),
  invalid('unknown category', withField('recommendation_shown', { category: 'groceries' })),
  invalid('reward-only category', withField('recommendation_shown', { category: 'all-eligible' })),
  invalid('no cards', withField('recommendation_shown', { cards_count: 0 })),
  invalid('ranking flag as a string', withField('recommendation_shown', { ranking_may_change: 'false' })),
  invalid('top card id empty', withField('recommendation_shown', { top_card_id: '' })),
  invalid('unknown view', withField('badge_expanded', { view: 'hidden' })),
  invalid('view null on badge_dismissed', withField('badge_dismissed', { view: null })),
  invalid('unknown difference bucket', withField('amount_typed', { relative_difference_bucket: '50%' })),
  invalid('unknown read outcome', withField('popup_opened', { read_outcome: 'order-page' })),
  invalid('unknown refresh kind', withField('release_refresh', { kind: 'extension' })),
  invalid('unknown refresh outcome', withField('release_refresh', { outcome: 'retry' })),
  invalid('unknown refresh trigger', withField('release_refresh', { trigger: 'startup' })),
  invalid('refresh to a version without a date', withField('release_refresh', { to_version: 'latest' })),
  invalid('error code as free text', withField('error', { code: 'TypeError: x is undefined' })),
  invalid('error surface with a URL', withField('error', { surface: 'https://shop.example' })),
  invalid('domain with upper case', withField('store_suggested', { domain: 'Shop.example' })),
  invalid('domain with a path', withField('store_suggested', { domain: 'shop.example/cart' })),
  invalid('domain with a scheme', withField('store_suggested', { domain: 'https://shop.example' })),
  invalid('domain without a dot', withField('store_suggested', { domain: 'localhost' })),
  invalid('IPv4 domain', withField('store_suggested', { domain: '127.0.0.1' })),
  invalid('missing domain on a tap event', without('store_suggested', 'domain')),
  invalid('domain null on a tap event', withField('problem_reported', { domain: null })),
  invalid('unknown problem reason', withField('problem_reported', { reason: 'rude-badge' })),
  invalid(
    'free text as a problem reason',
    withField('problem_reported', { reason: 'the total was off by $3' }),
  ),
  invalid('problem reported with a note', withField('problem_reported', { note: 'please fix' })),
];
