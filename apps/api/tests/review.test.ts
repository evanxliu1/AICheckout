import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_V3_LIMITS, PILOT_CATALOG, catalogSchema } from '@ai-checkout/rewards-core';
import {
  MAX_CAPTURE_REQUEST_BYTES,
  MAX_CAPTURES_PER_MINUTE,
  MAX_DRAFT_SOURCES,
  MAX_REVIEW_RESPONSE_BYTES,
  MAX_SOURCE_BODY_CHARS,
  reviewSummarySchema,
} from '@ai-checkout/catalog-review';
import { largeCatalogV3 } from '../../../packages/rewards-core/large-catalog-fixture.ts';
import { createApp } from '../src/app.ts';
import { createReviewRepository, ReviewError } from '../src/review-repository.ts';

const token = 'signed.human.session';
const authorization = `Bearer ${token}`;
const draftId = '30000000-0000-4000-8000-000000000003';
const reviewerId = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const queue = { reviewerId, head: null, drafts: [] };
const approval = {
  expectedRevision: 1,
  expectedHash: hash,
  expectedHead: null,
  reviewNote: 'Reviewed the issuer evidence.',
};
const draft = {
  id: draftId,
  catalog: PILOT_CATALOG,
  catalog_hash: hash,
  source_document_ids: [],
  base_sequence: null,
  revision: 1,
  status: 'draft',
  created_by: reviewerId,
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
};
const release = {
  sequence: 1,
  catalog: PILOT_CATALOG,
  catalog_hash: hash,
  version: PILOT_CATALOG.version,
  published_at: '2026-09-25T00:01:00Z',
};
const apps: ReturnType<typeof createApp>[] = [];
function app(rpc = vi.fn().mockResolvedValue(queue), reviewLimit?: number) {
  const instance = createApp({
    readCatalog: async () => null,
    reviewRpc: rpc,
    verifyReviewToken: async () => true,
    reviewLimit,
  });
  apps.push(instance);
  return { instance, rpc };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

describe('review API boundaries', () => {
  it.each([undefined, '', 'Basic credentials', 'Bearer service-key', `Bearer ${'a'.repeat(8200)}`])(
    'rejects absent/malformed authorization before any RPC (%s)',
    async (header) => {
      const { instance, rpc } = app();
      const response = await instance.inject({
        url: '/v1/review/',
        headers: header ? { authorization: header } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it('forwards only the signed session to the fixed queue RPC and sends no-store', async () => {
    const { instance, rpc } = app();
    const response = await instance.inject({ url: '/v1/review/', headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(queue);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_catalog_review', token, { p_draft_id: null });
  });
  it('does not accept session or identity assertions through query strings', async () => {
    const { instance, rpc } = app();
    const response = await instance.inject({
      url: '/v1/review/?reviewerId=forged',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409, 404, 422, 503])(
    'preserves the safe error category %i without leaking internal details',
    async (status) => {
      const { instance } = app(vi.fn().mockRejectedValue(new ReviewError(status, 'safe_code')));
      const response = await instance.inject({ url: '/v1/review/', headers: { authorization } });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error: 'safe_code' });
    },
  );
  it('rejects malformed upstream objects instead of exposing private fields', async () => {
    const { instance } = app(vi.fn().mockResolvedValue({ ...queue, secret: 'private detail' }));
    const response = await instance.inject({ url: '/v1/review/', headers: { authorization } });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private detail');
  });
  it('validates draft IDs and exact approval inputs before forwarding publication', async () => {
    const { instance, rpc } = app(vi.fn().mockResolvedValue(release));
    const response = await instance.inject({
      method: 'POST',
      url: `/v1/review/drafts/${draftId}/publish`,
      headers: { authorization },
      payload: approval,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(release);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('publish_catalog', token, {
      p_draft_id: draftId,
      p_expected_revision: 1,
      p_expected_hash: hash,
      p_expected_head: null,
      p_review_note: approval.reviewNote,
    });
    rpc.mockClear();
    for (const payload of [
      { ...approval, autoApprove: true },
      { ...approval, expectedHash: 'wrong' },
      { ...approval, reviewNote: '' },
    ]) {
      expect(
        (
          await instance.inject({
            method: 'POST',
            url: `/v1/review/drafts/${draftId}/publish`,
            headers: { authorization },
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (await instance.inject({ url: '/v1/review/drafts/not-a-uuid', headers: { authorization } })).statusCode,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('requires explicit base/revision on draft creation/edit and never implicitly publishes', async () => {
    const { instance, rpc } = app(vi.fn().mockResolvedValue(draft));
    const payload = { catalog: PILOT_CATALOG, sourceDocumentIds: [], baseSequence: null };
    expect(
      (
        await instance.inject({
          method: 'POST',
          url: '/v1/review/drafts',
          headers: { authorization },
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('save_catalog_draft', token, {
      p_id: null,
      p_expected_revision: null,
      p_catalog: PILOT_CATALOG,
      p_source_document_ids: [],
      p_base_sequence: null,
    });
    expect(
      (
        await instance.inject({
          method: 'PUT',
          url: `/v1/review/drafts/${draftId}`,
          headers: { authorization },
          payload,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await instance.inject({
          method: 'PUT',
          url: `/v1/review/drafts/${draftId}`,
          headers: { authorization },
          payload: { ...payload, expectedRevision: 1 },
        })
      ).statusCode,
    ).toBe(200);
    expect(rpc.mock.calls.every((call) => call[0] === 'save_catalog_draft')).toBe(true);
  });
  it('rejects malformed JSON and oversized source bodies before reaching the database', async () => {
    const { instance, rpc } = app();
    const headers = { authorization, 'content-type': 'application/json' };
    expect(
      (await instance.inject({ method: 'POST', url: '/v1/review/sources', headers, payload: '{' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await instance.inject({
          method: 'POST',
          url: '/v1/review/sources',
          headers,
          payload: JSON.stringify({ body: 'a'.repeat(MAX_CAPTURE_REQUEST_BYTES) }),
        })
      ).statusCode,
    ).toBe(413);
    // A long issuer capture (the largest expansion capture is 204,334 characters) fits; over 250,000
    // characters is rejected as invalid.
    expect(
      (
        await instance.inject({
          method: 'POST',
          url: '/v1/review/sources',
          headers,
          payload: JSON.stringify({
            sourceKey: 'long-terms',
            title: 'Long terms',
            url: 'https://issuer.example/terms',
            checkedOn: '2026-09-25',
            body: 'a'.repeat(250001),
          }),
        })
      ).statusCode,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('limits review requests even when a caller changes X-Forwarded-For', async () => {
    const { instance, rpc } = app(vi.fn().mockResolvedValue(queue), 2);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await instance.inject({
            url: '/v1/review/',
            headers: { authorization, 'x-forwarded-for': `192.0.2.${i}` },
          })
        ).statusCode,
      ).toBe(200);
    const limited = await instance.inject({
      url: '/v1/review/',
      headers: { authorization, 'x-forwarded-for': '192.0.2.99' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'too_many_requests' });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect((await instance.inject('/health')).statusCode).toBe(200);
  });
});

describe('large catalog review (Stage 2 M8)', () => {
  const sourceId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const capture = {
    id: sourceId(1),
    source_key: 'long-terms',
    title: 'Long terms',
    url: 'https://issuer.example/terms',
    checked_on: '2026-09-25',
    content_hash: hash,
    created_by: reviewerId,
    created_at: '2026-09-25T00:00:00Z',
  };
  const summary = {
    reviewerId,
    head: null,
    published: null,
    draft: { ...draft, source_document_ids: [capture.id] },
    sources: [{ ...capture, body_chars: 12 }],
  };
  it('serves the draft review from the summary RPC, with source metadata and no text', async () => {
    const { instance, rpc } = app(vi.fn().mockResolvedValue(summary));
    const response = await instance.inject({
      url: `/v1/review/drafts/${draftId}`,
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(summary);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_catalog_review_summary', token, { p_draft_id: draftId });
    // A body is never passed through the summary, and a summary of another draft is refused.
    for (const upstream of [
      { ...summary, sources: [{ ...capture, body_chars: 12, body: 'Captured text' }] },
      { ...summary, draft: { ...summary.draft, id: sourceId(9) } },
    ]) {
      rpc.mockResolvedValueOnce(upstream);
      const refused = await instance.inject({
        url: `/v1/review/drafts/${draftId}`,
        headers: { authorization },
      });
      expect(refused.statusCode).toBe(503);
      expect(refused.body).not.toContain('Captured text');
    }
  });
  it('reads one attached capture with its text', async () => {
    const document = { ...capture, body: 'Captured text' };
    const { instance, rpc } = app(vi.fn().mockResolvedValue(document));
    const url = `/v1/review/drafts/${draftId}/sources/${capture.id}`;
    const response = await instance.inject({ url, headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(document);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_catalog_review_source', token, {
      p_draft_id: draftId,
      p_source_document_id: capture.id,
    });
    rpc.mockResolvedValueOnce({ ...document, id: sourceId(2) });
    expect((await instance.inject({ url, headers: { authorization } })).statusCode).toBe(503);
    rpc.mockClear();
    for (const bad of [`/v1/review/drafts/${draftId}/sources/nope`, `${url}?full=1`])
      expect((await instance.inject({ url: bad, headers: { authorization } })).statusCode).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('accepts a 250,000-character capture however it is encoded, and nothing larger', async () => {
    const { instance, rpc } = app(vi.fn().mockResolvedValue({ ...capture, body: 'stored' }));
    const headers = { authorization, 'content-type': 'application/json' };
    const send = (body: string) =>
      instance.inject({
        method: 'POST',
        url: '/v1/review/sources',
        headers,
        payload: JSON.stringify({
          sourceKey: 'long-terms',
          title: capture.title,
          url: capture.url,
          checkedOn: '2026-09-25',
          body,
        }),
      });
    // Three bytes per character in UTF-8; six per control character once JSON-escaped.
    for (const body of ['界'.repeat(MAX_SOURCE_BODY_CHARS), '\u0001'.repeat(MAX_SOURCE_BODY_CHARS)]) {
      expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(524288);
      const response = await send(body);
      expect(response.statusCode).toBe(200);
      expect(rpc.mock.lastCall?.[2]).toMatchObject({ p_body: body });
    }
    expect((await send('界'.repeat(MAX_SOURCE_BODY_CHARS + 1))).statusCode).toBe(400);
  });
  it('saves a catalog v3 draft near 1 MiB that cites 600 captures', async () => {
    let cards = 300,
      catalog = largeCatalogV3({ cards, day: '2026-10-02' });
    while (Buffer.byteLength(JSON.stringify(catalog)) > CATALOG_V3_LIMITS.bytes)
      catalog = largeCatalogV3({ cards: --cards, day: '2026-10-02' });
    expect(Buffer.byteLength(JSON.stringify(catalog))).toBeGreaterThan(0.95 * CATALOG_V3_LIMITS.bytes);
    expect(catalogSchema.safeParse(catalog).success).toBe(true);
    const saved = { ...draft, catalog };
    const { instance, rpc } = app(vi.fn().mockResolvedValue(saved));
    const sourceDocumentIds = Array.from({ length: MAX_DRAFT_SOURCES }, (_, i) => sourceId(i + 1));
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/review/drafts',
      headers: { authorization },
      payload: { catalog, sourceDocumentIds, baseSequence: null },
    });
    expect(response.statusCode).toBe(200);
    expect(rpc.mock.lastCall?.[2]).toMatchObject({ p_source_document_ids: sourceDocumentIds });
    const update = await instance.inject({
      method: 'PUT',
      url: `/v1/review/drafts/${draftId}`,
      headers: { authorization },
      payload: { catalog, sourceDocumentIds, baseSequence: null, expectedRevision: 1 },
    });
    expect(update.statusCode).toBe(200);
  });
  it('lets a reviewer capture a full draft of sources in one minute while other routes keep the limit', async () => {
    const rpc = vi.fn(async (operation: string) =>
      operation === 'capture_catalog_source' ? { ...capture, body: 'stored' } : queue,
    );
    const { instance } = app(rpc, 2);
    const payload = {
      sourceKey: 'long-terms',
      title: capture.title,
      url: capture.url,
      checkedOn: '2026-09-25',
    };
    for (let i = 0; i < 5; i++)
      expect(
        (
          await instance.inject({
            method: 'POST',
            url: '/v1/review/sources',
            headers: { authorization },
            payload: { ...payload, body: `Terms ${i}` },
          })
        ).statusCode,
      ).toBe(200);
    for (const status of [200, 200, 429])
      expect((await instance.inject({ url: '/v1/review/', headers: { authorization } })).statusCode).toBe(
        status,
      );
  });
  it('limits captures to MAX_CAPTURES_PER_MINUTE and says when to retry', async () => {
    const rpc = vi.fn(async () => ({ ...capture, body: 'stored' }));
    const { instance } = app(rpc);
    const send = () =>
      instance.inject({
        method: 'POST',
        url: '/v1/review/sources',
        headers: { authorization },
        payload: {
          sourceKey: 'long-terms',
          title: capture.title,
          url: capture.url,
          checkedOn: '2026-09-25',
          body: 'Terms',
        },
      });
    expect(MAX_CAPTURES_PER_MINUTE).toBeLessThan(MAX_DRAFT_SOURCES);
    for (let i = 0; i < MAX_CAPTURES_PER_MINUTE; i++) expect((await send()).statusCode).toBe(200);
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'too_many_requests' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledTimes(MAX_CAPTURES_PER_MINUTE);
  });
  it('keeps the largest possible summary under the review response cap', () => {
    // Two catalogs at the v3 limit (draft and published) and 600 sources with the longest metadata;
    // PostgreSQL's JSONB text adds a space after each ":" and ",", well under 1.5x.
    const longest = {
      ...capture,
      source_key: 'a'.repeat(80),
      title: 't'.repeat(200),
      url: `https://issuer.example/${'u'.repeat(2020)}`,
      body_chars: MAX_SOURCE_BODY_CHARS,
    };
    const catalogBytes = CATALOG_V3_LIMITS.bytes;
    const sources = Array.from({ length: MAX_DRAFT_SOURCES }, (_, i) => ({
      ...longest,
      id: sourceId(i + 1),
    }));
    const metadata = JSON.stringify({ reviewerId, head: 1, sources, draft: { ...draft, catalog: null } });
    expect(1.5 * (2 * catalogBytes + Buffer.byteLength(metadata))).toBeLessThan(MAX_REVIEW_RESPONSE_BYTES);
    // The schema accepts that many sources.
    expect(
      reviewSummarySchema.safeParse({
        ...summary,
        draft: { ...summary.draft, source_document_ids: sources.map((source) => source.id) },
        sources,
      }).success,
    ).toBe(true);
  });
});

describe('review Data API adapter', () => {
  it('uses a fixed RPC, forwards the human token, and disables redirect/credential storage', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(queue));
    const repository = createReviewRepository('https://project.supabase.co', 'public-key', fetcher);
    expect(await repository('get_catalog_review', token, { p_draft_id: null })).toEqual(queue);
    const [url, options] = fetcher.mock.calls[0];
    expect(url.href).toBe('https://project.supabase.co/rest/v1/rpc/get_catalog_review');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { apikey: 'public-key', Authorization: authorization },
      body: '{"p_draft_id":null}',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    [401, 'PGRST301', 401, 'sign_in_required'],
    [403, '42501', 403, 'reviewer_access_required'],
    [400, '40001', 409, 'review_changed'],
    [409, '23505', 409, 'review_changed'],
    [400, 'P0002', 404, 'draft_not_found'],
    [400, '22023', 422, 'invalid_catalog_evidence'],
    [500, 'XX000', 503, 'review_unavailable'],
  ])('maps upstream failure %i/%s to safe status %i', async (upstream, code, status, error) => {
    const repository = createReviewRepository(
      'http://127.0.0.1:54321',
      'public-key',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code, message: 'Sensitive database details' }, { status: upstream as number }),
        ),
    );
    await expect(repository('get_catalog_review', token, {})).rejects.toMatchObject({
      status,
      code: error,
      message: error,
    });
  });
  it('maps a transport failure to unavailable without exposing credentials from the error', async () => {
    const repository = createReviewRepository(
      'https://project.supabase.co',
      'public-key',
      vi.fn().mockRejectedValue(new Error('Secret upstream details')),
    );
    await expect(repository('get_catalog_review', token, {})).rejects.toMatchObject({
      status: 503,
      message: 'review_unavailable',
    });
  });
});

it('maps a missing capture to source_not_found', async () => {
  const repository = createReviewRepository(
    'http://127.0.0.1:54321',
    'public-key',
    vi.fn().mockResolvedValue(Response.json({ code: 'P0002' }, { status: 400 })),
  );
  await expect(repository('get_catalog_review_source', token, {})).rejects.toMatchObject({
    status: 404,
    code: 'source_not_found',
  });
});

describe('token check before large review bodies', () => {
  function guarded(valid: boolean | Error, reviewLimit?: number) {
    const rpc = vi.fn().mockResolvedValue(queue);
    const verifyReviewToken = vi.fn(async () => {
      if (valid instanceof Error) throw valid;
      return valid;
    });
    const instance = createApp({
      readCatalog: async () => null,
      reviewRpc: rpc,
      verifyReviewToken,
      reviewLimit,
    });
    apps.push(instance);
    return { instance, rpc, verifyReviewToken };
  }
  const oversized = JSON.stringify({ body: 'a'.repeat(MAX_CAPTURE_REQUEST_BYTES) });
  it.each([
    ['POST', '/v1/review/sources'],
    ['POST', '/v1/review/drafts'],
    ['PUT', `/v1/review/drafts/${draftId}`],
    ['POST', `/v1/review/drafts/${draftId}/extractions/${draftId}/apply`],
  ] as const)('%s %s answers 401 before reading the body', async (method, url) => {
    const { instance, rpc, verifyReviewToken } = guarded(false);
    const response = await instance.inject({
      method,
      url,
      headers: { authorization, 'content-type': 'application/json' },
      payload: oversized,
    });
    // 401, not 413: the body limit is applied while parsing, which never started.
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'sign_in_required' });
    expect(verifyReviewToken).toHaveBeenCalledExactlyOnceWith(token);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rate-limits refused tokens before the check, so they cannot drive unlimited Auth calls', async () => {
    const { instance, verifyReviewToken } = guarded(false, 2);
    const send = (url: string) =>
      instance.inject({ method: 'POST', url, headers: { authorization }, payload: { body: 'x' } });
    for (const status of [401, 401, 429]) expect((await send('/v1/review/drafts')).statusCode).toBe(status);
    expect(verifyReviewToken).toHaveBeenCalledTimes(2);
    for (let i = 0; i < MAX_CAPTURES_PER_MINUTE; i++)
      expect((await send('/v1/review/sources')).statusCode).toBe(401);
    expect((await send('/v1/review/sources')).statusCode).toBe(429);
    expect(verifyReviewToken).toHaveBeenCalledTimes(2 + MAX_CAPTURES_PER_MINUTE);
  });
  it('reports an unreachable Auth server as unavailable, not as signed out', async () => {
    const { instance, rpc } = guarded(new TypeError('fetch failed'));
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/review/sources',
      headers: { authorization },
      payload: { body: 'x' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'review_unavailable' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('leaves small-body and read routes to the database check alone', async () => {
    const { instance, verifyReviewToken } = guarded(false);
    expect((await instance.inject({ url: '/v1/review/', headers: { authorization } })).statusCode).toBe(200);
    expect(verifyReviewToken).not.toHaveBeenCalled();
  });
  it('responds over a real socket while the declared 1 MB body is still unsent', async () => {
    const { instance } = guarded(false);
    const address = await instance.listen({ host: '127.0.0.1', port: 0 });
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = request(`${address}/v1/review/sources`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json', 'content-length': 1_000_000 },
      });
      outgoing.on('response', (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
        outgoing.destroy();
      });
      outgoing.on('error', reject);
      outgoing.flushHeaders();
    });
    expect(status).toBe(401);
  });
});
