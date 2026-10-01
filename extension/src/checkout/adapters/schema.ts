import { z } from 'zod';

import { AMOUNT_KINDS, MERCHANT_IDS } from './ids';

export { AMOUNT_KINDS, MERCHANT_IDS, type AmountKind, type MerchantId } from './ids';

const compiles = (value: string) => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};
const selector = z.string().min(1).max(300);
/** A summary must be a specific element, never the whole document. */
const summarySelector = selector.refine(
  (value) => value.split(',').every((part) => !/^(?:html|body|:root|\*)$/i.test(part.trim())),
  'Summary selectors must target a specific element, not html, body, :root or *.',
);
/** Anchored, compiling, and free of backreferences and nested quantifiers (catastrophic backtracking). */
const pattern = z
  .string()
  .min(2)
  .max(200)
  .startsWith('^')
  .endsWith('$')
  .refine(compiles, 'Invalid pattern')
  .refine((value) => !/\\[1-9]|\\k</.test(value), 'Backreferences are not allowed.')
  .refine((value) => !/\([^()]*[+*][^()]*\)\s*[+*{]/.test(value), 'Nested quantifiers are not allowed.');

/**
 * A declarative, versioned description of one merchant's visible order summary. The generic
 * interpreter (page-reader.ts) applies the same safety rules to every adapter: visible text
 * only, no form values or item names, bounded rows and text, ambiguity → unavailable.
 */
export const siteAdapterSchema = z.strictObject({
  schemaVersion: z.literal(1),
  merchantId: z.enum(MERCHANT_IDS),
  name: z.string().min(1).max(60),
  /** Bumped whenever the reading contract changes; part of every captured cart snapshot. */
  extractorVersion: z.string().regex(/^[a-z0-9]+-summary-v[0-9]+$/),
  observed: z.strictObject({ on: z.iso.date(), note: z.string().min(1).max(500) }),
  match: z.strictObject({
    hosts: z
      .array(z.string().regex(/^[a-z0-9.-]+$/))
      .min(1)
      .max(5),
    /** Anchored path patterns; HTTPS, no credentials, and no port are required for every adapter. */
    paths: z.array(pattern).min(1).max(5),
  }),
  summary: z.strictObject({ selector: summarySelector, maxCount: z.number().int().min(1).max(5) }),
  /** Shown instead of a summary when the cart is empty. */
  emptyCart: z.strictObject({ selector, text: z.string().min(1).max(100) }).nullable(),
  loading: z.strictObject({
    /** A summary (or matched row) inside an element matching this is still loading. */
    busyAncestor: selector,
    /** Also treat busy descendants of a matched row as loading. */
    checkMatchedRows: z.boolean(),
    /** Any visible element matching one of these means the cart is updating. */
    indicators: z.array(selector).max(5),
  }),
  /** Rows inside each summary; null when the summary element is itself the only row. */
  rows: z.strictObject({ selector: selector.nullable(), max: z.number().int().min(1).max(50) }),
  label: z.strictObject({
    /** Tried in order; the first selector with a match supplies the label. */
    selectors: z.array(selector).min(1).max(3),
    /** More than one label element in a matched row is ambiguous. */
    single: z.boolean(),
  }),
  /** Exactly one amount cell per matched row. */
  amount: z.strictObject({ selector }),
  labels: z
    .array(
      z.strictObject({
        pattern,
        caseInsensitive: z.boolean(),
        kind: z.enum(AMOUNT_KINDS),
      }),
    )
    .min(1)
    .max(10),
  /** Exact cell text that means "not yet known" for a kind (Newegg shows "TBD"). */
  pending: z.array(z.strictObject({ kind: z.enum(AMOUNT_KINDS), text: z.string().min(1).max(20) })).max(3),
  /** Kinds every summary must show (present or pending), else the summary is incomplete. */
  requiredKinds: z.array(z.enum(AMOUNT_KINDS)).max(3),
  /** A second row with an already-seen kind: always ambiguous, or allowed when amounts agree. */
  duplicates: z.enum(['ambiguous', 'allow-equal']),
  /** Pool rows from all summaries, or resolve each summary and require them to agree. */
  combine: z.enum(['pool-rows', 'per-summary']),
});
export type SiteAdapter = z.infer<typeof siteAdapterSchema>;
