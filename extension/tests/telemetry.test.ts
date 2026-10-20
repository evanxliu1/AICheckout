// @vitest-environment node
// Phase 15.3: the worker's usage-report module. Nothing is queued before consent; the install event is sent
// after it; Stop sharing clears the queue and the id; Delete my data posts the id then resets; a 410 pauses;
// 429 and 503 back off; the queue is capped; every automatic event is free of any domain, URL or host
// (property test over the builders); tap events carry the registrable domain only.
import { describe, expect, it, vi } from 'vitest';
import type { EventSender, EventSendResult } from '@ai-checkout/catalog-client';
import { TELEMETRY_EVENT_TYPES, telemetryEventSchema } from '@ai-checkout/catalog-review/telemetry';
import { createTelemetry } from '../src/state/telemetry';
import type { AutomaticInput, EventInput } from '../src/state/telemetry';
import { TELEMETRY_KEY } from '../src/state/keys';
import {
  daysSinceInstallBucket,
  pageForUrl,
  registrableDomain,
  TELEMETRY_FLUSH_ALARM,
  TELEMETRY_QUEUE_MAX,
  telemetryStateSchema,
} from '../src/state/telemetry-contracts';
import type { TelemetryState } from '../src/state/telemetry-contracts';

const T0 = Date.parse('2026-10-20T12:00:00Z');
const VERSIONS = { catalog: '2026-10-05.renewal.1', merchants: '2026-10-11.mcc.3' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function harness({
  client = true,
  answer = (): EventSendResult => ({ status: 200, retryAfterMs: null }),
  versions = VERSIONS,
}: {
  client?: boolean;
  answer?: (batch: { events: unknown[] }) => EventSendResult | Promise<EventSendResult>;
  versions?: { catalog: string; merchants: string };
} = {}) {
  let data: Record<string, unknown> = {};
  let now = T0;
  const sent: { events: unknown[] }[] = [];
  const deleted: string[] = [];
  const sender: EventSender = {
    send: vi.fn(async (batch) => {
      sent.push(structuredClone(batch));
      return answer(batch);
    }),
    deleteInstall: vi.fn(async (id) => {
      deleted.push(id);
      return answer({ events: [] });
    }),
  };
  const alarms = { created: [] as string[], cleared: [] as string[], existing: new Set<string>() };
  const telemetry = createTelemetry({
    local: {
      get: async (key) => ({ [key]: structuredClone(data[key]) }),
      set: async (items) => {
        data = { ...data, ...structuredClone(items) };
      },
    },
    client: client ? sender : undefined,
    alarms: {
      get: async (name) => (alarms.existing.has(name) ? { name } : undefined),
      create: async (name) => {
        alarms.created.push(name);
        alarms.existing.add(name);
      },
      clear: async (name) => {
        alarms.cleared.push(name);
        return alarms.existing.delete(name);
      },
    },
    clock: () => now,
    versions: async () => versions,
    extensionVersion: '2.1.0',
  });
  const state = (): TelemetryState => telemetryStateSchema.parse(data[TELEMETRY_KEY]);
  return {
    telemetry,
    sender,
    sent,
    deleted,
    alarms,
    state,
    stored: () => data[TELEMETRY_KEY],
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const shown: Extract<EventInput, { type: 'recommendation_shown' }> = {
  type: 'recommendation_shown',
  surface: 'badge',
  view: 'amount',
  withheld_reason: null,
  page: 'cart',
  store_kind: 'generic',
  evidence_basis: 'none',
  category: 'general-merchandise',
  amount_cents: 10_000,
  amount_kind: 'estimated-total',
  top_card_id: 'amex-blue-cash-everyday',
  cards_count: 2,
  ranking_may_change: false,
};
const CARDS = ['citi-double-cash', 'amex-blue-cash-everyday'];

describe('consent and the install event', () => {
  it('queues nothing before consent and sends nothing', async () => {
    const h = harness();
    await h.telemetry.record(shown);
    await h.telemetry.record({ type: 'badge_expanded', view: 'amount' });
    await h.telemetry.flush();
    expect(h.stored()).toBeUndefined();
    expect(h.sent).toEqual([]);
    expect(await h.telemetry.status()).toEqual({ enabled: true, consent: null });
  });
  it('Share mints a random id and sends consent_granted first, then the onboarding funnel and the wallet', async () => {
    const h = harness();
    const status = await h.telemetry.consent(true, { cardIds: CARDS, onboarding: true });
    await h.telemetry.flush();
    expect(status).toEqual({ enabled: true, consent: 'granted' });
    expect(h.sent).toHaveLength(1);
    const events = h.sent[0]!.events as Record<string, unknown>[];
    expect(events.map((e) => e.type)).toEqual(['consent_granted', 'onboarding_completed', 'wallet_changed']);
    for (const event of events) {
      expect(telemetryEventSchema.safeParse(event).success).toBe(true);
      expect(event.install_id).toMatch(UUID);
      expect(event).toMatchObject({
        install_month: '2026-10',
        days_since_install: '0',
        consent_version: 1,
        schema_version: 1,
        extension_version: '2.1.0',
        catalog_version: VERSIONS.catalog,
        merchants_version: VERSIONS.merchants,
        reader_version: 'generic-reader-v1',
        client_at: '2026-10-20T12:00:00.000Z',
      });
    }
    expect(events[1]).toMatchObject({ cards_count: 2 });
    expect(events[2]).toMatchObject({ card_ids: CARDS });
    expect(h.state().installId).toBe(events[0]!.install_id);
    expect(h.state().queue).toEqual([]);
    // Sharing again from Settings keeps the id and sends no second consent event.
    await h.telemetry.consent(true, { cardIds: CARDS, onboarding: false });
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(2);
    expect((h.sent[1]!.events as { type: string }[]).map((e) => e.type)).toEqual(['wallet_changed']);
  });
  it('a build without the sender has no consent, queues nothing and reports enabled false', async () => {
    const h = harness({ client: false });
    expect(await h.telemetry.consent(true, { cardIds: CARDS, onboarding: true })).toEqual({
      enabled: false,
      consent: null,
    });
    await h.telemetry.record(shown);
    expect(
      await h.telemetry.recordTap({ type: 'store_suggested', domain: 'example.com', page: 'cart' }),
    ).toBe(false);
    expect(h.stored()).toBeUndefined();
  });
  it('Stop sharing clears the queue and the id and sends nothing more; a new Share mints a new id', async () => {
    const h = harness({ answer: () => ({ status: 503, retryAfterMs: null }) });
    await h.telemetry.consent(true, { cardIds: CARDS, onboarding: true });
    await h.telemetry.flush();
    const first = h.state().installId!;
    expect(h.state().queue).toHaveLength(3); // 503: kept for later
    await h.telemetry.consent(false);
    expect(h.state()).toMatchObject({ consent: 'declined', installId: null, queue: [] });
    expect(h.alarms.cleared).toContain(TELEMETRY_FLUSH_ALARM);
    await h.telemetry.record(shown);
    await h.telemetry.flush();
    expect(h.state().queue).toEqual([]);
    expect(h.sent).toHaveLength(1);
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    expect(h.state().installId).toMatch(UUID);
    expect(h.state().installId).not.toBe(first);
  });
});

describe('Delete my data', () => {
  it('posts the current id to the delete route, then stops sharing and clears the id and the queue', async () => {
    const h = harness();
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    const id = h.state().installId!;
    await h.telemetry.record(shown);
    expect(await h.telemetry.deleteData()).toBe('deleted');
    expect(h.deleted).toEqual([id]);
    expect(h.state()).toMatchObject({ consent: 'declined', installId: null, queue: [] });
    expect(await h.telemetry.deleteData()).toBe('nothing-to-delete');
    expect(h.deleted).toEqual([id]);
  });
  it('keeps the id when the service is unavailable, so the shopper can try again', async () => {
    const h = harness({ answer: () => ({ status: 503, retryAfterMs: null }) });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    const id = h.state().installId!;
    expect(await h.telemetry.deleteData()).toBe('unavailable');
    expect(h.state().installId).toBe(id);
    expect(h.state().consent).toBe('granted');
  });
  it('a refusal (403, 400) deleted nothing: the id is kept and the shopper is told to try again', async () => {
    for (const status of [400, 403]) {
      let refuse = false;
      const h = harness({ answer: () => ({ status: refuse ? status : 200, retryAfterMs: null }) });
      await h.telemetry.consent(true);
      await h.telemetry.flush();
      const id = h.state().installId!;
      refuse = true;
      expect(await h.telemetry.deleteData()).toBe('unavailable');
      expect(h.state()).toMatchObject({ consent: 'granted', installId: id });
    }
  });
  it('waits for a batch in flight, so no report of the id reaches the service after its deletion', async () => {
    let release: (value: EventSendResult) => void = () => undefined;
    const order: string[] = [];
    const h = harness({
      answer: (batch) => {
        if (batch.events.length === 0) {
          order.push('delete');
          return { status: 200, retryAfterMs: null };
        }
        order.push('send');
        return new Promise<EventSendResult>((resolve) => {
          release = (value) => {
            order.push('landed');
            resolve(value);
          };
        });
      },
    });
    await h.telemetry.consent(true);
    await vi.waitFor(() => expect(order).toEqual(['send']));
    const deletion = h.telemetry.deleteData();
    await h.telemetry.record(shown);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['send']);
    release({ status: 200, retryAfterMs: null });
    expect(await deletion).toBe('deleted');
    expect(order).toEqual(['send', 'landed', 'delete']);
    await h.telemetry.flush();
    expect(order).toEqual(['send', 'landed', 'delete']);
    expect(h.state()).toMatchObject({ consent: 'declined', installId: null, queue: [] });
  });
});

describe('a slow or asleep service', () => {
  it('never holds up recording or the status while a request waits', async () => {
    let release: ((value: EventSendResult) => void) | null = null;
    const h = harness({
      answer: () =>
        release === null
          ? new Promise<EventSendResult>((resolve) => {
              release = resolve;
            })
          : { status: 200, retryAfterMs: null },
    });
    await h.telemetry.consent(true);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    // The request is still open: everything else answers at once.
    await h.telemetry.record(shown);
    expect(h.state().queue.map((e) => e.type)).toContain('recommendation_shown');
    expect(await h.telemetry.status()).toEqual({ enabled: true, consent: 'granted' });
    // A second flush joins the one in flight instead of sending the same events again.
    const joined = h.telemetry.flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.sent).toHaveLength(1);
    release!({ status: 200, retryAfterMs: null });
    await joined;
    // Only the sent events left the queue; the one recorded meanwhile waits for the next flush.
    expect(h.state().queue.map((e) => e.type)).toEqual(['recommendation_shown']);
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.state().queue).toEqual([]);
  });
});

describe('the queue and the flush', () => {
  it('queues automatic events after consent, creates the alarm once, flushes at 50 and clears the alarm', async () => {
    const h = harness();
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    h.alarms.created.length = 0;
    for (let i = 0; i < 49; i++) await h.telemetry.record({ type: 'badge_expanded', view: 'amount' });
    expect(h.state().queue).toHaveLength(49);
    expect(h.alarms.created).toEqual([TELEMETRY_FLUSH_ALARM]);
    expect(h.sent).toHaveLength(1);
    await h.telemetry.record({ type: 'badge_expanded', view: 'rates' });
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.events).toHaveLength(50);
    expect(h.state().queue).toEqual([]);
    expect(h.alarms.existing.has(TELEMETRY_FLUSH_ALARM)).toBe(false);
  });
  it('drops the oldest events beyond the cap while the service is unreachable', async () => {
    const h = harness({
      answer: () => {
        throw new TypeError('fetch failed');
      },
    });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    for (let i = 0; i < TELEMETRY_QUEUE_MAX + 20; i++)
      await h.telemetry.record({ type: 'error', code: `code-${i}`, surface: 'worker' }).then(() =>
        // The error cap is 20 a day; use expansions to fill the queue instead.
        h.telemetry.record({ type: 'badge_expanded', view: 'amount' }),
      );
    const queue = h.state().queue;
    expect(queue).toHaveLength(TELEMETRY_QUEUE_MAX);
    expect(queue[0]!.type).not.toBe('consent_granted');
  });
  it('the alarm flushes; a foreign alarm does nothing', async () => {
    const h = harness({ answer: () => ({ status: 503, retryAfterMs: null }) });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(1);
    h.advance(16 * 60 * 1000);
    await h.telemetry.onAlarm('refresh-releases');
    expect(h.sent).toHaveLength(1);
    await h.telemetry.onAlarm(TELEMETRY_FLUSH_ALARM);
    expect(h.sent).toHaveLength(2);
  });
  it('a 410 pauses sending for 7 days and drops what waited', async () => {
    const h = harness({ answer: () => ({ status: 410, retryAfterMs: null }) });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    expect(h.state().queue).toEqual([]);
    expect(h.state().pausedUntil).toBe(T0 + 7 * 24 * 60 * 60 * 1000);
    await h.telemetry.record(shown);
    await h.telemetry.flush();
    h.advance(6 * 24 * 60 * 60 * 1000);
    await h.telemetry.onAlarm(TELEMETRY_FLUSH_ALARM);
    expect(h.sent).toHaveLength(1);
    h.advance(2 * 24 * 60 * 60 * 1000);
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(2);
  });
  it.each([429, 503])('backs off after a %i, honouring Retry-After, and keeps the events', async (status) => {
    const h = harness({ answer: () => ({ status, retryAfterMs: 120_000 }) });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    expect(h.state().queue).toHaveLength(1);
    expect(h.state().retryAt).toBe(T0 + 120_000);
    h.advance(60_000);
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(1);
    h.advance(61_000);
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.events).toEqual(h.sent[0]!.events);
  });
  it('a refused batch (400, 403) is dropped, never retried', async () => {
    const h = harness({ answer: () => ({ status: 400, retryAfterMs: null }) });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    expect(h.state().queue).toEqual([]);
    expect(h.state().retryAt).toBeNull();
  });
  it('never queues an event the contract refuses (a fixture catalog version), and caps error events at 20 a day', async () => {
    const bad = harness({ versions: { catalog: 'test-v3.e2e', merchants: VERSIONS.merchants } });
    await bad.telemetry.consent(true);
    await bad.telemetry.flush();
    expect(bad.sent).toEqual([]);
    expect(bad.state().consent).toBe('granted');
    const h = harness({ answer: () => ({ status: 503, retryAfterMs: null }) });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    for (let i = 0; i < 25; i++)
      await h.telemetry.record({ type: 'error', code: 'request-failed', surface: 'page' });
    expect(h.state().queue.filter((e) => e.type === 'error')).toHaveLength(20);
    h.advance(24 * 60 * 60 * 1000);
    await h.telemetry.record({ type: 'error', code: 'request-failed', surface: 'page' });
    expect(h.state().queue.filter((e) => e.type === 'error')).toHaveLength(21);
  });
});

describe('tap events', () => {
  it('are sent at once without an id when sharing is off, with the registrable domain only', async () => {
    const h = harness();
    expect(
      await h.telemetry.recordTap({ type: 'store_suggested', domain: 'example.com', page: 'cart' }),
    ).toBe(true);
    await h.telemetry.flush();
    expect(h.sent).toHaveLength(1);
    const event = h.sent[0]!.events[0] as Record<string, unknown>;
    expect(event).toMatchObject({
      type: 'store_suggested',
      install_id: null,
      domain: 'example.com',
      page: 'cart',
      install_month: '2026-10',
      days_since_install: '0',
    });
    expect(telemetryEventSchema.safeParse(event).success).toBe(true);
    // Not now afterwards: still no id, and the anchor month is kept.
    await h.telemetry.consent(false);
    h.advance(10 * 24 * 60 * 60 * 1000);
    await h.telemetry.recordTap({
      type: 'problem_reported',
      domain: 'example.com',
      reason: 'wrong-amount',
      view: 'amount',
      withheld_reason: null,
    });
    await h.telemetry.flush();
    expect(h.sent[1]!.events[0]).toMatchObject({ install_id: null, days_since_install: '7-13' });
  });
  it('carry the id while sharing is on', async () => {
    const h = harness();
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    await h.telemetry.recordTap({ type: 'store_suggested', domain: 'shop.example', page: 'checkout' });
    await h.telemetry.flush();
    expect(h.sent[1]!.events[0]).toMatchObject({ install_id: h.state().installId, domain: 'shop.example' });
  });
  it('refuse a domain the contract rejects', async () => {
    const h = harness();
    expect(
      await h.telemetry.recordTap({ type: 'store_suggested', domain: '192.168.0.1', page: 'cart' }),
    ).toBe(false);
    expect(h.sent).toEqual([]);
  });
});

/** A small deterministic generator (no fixture library): the property tests must be reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return { next, pick, int };
}
const HOSTS = ['shop.example.com', 'www.bestbuy.com', 'secure.newegg.com', 'smile.amazon.com', 'store.co.uk'];
/** Every automatic event type with random, contract-valid fields. The values a store could leak through
 * (reason codes, card ids, versions) are the fixed vocabularies the extension has, never a host. */
function randomAutomatic(r: ReturnType<typeof rng>): AutomaticInput {
  const view = r.pick(['amount', 'rates'] as const);
  const storeKind = r.pick(['named', 'generic'] as const);
  switch (r.pick(TELEMETRY_EVENT_TYPES.filter((t) => t !== 'store_suggested' && t !== 'problem_reported'))) {
    case 'consent_granted':
      return { type: 'consent_granted' };
    case 'onboarding_completed':
      return { type: 'onboarding_completed', cards_count: r.int(0, 20) };
    case 'wallet_changed':
      return { type: 'wallet_changed', card_ids: CARDS.slice(0, r.int(0, 2)) };
    case 'recommendation_shown':
      return {
        ...shown,
        view,
        withheld_reason: view === 'rates' ? 'withheld' : null,
        amount_cents: view === 'amount' ? r.int(1, 9_999_999) : null,
        amount_kind: view === 'amount' ? r.pick(['total', 'estimated-total', 'subtotal'] as const) : null,
        store_kind: storeKind,
        page: r.pick(['cart', 'checkout', 'popup-read'] as const),
        cards_count: r.int(1, 20),
      };
    case 'badge_expanded':
      return { type: 'badge_expanded', view };
    case 'badge_dismissed':
      return { type: 'badge_dismissed', view };
    case 'site_disabled':
      return { type: 'site_disabled', store_kind: storeKind };
    case 'amount_typed':
      return {
        type: 'amount_typed',
        relative_difference_bucket: r.pick(['<1%', '1-5%', '5-20%', '>20%', 'no-read'] as const),
      };
    case 'popup_opened':
      return {
        type: 'popup_opened',
        read_outcome: r.pick([
          'found',
          'withheld',
          'not-a-cart',
          'empty',
          'non-usd',
          'payment-page',
          'non-web',
        ] as const),
        store_kind: storeKind,
      };
    case 'release_refresh':
      return {
        type: 'release_refresh',
        kind: r.pick(['catalog', 'merchants'] as const),
        outcome: r.pick(['ok', 'skipped', 'failed'] as const),
        from_version: VERSIONS.catalog,
        to_version: r.next() < 0.5 ? null : '2026-10-28.renewal.2',
        trigger: r.pick(['install', 'weekly', 'manual'] as const),
      };
    default:
      return {
        type: 'error',
        code: r.pick(['request-failed', 'storage']),
        surface: r.pick(['page', 'badge']),
      };
  }
}

describe('property: no automatic event carries a domain, URL or host', () => {
  it('over 300 random automatic events built in the worker', async () => {
    const h = harness({ answer: () => ({ status: 503, retryAfterMs: null }) });
    await h.telemetry.consent(true);
    await h.telemetry.flush();
    const r = rng(15_3);
    const types = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const input = randomAutomatic(r);
      types.add(input.type);
      await h.telemetry.record(input);
    }
    // Every automatic type was exercised; events over the cap were dropped oldest first.
    expect(types.size).toBe(TELEMETRY_EVENT_TYPES.length - 2);
    const queued = h.state().queue;
    expect(queued.length).toBeGreaterThan(0);
    const text = JSON.stringify(queued);
    for (const host of HOSTS) expect(text).not.toContain(host);
    expect(text).not.toMatch(/https?:|www\.|\.com|\.co\.uk|\.example/);
    for (const event of queued) {
      expect(telemetryEventSchema.safeParse(event).success).toBe(true);
      expect(Object.keys(event)).not.toEqual(expect.arrayContaining(['domain']));
      expect(Object.keys(event).some((key) => /url|host|domain|path|title/i.test(key))).toBe(false);
    }
  });
  it('registrableDomain returns the API-valid registrable domain or null, for random hosts', () => {
    const r = rng(42);
    const labels = ['www', 'shop', 'secure', 'co', 'com', 'uk', 'example', 'store', 'a-b', '192', '168'];
    const rule = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
    for (let i = 0; i < 500; i++) {
      const host = Array.from({ length: r.int(1, 5) }, () => r.pick(labels)).join('.');
      const domain = registrableDomain(host);
      if (domain === null) continue;
      expect(domain).toMatch(rule);
      expect(host.endsWith(domain)).toBe(true);
      expect(domain.split('.').length).toBeLessThanOrEqual(3);
    }
    expect(registrableDomain('www.shop.example.com')).toBe('example.com');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('secure.newegg.com')).toBe('newegg.com');
    expect(registrableDomain('192.168.0.1')).toBeNull();
    expect(registrableDomain('localhost')).toBeNull();
    // A shop platform's subdomain is the shop (public suffix list, private section), not the platform.
    expect(registrableDomain('checkout.cool-socks.myshopify.com')).toBe('cool-socks.myshopify.com');
    expect(registrableDomain('myshopify.com')).toBe('myshopify.com');
    expect(registrableDomain('www.example.com.au')).toBe('example.com.au');
    expect(registrableDomain('shop.example.us')).toBe('example.us');
  });
  it('buckets days since install and reads the page kind from the URL only', () => {
    const day = 86_400_000;
    expect(
      [0, 1, 6, 7, 13, 14, 29, 30, 59, 60, 400].map((d) => daysSinceInstallBucket(T0, T0 + d * day)),
    ).toEqual(['0', '1-6', '1-6', '7-13', '7-13', '14-29', '14-29', '30-59', '30-59', '60+', '60+']);
    expect(pageForUrl('https://shop.example.com/cart')).toBe('cart');
    expect(pageForUrl('https://shop.example.com/checkout/payment')).toBe('checkout');
    expect(pageForUrl('not a url')).toBe('cart');
  });
});
