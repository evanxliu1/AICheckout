import { z } from 'zod';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import { reviewDetailSchema, type StartExtractionInput } from '@ai-checkout/catalog-review';
import { ReviewError, type ReviewRpc } from '../review-repository';
import { executeRecordedExtraction, type CurationProfile, type createCurationLedger } from './ledger';
import type { ExtractionProvider } from './runner';

export type RecordedExecutor = typeof executeRecordedExtraction;
export interface CurationExecution {
  ledger: ReturnType<typeof createCurationLedger>; profileId: string;
  providerFor: (profile: CurationProfile) => ExtractionProvider;
  execute?: RecordedExecutor;
}
const identitySchema = z.object({ sub: z.uuid(), session_id: z.uuid(), exp: z.number().int().positive() });

/** Decoding is safe only AFTER the same token succeeded at the signed Data API boundary. */
function verifiedIdentity(token: string, verifiedReviewerId: string) {
  try {
    const claims = identitySchema.parse(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')));
    if (claims.sub !== verifiedReviewerId || claims.exp * 1000 <= Date.now()) throw new Error();
    return { userId: verifiedReviewerId, sessionId: claims.session_id };
  } catch { throw new ReviewError(401, 'sign_in_required'); }
}

export async function startReviewedExtraction(rpc: ReviewRpc, token: string, draftId: string, request: StartExtractionInput,
  execution?: CurationExecution, signal?: AbortSignal) {
  // This call verifies signature/expiry and current reviewer/session authority. Do not
  // decode a supplied token or touch the executor connection before it succeeds.
  const detail = reviewDetailSchema.parse(await rpc('get_catalog_review', token, { p_draft_id: draftId }));
  const actor = verifiedIdentity(token, detail.reviewerId);
  if (detail.draft.id !== draftId || detail.draft.revision !== request.expectedRevision || detail.draft.status !== 'draft') {
    throw new ReviewError(409, 'review_changed');
  }
  if (!detail.draft.catalog.cards.some(card => card.id === request.cardId)) throw new ReviewError(422, 'invalid_curation_input');
  if (!execution) throw new ReviewError(503, 'curation_inactive');
  const target = PILOT_CATALOG.cards.find(card => card.id === request.cardId)!;
  const required = new Set(target.rules.flatMap(rule => rule.sourceIds));
  const documents = detail.sources.filter(source => required.has(source.source_key));
  if ([...required].some(key => !documents.some(source => source.source_key === key))) throw new ReviewError(422, 'invalid_curation_input');
  return (execution.execute ?? executeRecordedExtraction)({ input: { cardId: request.cardId, documents }, actor,
    requestKey: request.requestKey, profileId: execution.profileId, ledger: execution.ledger, providerFor: execution.providerFor, signal,
    origin: { draftId, revision: detail.draft.revision, catalogHash: detail.draft.catalog_hash } });
}

/** Explicitly local development only. A refusal exercises the full path without pretending to be an LLM. */
export function fixtureRefusalProvider(profile: CurationProfile): ExtractionProvider {
  if (profile.provider !== 'fixture' || profile.model !== 'synthetic-refusal-v1' || profile.mode !== 'fixture' || profile.input_price || profile.output_price) {
    throw new Error('Unsupported fixture profile.');
  }
  return { id: 'fixture', model: 'synthetic-refusal-v1', mode: 'fixture', pricing: { input: 0, output: 0 }, invoke: async () => ({
    finishReason: 'refusal', text: 'Synthetic integration fixture. No model was called and no reward facts were generated.', usage: { inputTokens: 0, outputTokens: 0 },
  }) };
}
