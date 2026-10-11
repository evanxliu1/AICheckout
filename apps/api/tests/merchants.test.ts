import { afterEach, describe, expect, it, vi } from 'vitest';
import { MERCHANT_RELEASE_LIMITS, MERCHANTS_V1 } from '@ai-checkout/rewards-core';
import { MERCHANT_RELEASE_FIXTURE } from '../../../packages/rewards-core/test-cases.ts';
import { createApp } from '../src/app.ts';
import { createMerchantRepository, MAX_MERCHANTS_READ_BYTES } from '../src/merchant-repository.ts';

/* Phase 14.6: the public merchant release route and the reviewer's publish route. */

const published = {
  sequence: 1,
  release: MERCHANT_RELEASE_FIXTURE,
  version: MERCHANT_RELEASE_FIXTURE.version,
  release_hash: 'b'.repeat(64),
  published_at: '2026-10-10T12:00:00Z',
};
const NOW = Date.parse('2026-10-11T15:00:00Z');
const apps: ReturnType<typeof createApp>[] = [];
function app(readMerchants?: () => Promise<unknown>) {
  const server = createApp({ readCatalog: async () => null, readMerchants, clock: () => NOW });
  apps.push(server);
  return server;
}
const json = (value: unknown) => Response.json(value);
afterEach(async () => {
  await Promise.all(apps.splice(0).map((server) => server.close()));
});

describe('GET /v1/merchants', () => {
  it('serves only a validated published merchant release, never cached', async () => {
    const response = await app(async () => published).inject('/v1/merchants');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ release: published });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('answers null before the first publication', async () => {
    expect((await app(async () => null).inject('/v1/merchants')).json()).toEqual({ release: null });
  });
  it('serves the bundled release as published', async () => {
    const row = {
      ...published,
      release: MERCHANTS_V1,
      version: MERCHANTS_V1.version,
      published_at: '2026-10-11T12:00:00Z',
    };
    expect((await app(async () => row).inject('/v1/merchants')).json().release.version).toBe(
      MERCHANTS_V1.version,
    );
  });
  it.each([
    'not configured',
    'malformed',
    'version mismatch',
    'verified in the future',
    'published in the future',
    'database error',
  ])('fails closed for %s', async (kind) => {
    const read =
      kind === 'not configured'
        ? undefined
        : vi.fn(async (): Promise<unknown> => {
            if (kind === 'database error') throw new Error('private-database-details');
            const value = structuredClone(published);
            if (kind === 'malformed') value.release.merchants[0].hosts = ['Amazon.com'];
            if (kind === 'version mismatch') value.version = 'other';
            if (kind === 'verified in the future') value.release.verifiedAt = '2026-10-12T00:00:00Z';
            if (kind === 'published in the future') value.published_at = '2026-10-12T00:00:00Z';
            return value;
          });
    const response = await app(read).inject('/v1/merchants');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'merchants_unavailable' });
    expect(response.body).not.toContain('private');
  });
});

describe('merchant head repository', () => {
  it('makes one joined query with only the configured public key', async () => {
    const fetcher = vi.fn(async () => json([{ release_sequence: 1, release: published }]));
    const read = createMerchantRepository('https://example.supabase.co', 'public-key', fetcher);
    expect(await read()).toEqual(published);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/rest/v1/merchant_head');
    expect(new URL(url).searchParams.get('select')).toContain('!merchant_head_release_sequence_fkey');
    expect(options.headers).toEqual({ apikey: 'public-key', Accept: 'application/json' });
    expect(options.redirect).toBe('error');
  });
  it('reads a row larger than the release limit (JSONB spacing) but not past the cap', async () => {
    expect(MAX_MERCHANTS_READ_BYTES).toBe(2 * MERCHANT_RELEASE_LIMITS.bytes);
    const body = JSON.stringify([{ release_sequence: 1, release: published }])
      .replaceAll('":', '": ')
      .replaceAll(',"', ', "');
    const read = createMerchantRepository(
      'https://example.supabase.co',
      'public-key',
      async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    );
    expect((await read())?.version).toBe(published.version);
    const huge = createMerchantRepository(
      'https://example.supabase.co',
      'public-key',
      async () =>
        new Response(body, {
          headers: {
            'content-type': 'application/json',
            'content-length': String(MAX_MERCHANTS_READ_BYTES + 1),
          },
        }),
    );
    await expect(huge()).rejects.toThrow();
  });
  it('rejects a missing row or an inconsistent head', async () => {
    for (const rows of [
      [],
      [{ release_sequence: 2, release: published }],
      [{ release_sequence: 1, release: null }],
    ]) {
      await expect(
        createMerchantRepository('https://example.supabase.co', 'public', async () => json(rows))(),
      ).rejects.toThrow();
    }
  });
  it.each([
    'http://example.supabase.co',
    'https://user:pw@example.supabase.co',
    'https://example.supabase.co/x',
  ])('refuses the database URL %s', (url) => {
    expect(() => createMerchantRepository(url, 'public')).toThrow();
  });
});

describe('POST /v1/review/merchants/publish', () => {
  const token = 'signed.human.session';
  const authorization = `Bearer ${token}`;
  const body = {
    release: MERCHANT_RELEASE_FIXTURE,
    expectedHead: null,
    expectedHash: null,
    reviewNote: 'Agent-verified merchant release; the coordinator checked it.',
  };
  function review(rpc = vi.fn().mockResolvedValue(published), verify = vi.fn(async () => true)) {
    const instance = createApp({
      readCatalog: async () => null,
      reviewRpc: rpc,
      verifyReviewToken: verify,
    });
    apps.push(instance);
    return { instance, rpc, verify };
  }
  it('checks the token before the body and forwards the release to the publish RPC', async () => {
    const { instance, rpc, verify } = review();
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/review/merchants/publish',
      headers: { authorization },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(published);
    expect(verify).toHaveBeenCalledWith(token);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('publish_merchant_release', token, {
      p_release: MERCHANT_RELEASE_FIXTURE,
      p_expected_head: null,
      p_expected_hash: null,
      p_review_note: body.reviewNote,
    });
  });
  it('refuses an unverified token without reading the body or calling the RPC', async () => {
    const { instance, rpc } = review(
      undefined,
      vi.fn(async () => false),
    );
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/review/merchants/publish',
      headers: { authorization },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['an invalid release', { ...body, release: { ...MERCHANT_RELEASE_FIXTURE, merchants: [] } }],
    ['a short note', { ...body, reviewNote: 'short' }],
    ['an unknown field', { ...body, publish: true }],
    ['a catalog instead of a release', { ...body, release: { schemaVersion: 3 } }],
  ])('rejects %s before any RPC', async (_name, payload) => {
    const { instance, rpc } = review();
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/review/merchants/publish',
      headers: { authorization },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not accept the RPC answer unless it is a published merchant release', async () => {
    const { instance } = review(vi.fn().mockResolvedValue({ ...published, version: 'other' }));
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/review/merchants/publish',
      headers: { authorization },
      payload: body,
    });
    expect(response.statusCode).toBe(503);
  });
});
