import { readBoundedJson } from '@ai-checkout/catalog-client';
import { MAX_REVIEW_RESPONSE_BYTES } from '@ai-checkout/catalog-review';

export type ReviewOperation = 'get_catalog_review' | 'capture_catalog_source' | 'save_catalog_draft' | 'publish_catalog' | 'get_curation_run' |
  'list_draft_extractions' | 'get_draft_extraction' | 'apply_reviewed_extraction';
export type ReviewRpc = (operation: ReviewOperation, token: string, parameters: Record<string, unknown>) => Promise<unknown>;
export class ReviewError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** The Data API verifies the signed token; each RPC checks live session/membership
 * inside its transaction. The server never substitutes an administrative credential. */
export function createReviewRepository(supabaseUrl: string, publishableKey: string, fetcher: typeof fetch = fetch): ReviewRpc {
  const base = new URL(supabaseUrl);
  const local = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
  if ((!local && base.protocol !== 'https:') || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !publishableKey) {
    throw new Error('Invalid review database configuration.');
  }
  return async (operation, token, parameters) => {
    try {
      const response = await fetcher(new URL(`/rest/v1/rpc/${operation}`, base), {
        method: 'POST', signal: AbortSignal.timeout(7000), redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters),
      });
      if (response.ok) return await readBoundedJson(response, MAX_REVIEW_RESPONSE_BYTES);
      // Failure bodies are untrusted too. Preserve safe categories, never SQL details.
      let code: unknown;
      try {
        const normalized = new Response(response.body, { status: 200, headers: response.headers });
        const body = await readBoundedJson(normalized, 8192);
        if (body && typeof body === 'object' && 'code' in body) code = body.code;
      } catch { /* Invalid error data becomes a generic unavailable response. */ }
      if (response.status === 401) throw new ReviewError(401, 'sign_in_required');
      if (response.status === 403) throw new ReviewError(403, 'reviewer_access_required');
      if (code === '40001' || code === '23505') throw new ReviewError(409, 'review_changed');
      if (code === 'P0002') throw new ReviewError(404, operation === 'get_curation_run' ? 'curation_run_not_found' : 'draft_not_found');
      if (['22023', '23514', '23503', '23502'].includes(String(code))) throw new ReviewError(422, 'invalid_catalog_evidence');
      throw new ReviewError(503, 'review_unavailable');
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      throw new ReviewError(503, 'review_unavailable');
    }
  };
}
