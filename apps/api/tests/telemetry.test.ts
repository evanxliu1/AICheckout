import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TELEMETRY_LIMITS,
  eventBatchSchema,
  telemetryEventSchema,
  telemetrySummarySchema,
} from '@ai-checkout/catalog-review';
import {
  TELEMETRY_EVENT_FIXTURES,
  telemetryEventCases,
} from '../../../packages/catalog-review/test-cases.ts';
import { createApp } from '../src/app.ts';
import type { ReviewRpc } from '../src/review-repository.ts';
import { createTelemetryRepository, TelemetryError } from '../src/telemetry-repository.ts';
import { allowedOrigin, createLimiter } from '../src/telemetry-routes.ts';
import type { TelemetryOptions } from '../src/telemetry-routes.ts';

/* Phase 15.2: the anonymous ingest and delete routes, the reviewer reads, and the shared envelope. */

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const INSTALL = TELEMETRY_EVENT_FIXTURES.consent_granted.install_id!;
const events = [TELEMETRY_EVENT_FIXTURES.consent_granted, TELEMETRY_EVENT_FIXTURES.recommendation_shown];
const ingested = { accepted: 2, dropped: 0 };
const apps: ReturnType<typeof createApp>[] = [];
let now = Date.parse('2026-10-19T15:00:00Z');
function app(
  rpc = vi.fn().mockResolvedValue(ingested),
  telemetry: TelemetryOptions = {},
  reviewRpc?: ReviewRpc,
) {
  const instance = createApp({
    readCatalog: async () => null,
    clock: () => now,
    telemetryRpc: rpc,
    telemetry,
    ...(reviewRpc ? { reviewRpc, verifyReviewToken: async () => true } : {}),
  });
  apps.push(instance);
  return { instance, rpc };
}
const post = (
  instance: ReturnType<typeof createApp>,
  url: string,
  payload: object | string,
  headers: Record<string, string> = {},
  remoteAddress = '127.0.0.1',
) => instance.inject({ method: 'POST', url, payload, headers, remoteAddress });
afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

describe('telemetry envelope (Zod side of the parity cases)', () => {
  it.each(telemetryEventCases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(telemetryEventSchema.safeParse(c.input).success).toBe(c.valid);
  });
  it('accepts every fixture and caps the batch at 50', () => {
    const all = Object.values(TELEMETRY_EVENT_FIXTURES);
    expect(eventBatchSchema.safeParse({ events: all }).success).toBe(true);
    expect(eventBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(eventBatchSchema.safeParse({ events: Array(51).fill(all[0]) }).success).toBe(false);
    expect(eventBatchSchema.safeParse({ events: all, extra: true }).success).toBe(false);
    expect(TELEMETRY_LIMITS.batchEvents).toBe(50);
  });
  it('no automatic event accepts a domain, URL or free text; only the tap events carry a domain', () => {
    for (const [type, fixture] of Object.entries(TELEMETRY_EVENT_FIXTURES)) {
      const tap = type === 'store_suggested' || type === 'problem_reported';
      expect('domain' in fixture).toBe(tap);
      for (const field of ['url', 'host', 'page_url', 'merchant', 'title', 'note', 'text', 'email'])
        expect(telemetryEventSchema.safeParse({ ...fixture, [field]: 'shop.example' }).success).toBe(false);
      expect(telemetryEventSchema.safeParse({ ...fixture, install_id: null }).success).toBe(tap);
    }
  });
});

describe('POST /v1/events', () => {
  it('forwards a validated batch to the anonymous ingest RPC and never caches', async () => {
    const { instance, rpc } = app();
    const response = await post(instance, '/v1/events', { events });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(ingested);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('ingest_events', { p_batch: events });
  });
  it.each([
    ['no events', { events: [] }],
    ['51 events', { events: Array(51).fill(events[0]) }],
    ['an array body', events],
    ['an unknown envelope field', { events: [{ ...events[0], url: 'https://shop.example/cart' }] }],
    ['a domain on an automatic event', { events: [{ ...events[0], domain: 'shop.example' }] }],
    ['a null install id on an automatic event', { events: [{ ...events[0], install_id: null }] }],
    ['a reserved type', { events: [{ ...events[0], type: 'offer_click' }] }],
    ['a batch-level extra field', { events, source: 'test' }],
  ])('refuses %s before any RPC', async (_name, payload) => {
    const { instance, rpc } = app();
    const response = await post(instance, '/v1/events', payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('refuses query strings, non-JSON bodies and malformed JSON', async () => {
    const { instance, rpc } = app();
    expect((await post(instance, '/v1/events?install=x', { events })).statusCode).toBe(400);
    const text = await instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: 'events',
      headers: { 'content-type': 'text/plain' },
    });
    expect(text.statusCode).toBe(400);
    const broken = await instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: '{"events":[',
      headers: { 'content-type': 'application/json' },
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toEqual({ error: 'invalid_request' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('answers 413 to a body over 64 KiB without reading it into the schema', async () => {
    const { instance, rpc } = app();
    const padded = { events, pad: 'x'.repeat(TELEMETRY_LIMITS.batchBytes) };
    const response = await post(instance, '/v1/events', padded);
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: 'request_too_large' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('answers 410 when ingest is off, before the Origin and rate checks, and keeps delete working', async () => {
    const { instance, rpc } = app(vi.fn().mockResolvedValue({ deleted: 3 }), {
      ingest: 'off',
      extensionIds: [EXTENSION_ID],
    });
    const response = await post(instance, '/v1/events', { events });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ error: 'telemetry_disabled' });
    const deletion = await post(instance, '/v1/events/delete', { install_id: INSTALL }, { origin: ORIGIN });
    expect(deletion.statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_install', { p_install_id: INSTALL });
  });
  it('requires a listed chrome-extension Origin only when EXTENSION_IDS is set', async () => {
    const open = app();
    expect((await post(open.instance, '/v1/events', { events })).statusCode).toBe(200);
    expect(
      (await post(open.instance, '/v1/events', { events }, { origin: 'https://evil.example' })).statusCode,
    ).toBe(200);
    const closed = app(undefined, { extensionIds: [EXTENSION_ID] });
    for (const origin of [
      undefined,
      'https://evil.example',
      'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      `${ORIGIN}x`,
    ]) {
      const response = await post(closed.instance, '/v1/events', { events }, origin ? { origin } : {});
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'origin_not_allowed' });
    }
    expect((await post(closed.instance, '/v1/events', { events }, { origin: ORIGIN })).statusCode).toBe(200);
    expect(closed.rpc).toHaveBeenCalledTimes(1);
    expect(allowedOrigin(ORIGIN.toUpperCase(), [EXTENSION_ID])).toBe(false);
  });
  it('maps RPC refusals and failures to safe codes', async () => {
    const refused = app(vi.fn().mockRejectedValue(new TelemetryError(400, 'invalid_request')));
    expect((await post(refused.instance, '/v1/events', { events })).json()).toEqual({
      error: 'invalid_request',
    });
    const failed = app(vi.fn().mockRejectedValue(new Error('private database detail')));
    const response = await post(failed.instance, '/v1/events', { events });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'telemetry_unavailable' });
    expect(response.body).not.toContain('private');
    const odd = app(vi.fn().mockResolvedValue({ accepted: 2, dropped: 0, rows: ['leak'] }));
    const malformed = await post(odd.instance, '/v1/events', { events });
    expect(malformed.statusCode).toBe(503);
    expect(malformed.body).not.toContain('leak');
  });
});

describe('telemetry rate limits', () => {
  it('limits a client IP per minute with Retry-After and leaves other addresses alone', async () => {
    const { instance, rpc } = app(undefined, { ipLimit: 2, globalLimit: 100 });
    expect((await post(instance, '/v1/events', { events })).statusCode).toBe(200);
    expect((await post(instance, '/v1/events', { events })).statusCode).toBe(200);
    const limited = await post(instance, '/v1/events', { events });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'too_many_requests' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await post(instance, '/v1/events', { events }, {}, '10.0.0.2')).statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(3);
    now += 60_001;
    expect((await post(instance, '/v1/events', { events })).statusCode).toBe(200);
  });
  it('ignores X-Forwarded-For without proxy hops (trustProxy stays false)', async () => {
    const { instance } = app(undefined, { ipLimit: 1, globalLimit: 100 });
    expect(
      (await post(instance, '/v1/events', { events }, { 'x-forwarded-for': '1.1.1.1' })).statusCode,
    ).toBe(200);
    expect(
      (await post(instance, '/v1/events', { events }, { 'x-forwarded-for': '2.2.2.2' })).statusCode,
    ).toBe(429);
  });
  it('reads the client at the fixed hop so forged leading entries do not move the bucket', async () => {
    const { instance } = app(undefined, { proxyHops: 1, ipLimit: 1, globalLimit: 100 });
    const real = { 'x-forwarded-for': '203.0.113.9' };
    expect((await post(instance, '/v1/events', { events }, real)).statusCode).toBe(200);
    expect(
      (await post(instance, '/v1/events', { events }, { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))
        .statusCode,
    ).toBe(429);
    expect(
      (await post(instance, '/v1/events', { events }, { 'x-forwarded-for': '9.9.9.9,203.0.113.9' }))
        .statusCode,
    ).toBe(429);
    // Another client behind the same proxy has its own bucket; a request without the header is the socket.
    expect(
      (await post(instance, '/v1/events', { events }, { 'x-forwarded-for': '198.51.100.7' })).statusCode,
    ).toBe(200);
    expect((await post(instance, '/v1/events', { events })).statusCode).toBe(200);
    expect((await post(instance, '/v1/events', { events })).statusCode).toBe(429);
  });
  it('has a global bucket across all clients, separate for ingest and Delete my data', async () => {
    const rpc = vi.fn(async (operation: string) =>
      operation === 'delete_install' ? { deleted: 0 } : ingested,
    );
    const { instance } = app(rpc, { ipLimit: 100, globalLimit: 2 });
    expect((await post(instance, '/v1/events', { events }, {}, '10.0.0.1')).statusCode).toBe(200);
    expect((await post(instance, '/v1/events', { events }, {}, '10.0.0.2')).statusCode).toBe(200);
    expect((await post(instance, '/v1/events', { events }, {}, '10.0.0.3')).statusCode).toBe(429);
    // A flood of batches does not starve a deletion; deletions have their own global bucket.
    const remove = (address: string) =>
      post(instance, '/v1/events/delete', { install_id: INSTALL }, {}, address);
    expect((await remove('10.0.0.4')).statusCode).toBe(200);
    expect((await remove('10.0.0.5')).statusCode).toBe(200);
    expect((await remove('10.0.0.6')).statusCode).toBe(429);
  });
  it('bounds the number of buckets it remembers', () => {
    let clock = 0;
    const limit = createLimiter(1, () => clock);
    for (let i = 0; i < 10_000; i += 1) expect(limit(`k${i}`)).toBeNull();
    expect(limit('k0')).toBe(60);
    expect(limit('k10000')).toBeNull();
    clock = 60_001;
    expect(limit('k1')).toBeNull();
  });
});

describe('POST /v1/events/delete', () => {
  it('forwards one install id to delete_install', async () => {
    const { instance, rpc } = app(vi.fn().mockResolvedValue({ deleted: 12 }));
    const response = await post(instance, '/v1/events/delete', { install_id: INSTALL });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: 12 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_install', { p_install_id: INSTALL });
  });
  it.each([
    { install_id: 'not-a-uuid' },
    { install_id: '7f1c2a40-5b7e-1c1d-9a3e-2f6b8c0d1e22' },
    { install_id: INSTALL, reason: 'leaving' },
    { installId: INSTALL },
    {},
  ])('refuses %j', async (payload) => {
    const { instance, rpc } = app();
    expect((await post(instance, '/v1/events/delete', payload)).statusCode).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('telemetry repository', () => {
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  it('posts to the RPC as anon with the publishable key and no bearer token', async () => {
    const fetcher = vi.fn(async () => json(ingested));
    const rpc = createTelemetryRepository('https://example.supabase.co', 'public-key', fetcher);
    expect(await rpc('ingest_events', { p_batch: events })).toEqual(ingested);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('https://example.supabase.co/rest/v1/rpc/ingest_events');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      apikey: 'public-key',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body as string)).toEqual({ p_batch: events });
  });
  it('maps a validation refusal to 400 and everything else to a generic 503', async () => {
    const refused = createTelemetryRepository('https://example.supabase.co', 'k', async () =>
      json({ code: '22023', message: 'Event batch is invalid' }, 400),
    );
    await expect(refused('ingest_events', {})).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    for (const answer of [
      async () => json({ code: '42501', message: 'permission denied' }, 401),
      async () => new Response('<html>', { status: 502 }),
      async () => {
        throw new Error('network');
      },
    ]) {
      const rpc = createTelemetryRepository('https://example.supabase.co', 'k', answer);
      await expect(rpc('delete_install', {})).rejects.toMatchObject({
        status: 503,
        code: 'telemetry_unavailable',
      });
    }
  });
  it('refuses an insecure or decorated database URL', () => {
    for (const url of [
      'http://example.supabase.co',
      'https://u:p@example.supabase.co',
      'https://example.supabase.co/x',
    ])
      expect(() => createTelemetryRepository(url, 'k')).toThrow();
    expect(() => createTelemetryRepository('https://example.supabase.co', '')).toThrow();
    expect(() => createTelemetryRepository('http://127.0.0.1:54321', 'k')).not.toThrow();
  });
});

describe('reviewer telemetry reads', () => {
  const token = 'signed.human.session';
  const authorization = `Bearer ${token}`;
  const summary = {
    days: 7,
    events: 3,
    installs: 2,
    by_type: [
      { type: 'recommendation_shown', count: 2 },
      { type: 'consent_granted', count: 1 },
    ],
    by_day: [{ day: '2026-10-19', events: 3, installs: 2 }],
  };
  const suggestions = [
    { domain: 'shop.example', count: 4, installs: 2, last_seen: '2026-10-19T12:00:00+00:00' },
  ];
  it('reads the summary for the requested window through the reviewer RPC', async () => {
    const reviewRpc = vi.fn().mockResolvedValue(summary) as unknown as ReviewRpc;
    const { instance } = app(undefined, {}, reviewRpc);
    const response = await instance.inject({
      url: '/v1/review/telemetry/summary?days=7',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(summary);
    expect(reviewRpc).toHaveBeenCalledExactlyOnceWith('telemetry_summary', token, { p_days: 7 });
    expect(telemetrySummarySchema.safeParse(summary).success).toBe(true);
  });
  it('defaults to 30 days and refuses windows outside 1..90 or unknown query fields', async () => {
    const reviewRpc = vi.fn().mockResolvedValue({ ...summary, days: 30 }) as unknown as ReviewRpc;
    const { instance } = app(undefined, {}, reviewRpc);
    expect(
      (await instance.inject({ url: '/v1/review/telemetry/summary', headers: { authorization } })).statusCode,
    ).toBe(200);
    expect(reviewRpc).toHaveBeenCalledExactlyOnceWith('telemetry_summary', token, { p_days: 30 });
    for (const query of ['days=0', 'days=91', 'days=abc', 'days=7&install=x'])
      expect(
        (await instance.inject({ url: `/v1/review/telemetry/summary?${query}`, headers: { authorization } }))
          .statusCode,
      ).toBe(400);
    expect(reviewRpc).toHaveBeenCalledTimes(1);
  });
  it('reads the store suggestions and validates the shape', async () => {
    const reviewRpc = vi.fn().mockResolvedValue(suggestions) as unknown as ReviewRpc;
    const { instance } = app(undefined, {}, reviewRpc);
    const response = await instance.inject({
      url: '/v1/review/telemetry/suggestions',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(suggestions);
    expect(reviewRpc).toHaveBeenCalledExactlyOnceWith('telemetry_store_suggestions', token, {});
    const leaky = app(
      undefined,
      {},
      vi.fn().mockResolvedValue([{ ...suggestions[0], install_id: 'x' }]) as unknown as ReviewRpc,
    );
    const refused = await leaky.instance.inject({
      url: '/v1/review/telemetry/suggestions',
      headers: { authorization },
    });
    expect(refused.statusCode).toBe(503);
    expect(refused.body).not.toContain('install_id');
  });
  it('needs a bearer token like every review route', async () => {
    const reviewRpc = vi.fn();
    const { instance } = app(undefined, {}, reviewRpc as unknown as ReviewRpc);
    expect((await instance.inject({ url: '/v1/review/telemetry/summary' })).statusCode).toBe(401);
    expect((await instance.inject({ url: '/v1/review/telemetry/suggestions' })).statusCode).toBe(401);
    expect(reviewRpc).not.toHaveBeenCalled();
  });
});

describe('without a telemetry repository', () => {
  it('has no events routes', async () => {
    const instance = createApp({ readCatalog: async () => null });
    apps.push(instance);
    expect((await post(instance, '/v1/events', { events })).statusCode).toBe(404);
  });
});
