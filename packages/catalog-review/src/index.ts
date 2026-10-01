import { z } from 'zod';
import {
  catalogSchema,
  catalogV1Schema,
  sourceSchema,
  publishedReleaseSchema,
} from '@ai-checkout/rewards-core';

export const MAX_REVIEW_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Longest captured source text. Issuer terms PDFs run to about 75,000 characters. */
export const MAX_SOURCE_BODY_CHARS = 120_000;
export const draftIdSchema = z.uuid();
export const sequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable();
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const sourceIds = z
  .array(z.uuid())
  .max(30)
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
export const reviewDetailSchema = z
  .strictObject({
    reviewerId: z.uuid(),
    head: sequenceSchema,
    published: publishedReleaseSchema.nullable(),
    draft: draftSchema,
    sources: z.array(sourceDocumentSchema).max(30),
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
export type ReviewQueue = z.infer<typeof reviewQueueSchema>;
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;

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
