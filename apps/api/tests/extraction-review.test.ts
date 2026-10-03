import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import type { ReviewDetail } from '@ai-checkout/catalog-review';
import type { ApplyExtractionInput, CurationRun } from '@ai-checkout/catalog-review/curation';
import { createApp } from '../src/app.ts';
import { buildContext } from '../src/curation/context.ts';
import { runExtraction } from '../src/curation/runner.ts';
import { prepareExtractionReview } from '../src/curation/review.ts';
import { extractionFixture } from './curation-fixture.ts';

async function fixture(change?: (value: ReturnType<typeof extractionFixture>) => void) {
  const f = extractionFixture();
  change?.(f);
  f.reply.text = JSON.stringify(f.output);
  const now = new Date().toISOString(),
    catalog = structuredClone(PILOT_CATALOG),
    document = f.input.documents[0];
  catalog.cards[0].rules[0].rateBps = 50;
  catalog.sources[0].title = document.title;
  const detail: ReviewDetail = {
    reviewerId: randomUUID(),
    head: null,
    published: null,
    sources: f.input.documents,
    draft: {
      id: randomUUID(),
      catalog,
      catalog_hash: 'a'.repeat(64),
      source_document_ids: [document.id],
      base_sequence: null,
      revision: 2,
      status: 'draft',
      created_by: null,
      created_at: now,
      updated_at: now,
    },
  };
  const trace = await runExtraction(f.input, f.provider);
  const run: CurationRun = {
    id: trace.runId,
    requested_by: detail.reviewerId,
    session_id: randomUUID(),
    request_key: randomUUID(),
    request_hash: 'b'.repeat(64),
    profile_id: 'fixture',
    profile: {
      id: 'fixture',
      enabled: true,
      provider: 'fixture',
      model: 'synthetic-v1',
      mode: 'fixture',
      input_price: 0,
      output_price: 0,
      max_input_tokens: 48000,
      max_output_tokens: 4096,
      max_attempts: 2,
      attempt_timeout_ms: 10000,
      total_timeout_ms: 15000,
    },
    card_id: f.input.cardId,
    context: {
      ...buildContext(f.input),
      origin: { draftId: detail.draft.id, revision: 2, catalogHash: detail.draft.catalog_hash },
    },
    context_hash: 'c'.repeat(64),
    budget_day: now.slice(0, 10),
    reserved_microusd: 0,
    state: 'finished',
    started_at: now,
    deadline_at: now,
    finished_at: now,
    trace: JSON.parse(JSON.stringify(trace)),
    trace_hash: 'd'.repeat(64),
    interruption_note: null,
  };
  const input: ApplyExtractionInput = {
    expectedRevision: 2,
    expectedHash: detail.draft.catalog_hash,
    reviewNote: 'I reviewed the synthetic evidence and all conditions.',
    conditionReviews: [
      {
        index: 0,
        coverage: 'existing-rules',
        ruleIds: ['quicksilver-base'],
        note: 'The all-eligible category expresses this eligibility requirement.',
      },
    ],
  };
  const application = {
    run_id: run.id,
    draft_id: detail.draft.id,
    from_revision: 2,
    to_revision: 3,
    result_hash: 'e'.repeat(64),
    applied_by: detail.reviewerId,
    applied_at: now,
    review_note: input.reviewNote,
    condition_reviews: input.conditionReviews,
  };
  return {
    ...f,
    detail,
    run,
    input,
    application,
    review: () => prepareExtractionReview(detail, { run, application: null }),
  };
}
it('proposes only extracted representable fields, preserving dates, other cards and sources', async () => {
  const f = await fixture(),
    review = f.review();
  expect(review.blockers).toEqual([]);
  expect(review.proposedCatalog!.cards[0].rules[0].rateBps).toBe(150);
  expect(review.proposedCatalog!.cards[1]).toEqual(f.detail.draft.catalog.cards[1]);
  expect(review.proposedCatalog!.sources).toEqual(f.detail.draft.catalog.sources);
  expect(review.proposedCatalog!.expiresAt).toBe(f.detail.draft.catalog.expiresAt);
  expect(f.detail.draft.catalog.cards[0].rules[0].rateBps).toBe(50);
  expect(review.run.trace?.extraction?.conditions).toHaveLength(1);
});
it.each([
  'unknown',
  'unsupported',
  'citation',
  'stale',
  'metadata',
  'raw',
  'schema-context',
  'rule-set',
  'running',
])('blocks applying %s while preserving inspectable evidence', async (failure) => {
  const f = await fixture((value) => {
    if (failure === 'unknown')
      value.output.rules[0].activation = { state: 'unknown', value: null, evidence: [] };
    if (failure === 'unsupported')
      value.output.issues = [
        {
          code: 'unsupported-condition',
          field: 'conditions',
          detail: 'Cannot represent this restriction.',
          evidence: value.output.conditions[0].evidence,
        },
      ];
    if (failure === 'citation') value.output.rules[0].rateBps.evidence[0].start++;
  });
  if (failure === 'stale') f.detail.draft.revision++;
  if (failure === 'metadata') f.detail.draft.catalog.sources[0].checkedOn = '2026-09-24';
  if (failure === 'raw') (f.run.trace!.attempts as { rawOutput: string }[])[0].rawOutput = '{}';
  if (failure === 'schema-context') f.run.context.jsonSchema = {};
  if (failure === 'rule-set') f.detail.draft.catalog.cards[0].rules[0].id = 'different-rule';
  if (failure === 'running') {
    f.run.state = 'running';
    f.run.trace = null;
  }
  const review = f.review();
  expect(review.proposedCatalog).toBeNull();
  expect(review.blockers.length).toBeGreaterThan(0);
  expect(review.documents[0].body).toBe(f.detail.sources[0].body);
});
it('does not allow a different draft to inspect a run through the review endpoint', async () => {
  const f = await fixture();
  f.detail.draft.id = randomUUID();
  expect(f.review).toThrow('curation_run_not_found');
});
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
it('the apply route accepts human review only and uses the signed session, never a catalog or model authority', async () => {
  const f = await fixture(),
    proposal = f.review().proposedCatalog!,
    next = { ...f.detail.draft, revision: 3, catalog: proposal, catalog_hash: f.application.result_hash };
  const rpc = vi.fn(async (operation: string) =>
    operation === 'get_catalog_review'
      ? f.detail
      : operation === 'get_draft_extraction'
        ? { run: f.run, application: null }
        : { draft: next, application: f.application },
  );
  const app = createApp({
    readCatalog: async () => null,
    reviewRpc: rpc,
    verifyReviewToken: async () => true,
  });
  apps.push(app);
  const path = `/v1/review/drafts/${f.detail.draft.id}/extractions/${f.run.id}/apply`,
    headers = { authorization: 'Bearer signed.human.session' };
  expect((await app.inject({ method: 'POST', url: path, payload: f.input })).statusCode).toBe(401);
  expect(
    (await app.inject({ method: 'POST', url: path, headers, payload: { ...f.input, catalog: proposal } }))
      .statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ method: 'POST', url: path, headers, payload: { ...f.input, conditionReviews: [] } }))
      .statusCode,
  ).toBe(422);
  expect(
    (await app.inject({ method: 'POST', url: path, headers, payload: { ...f.input, expectedRevision: 9 } }))
      .statusCode,
  ).toBe(409);
  expect(rpc.mock.calls.some((call) => call[0] === 'apply_reviewed_extraction')).toBe(false);
  const response = await app.inject({ method: 'POST', url: path, headers, payload: f.input });
  expect(response.statusCode).toBe(200);
  expect(response.json().draft.revision).toBe(3);
  expect(rpc).toHaveBeenLastCalledWith('apply_reviewed_extraction', 'signed.human.session', {
    p_draft_id: f.detail.draft.id,
    p_run_id: f.run.id,
    p_expected_revision: 2,
    p_expected_hash: f.detail.draft.catalog_hash,
    p_condition_reviews: f.input.conditionReviews,
    p_review_note: f.input.reviewNote,
  });
  expect(rpc.mock.calls.some((call) => call[0] === 'publish_catalog')).toBe(false);
});
