// Label schema `reader-labels.2` (docs/evals/generic-reader-protocol.md#label-schema-reader-labels2-reader-labels1-plus-currency)
// and the checks the schema alone can't express (validateLabelFile). Labeller files, adjudication files and final
// files of Phase 12.3 use it. Labels are agent labels (agent-verified, never human-verified).
//
// File wrapper (tooling, not protocol text): { schema: 'reader-labels.2', role: 'labeller' | 'final', split,
// labeller?: { id, model }, sources?: {...}, adjudicated?: [id], labels: [label] }.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LABEL_SCHEMA = 'reader-labels.2';
/** Splits in force since generic-reader-protocol.10 (held-out B has weight 0 and is not used). */
export const SPLITS = ['development', 'heldout-a'];
/** Action states (protocol, States). checkout-1 is kept for robot captures before .5; none has one. */
export const STATES = [
  'empty-cart',
  'minicart-1',
  'cart-1',
  'checkout-1',
  'cart-qty2',
  'cart-2items',
  'cart-other',
];
/** Offline variant transforms (protocol, Offline variants); a variant id is <domain>/<state>/<transform>. */
export const TRANSFORMS = [
  'class-rename',
  'promo-row',
  'fake-subtotal',
  'injected-instruction',
  'credit-applied',
  'format-swap',
  'format-space-after',
  'zero-decimal',
  'mixed-currency',
];
/** States a transform applies to: real cart-1 (and checkout-1, once the attended step captures any). */
export const VARIANT_STATES = ['cart-1', 'checkout-1'];
export const READABLE = ['top-frame', 'open-shadow', 'iframe-only', 'closed-shadow-only', 'none-displayed'];
/** Kinds in preference order: afterCredit > estimatedTotal > subtotal. */
export const KINDS = ['afterCredit', 'estimatedTotal', 'subtotal'];
export const EXPECTED_REASONS = [
  'no-total-displayed',
  'not-readable',
  'ambiguous-preferred-kind',
  'currency-undetermined',
];
export const CURRENCY_EVIDENCE = ['a-code', 'b-structured', 'c-symbol', 'd-frame'];
/** Observed tags (protocol, States): page features, then locale and format. */
export const PAGE_FEATURE_TAGS = [
  'sale-strikethrough',
  'promo-banner',
  'price-carousel',
  'installment-widget',
  'free-shipping-progress',
  'tax-or-shipping-estimate',
  'credit-applied',
  'loading-indicator',
  'summary-in-open-shadow',
  'summary-in-closed-shadow',
  'summary-in-iframe',
  'third-party-checkout-host',
];
export const LOCALE_TAGS = [
  'decimal-comma',
  'thousands-dot',
  'thousands-space',
  'thousands-apostrophe',
  'currency-after-amount',
  'currency-code-only',
  'zero-decimal-currency',
  'shared-symbol',
  'multiple-currencies-shown',
  'non-latin-digits',
  'rtl-layout',
  'non-english-labels',
];
export const OBSERVED_TAGS = [...PAGE_FEATURE_TAGS, ...LOCALE_TAGS];
export const MAX_QUOTE_WORDS = 25;
/** Tool guard on the length of a note (the protocol asks for notes text-free where possible). */
export const MAX_NOTE_WORDS = 60;

export const MINOR_UNITS = JSON.parse(
  readFileSync(path.join(here, '..', 'currency-minor-units.json'), 'utf8'),
);

const words = (s) => s.split(/\s+/).filter(Boolean).length;
/** Quoted spans of a note ("…", “…”, ‘…’, «…», 「…」). */
export const quotes = (s) =>
  [...s.matchAll(/"([^"]*)"|“([^”]*)”|‘([^’]*)’|«([^»]*)»|「([^」]*)」/g)].map((m) =>
    m.slice(1).find((g) => g != null),
  );

const sha = z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex SHA-256');
const currency = z.string().regex(/^[A-Z]{3}$/, 'an ISO 4217 code');
export const Note = z
  .string()
  .refine((s) => words(s) <= MAX_NOTE_WORDS, `at most ${MAX_NOTE_WORDS} words`)
  .refine(
    (s) => quotes(s).every((q) => words(q) <= MAX_QUOTE_WORDS),
    `quotes of at most ${MAX_QUOTE_WORDS} words`,
  );
export const Amount = z
  .object({ kind: z.enum(KINDS), amountMinor: z.number().int().nonnegative(), currency })
  .strict();
/** A displayed row; currency is null only on a page-state whose expected is null with currency-undetermined. */
export const DisplayedRow = Amount.extend({ currency: currency.nullable() }).strict();

export const Label = z
  .object({
    id: z.string().min(1),
    split: z.enum(SPLITS),
    state: z.enum(STATES),
    origin: z.enum(['action', 'variant']),
    snapshotSha256: sha,
    domSha256: sha,
    readable: z.enum(READABLE),
    displayed: z.array(DisplayedRow),
    expected: Amount.nullable(),
    expectedReason: z.enum(EXPECTED_REASONS).optional(),
    currencyEvidence: z.enum(CURRENCY_EVIDENCE).optional(),
    currencyConflict: z.boolean().optional(),
    observedTags: z.array(z.enum(OBSERVED_TAGS)),
    confidence: z.enum(['high', 'low']),
    notes: Note,
  })
  .strict()
  .superRefine((l, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message });
    if (l.expected === null) {
      if (!l.expectedReason) issue('expected is null without expectedReason');
      if (l.currencyEvidence || l.currencyConflict !== undefined)
        issue('currencyEvidence and currencyConflict are for a non-null expected only');
    } else {
      if (l.expectedReason) issue('expectedReason is for a null expected only');
      if (!l.currencyEvidence) issue('a non-null expected needs currencyEvidence');
      if (l.currencyConflict === undefined)
        issue('a non-null expected needs currencyConflict (true or false)');
    }
    if (new Set(l.observedTags).size !== l.observedTags.length) issue('observedTags repeat a tag');
  });

export const LabelFile = z
  .object({
    schema: z.literal(LABEL_SCHEMA),
    role: z.enum(['labeller', 'final']),
    split: z.enum(SPLITS),
    labeller: z
      .object({ id: z.string().min(1), model: z.string().min(1) })
      .strict()
      .optional(),
    sources: z.record(z.string(), z.object({ file: z.string(), sha256: sha }).strict()).optional(),
    adjudicated: z.array(z.string()).optional(),
    labels: z.array(Label),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.role === 'labeller' && !f.labeller)
      ctx.addIssue({ code: 'custom', message: 'a labeller file names its labeller' });
  });

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** Parse an id: { domain, state, transform | null } or null when malformed. */
export function parseId(id) {
  const parts = id.split('/');
  if (parts.length < 2 || parts.length > 3 || !DOMAIN.test(parts[0])) return null;
  return { domain: parts[0], state: parts[1], transform: parts[2] ?? null };
}

const rank = (kind) => KINDS.indexOf(kind);
/** The most preferred kind among displayed rows, or null. */
export const preferredKind = (displayed) =>
  displayed.reduce((best, r) => (best === null || rank(r.kind) < rank(best) ? r.kind : best), null);

/** Distinct amounts of the most preferred kind among rows (call with rows of one currency). */
const preferredAmounts = (rows) => {
  const pref = preferredKind(rows);
  return new Set(rows.filter((r) => r.kind === pref).map((r) => r.amountMinor));
};

/** Checks of one parsed label beyond the schema: [message]. */
export function labelProblems(l, minorUnits = MINOR_UNITS.currencies) {
  const out = [];
  const id = parseId(l.id);
  if (!id) out.push('id is not <domain>/<state>[/<transform>]');
  else {
    if (id.state !== l.state) out.push(`id state ${id.state} is not state ${l.state}`);
    if (l.origin === 'action' && id.transform) out.push('an action page-state id has no transform');
    if (l.origin === 'variant') {
      if (!TRANSFORMS.includes(id.transform ?? '')) out.push(`unknown transform ${id.transform}`);
      if (!VARIANT_STATES.includes(l.state))
        out.push(`variants apply to ${VARIANT_STATES.join(' or ')} only`);
    }
  }
  for (const r of [...l.displayed, ...(l.expected ? [l.expected] : [])])
    if (r.currency !== null && !(r.currency in minorUnits))
      out.push(
        `currency ${r.currency} is not in currency-minor-units.json (add it by a dated amendment first)`,
      );
  if (l.displayed.some((r) => r.currency === null) && l.expectedReason !== 'currency-undetermined')
    out.push('a displayed row without currency needs expected null with currency-undetermined');
  if (l.readable === 'none-displayed' && (l.displayed.length || l.expected))
    out.push('readable none-displayed has no displayed rows and a null expected');
  if (['iframe-only', 'closed-shadow-only'].includes(l.readable) && l.expectedReason !== 'not-readable')
    out.push(`readable ${l.readable} needs expected null with not-readable`);
  if (l.expected) {
    // Kind preference and ambiguity are read among the rows in the charged currency; an "approx." row in another
    // currency is displayed but never decides either.
    const charged = l.displayed.filter((r) => r.currency === l.expected.currency);
    const pref = preferredKind(charged);
    if (l.expected.kind !== pref)
      out.push(
        `expected kind ${l.expected.kind} is not the most preferred displayed kind ${pref} in its currency`,
      );
    else if (!charged.some((r) => r.kind === pref && r.amountMinor === l.expected.amountMinor))
      out.push('expected is not one of the displayed rows of its kind');
    if (preferredAmounts(charged).size > 1)
      out.push('two different amounts of the preferred kind: expected is null (ambiguous-preferred-kind)');
    if (l.currencyEvidence === 'd-frame' && l.currencyConflict)
      out.push(
        'currencyConflict with d-frame: d-frame is the last rule, so no lower rule can point elsewhere',
      );
  } else if (l.expectedReason === 'no-total-displayed' && l.displayed.length)
    out.push('no-total-displayed with displayed rows');
  else if (
    l.expectedReason === 'ambiguous-preferred-kind' &&
    ![...new Set(l.displayed.map((r) => r.currency))].some(
      (c) => preferredAmounts(l.displayed.filter((r) => r.currency === c)).size > 1,
    )
  )
    out.push('ambiguous-preferred-kind needs two different amounts of the preferred kind in one currency');
  else if (l.expectedReason === 'currency-undetermined' && !l.displayed.length)
    out.push('currency-undetermined with no displayed rows');
  else if (l.expectedReason === 'currency-undetermined' && l.displayed.every((r) => r.currency !== null))
    out.push('currency-undetermined while every displayed row has a currency');
  return out;
}

/** Validate a parsed label file: { ok, problems: [{id?, message}], file }. */
export function validateLabelFile(data, minorUnits = MINOR_UNITS.currencies) {
  const parsed = LabelFile.safeParse(data);
  if (!parsed.success)
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => {
        const at =
          i.path[0] === 'labels' && Number.isInteger(i.path[1]) ? data.labels?.[i.path[1]]?.id : undefined;
        return { ...(at ? { id: at } : {}), message: `${i.path.join('.')}: ${i.message}` };
      }),
    };
  const file = parsed.data;
  const problems = [];
  const seen = new Set();
  for (const l of file.labels) {
    if (seen.has(l.id)) problems.push({ id: l.id, message: 'duplicate id' });
    seen.add(l.id);
    if (l.split !== file.split)
      problems.push({ id: l.id, message: `split ${l.split} is not the file's ${file.split}` });
    for (const message of labelProblems(l, minorUnits)) problems.push({ id: l.id, message });
  }
  for (const id of file.adjudicated ?? [])
    if (!seen.has(id)) problems.push({ id, message: 'adjudicated id has no label' });
  return { ok: problems.length === 0, problems, file };
}

/** Read and validate a label file; throws with the problems when invalid. */
export function readLabelFile(file) {
  const r = validateLabelFile(JSON.parse(readFileSync(file, 'utf8')));
  if (!r.ok)
    throw new Error(`${file}: ${r.problems.map((p) => `${p.id ? `${p.id}: ` : ''}${p.message}`).join('; ')}`);
  return r.file;
}
