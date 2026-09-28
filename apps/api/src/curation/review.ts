import { z } from 'zod';
import { catalogSchema, type Catalog } from '@ai-checkout/rewards-core';
import { draftSchema, reviewDetailSchema, type ReviewDetail } from '@ai-checkout/catalog-review';
import {
  extractionApplicationSchema,
  extractionInputSchema,
  extractionReviewSchema,
  extractionSchema,
  reviewRunSchema,
  type ApplyExtractionInput,
  type ExtractionReview,
} from '@ai-checkout/catalog-review/curation';
import { validateExtraction, validateInputs, sha256 } from './extraction';
import { canonicalJson } from './canonical';
import { buildContext, CONTEXT_VERSION } from './context';
import { ReviewError, type ReviewRpc } from '../review-repository';

const savedRunSchema = z.strictObject({
  run: reviewRunSchema,
  application: extractionApplicationSchema.nullable(),
});
const contextSchema = z.object({
  system: z.string(),
  user: z.string().max(196608),
  jsonSchema: z.record(z.string(), z.unknown()),
  hash: z.string(),
  versions: z.object({
    prompt: z.string(),
    context: z.string(),
    schema: z.string(),
    sourcePolicy: z.string(),
  }),
  origin: z.strictObject({
    draftId: z.uuid(),
    revision: z.number().int().positive(),
    catalogHash: z.string(),
  }),
});

/** A proposal is an inspectable draft change, never a publication or a semantic proof. */
export function prepareExtractionReview(detail: ReviewDetail, raw: unknown): ExtractionReview {
  const { run, application } = savedRunSchema.parse(raw),
    blockers: string[] = [];
  let documents: ExtractionReview['documents'] = [],
    proposedCatalog: Catalog | null = null;
  const context = contextSchema.safeParse(run.context);
  if (!context.success || context.data.origin.draftId !== detail.draft.id)
    throw new ReviewError(404, 'curation_run_not_found');
  if (application)
    blockers.push(
      `This run was applied to revision ${application.to_revision}. Review the saved draft before publishing.`,
    );
  if (detail.draft.status !== 'draft') blockers.push('This draft is no longer editable.');
  if (
    !application &&
    (context.data.origin.revision !== detail.draft.revision ||
      context.data.origin.catalogHash !== detail.draft.catalog_hash)
  ) {
    blockers.push(
      'The draft changed since this run. Start a new extraction from the current saved revision.',
    );
  }
  try {
    const envelope = z
      .object({
        documents: z
          .array(
            z.object({
              documentId: z.uuid(),
              sourceKey: z.string(),
              url: z.string(),
              checkedOn: z.string(),
              body: z.string(),
              contentHash: z.string(),
            }),
          )
          .max(3),
      })
      .parse(JSON.parse(context.data.user));
    const input = extractionInputSchema.parse({
      cardId: run.card_id,
      documents: envelope.documents.map((doc) => ({
        id: doc.documentId,
        source_key: doc.sourceKey,
        url: doc.url,
        checked_on: doc.checkedOn,
        body: doc.body,
        content_hash: doc.contentHash,
        title: 'Saved extraction source',
        created_at: run.started_at,
        created_by: null,
      })),
    });
    documents = input.documents;
    if (
      validateInputs(input, Date.now()).length ||
      context.data.versions.context !== CONTEXT_VERSION ||
      canonicalJson(JSON.parse(buildContext(input).user)) !== canonicalJson(JSON.parse(context.data.user)) ||
      context.data.hash !==
        sha256(
          canonicalJson({
            system: context.data.system,
            user: context.data.user,
            jsonSchema: context.data.jsonSchema,
            sourcePolicy: context.data.versions.sourcePolicy,
          }),
        )
    ) {
      blockers.push('The saved input/context could not be verified. Inspect this run without applying it.');
    }
    if (
      documents.some(
        (doc) =>
          !detail.sources.some(
            (current) =>
              current.id === doc.id &&
              current.content_hash === doc.content_hash &&
              detail.draft.catalog.sources.some(
                (source) =>
                  source.id === current.source_key &&
                  source.url === current.url &&
                  source.title === current.title &&
                  source.checkedOn === current.checked_on,
              ),
          ),
      )
    )
      blockers.push('The captured sources no longer match this draft.');
    const trace = run.trace;
    if (run.state !== 'finished' || !trace)
      blockers.push(
        run.state === 'running'
          ? 'This run is still recorded as running. Refresh its saved result; do not start a duplicate.'
          : 'This run did not finish with a usable result.',
      );
    else {
      if (
        trace.context?.hash !== context.data.hash ||
        canonicalJson(trace.context?.versions ?? null) !== canonicalJson(context.data.versions) ||
        canonicalJson(trace.documents) !==
          canonicalJson(documents.map((doc) => ({ id: doc.id, contentHash: doc.content_hash }))) ||
        trace.runId !== run.id ||
        trace.provider.id !== run.profile.provider ||
        trace.provider.model !== run.profile.model ||
        trace.provider.mode !== run.profile.mode
      ) {
        blockers.push('The trace does not match its saved context.');
      }
      if (trace.status !== 'evidence_valid' || trace.findings.length || !trace.extraction)
        blockers.push(
          'This extraction has unresolved findings or no usable facts. Correct the source or maintain the draft manually.',
        );
      if (trace.extraction) {
        if (validateExtraction(trace.extraction, input).length)
          blockers.push('Evidence checks did not pass. The extraction cannot be applied.');
        const rawOutput = trace.attempts.at(-1)?.rawOutput;
        if (
          !rawOutput ||
          canonicalJson(extractionSchema.parse(JSON.parse(rawOutput))) !== canonicalJson(trace.extraction)
        )
          blockers.push('The saved output does not match the parsed facts.');
        const target = detail.draft.catalog.cards.find((card) => card.id === run.card_id);
        if (
          !target ||
          canonicalJson(target.rules.map((rule) => rule.id).sort()) !==
            canonicalJson(trace.extraction.rules.map((rule) => rule.ruleId).sort()) ||
          trace.extraction.rules.some(
            (fact) => fact.category.value !== target.rules.find((rule) => rule.id === fact.ruleId)?.category,
          )
        ) {
          blockers.push('The draft rule set differs from the extraction target.');
        }
        if (!blockers.length) {
          const output = trace.extraction;
          proposedCatalog = structuredClone(detail.draft.catalog);
          const card = proposedCatalog.cards.find((value) => value.id === run.card_id)!;
          card.rules = card.rules.map((rule) => {
            const fact = output.rules.find((value) => value.ruleId === rule.id)!;
            const result = {
              ...rule,
              rateBps: fact.rateBps.value!,
              requiresActivation: fact.activation.value!,
            };
            if (fact.cap.kind === 'none') delete result.annualCapCents;
            else result.annualCapCents = fact.cap.amountCents!;
            return result;
          });
          proposedCatalog = catalogSchema.parse(proposedCatalog);
        }
      }
    }
  } catch {
    blockers.push(
      'The saved extraction could not be verified. Inspect its source and run details before continuing.',
    );
    proposedCatalog = null;
  }
  return extractionReviewSchema.parse({ run, application, documents, blockers, proposedCatalog });
}

export async function readExtractionReview(rpc: ReviewRpc, token: string, draftId: string, runId: string) {
  const detail = reviewDetailSchema.parse(await rpc('get_catalog_review', token, { p_draft_id: draftId }));
  if (detail.draft.id !== draftId) throw new ReviewError(404, 'draft_not_found');
  const saved = await rpc('get_draft_extraction', token, { p_draft_id: draftId, p_run_id: runId });
  return { detail, review: prepareExtractionReview(detail, saved) };
}
export async function applyReviewedExtraction(
  rpc: ReviewRpc,
  token: string,
  draftId: string,
  runId: string,
  input: ApplyExtractionInput,
) {
  const { detail, review } = await readExtractionReview(rpc, token, draftId, runId);
  if (!review.application) {
    if (detail.draft.revision !== input.expectedRevision || detail.draft.catalog_hash !== input.expectedHash)
      throw new ReviewError(409, 'review_changed');
    if (!review.proposedCatalog || review.blockers.length)
      throw new ReviewError(422, 'curation_requires_review');
    const output = review.run.trace!.extraction!;
    if (
      input.conditionReviews.length !== output.conditions.length ||
      input.conditionReviews.some(
        (item, i) =>
          item.index !== i || item.ruleIds.some((id) => !output.rules.some((rule) => rule.ruleId === id)),
      )
    )
      throw new ReviewError(422, 'curation_requires_review');
  }
  // The database rechecks origin/revision, conditions and live authority under locks,
  // builds the candidate from its immutable trace, and records the human's decision.
  return z.strictObject({ draft: draftSchema, application: extractionApplicationSchema }).parse(
    await rpc('apply_reviewed_extraction', token, {
      p_draft_id: draftId,
      p_run_id: runId,
      p_expected_revision: input.expectedRevision,
      p_expected_hash: input.expectedHash,
      p_condition_reviews: input.conditionReviews,
      p_review_note: input.reviewNote,
    }),
  );
}
