import { z } from 'zod';
import { sourceDocumentSchema } from './index.ts';
import { catalogSchema } from '@ai-checkout/rewards-core';

export const EXTRACTION_SCHEMA_VERSION = 'issuer-extraction.1';
export const SOURCE_POLICY_VERSION = 'pilot-sources.1';
export const citationSchema = z.strictObject({
  documentId: z.uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  start: z.number().int().min(0).max(60000),
  end: z.number().int().positive().max(60000),
  quote: z.string().min(1).max(1600),
});
const evidence = z.array(citationSchema).max(6);
const state = z.enum(['known', 'unknown', 'conflicting']);
const rate = z.strictObject({ state, value: z.number().int().min(0).max(10000).nullable(), evidence });
const category = z.strictObject({
  state,
  value: z.enum(['all-eligible', 'us-online-retail']).nullable(),
  evidence,
});
const activation = z.strictObject({ state, value: z.boolean().nullable(), evidence });
const cap = z.strictObject({
  state,
  kind: z.enum(['none', 'annual-spend']).nullable(),
  amountCents: z.number().int().positive().max(100_000_000).nullable(),
  period: z.literal('calendar-year').nullable(),
  evidence,
});
const supportedCardIds = ['capital-one-quicksilver', 'amex-blue-cash-everyday'] as const;
const text = z.string().trim().min(1).max(1200);
export const extractionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cardId: z.enum(supportedCardIds),
  rules: z
    .array(z.strictObject({ ruleId: z.string().min(1).max(100), rateBps: rate, category, activation, cap }))
    .max(2),
  conditions: z
    .array(z.strictObject({ kind: z.enum(['eligibility', 'exclusion', 'other']), text, evidence }))
    .max(30),
  issues: z
    .array(
      z.strictObject({
        code: z.enum([
          'missing',
          'ambiguous',
          'conflicting',
          'unsupported-condition',
          'untrusted-instruction',
        ]),
        field: z.enum(['document', 'rate', 'category', 'activation', 'cap', 'validity', 'conditions']),
        detail: text,
        evidence,
      }),
    )
    .max(30),
});
export type Extraction = z.infer<typeof extractionSchema>;
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export const extractionInputSchema = z.strictObject({
  cardId: z.enum(supportedCardIds),
  documents: z.array(sourceDocumentSchema).min(1).max(3),
});
export type ExtractionInput = z.infer<typeof extractionInputSchema>;
export interface Finding {
  code: string;
  path: string;
}

export const usageSchema = z.strictObject({
  inputTokens: z.number().int().min(0).max(1_000_000),
  outputTokens: z.number().int().min(0).max(1_000_000),
});
export const providerResponseSchema = z.strictObject({
  id: z.string().min(1).max(200),
  model: z.string().min(1).max(120),
});
export const replySchema = z.strictObject({
  finishReason: z.enum(['stop', 'length', 'refusal']),
  text: z.string(),
  usage: usageSchema,
  providerResponse: providerResponseSchema.optional(),
});
export const limitsSchema = z.strictObject({
  budgetMicrousd: z.number().int().min(0).max(1_000_000_000).default(0),
  maxAttempts: z.number().int().min(1).max(2).default(2),
  attemptTimeoutMs: z.number().int().min(1).max(30_000).default(10_000),
  totalTimeoutMs: z.number().int().min(1).max(60_000).default(15_000),
  maxInputTokens: z.number().int().min(512).max(64_000).default(48_000),
  maxOutputTokens: z.number().int().min(128).max(8192).default(4096),
});
export const providerIdentitySchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9._-]{1,80}$/),
    model: z.string().regex(/^[a-zA-Z0-9/._:-]{1,120}$/),
    mode: z.enum(['fixture', 'metered']),
    pricing: z.strictObject({
      input: z.number().int().min(0).max(1_000_000_000),
      output: z.number().int().min(0).max(1_000_000_000),
    }),
  })
  .refine((value) =>
    value.mode === 'fixture'
      ? value.pricing.input === 0 && value.pricing.output === 0
      : value.pricing.input > 0 && value.pricing.output > 0,
  );
export type Status =
  | 'invalid_input'
  | 'input_limit'
  | 'budget_blocked'
  | 'cancelled'
  | 'timeout'
  | 'provider_error'
  | 'invalid_output'
  | 'output_limit'
  | 'refused'
  | 'needs_review'
  | 'evidence_valid';
export interface Attempt {
  number: number;
  durationMs: number;
  outcome: Status | 'transient' | 'rate-limit';
  reservedMicrousd: number;
  accountedMicrousd: number;
  usage?: z.infer<typeof usageSchema>;
  rawOutput?: string;
  providerResponse?: z.infer<typeof providerResponseSchema>;
}
export interface ExtractionTrace {
  runId: string;
  startedAt: string;
  durationMs: number;
  status: Status;
  provider: z.infer<typeof providerIdentitySchema>;
  limits: z.infer<typeof limitsSchema>;
  context?: {
    hash: string;
    versions: { prompt: string; context: string; schema: string; sourcePolicy: string };
    inputTokenEstimate: number;
  };
  documents: { id: string; contentHash: string }[];
  attempts: Attempt[];
  accountedMicrousd: number;
  findings: Finding[];
  extraction?: Extraction;
}
/** Validate saved/imported traces before evaluation or presentation. */
export const extractionTraceSchema: z.ZodType<ExtractionTrace> = z.strictObject({
  runId: z.uuid(),
  startedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative().max(3_600_000),
  status: z.enum([
    'invalid_input',
    'input_limit',
    'budget_blocked',
    'cancelled',
    'timeout',
    'provider_error',
    'invalid_output',
    'output_limit',
    'refused',
    'needs_review',
    'evidence_valid',
  ]),
  provider: providerIdentitySchema,
  limits: limitsSchema,
  context: z
    .strictObject({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      versions: z.strictObject({
        prompt: z.string().min(1).max(80),
        context: z.string().min(1).max(80),
        schema: z.string().min(1).max(80),
        sourcePolicy: z.string().min(1).max(80),
      }),
      inputTokenEstimate: z.number().int().nonnegative().max(1_000_000),
    })
    .optional(),
  documents: z
    .array(z.strictObject({ id: z.uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }))
    .max(3),
  attempts: z
    .array(
      z.strictObject({
        number: z.number().int().min(1).max(2),
        durationMs: z.number().int().nonnegative().max(3_600_000),
        outcome: z.enum([
          'invalid_input',
          'input_limit',
          'budget_blocked',
          'cancelled',
          'timeout',
          'provider_error',
          'invalid_output',
          'output_limit',
          'refused',
          'needs_review',
          'evidence_valid',
          'transient',
          'rate-limit',
        ]),
        reservedMicrousd: z.number().int().nonnegative(),
        accountedMicrousd: z.number().int().nonnegative(),
        usage: usageSchema.optional(),
        rawOutput: z
          .string()
          .refine((value) => new TextEncoder().encode(value).byteLength <= 65536)
          .optional(),
        providerResponse: providerResponseSchema.optional(),
      }),
    )
    .max(2),
  accountedMicrousd: z.number().int().nonnegative(),
  findings: z
    .array(z.strictObject({ code: z.string().min(1).max(100), path: z.string().max(300) }))
    .max(4096),
  extraction: extractionSchema.optional(),
});

const hash = z.string().regex(/^[a-f0-9]{64}$/),
  money = z.number().int().min(0).max(1_000_000_000);
export const profileSchema = z.strictObject({
  id: z.string(),
  enabled: z.boolean(),
  provider: z.string(),
  model: z.string(),
  mode: z.enum(['fixture', 'metered']),
  input_price: money,
  output_price: money,
  max_input_tokens: z.number().int().min(512).max(64000),
  max_output_tokens: z.number().int().min(128).max(8192),
  max_attempts: z.number().int().min(1).max(2),
  attempt_timeout_ms: z.number().int().positive().max(30000),
  total_timeout_ms: z.number().int().positive().max(60000),
});
export type CurationProfile = z.infer<typeof profileSchema>;
const timestamp = z.iso.datetime({ offset: true });
export const curationRunSchema = z.strictObject({
  id: z.uuid(),
  requested_by: z.uuid(),
  session_id: z.uuid(),
  request_key: z.uuid(),
  request_hash: hash,
  profile_id: z.string(),
  profile: profileSchema,
  card_id: extractionInputSchema.shape.cardId,
  context: z.record(z.string(), z.unknown()),
  context_hash: hash,
  budget_day: z.iso.date(),
  reserved_microusd: money,
  state: z.enum(['running', 'finished', 'interrupted']),
  started_at: timestamp,
  deadline_at: timestamp,
  finished_at: timestamp.nullable(),
  trace: z.record(z.string(), z.unknown()).nullable(),
  trace_hash: hash.nullable(),
  interruption_note: z.string().nullable(),
});
export type CurationRun = z.infer<typeof curationRunSchema>;
export const reviewRunSchema = curationRunSchema.extend({ trace: extractionTraceSchema.nullable() });
export const conditionReviewSchema = z.strictObject({
  index: z.number().int().min(0).max(29),
  coverage: z.literal('existing-rules'),
  ruleIds: z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(2)
    .refine((value) => new Set(value).size === value.length),
  note: z.string().trim().min(10).max(1200),
});
export const applyExtractionInputSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  expectedHash: hash,
  reviewNote: z.string().trim().min(10).max(2000),
  conditionReviews: z.array(conditionReviewSchema).max(30),
});
export type ApplyExtractionInput = z.infer<typeof applyExtractionInputSchema>;
export const extractionApplicationSchema = z.strictObject({
  run_id: z.uuid(),
  draft_id: z.uuid(),
  from_revision: z.number().int().positive(),
  to_revision: z.number().int().positive(),
  result_hash: hash,
  applied_by: z.uuid().nullable(),
  applied_at: timestamp,
  review_note: z.string().min(10).max(2000),
  condition_reviews: z.array(conditionReviewSchema).max(30),
});
export const extractionListSchema = z.strictObject({
  runs: z
    .array(
      z.strictObject({
        id: z.uuid(),
        card_id: extractionInputSchema.shape.cardId,
        state: curationRunSchema.shape.state,
        started_at: timestamp,
        revision: z.number().int().positive(),
        outcome: z.string().max(80).nullable(),
        application: extractionApplicationSchema.nullable(),
      }),
    )
    .max(20),
});
export const extractionReviewSchema = z.strictObject({
  run: reviewRunSchema,
  documents: z.array(sourceDocumentSchema).max(3),
  blockers: z.array(z.string().max(500)).max(20),
  proposedCatalog: catalogSchema.nullable(),
  application: extractionApplicationSchema.nullable(),
});
export type ExtractionReview = z.infer<typeof extractionReviewSchema>;
export type ExtractionList = z.infer<typeof extractionListSchema>;
