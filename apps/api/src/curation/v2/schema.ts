import { z } from 'zod';

/**
 * Extraction contract v2: every earning rule a card's terms describe, in a taxonomy shared across issuers.
 *
 * Differences from v1:
 * - The model discovers the rules; the target no longer lists expected rule IDs or categories.
 * - Citations are exact quotes only. The server resolves each quote to a span in the original document,
 *   so the model never counts characters and the harness may send excerpts instead of whole pages.
 * - A field the source does not state is `null`; disagreements and suspicious text go in `issues`.
 */
export const EXTRACTION_V2_SCHEMA_VERSION = 'issuer-extraction.2';

/** Shared reward categories. See docs/research for how issuer definitions differ within each. */
export const CATEGORIES = [
  'all-purchases',
  'online-retail',
  'supermarkets',
  'gas',
  'ev-charging',
  'dining',
  'drugstores',
  'entertainment',
  'streaming',
  'transit',
  'travel-portal',
  'entertainment-portal',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

const quote = z.string().min(1).max(600);
const evidence = z.array(quote).max(4);
const nullable = <T extends z.ZodType>(value: T) => z.strictObject({ value: value.nullable(), evidence });
const bps = z.number().int().min(0).max(10_000);

export const ruleSchema = z.strictObject({
  category: z.enum(CATEGORIES),
  /** The issuer's own name for the category, verbatim (e.g. "U.S. online retail purchases"). */
  issuerWording: z.string().min(1).max(200),
  /** Total earn rate for this category in basis points (3% = 300), not an increment over the base. */
  rateBps: nullable(bps),
  /** Portion of rateBps earned only when the purchase is paid off (Citi's "1% as you pay"). */
  paidOnPaymentBps: nullable(bps),
  cap: z.strictObject({
    value: z
      .strictObject({
        kind: z.enum(['none', 'spend']),
        amountCents: z.number().int().positive().max(100_000_000).nullable(),
        period: z
          .enum(['calendar-year', 'cardmember-year', 'billing-cycle', 'quarter', 'month', 'year-unspecified'])
          .nullable(),
        rateAfterCapBps: bps.nullable(),
      })
      .nullable(),
    evidence,
  }),
  activation: nullable(z.enum(['none', 'enroll-once', 'recurring'])),
  /** True when only purchases from U.S. merchants qualify (e.g. Amex "U.S. supermarkets"). */
  usMerchantsOnly: nullable(z.boolean()),
  /** Limited-time or promotional rule, with its end date when stated. */
  limitedTime: nullable(z.strictObject({ endsOn: z.iso.date().nullable() })),
  /** Short definitions and exclusions for this category, as stated by the issuer. */
  definition: z.array(z.strictObject({ kind: z.enum(['includes', 'excludes']), text: quote })).max(10),
});
export type Rule = z.infer<typeof ruleSchema>;

export const extractionV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  cardId: z.string().min(1).max(80),
  rewardCurrency: nullable(z.enum(['cash-back', 'points'])),
  /** Cash value of one point in hundredths of a cent (1 cent = 100); null for cash back. */
  pointValueHundredthsOfCent: nullable(z.number().int().min(1).max(10_000)),
  rules: z.array(ruleSchema).max(20),
  /** Purchases that never earn rewards (balance transfers, fees, ...). */
  exclusions: z.array(z.strictObject({ text: quote, evidence })).max(20),
  issues: z
    .array(
      z.strictObject({
        code: z.enum(['missing', 'ambiguous', 'conflicting', 'untrusted-instruction', 'out-of-scope']),
        detail: z.string().min(1).max(600),
        evidence,
      }),
    )
    .max(20),
});
export type ExtractionV2 = z.infer<typeof extractionV2Schema>;

export const documentV2Schema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
  title: z.string().min(1).max(200),
  url: z.url({ protocol: /^https$/ }).max(2048),
  capturedOn: z.iso.date(),
  body: z.string().min(1).max(400_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DocumentV2 = z.infer<typeof documentV2Schema>;

export const extractionV2InputSchema = z.strictObject({
  cardId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  cardName: z.string().min(1).max(120),
  documents: z.array(documentV2Schema).min(1).max(4),
});
export type ExtractionV2Input = z.infer<typeof extractionV2InputSchema>;
