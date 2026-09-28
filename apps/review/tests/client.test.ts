import { afterEach, expect, it, vi } from 'vitest';
import { createReviewApi } from '../src/client';
import { reviewFixture } from './fixtures';
afterEach(() => vi.unstubAllGlobals());
it('sends a bearer token only to the same-origin API and validates the review response', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(reviewFixture()));
  vi.stubGlobal('fetch', fetcher);
  const detail = reviewFixture(),
    api = createReviewApi(async () => 'human-token', vi.fn());
  expect(await api.detail(detail.draft.id, new AbortController().signal)).toEqual(detail);
  expect(fetcher).toHaveBeenCalledWith(
    `/v1/review/drafts/${detail.draft.id}`,
    expect.objectContaining({
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer human-token', Accept: 'application/json' },
    }),
  );
});
it('clears access on revoked sessions and never displays raw server details', async () => {
  const lost = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'reviewer_access_required', secret: 'private SQL' }, { status: 403 }),
      ),
  );
  const api = createReviewApi(async () => 'token', lost);
  await expect(api.queue(new AbortController().signal)).rejects.toThrow(
    'does not currently have reviewer access',
  );
  expect(lost).toHaveBeenCalledExactlyOnceWith(403);
});
it('does not let a canceled old request revoke a newer session', async () => {
  const lost = vi.fn(),
    controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ error: 'sign_in_required' }, { status: 401 })),
  );
  await expect(createReviewApi(async () => 'old-token', lost).queue(controller.signal)).rejects.toThrow();
  expect(lost).not.toHaveBeenCalled();
});
