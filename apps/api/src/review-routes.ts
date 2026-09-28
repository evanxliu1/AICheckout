import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { publishedReleaseSchema } from '@ai-checkout/rewards-core';
import {
  captureSourceInputSchema,
  createDraftInputSchema,
  updateDraftInputSchema,
  publishInputSchema,
  sourceDocumentSchema,
  draftSchema,
  draftIdSchema,
  reviewQueueSchema,
  reviewDetailSchema,
  startExtractionInputSchema,
} from '@ai-checkout/catalog-review';
import { ReviewError, type ReviewRpc } from './review-repository.ts';
import { curationRunSchema, LedgerError } from './curation/ledger';
import { startReviewedExtraction, type CurationExecution } from './curation/service';
import { applyExtractionInputSchema, extractionListSchema } from '@ai-checkout/catalog-review/curation';
import { applyReviewedExtraction, readExtractionReview } from './curation/review';

function bearer(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (
    !header ||
    header.length > 8192 ||
    !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)
  ) {
    throw new ReviewError(401, 'sign_in_required');
  }
  return header.slice(7);
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request');
  return parsed.data;
}
function id(request: FastifyRequest) {
  return input(z.strictObject({ id: draftIdSchema }), request.params).id;
}

export async function reviewRoutes(
  app: FastifyInstance,
  {
    rpc,
    limit = 60,
    curation,
    shutdownSignal,
    curationLimit = 3,
  }: {
    rpc: ReviewRpc;
    limit?: number;
    curation?: CurationExecution;
    shutdownSignal?: AbortSignal;
    curationLimit?: number;
  },
) {
  // In-memory, per-process/IP limits. trustProxy remains false: callers cannot forge
  // X-Forwarded-For to evade this boundary. Deployment must address proxy topology.
  await app.register(rateLimit, { global: true, max: limit, timeWindow: 60000, cache: 1000 });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    bearer(request);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ReviewError) return reply.code(error.status).send({ error: error.code });
    if (error instanceof LedgerError) {
      const status =
        (
          {
            reviewer_access_required: 403,
            curation_changed: 409,
            invalid_curation_input: 422,
            curation_budget_exhausted: 429,
            curation_capacity_exhausted: 429,
          } as Record<string, number>
        )[error.code] ?? 503;
      return reply.code(status).send({ error: error.code, ...(error.runId ? { runId: error.runId } : {}) });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'too_many_requests' });
    if (status === 413) return reply.code(413).send({ error: 'request_too_large' });
    if (status === 400 || status === 415) return reply.code(status).send({ error: 'invalid_request' });
    return reply.code(503).send({ error: 'review_unavailable' });
  });
  app.get('/', async (request) => {
    input(z.strictObject({}), request.query);
    return reviewQueueSchema.parse(await rpc('get_catalog_review', bearer(request), { p_draft_id: null }));
  });
  app.get('/drafts/:id', async (request) => {
    input(z.strictObject({}), request.query);
    return reviewDetailSchema.parse(
      await rpc('get_catalog_review', bearer(request), { p_draft_id: id(request) }),
    );
  });
  app.get('/runs/:id', async (request) => {
    input(z.strictObject({}), request.query);
    return {
      run: curationRunSchema.parse(await rpc('get_curation_run', bearer(request), { p_id: id(request) })),
    };
  });
  app.get('/drafts/:id/extractions', async (request) => {
    input(z.strictObject({}), request.query);
    return extractionListSchema.parse(
      await rpc('list_draft_extractions', bearer(request), { p_draft_id: id(request) }),
    );
  });
  app.get('/drafts/:id/extractions/:runId', async (request) => {
    input(z.strictObject({}), request.query);
    const params = input(z.strictObject({ id: draftIdSchema, runId: draftIdSchema }), request.params);
    return (await readExtractionReview(rpc, bearer(request), params.id, params.runId)).review;
  });
  app.post('/drafts/:id/extractions/:runId/apply', { bodyLimit: 196608 }, async (request) => {
    input(z.strictObject({}), request.query);
    const params = input(z.strictObject({ id: draftIdSchema, runId: draftIdSchema }), request.params);
    return applyReviewedExtraction(
      rpc,
      bearer(request),
      params.id,
      params.runId,
      input(applyExtractionInputSchema, request.body),
    );
  });
  app.post(
    '/drafts/:id/extractions',
    { bodyLimit: 4096, config: { rateLimit: { max: curationLimit, timeWindow: 60000 } } },
    async (request, reply) => {
      input(z.strictObject({}), request.query);
      const draftId = id(request),
        value = input(startExtractionInputSchema, request.body);
      const cancelled = new AbortController(),
        cancel = () => cancelled.abort();
      const disconnected = () => {
        if (!reply.raw.writableEnded) cancel();
      };
      request.raw.once('aborted', cancel);
      reply.raw.once('close', disconnected);
      try {
        // Includes signed authorization, the <=60s kernel, bounded SQL and result write.
        // In-process Fastify injection has no network socket timeout implementation.
        request.raw.socket.setTimeout?.(85000);
        const result = await startReviewedExtraction(
          rpc,
          bearer(request),
          draftId,
          value,
          curation,
          AbortSignal.any([
            cancelled.signal,
            AbortSignal.timeout(75000),
            ...(shutdownSignal ? [shutdownSignal] : []),
          ]),
        );
        const validated = z.strictObject({ executed: z.boolean(), run: curationRunSchema }).parse(result);
        return reply.code(validated.run.state === 'running' ? 202 : 200).send(validated);
      } finally {
        request.raw.off('aborted', cancel);
        reply.raw.off('close', disconnected);
      }
    },
  );
  app.post('/sources', { bodyLimit: 262144 }, async (request) => {
    const value = input(captureSourceInputSchema, request.body);
    return sourceDocumentSchema.parse(
      await rpc('capture_catalog_source', bearer(request), {
        p_source_key: value.sourceKey,
        p_title: value.title,
        p_url: value.url,
        p_checked_on: value.checkedOn,
        p_body: value.body,
      }),
    );
  });
  app.post('/drafts', { bodyLimit: 270336 }, async (request) => {
    const value = input(createDraftInputSchema, request.body);
    return draftSchema.parse(
      await rpc('save_catalog_draft', bearer(request), {
        p_id: null,
        p_expected_revision: null,
        p_catalog: value.catalog,
        p_source_document_ids: value.sourceDocumentIds,
        p_base_sequence: value.baseSequence,
      }),
    );
  });
  app.put('/drafts/:id', { bodyLimit: 270336 }, async (request) => {
    const draftId = id(request),
      value = input(updateDraftInputSchema, request.body);
    return draftSchema.parse(
      await rpc('save_catalog_draft', bearer(request), {
        p_id: draftId,
        p_expected_revision: value.expectedRevision,
        p_catalog: value.catalog,
        p_source_document_ids: value.sourceDocumentIds,
        p_base_sequence: value.baseSequence,
      }),
    );
  });
  // Publication is a distinct explicit human action, never an LLM tool or a side
  // effect of GET, source capture, draft save, or later extraction endpoints.
  app.post('/drafts/:id/publish', { bodyLimit: 16384 }, async (request) => {
    const draftId = id(request),
      value = input(publishInputSchema, request.body);
    return publishedReleaseSchema.parse(
      await rpc('publish_catalog', bearer(request), {
        p_draft_id: draftId,
        p_expected_revision: value.expectedRevision,
        p_expected_hash: value.expectedHash,
        p_expected_head: value.expectedHead,
        p_review_note: value.reviewNote,
      }),
    );
  });
}
