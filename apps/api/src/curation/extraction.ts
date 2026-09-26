import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { citationSchema } from '@ai-checkout/catalog-review/curation';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import { type Extraction, type ExtractionInput, type Finding } from '@ai-checkout/catalog-review/curation';
export { EXTRACTION_SCHEMA_VERSION, SOURCE_POLICY_VERSION, citationSchema, extractionSchema, extractionInputSchema, type Extraction, type SourceDocument, type ExtractionInput, type Finding } from '@ai-checkout/catalog-review/curation';
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Pasted text is supplied by an authorized maintainer; allowed URLs do not prove its authenticity. */
export function validateInputs(input: ExtractionInput, now: number): Finding[] {
  const findings: Finding[] = [], seen = new Set<string>(), sourceKeys = new Set<string>();
  const card = PILOT_CATALOG.cards.find(value => value.id === input.cardId)!;
  const allowed = new Set(card.rules.flatMap(rule => rule.sourceIds));
  for (const [i, document] of input.documents.entries()) {
    const path = `documents.${i}`, declared = PILOT_CATALOG.sources.find(source => source.id === document.source_key);
    if (!declared || !allowed.has(document.source_key) || document.url !== declared.url) findings.push({ code: 'source_not_allowed', path });
    if (seen.has(document.id) || sourceKeys.has(document.source_key)) findings.push({ code: 'duplicate_document', path });
    seen.add(document.id); sourceKeys.add(document.source_key);
    if (sha256(document.body) !== document.content_hash) findings.push({ code: 'source_hash_mismatch', path });
    if (!document.body.trim()) findings.push({ code: 'empty_document', path });
    if (document.checked_on > new Date(now).toISOString().slice(0, 10) || Date.parse(document.created_at) > now) findings.push({ code: 'future_document', path });
  }
  for (const key of allowed) if (!sourceKeys.has(key)) findings.push({ code: 'missing_required_source', path: `documents.${key}` });
  return findings;
}

/** Evidence integrity and narrow consistency checks, not general entailment/completeness or publishability. */
export function validateExtraction(output: Extraction, input: ExtractionInput): Finding[] {
  const findings: Finding[] = [], documents = new Map(input.documents.map(document => [document.id, document]));
  const add = (code: string, path: string) => findings.push({ code, path });
  function citations(items: z.infer<typeof citationSchema>[], path: string, required = false) {
    if (required && !items.length) add('missing_evidence', path);
    for (const [i, citation] of items.entries()) {
      const document = documents.get(citation.documentId), at = `${path}.${i}`;
      if (!document || citation.contentHash !== document.content_hash) { add('unknown_evidence', at); continue; }
      if (citation.start >= citation.end || document.body.slice(citation.start, citation.end) !== citation.quote || citation.end > document.body.length || !citation.quote.trim()) add('quote_mismatch', at);
    }
  }
  if (output.cardId !== input.cardId) add('wrong_card', 'cardId');
  const expected = PILOT_CATALOG.cards.find(card => card.id === input.cardId)!.rules;
  const ids = new Set<string>();
  for (const [i, rule] of output.rules.entries()) {
    const path = `rules.${i}`, target = expected.find(value => value.id === rule.ruleId);
    if (!target || ids.has(rule.ruleId)) add('unexpected_rule', `${path}.ruleId`);
    ids.add(rule.ruleId);
    for (const field of ['rateBps', 'category', 'activation'] as const) {
      const claim = rule[field];
      if (claim.state === 'known' ? claim.value === null : claim.value !== null) add('inconsistent_claim', `${path}.${field}`);
      if (claim.state !== 'known') add('unresolved_claim', `${path}.${field}`);
      citations(claim.evidence, `${path}.${field}.evidence`, claim.state !== 'unknown');
    }
    if (target && rule.category.state === 'known' && rule.category.value !== target.category) add('changed_rule_category', `${path}.category`);
    if (rule.rateBps.state === 'known' && !rule.rateBps.evidence.some(citation =>
      [...citation.quote.matchAll(/(?<![\d.-])(\d{1,3})(?:\.(\d{1,2}))?\s*(?:%|percent\b)/gi)]
        .some(match => Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) === rule.rateBps.value))) {
      add('rate_not_in_evidence', `${path}.rateBps`);
    }
    if (rule.activation.state === 'known') {
      const polarities = rule.activation.evidence.map(citation => {
        if (/\b(?:no activation (?:is )?(?:required|needed)|without activation|activation (?:is )?not required)\b/i.test(citation.quote)) return false;
        if (/\b(?:requires activation|activation (?:is )?required)\b/i.test(citation.quote)) return true;
        return null;
      });
      if (polarities.some(value => value !== null && value !== rule.activation.value)) add('activation_contradiction', `${path}.activation`);
    }
    const cap = rule.cap;
    if (cap.state !== 'known') {
      add('unresolved_claim', `${path}.cap`);
      if (cap.kind !== null || cap.amountCents !== null || cap.period !== null) add('inconsistent_claim', `${path}.cap`);
    } else if (cap.kind === 'none') {
      if (cap.amountCents !== null || cap.period !== null) add('inconsistent_claim', `${path}.cap`);
    } else if (cap.kind !== 'annual-spend' || cap.amountCents === null || cap.period !== 'calendar-year') add('inconsistent_claim', `${path}.cap`);
    citations(cap.evidence, `${path}.cap.evidence`, cap.state !== 'unknown');
  }
  for (const rule of expected) if (!ids.has(rule.id)) add('missing_rule', `rules.${rule.id}`);
  for (const [i, condition] of output.conditions.entries()) citations(condition.evidence, `conditions.${i}.evidence`, true);
  for (const [i, issue] of output.issues.entries()) {
    add(`reported_${issue.code}`, `issues.${i}`);
    citations(issue.evidence, `issues.${i}.evidence`, issue.code !== 'missing');
  }
  return findings;
}
