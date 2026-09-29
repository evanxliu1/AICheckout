import { sha256, type Finding } from '../extraction.ts';
import type { ExtractionV2, ExtractionV2Input } from './schema.ts';

export interface Span {
  documentId: string;
  start: number;
  end: number;
}

/**
 * Locate a model quote in the original captured text. Matching is exact except that any run of whitespace
 * matches any other run, because rendered pages break lines where the model may write a space.
 */
export function resolveQuote(quote: string, input: Pick<ExtractionV2Input, 'documents'>): Span | null {
  const pattern = quotePattern(quote);
  if (!pattern) return null;
  for (const document of input.documents) {
    const match = pattern.exec(document.body);
    if (match) return { documentId: document.id, start: match.index, end: match.index + match[0].length };
  }
  return null;
}

/** A regex matching `quote` with any whitespace run standing for any other; null for a blank quote. */
export function quotePattern(quote: string): RegExp | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
}

export function validateInputsV2(input: ExtractionV2Input): Finding[] {
  const findings: Finding[] = [],
    ids = new Set<string>();
  input.documents.forEach((document, i) => {
    if (ids.has(document.id)) findings.push({ code: 'duplicate_document', path: `documents.${i}` });
    ids.add(document.id);
    if (sha256(document.body) !== document.contentHash)
      findings.push({ code: 'source_hash_mismatch', path: `documents.${i}` });
  });
  return findings;
}

/** Percent figures written in a quote, in basis points ("1.5%" -> 150, "3 percent" -> 300). */
export function percentsIn(text: string): number[] {
  return [...text.matchAll(/(?<![\d.])(\d{1,2})(?:\.(\d{1,2}))?\s*(?:%|percent\b)/gi)].map(
    (match) => Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')),
  );
}

/** Evidence integrity and internal consistency. Not a correctness check: that is what the eval measures. */
export function validateExtractionV2(output: ExtractionV2, input: ExtractionV2Input): Finding[] {
  const findings: Finding[] = [];
  const add = (code: string, path: string) => findings.push({ code, path });
  const cite = (quotes: string[], path: string, required: boolean) => {
    if (required && !quotes.length) add('missing_evidence', path);
    quotes.forEach((quote, i) => {
      if (!resolveQuote(quote, input)) add('quote_not_found', `${path}.${i}`);
    });
  };

  if (output.cardId !== input.cardId) add('wrong_card', 'cardId');
  cite(output.rewardCurrency.evidence, 'rewardCurrency', output.rewardCurrency.value !== null);
  cite(
    output.pointValueHundredthsOfCent.evidence,
    'pointValueHundredthsOfCent',
    output.pointValueHundredthsOfCent.value !== null,
  );
  output.rules.forEach((rule, i) => {
    const path = `rules.${i}`;
    for (const field of [
      'rateBps',
      'paidOnPaymentBps',
      'activation',
      'usMerchantsOnly',
      'limitedTime',
    ] as const) {
      const claim = rule[field];
      // A zero payment portion is the default reading and needs no quote.
      const required = claim.value !== null && !(field === 'paidOnPaymentBps' && claim.value === 0);
      cite(claim.evidence, `${path}.${field}`, required);
    }
    cite(rule.cap.evidence, `${path}.cap`, rule.cap.value !== null);
    rule.definition.forEach((item, j) => cite([item.text], `${path}.definition.${j}`, true));

    const rate = rule.rateBps.value;
    if (rate !== null) {
      const stated = rule.rateBps.evidence.flatMap(percentsIn);
      const total = stated.reduce((sum, value) => sum + value, 0);
      if (!stated.includes(rate) && total !== rate) add('rate_not_in_evidence', `${path}.rateBps`);
    }
    if (rule.paidOnPaymentBps.value !== null && rate !== null && rule.paidOnPaymentBps.value > rate)
      add('inconsistent_claim', `${path}.paidOnPaymentBps`);
    const cap = rule.cap.value;
    if (
      cap?.kind === 'none' &&
      (cap.amountCents !== null || cap.period !== null || cap.rateAfterCapBps !== null)
    )
      add('inconsistent_claim', `${path}.cap`);
    if (cap?.kind === 'spend' && cap.amountCents === null) add('inconsistent_claim', `${path}.cap`);
  });
  output.exclusions.forEach((item, i) => cite(item.evidence, `exclusions.${i}`, true));
  output.issues.forEach((issue, i) => {
    add(`reported_${issue.code}`, `issues.${i}`);
    cite(issue.evidence, `issues.${i}`, issue.code !== 'missing');
  });
  return findings;
}
