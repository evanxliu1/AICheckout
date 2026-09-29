import { canonicalJson } from '../canonical.ts';
import type { TaskTrace } from '../runner.ts';
import type { CorpusCase, Reference, ReferenceRule } from './corpus.ts';
import type { ExtractionV2, ExtractionV2Input, Rule } from './schema.ts';
import { resolveQuote, type Span } from './validate.ts';

export const SCORER_VERSION = 'v2-scorer.1';

/** Rule fields scored on matched rules. Cap parts after `capKind` are scored only when the reference has a spend cap. */
export const RULE_FIELDS = [
  'rateBps',
  'paidOnPaymentBps',
  'capKind',
  'capAmountCents',
  'capPeriod',
  'capRateAfterCapBps',
  'activation',
  'usMerchantsOnly',
  'limitedTime',
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

function fieldValue(rule: Rule | ReferenceRule, field: RuleField): unknown {
  const plain = (key: 'rateBps' | 'paidOnPaymentBps' | 'activation' | 'usMerchantsOnly' | 'limitedTime') => {
    const value = rule[key];
    return value !== null && typeof value === 'object' && 'evidence' in value ? value.value : value;
  };
  const cap = 'anchors' in rule ? rule.cap : rule.cap.value;
  switch (field) {
    case 'capKind':
      return cap?.kind ?? null;
    case 'capAmountCents':
      return cap?.amountCents ?? null;
    case 'capPeriod':
      return cap?.period ?? null;
    case 'capRateAfterCapBps':
      return cap?.rateAfterCapBps ?? null;
    default:
      return plain(field);
  }
}
const scored = (reference: ReferenceRule, field: RuleField) =>
  !field.startsWith('cap') || field === 'capKind' || reference.cap?.kind === 'spend';

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
function similarity(a: string, b: string) {
  const x = words(a),
    y = words(b);
  const shared = [...x].filter((word) => y.has(word)).length;
  return x.size + y.size ? shared / (x.size + y.size - shared) : 0;
}

/**
 * Pair predicted rules with reference rules of the same category. When a category has several rules, the
 * closest issuer wording wins, then an equal rate.
 */
export function matchRules(reference: ReferenceRule[], predicted: Rule[]): [number, number][] {
  const candidates: { r: number; p: number; score: number }[] = [];
  reference.forEach((want, r) =>
    predicted.forEach((got, p) => {
      if (want.category !== got.category) return;
      const rate = want.rateBps !== null && want.rateBps === got.rateBps.value ? 0.5 : 0;
      candidates.push({ r, p, score: similarity(want.issuerWording, got.issuerWording) + rate });
    }),
  );
  candidates.sort((a, b) => b.score - a.score || a.r - b.r || a.p - b.p);
  const usedR = new Set<number>(),
    usedP = new Set<number>(),
    pairs: [number, number][] = [];
  for (const { r, p } of candidates) {
    if (usedR.has(r) || usedP.has(p)) continue;
    usedR.add(r);
    usedP.add(p);
    pairs.push([r, p]);
  }
  return pairs.sort((a, b) => a[0] - b[0]);
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const overlaps = (a: Span, b: Span) => a.documentId === b.documentId && a.start < b.end && b.start < a.end;
/** A predicted quote supports a labeled anchor when their source spans overlap or one text contains the other. */
export function supports(quote: string, anchor: string, input: ExtractionV2Input) {
  const q = resolveQuote(quote, input),
    a = resolveQuote(anchor, input);
  if (!q) return false;
  if (a && overlaps(q, a)) return true;
  return norm(quote).includes(norm(anchor)) || norm(anchor).includes(norm(quote));
}

export interface FieldError {
  category: string;
  field: RuleField | 'rewardCurrency' | 'pointValueHundredthsOfCent';
  expected: unknown;
  actual: unknown;
}

export interface CaseScore {
  caseId: string;
  repeat: number;
  split: CorpusCase['split'];
  variant: string;
  status: string;
  rules: { reference: number; predicted: number; matched: number };
  missedRules: string[];
  extraRules: string[];
  fields: Record<RuleField, { correct: number; total: number }>;
  /** Scored fields across all reference rules, matched or not. */
  referenceFields: number;
  card: { correct: number; total: number };
  /** Non-null predicted values, and those that are wrong, belong to no reference rule, or lack resolvable evidence. */
  claims: { predicted: number; unsupported: number };
  evidence: { quotes: number; resolved: number };
  issues: { code: string; found: boolean }[];
  exclusions: { expected: number; found: number };
  fieldErrors: FieldError[];
  falseClean: boolean;
  durationMs: number;
  tokens: { input: number; output: number } | null;
}

/** Score one trace against its labeled case. A failed run scores as an empty extraction. */
export function scoreCase(
  item: CorpusCase,
  input: ExtractionV2Input,
  trace: TaskTrace<ExtractionV2>,
  repeat = 1,
): CaseScore {
  const reference: Reference = item.reference;
  const output = ['evidence_valid', 'needs_review'].includes(trace.status) ? trace.extraction : undefined;
  const predicted = output?.rules ?? [];
  const pairs = matchRules(reference.rules, predicted);
  const matchedR = new Set(pairs.map(([r]) => r)),
    matchedP = new Set(pairs.map(([, p]) => p));
  const fields = Object.fromEntries(
    RULE_FIELDS.map((field) => [field, { correct: 0, total: 0 }]),
  ) as CaseScore['fields'];
  const fieldErrors: FieldError[] = [];
  const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
  const resolves = (quotes: string[]) => quotes.some((quote) => resolveQuote(quote, input));

  let claimed = 0,
    unsupported = 0;
  const claim = (value: unknown, correct: boolean, evidence: string[], evidenceOptional = false) => {
    if (value === null) return;
    claimed++;
    if (!correct || (!evidenceOptional && !resolves(evidence))) unsupported++;
  };

  for (const [r, p] of pairs) {
    const want = reference.rules[r],
      got = predicted[p];
    for (const field of RULE_FIELDS) {
      if (!scored(want, field)) continue;
      const expected = fieldValue(want, field),
        actual = fieldValue(got, field);
      fields[field].total++;
      if (same(expected, actual)) fields[field].correct++;
      else fieldErrors.push({ category: want.category, field, expected, actual });
    }
  }
  predicted.forEach((got, p) => {
    const pair = pairs.find(([, q]) => q === p);
    const want = pair ? reference.rules[pair[0]] : undefined;
    const check = (key: 'rateBps' | 'paidOnPaymentBps' | 'activation' | 'usMerchantsOnly' | 'limitedTime') =>
      claim(
        got[key].value,
        want !== undefined && same(got[key].value, want[key]),
        got[key].evidence,
        key === 'paidOnPaymentBps' && got[key].value === 0,
      );
    check('rateBps');
    check('paidOnPaymentBps');
    check('activation');
    check('usMerchantsOnly');
    check('limitedTime');
    claim(got.cap.value, want !== undefined && same(got.cap.value, want.cap), got.cap.evidence);
  });

  let cardCorrect = 0;
  for (const field of ['rewardCurrency', 'pointValueHundredthsOfCent'] as const) {
    const expected = reference[field].value,
      actual = output?.[field].value ?? null;
    if (same(expected, actual)) cardCorrect++;
    else fieldErrors.push({ category: 'card', field, expected, actual });
    claim(actual, same(expected, actual), output?.[field].evidence ?? []);
  }

  const quotes = output
    ? [
        ...output.rewardCurrency.evidence,
        ...output.pointValueHundredthsOfCent.evidence,
        ...output.rules.flatMap((rule) => [
          ...rule.rateBps.evidence,
          ...rule.paidOnPaymentBps.evidence,
          ...rule.cap.evidence,
          ...rule.activation.evidence,
          ...rule.usMerchantsOnly.evidence,
          ...rule.limitedTime.evidence,
          ...rule.definition.map((value) => value.text),
        ]),
        ...output.exclusions.flatMap((value) => value.evidence),
        ...output.issues.flatMap((value) => value.evidence),
      ]
    : [];

  const reported = [...(output?.issues ?? [])];
  const issues = reference.issues.map((want) => {
    const index = reported.findIndex(
      (got) =>
        got.code === want.code &&
        (!want.anchors.length ||
          want.anchors.some((a) => got.evidence.some((quote) => supports(quote, a, input)))),
    );
    if (index >= 0) reported.splice(index, 1);
    return { code: want.code, found: index >= 0 };
  });
  const exclusionsFound = reference.exclusions.filter((want) =>
    output?.exclusions.some((got) =>
      want.anchors.some((a) => [got.text, ...got.evidence].some((quote) => supports(quote, a, input))),
    ),
  ).length;

  const missedRules = reference.rules.filter((_, r) => !matchedR.has(r)).map((v) => v.category);
  const clean =
    !missedRules.length && !fieldErrors.length && !unsupported && issues.every((value) => value.found);
  const usage = trace.attempts.at(-1)?.usage;
  return {
    caseId: item.id,
    repeat,
    split: item.split,
    variant: item.variant?.kind ?? 'none',
    status: trace.status,
    rules: { reference: reference.rules.length, predicted: predicted.length, matched: pairs.length },
    missedRules,
    extraRules: predicted.filter((_, p) => !matchedP.has(p)).map((v) => v.category),
    fields,
    referenceFields: reference.rules.reduce(
      (n, want) => n + RULE_FIELDS.filter((field) => scored(want, field)).length,
      0,
    ),
    card: { correct: cardCorrect, total: 2 },
    claims: { predicted: claimed, unsupported },
    evidence: {
      quotes: quotes.length,
      resolved: quotes.filter((quote) => resolveQuote(quote, input)).length,
    },
    issues,
    exclusions: { expected: reference.exclusions.length, found: exclusionsFound },
    fieldErrors,
    // The kernel passed it as clean although the reference needs review or the extraction is wrong.
    falseClean: trace.status === 'evidence_valid' && (reference.issues.length > 0 || !clean),
    durationMs: trace.durationMs,
    tokens: usage ? { input: usage.inputTokens, output: usage.outputTokens } : null,
  };
}

export interface Fraction {
  correct: number;
  total: number;
  rate: number | null;
}
const fraction = (correct: number, total: number): Fraction => ({
  correct,
  total,
  rate: total ? correct / total : null,
});
const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;

/** Aggregate metrics over any set of case scores (a whole run, one repeat, one variant kind, ...). */
export function summarize(cases: CaseScore[]) {
  const sum = (pick: (value: CaseScore) => number) => cases.reduce((total, value) => total + pick(value), 0);
  const perField = Object.fromEntries(
    RULE_FIELDS.map((field) => [
      field,
      fraction(
        sum((v) => v.fields[field].correct),
        sum((v) => v.fields[field].total),
      ),
    ]),
  ) as Record<RuleField, Fraction>;
  const allIssues = cases.flatMap((value) => value.issues);
  const codes = [...new Set(allIssues.map((value) => value.code))].sort();
  const durations = cases.map((value) => value.durationMs).sort((a, b) => a - b);
  const tokens = cases.flatMap((value) => (value.tokens ? [value.tokens] : []));
  return {
    cases: cases.length,
    ruleRecall: fraction(
      sum((v) => v.rules.matched),
      sum((v) => v.rules.reference),
    ),
    rulePrecision: fraction(
      sum((v) => v.rules.matched),
      sum((v) => v.rules.predicted),
    ),
    fieldAccuracy: fraction(
      RULE_FIELDS.reduce((n, field) => n + perField[field].correct, 0),
      RULE_FIELDS.reduce((n, field) => n + perField[field].total, 0),
    ),
    /** Field accuracy with every field of a missed rule counted wrong. */
    endToEndFieldAccuracy: fraction(
      RULE_FIELDS.reduce((n, field) => n + perField[field].correct, 0),
      sum((v) => v.referenceFields),
    ),
    perField,
    cardFieldAccuracy: fraction(
      sum((v) => v.card.correct),
      sum((v) => v.card.total),
    ),
    claimPrecision: fraction(
      sum((v) => v.claims.predicted - v.claims.unsupported),
      sum((v) => v.claims.predicted),
    ),
    unsupportedClaims: sum((v) => v.claims.unsupported),
    evidenceValidity: fraction(
      sum((v) => v.evidence.resolved),
      sum((v) => v.evidence.quotes),
    ),
    issueRecall: fraction(allIssues.filter((v) => v.found).length, allIssues.length),
    issueRecallByCode: Object.fromEntries(
      codes.map((code) => {
        const group = allIssues.filter((v) => v.code === code);
        return [code, fraction(group.filter((v) => v.found).length, group.length)];
      }),
    ),
    exclusionRecall: fraction(
      sum((v) => v.exclusions.found),
      sum((v) => v.exclusions.expected),
    ),
    falseClean: cases.filter((v) => v.falseClean).length,
    statuses: cases.reduce<Record<string, number>>((counts, v) => {
      counts[v.status] = (counts[v.status] ?? 0) + 1;
      return counts;
    }, {}),
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
    tokens: tokens.length
      ? {
          meanInput: Math.round(tokens.reduce((n, v) => n + v.input, 0) / tokens.length),
          meanOutput: Math.round(tokens.reduce((n, v) => n + v.output, 0) / tokens.length),
        }
      : null,
  };
}
export type Summary = ReturnType<typeof summarize>;

/** Field errors on matched rules and missed rules, grouped by reference category. */
export function byCategory(cases: CaseScore[]) {
  const out: Record<
    string,
    { missedRules: number; fieldErrors: number; fields: Partial<Record<string, number>> }
  > = {};
  const entry = (category: string) => (out[category] ??= { missedRules: 0, fieldErrors: 0, fields: {} });
  for (const value of cases) {
    for (const category of value.missedRules) entry(category).missedRules++;
    for (const error of value.fieldErrors) {
      const group = entry(error.category);
      group.fieldErrors++;
      group.fields[error.field] = (group.fields[error.field] ?? 0) + 1;
    }
  }
  return out;
}
