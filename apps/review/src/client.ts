import { z } from 'zod';
import { readBoundedJson } from '@ai-checkout/catalog-client';
import {
  MAX_REVIEW_RESPONSE_BYTES,
  reviewQueueSchema,
  reviewDetailSchema,
  sourceDocumentSchema,
  draftSchema,
  type ReviewConfig,
} from '@ai-checkout/catalog-review';
import { publishedReleaseSchema } from '@ai-checkout/rewards-core';
import { createClient } from '@supabase/supabase-js';
import {
  applyExtractionInputSchema,
  curationRunSchema,
  extractionApplicationSchema,
  extractionListSchema,
  extractionReviewSchema,
} from '@ai-checkout/catalog-review/curation';

const messages: Record<string, string> = {
  sign_in_required: 'Your session ended. Sign in again to continue.',
  reviewer_access_required: 'This account does not currently have reviewer access.',
  invalid_request: 'Some draft fields are invalid. Check the input and try again.',
  review_changed: 'The draft or published catalog changed. Reload it and review the changes again.',
  draft_not_found: 'This draft is no longer available. Return to the pending drafts.',
  invalid_catalog_evidence:
    'The draft, dates, or captured evidence are not ready to publish. Reload and check them.',
  too_many_requests: 'Too many requests. Wait a minute, then try again.',
  request_too_large: 'This input is too large. Shorten the source text or draft.',
  curation_inactive:
    'Extraction is disabled. An operator must configure the provider and budget before it can run.',
  curation_budget_exhausted: 'The extraction budget is exhausted. Ask the operator to review the budget.',
  curation_capacity_exhausted: 'Another extraction is running. Refresh the run list before starting another.',
  invalid_curation_input: 'Capture the complete registered source pack for this card before extracting.',
  curation_changed:
    'The saved request belongs to different draft or provider settings. Inspect the existing run before starting a new one.',
  curation_result_unconfirmed:
    'The run may have finished, but saving its result was not confirmed. Inspect the recorded run; do not start a duplicate.',
  curation_requires_review:
    'Unresolved facts, evidence, or conditions prevent applying this extraction. Review them and correct the source or draft manually.',
  curation_run_not_found: 'This extraction is not available for the selected draft.',
};
export class ReviewApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly runId?: string;
  constructor(status: number, code: string, runId?: string) {
    super(
      messages[code] ??
        'The request did not finish. Reload the draft before retrying a change or publication.',
    );
    this.status = status;
    this.code = code;
    this.runId = runId;
  }
}
export function createReviewAuth(config: ReviewConfig) {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    global: {
      fetch: (url, options) =>
        fetch(url, {
          ...options,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([AbortSignal.timeout(10000), ...(options?.signal ? [options.signal] : [])]),
        }),
    },
  });
}
export function createReviewApi(
  getToken: () => Promise<string | null>,
  accessLost: (status: number) => void,
) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    method = 'GET',
    body?: unknown,
    timeoutMs = 10000,
  ): Promise<T> {
    try {
      const token = await getToken();
      if (!token) throw new ReviewApiError(401, 'sign_in_required');
      const response = await fetch(`/v1/review${path}`, {
        method,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        let code = 'review_unavailable';
        let runId: string | undefined;
        try {
          const error = await readBoundedJson(
            new Response(response.body, { status: 200, headers: response.headers }),
            8192,
          );
          const parsed = z.object({ error: z.string().max(80), runId: z.uuid().optional() }).parse(error);
          code = parsed.error;
          runId = parsed.runId;
        } catch {
          /* Do not display server or database details. */
        }
        throw new ReviewApiError(response.status, code, runId);
      }
      return schema.parse(await readBoundedJson(response, MAX_REVIEW_RESPONSE_BYTES));
    } catch (error) {
      if (!signal.aborted && error instanceof ReviewApiError && [401, 403].includes(error.status))
        accessLost(error.status);
      if (error instanceof ReviewApiError) throw error;
      throw new ReviewApiError(503, 'review_unavailable');
    }
  }
  return {
    queue: (signal: AbortSignal) => request('/', reviewQueueSchema, signal),
    detail: (id: string, signal: AbortSignal) =>
      request(`/drafts/${encodeURIComponent(id)}`, reviewDetailSchema, signal),
    capture: (body: unknown, signal: AbortSignal) =>
      request('/sources', sourceDocumentSchema, signal, 'POST', body),
    update: (id: string, body: unknown, signal: AbortSignal) =>
      request(`/drafts/${encodeURIComponent(id)}`, draftSchema, signal, 'PUT', body),
    publish: (id: string, body: unknown, signal: AbortSignal) =>
      request(`/drafts/${encodeURIComponent(id)}/publish`, publishedReleaseSchema, signal, 'POST', body),
    extractions: (id: string, signal: AbortSignal) =>
      request(`/drafts/${encodeURIComponent(id)}/extractions`, extractionListSchema, signal),
    extraction: (id: string, runId: string, signal: AbortSignal) =>
      request(
        `/drafts/${encodeURIComponent(id)}/extractions/${encodeURIComponent(runId)}`,
        extractionReviewSchema,
        signal,
      ),
    extract: (id: string, body: unknown, signal: AbortSignal) =>
      request(
        `/drafts/${encodeURIComponent(id)}/extractions`,
        z.strictObject({ executed: z.boolean(), run: curationRunSchema }),
        signal,
        'POST',
        body,
        90000,
      ),
    applyExtraction: (
      id: string,
      runId: string,
      body: z.infer<typeof applyExtractionInputSchema>,
      signal: AbortSignal,
    ) =>
      request(
        `/drafts/${encodeURIComponent(id)}/extractions/${encodeURIComponent(runId)}/apply`,
        z.strictObject({ draft: draftSchema, application: extractionApplicationSchema }),
        signal,
        'POST',
        body,
      ),
  };
}
export type ReviewApi = ReturnType<typeof createReviewApi>;
