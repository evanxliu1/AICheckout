import { z } from 'zod';
import {
  CATALOG_V3_LIMITS,
  catalogSchema,
  catalogV1Schema,
  sourceSchema,
  publishedReleaseSchema,
} from '@ai-checkout/rewards-core';

export const MAX_REVIEW_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Longest captured source text. The largest expansion capture (2026-10-02) is 204,334 characters. */
export const MAX_SOURCE_BODY_CHARS = 250_000;
/** Most captures a draft can reference (`drafts.source_document_ids`); catalog v3 cites up to 600 sources. */
export const MAX_DRAFT_SOURCES = 600;
/** Largest `POST /v1/review/sources` body. `JSON.stringify` writes each UTF-16 unit of the text in at
 * most 6 bytes (a `\u` escape; a multibyte character takes at most 3), plus 16 KiB for metadata. */
export const MAX_CAPTURE_REQUEST_BYTES = MAX_SOURCE_BODY_CHARS * 6 + 16_384;
/** Largest draft save body: a catalog of up to `CATALOG_V3_LIMITS.bytes` (measured as
 * `JSON.stringify` bytes, as the request sends it), 600 source IDs and the other fields. */
export const MAX_DRAFT_REQUEST_BYTES = CATALOG_V3_LIMITS.bytes + 65_536;
export const draftIdSchema = z.uuid();
export const sequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable();
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const sourceIds = z
  .array(z.uuid())
  .max(MAX_DRAFT_SOURCES)
  .refine((ids) => new Set(ids).size === ids.length);
export const captureSourceInputSchema = z.strictObject({
  sourceKey: sourceSchema.shape.id,
  title: sourceSchema.shape.title,
  url: sourceSchema.shape.url,
  checkedOn: sourceSchema.shape.checkedOn,
  body: z.string().min(1).max(MAX_SOURCE_BODY_CHARS),
});
export const createDraftInputSchema = z.strictObject({
  catalog: catalogSchema,
  sourceDocumentIds: sourceIds,
  baseSequence: sequenceSchema,
});
export const updateDraftInputSchema = createDraftInputSchema.extend({
  expectedRevision: z.number().int().positive(),
});
export const publishInputSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  expectedHash: hashSchema,
  expectedHead: sequenceSchema,
  reviewNote: z.string().trim().min(10).max(2000),
});

export const sourceDocumentSchema = z.strictObject({
  id: z.uuid(),
  source_key: sourceSchema.shape.id,
  title: sourceSchema.shape.title,
  url: sourceSchema.shape.url,
  checked_on: sourceSchema.shape.checkedOn,
  body: z.string().min(1).max(MAX_SOURCE_BODY_CHARS),
  content_hash: hashSchema,
  created_by: z.uuid().nullable(),
  created_at: timestamp,
});
export const draftSchema = z.strictObject({
  id: z.uuid(),
  catalog: catalogSchema,
  catalog_hash: hashSchema,
  source_document_ids: sourceIds,
  base_sequence: sequenceSchema,
  revision: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'rejected']),
  created_by: z.uuid().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export const reviewQueueSchema = z.strictObject({
  reviewerId: z.uuid(),
  head: sequenceSchema,
  drafts: z
    .array(
      draftSchema
        .pick({ id: true, revision: true, status: true, updated_at: true, base_sequence: true })
        .extend({ version: catalogV1Schema.shape.version }),
    )
    .max(30),
});
/** A capture without its text, as the review summary lists it: `body_chars` is the text length. */
export const sourceSummarySchema = sourceDocumentSchema
  .omit({ body: true })
  .extend({ body_chars: z.number().int().min(1).max(MAX_SOURCE_BODY_CHARS) });
function reviewSchema<T extends z.ZodType<{ id: string }>>(source: T) {
  return z
    .strictObject({
      reviewerId: z.uuid(),
      head: sequenceSchema,
      published: publishedReleaseSchema.nullable(),
      draft: draftSchema,
      sources: z.array(source).max(MAX_DRAFT_SOURCES),
    })
    .refine(
      (detail) =>
        detail.sources.length === detail.draft.source_document_ids.length &&
        detail.sources.every((source) => detail.draft.source_document_ids.includes(source.id)) &&
        new Set(detail.sources.map((source) => source.id)).size === detail.sources.length,
      'Draft source references disagree with captured documents.',
    )
    .refine(
      (detail) => detail.head === (detail.published?.sequence ?? null),
      'The published snapshot disagrees with the review head.',
    );
}
/** `get_catalog_review` for one draft: every attached capture with its text. The extraction routes
 * use it; their drafts cite a few sources. */
export const reviewDetailSchema = reviewSchema(sourceDocumentSchema);
/** `get_catalog_review_summary`: the same review with source metadata only, so a draft citing 600
 * sources stays far under `MAX_REVIEW_RESPONSE_BYTES`. The review app loads one text at a time. */
export const reviewSummarySchema = reviewSchema(sourceSummarySchema);
export type ReviewQueue = z.infer<typeof reviewQueueSchema>;
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
export type SourceSummary = z.infer<typeof sourceSummarySchema>;

export const reviewConfigSchema = z.strictObject({
  supabaseUrl: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }),
  publishableKey: z.string().regex(/^sb_publishable_[a-zA-Z0-9_-]+$/),
});
export type ReviewConfig = z.infer<typeof reviewConfigSchema>;

export const startExtractionInputSchema = z.strictObject({
  cardId: z.enum(['capital-one-quicksilver', 'amex-blue-cash-everyday']),
  expectedRevision: z.number().int().positive(),
  requestKey: z.uuid(),
});
export type StartExtractionInput = z.infer<typeof startExtractionInputSchema>;
