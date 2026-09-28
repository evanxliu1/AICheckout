import { afterEach, expect, it, vi } from 'vitest';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import type { ReviewDetail } from '@ai-checkout/catalog-review';
import { createApp } from '../src/app.ts';
import { createCurationLedger, LedgerError, type CurationRun } from '../src/curation/ledger.ts';
import { fixtureRefusalProvider, startReviewedExtraction } from '../src/curation/service.ts';
import { curationDatabaseConfig } from '../src/curation/database.ts';
import { ReviewError, type ReviewRpc } from '../src/review-repository.ts';
import { extractionFixture } from './curation-fixture.ts';
import { buildContext } from '../src/curation/context.ts';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function fixture() {
  const { input } = extractionFixture(),
    actor = '10000000-0000-4000-8000-000000000001',
    sessionId = '20000000-0000-4000-8000-000000000001';
  const claims = { sub: actor, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  const draftId = '40000000-0000-4000-8000-000000000001';
  const detail: ReviewDetail = {
    reviewerId: actor,
    head: null,
    published: null,
    sources: input.documents,
    draft: {
      id: draftId,
      catalog: PILOT_CATALOG,
      catalog_hash: 'a'.repeat(64),
      source_document_ids: input.documents.map((doc) => doc.id),
      base_sequence: null,
      revision: 1,
      status: 'draft',
      created_by: actor,
      created_at: '2026-09-25T00:00:00Z',
      updated_at: '2026-09-25T00:00:00Z',
    },
  };
  const request = {
    cardId: 'capital-one-quicksilver' as const,
    expectedRevision: 1,
    requestKey: '50000000-0000-4000-8000-000000000001',
  };
  const run: CurationRun = {
    id: '60000000-0000-4000-8000-000000000001',
    requested_by: actor,
    session_id: sessionId,
    request_key: request.requestKey,
    request_hash: 'b'.repeat(64),
    profile_id: 'test-fixture',
    card_id: request.cardId,
    profile: {
      id: 'test-fixture',
      enabled: true,
      provider: 'fixture',
      model: 'synthetic-refusal-v1',
      mode: 'fixture',
      input_price: 0,
      output_price: 0,
      max_input_tokens: 48000,
      max_output_tokens: 4096,
      max_attempts: 2,
      attempt_timeout_ms: 10000,
      total_timeout_ms: 15000,
    },
    context: buildContext(input),
    context_hash: 'c'.repeat(64),
    budget_day: '2026-09-25',
    reserved_microusd: 0,
    state: 'finished',
    started_at: '2026-09-25T00:00:00Z',
    deadline_at: '2026-09-25T00:02:00Z',
    finished_at: '2026-09-25T00:00:01Z',
    trace: { status: 'refused' },
    trace_hash: 'd'.repeat(64),
    interruption_note: null,
  };
  const query = vi.fn(),
    execute = vi.fn(async () => ({ executed: true, run }));
  const execution = {
    ledger: createCurationLedger(query),
    profileId: 'test-fixture',
    providerFor: fixtureRefusalProvider,
    execute,
  };
  const rpc = vi.fn<ReviewRpc>().mockResolvedValue(detail);
  const app = createApp({ readCatalog: async () => null, reviewRpc: rpc, curation: execution });
  apps.push(app);
  const post = (payload: Record<string, unknown> = request, authorization = `Bearer ${token}`) =>
    app.inject({
      method: 'POST',
      url: `/v1/review/drafts/${draftId}/extractions`,
      headers: { authorization },
      payload,
    });
  return {
    input,
    actor,
    sessionId,
    token,
    claims,
    draftId,
    detail,
    request,
    run,
    query,
    execute,
    execution,
    rpc,
    app,
    post,
  };
}
it('authenticates through the signed RPC before deriving identity and uses only database source text', async () => {
  const f = fixture(),
    response = await f.post();
  expect(response.statusCode).toBe(200);
  expect(response.json().run.id).toBe(f.run.id);
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('get_catalog_review', f.token, { p_draft_id: f.draftId });
  expect(f.execute).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      actor: { userId: f.actor, sessionId: f.sessionId },
      input: f.input,
      requestKey: f.request.requestKey,
      profileId: 'test-fixture',
      origin: { draftId: f.draftId, revision: 1, catalogHash: f.detail.draft.catalog_hash },
    }),
  );
  expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.execute.mock.invocationCallOrder[0]);
  expect(response.headers['cache-control']).toBe('no-store');
});
it.each(['actor', 'body', 'profile', 'sources', 'autoPublish'])(
  'rejects client assertions about %s',
  async (field) => {
    const f = fixture();
    expect((await f.post({ ...f.request, [field]: 'forged' })).statusCode).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  },
);
it('denies revoked or invalid signed sessions without touching the scoped executor', async () => {
  const f = fixture();
  f.rpc.mockRejectedValueOnce(new ReviewError(403, 'reviewer_access_required'));
  expect((await f.post()).statusCode).toBe(403);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.query).not.toHaveBeenCalled();
});
it.each(['different-user', 'bad-session', 'expired', 'missing-session'])(
  'rejects inconsistent verified identity (%s)',
  async (kind) => {
    const f = fixture(),
      claims: Record<string, unknown> = { ...f.claims };
    if (kind === 'different-user') claims.sub = '10000000-0000-4000-8000-000000000002';
    if (kind === 'bad-session') claims.session_id = 'bad';
    if (kind === 'expired') claims.exp = 1;
    if (kind === 'missing-session') delete claims.session_id;
    const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
    expect((await f.post(f.request, `Bearer ${token}`)).statusCode).toBe(401);
    expect(f.execute).not.toHaveBeenCalled();
  },
);
it.each(['revision', 'published', 'missing-source'])('prevents execution for %s', async (kind) => {
  const f = fixture();
  if (kind === 'revision') f.detail.draft.revision++;
  if (kind === 'published') f.detail.draft.status = 'published';
  if (kind === 'missing-source') {
    f.detail.sources = [];
    f.detail.draft.source_document_ids = [];
  }
  expect((await f.post()).statusCode).toBe(kind === 'missing-source' ? 422 : 409);
  expect(f.execute).not.toHaveBeenCalled();
});
it('keeps unconfigured curation unavailable after authorizing the caller', async () => {
  const f = fixture();
  await expect(startReviewedExtraction(f.rpc, f.token, f.draftId, f.request)).rejects.toMatchObject({
    status: 503,
    code: 'curation_inactive',
  });
});
it.each([
  ['curation_budget_exhausted', 429],
  ['curation_capacity_exhausted', 429],
  ['curation_changed', 409],
  ['curation_unavailable', 503],
] as const)('maps %s without exposing private database details', async (code, status) => {
  const f = fixture();
  f.execute.mockRejectedValueOnce(new LedgerError(code));
  const response = await f.post();
  expect(response.statusCode).toBe(status);
  expect(response.json()).toEqual({ error: code });
});
it('returns an inspectable run ID when result persistence is uncertain', async () => {
  const f = fixture();
  f.execute.mockRejectedValueOnce(new LedgerError('curation_result_unconfirmed', f.run.id));
  const response = await f.post();
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ error: 'curation_result_unconfirmed', runId: f.run.id });
});
it('returns pending state without claiming that a duplicate request executed', async () => {
  const f = fixture();
  f.run.state = 'running';
  f.execute.mockResolvedValueOnce({ executed: false, run: f.run });
  expect((await f.post()).statusCode).toBe(202);
});
it('protects run inspection with the human RPC and rejects leaked internal capability fields', async () => {
  const f = fixture();
  f.rpc.mockResolvedValueOnce(f.run);
  const response = await f.app.inject({
    url: `/v1/review/runs/${f.run.id}`,
    headers: { authorization: `Bearer ${f.token}` },
  });
  expect(response.statusCode).toBe(200);
  expect(f.rpc).toHaveBeenLastCalledWith('get_curation_run', f.token, { p_id: f.run.id });
  f.rpc.mockResolvedValueOnce({ ...f.run, execution_token_hash: 'secret' });
  const invalid = await f.app.inject({
    url: `/v1/review/runs/${f.run.id}`,
    headers: { authorization: `Bearer ${f.token}` },
  });
  expect(invalid.statusCode).toBe(503);
  expect(invalid.body).not.toContain('secret');
});
it('limits extraction attempts even when a client changes forwarded IP headers', async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) {
    const response = await f.app.inject({
      method: 'POST',
      url: `/v1/review/drafts/${f.draftId}/extractions`,
      headers: { authorization: `Bearer ${f.token}`, 'x-forwarded-for': `192.0.2.${i}` },
      payload: f.request,
    });
    expect(response.statusCode).toBe(i === 3 ? 429 : 200);
  }
  expect(f.execute).toHaveBeenCalledTimes(3);
});
it('requires authenticated TLS for remote database connections and ignores URL-based TLS overrides', () => {
  const config = curationDatabaseConfig('postgresql://scoped_login:password@db.example/postgres');
  expect(config.ssl).toEqual({ rejectUnauthorized: true });
  expect(config.max).toBe(2);
  expect(config.statement_timeout).toBe(5000);
  expect(curationDatabaseConfig('postgresql://scoped_login:password@127.0.0.1:54322/postgres').ssl).toBe(
    false,
  );
});
it.each([
  'postgresql://postgres:secret@127.0.0.1/postgres',
  'postgresql://service_role:secret@db.example/postgres',
  'postgresql://scoped:secret@db.example/postgres?sslmode=no-verify',
  'postgresql://scoped:secret@db.example/other',
  'postgresql://scoped@db.example/postgres',
  'secret-not-a-url',
])('rejects unsafe database config without echoing its credential: %s', (url) => {
  expect(() => curationDatabaseConfig(url)).toThrow('Invalid scoped curation database configuration.');
});
