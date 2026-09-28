import { afterEach, describe, expect, it, vi } from 'vitest';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
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
  const instance = createApp({ readCatalog: async () => null, reviewRpc: rpc, reviewLimit });
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
          payload: JSON.stringify({ body: 'a'.repeat(270000) }),
        })
      ).statusCode,
    ).toBe(413);
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
