import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_V2, PILOT_CATALOG } from '@ai-checkout/rewards-core';
import { createCatalogFetcher, readBoundedJson } from '@ai-checkout/catalog-client';
import { createApp } from '../src/app.ts';
import { createCatalogRepository } from '../src/catalog-repository.ts';

const release = {
  sequence: 1,
  version: PILOT_CATALOG.version,
  catalog: PILOT_CATALOG,
  published_at: '2026-09-25T12:00:00Z',
  catalog_hash: 'a'.repeat(64),
};
const apps: ReturnType<typeof createApp>[] = [];
function app(readCatalog = vi.fn(async (): Promise<unknown> => release)) {
  const server = createApp({ readCatalog, clock: () => Date.parse('2026-09-25T15:00:00Z') });
  apps.push(server);
  return server;
}
const json = (value: unknown) => Response.json(value);
afterEach(async () => {
  await Promise.all(apps.splice(0).map((server) => server.close()));
});

describe('public catalog API', () => {
  it('returns only a validated published release through a real Fastify route', async () => {
    const response = await app().inject({ method: 'GET', url: '/v1/catalog' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ release });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('serves a catalog v2 release and still fails closed on an invalid v2 catalog', async () => {
    const v2 = {
      ...release,
      version: CATALOG_V2.version,
      catalog: CATALOG_V2,
      published_at: '2026-09-30T12:00:00Z',
    };
    const server = createApp({
      readCatalog: vi.fn(async () => v2),
      clock: () => Date.parse('2026-09-30T15:00:00Z'),
    });
    apps.push(server);
    expect((await server.inject('/v1/catalog')).json()).toEqual({ release: v2 });
    const broken = structuredClone(v2);
    broken.catalog.cards[0].rules[0].paidOnPaymentBps = 999;
    const failing = createApp({
      readCatalog: vi.fn(async () => broken),
      clock: () => Date.parse('2026-09-30T15:00:00Z'),
    });
    apps.push(failing);
    expect((await failing.inject('/v1/catalog')).statusCode).toBe(503);
  });
  it('returns no publication when the database has only an unapproved seed', async () => {
    expect((await app(vi.fn(async () => null)).inject('/v1/catalog')).json()).toEqual({ release: null });
  });
  it.each(['malformed', 'expired', 'not yet valid', 'database error'])(
    'fails closed for %s',
    async (kind) => {
      const read = vi.fn(async (): Promise<unknown> => {
        if (kind === 'database error') throw new Error('private-database-details');
        const value = structuredClone(release);
        if (kind === 'malformed') value.catalog.cards[0].rules[0].rateBps = -1;
        if (kind === 'expired') value.catalog.expiresAt = '2026-09-25T14:00:00Z';
        if (kind === 'not yet valid') value.published_at = '2026-09-26T00:00:00Z';
        return value;
      });
      const response = await app(read).inject('/v1/catalog');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'catalog_unavailable' });
      expect(response.body).not.toContain('private');
    },
  );
  it('reports liveness without falsely claiming a database readiness check', async () => {
    const read = vi.fn(async () => {
      throw new Error('offline');
    });
    expect((await app(read).inject('/health')).json()).toEqual({ status: 'ok' });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('catalog transport and database adapter', () => {
  it('makes one joined query with only the configured public key', async () => {
    const fetcher = vi.fn(async () => json([{ release_sequence: 1, release }]));
    const read = createCatalogRepository('https://example.supabase.co', 'public-key', fetcher);
    expect(await read()).toEqual(release);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/rest/v1/catalog_head');
    expect(new URL(url).searchParams.get('select')).toContain('!catalog_head_release_sequence_fkey');
    expect(options.headers).toEqual({ apikey: 'public-key', Accept: 'application/json' });
    expect(options.redirect).toBe('error');
  });
  it('rejects a missing row or inconsistent head instead of serving an arbitrary release', async () => {
    for (const rows of [[], [{ release_sequence: 2, release }], [{ release_sequence: 1, release: null }]]) {
      await expect(
        createCatalogRepository('https://example.supabase.co', 'public', async () => json(rows))(),
      ).rejects.toThrow();
    }
  });
  it('sends no wallet, page, user credential or referrer from the extension', async () => {
    const fetcher = vi.fn(async () => json({ release }));
    const controller = new AbortController();
    expect(
      await createCatalogFetcher('https://catalog.example/v1/catalog', fetcher)(controller.signal),
    ).toEqual({ release });
    expect(fetcher).toHaveBeenCalledWith('https://catalog.example/v1/catalog', {
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  });
  it.each([
    'http://catalog.example/v1/catalog',
    'https://user:secret@catalog.example/v1/catalog',
    'https://catalog.example/v1/catalog?wallet=1',
    'https://catalog.example/v1/catalog#anything',
  ])('rejects unsafe endpoint %s', (url) => {
    expect(() => createCatalogFetcher(url)).toThrow();
  });
  it.each([
    new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }),
    new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    new Response('broken', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '99999999' } }),
  ])('rejects an unsafe HTTP body', async (response) => {
    await expect(readBoundedJson(response)).rejects.toThrow();
  });
  it('enforces size while streaming when content-length is absent or dishonest', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(100));
        },
        cancel,
      }),
      { headers: { 'content-type': 'application/json', 'content-length': '2' } },
    );
    await expect(readBoundedJson(response, 50)).rejects.toThrow('too large');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
