import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '../canonical.ts';
import { sha256 } from '../extraction.ts';
import {
  CATEGORIES,
  extractionV2InputSchema,
  extractionV2Schema,
  ruleSchema,
  type ExtractionV2Input,
} from './schema.ts';
import { quotePattern, resolveQuote } from './validate.ts';

/**
 * Evaluation corpus v2. Issuer text is copyrighted, so the committed corpus holds only source IDs, hashes,
 * labels, and short anchor quotes; page bodies are read at run time from local captures (`captures/<id>.txt`)
 * and must match the SHA-256 recorded in the committed manifest.
 */
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
const anchor = z.string().min(1).max(400);
const anchors = z.array(anchor).min(1).max(4);
const rule = ruleSchema.shape;
const value = <T extends z.ZodType>(schema: T) => z.strictObject({ value: schema.nullable(), anchors });

export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sources: z
    .array(
      z.strictObject({
        id,
        cardIds: z.array(z.string().min(1).max(80)).min(1).max(8),
        issuer: z.string().min(1).max(80),
        kind: z.string().min(1).max(80),
        title: z.string().min(1).max(200),
        url: z.url({ protocol: /^https$/ }).max(2048),
        capturedOn: z.iso.date(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        length: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(100),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const referenceRuleSchema = z.strictObject({
  category: z.enum(CATEGORIES),
  issuerWording: rule.issuerWording,
  rateBps: rule.rateBps.shape.value,
  paidOnPaymentBps: rule.paidOnPaymentBps.shape.value,
  cap: rule.cap.shape.value,
  activation: rule.activation.shape.value,
  usMerchantsOnly: rule.usMerchantsOnly.shape.value,
  limitedTime: rule.limitedTime.shape.value,
  /** Verbatim quotes that state this rule; the first should carry the rate. */
  anchors,
});
export type ReferenceRule = z.infer<typeof referenceRuleSchema>;

const issueCode = extractionV2Schema.shape.issues.element.shape.code;
export const referenceSchema = z.strictObject({
  rewardCurrency: value(extractionV2Schema.shape.rewardCurrency.shape.value.unwrap()),
  pointValueHundredthsOfCent: z.strictObject({
    value: extractionV2Schema.shape.pointValueHundredthsOfCent.shape.value,
    anchors: z.array(anchor).max(4),
  }),
  rules: z.array(referenceRuleSchema).min(1).max(20),
  exclusions: z.array(z.strictObject({ text: z.string().min(1).max(200), anchors })).max(20),
  /** Issues a careful extractor must report. `missing` may have no anchors. */
  issues: z.array(z.strictObject({ code: issueCode, anchors: z.array(anchor).max(4) })).max(10),
});
export type Reference = z.infer<typeof referenceSchema>;

/** Mechanical edits that derive a variant case from real captures. `target` matches like a quote. */
export const editSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('delete'), sourceId: id, target: anchor }),
  z.strictObject({
    op: z.literal('insert-after'),
    sourceId: id,
    target: anchor,
    text: z.string().min(1).max(2000),
  }),
  z.strictObject({ op: z.literal('append'), sourceId: id, text: z.string().min(1).max(2000) }),
]);
export const VARIANT_KINDS = ['remove-cap', 'conflicting-rate', 'injection', 'stale-promo'] as const;

export const caseSchema = z.strictObject({
  id,
  cardId: extractionV2InputSchema.shape.cardId,
  cardName: extractionV2InputSchema.shape.cardName,
  issuer: z.string().min(1).max(80),
  split: z.enum(['dev', 'heldout']),
  sourceIds: z.array(id).min(1).max(4),
  variant: z
    .strictObject({ kind: z.enum(VARIANT_KINDS), edits: z.array(editSchema).min(1).max(6) })
    .optional(),
  reference: referenceSchema,
});
export type CorpusCase = z.infer<typeof caseSchema>;

export const corpusV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  version: id,
  origin: z.enum(['synthetic-fixture', 'real-issuer-captures']),
  annotationStatus: z.enum(['agent-drafted', 'human-verified']),
  description: z.string().min(1).max(2000),
  cases: z.array(caseSchema).min(1).max(200),
});
export type CorpusV2 = z.infer<typeof corpusV2Schema>;

export interface LoadedCase {
  item: CorpusCase;
  input: ExtractionV2Input;
}
export interface LoadedCorpus {
  corpus: CorpusV2;
  manifest: Manifest;
  /** Binds labels and the exact source captures the observations were collected on. */
  hash: string;
  cases: LoadedCase[];
}

function applyEdit(body: string, edit: z.infer<typeof editSchema>, caseId: string) {
  if (edit.op === 'append') return `${body.replace(/\n*$/, '')}\n${edit.text}\n`;
  const match = quotePattern(edit.target)!.exec(body);
  if (!match) throw new Error(`Variant edit target not found in ${edit.sourceId} for ${caseId}.`);
  const end = match.index + match[0].length;
  return edit.op === 'delete'
    ? body.slice(0, match.index) + body.slice(end)
    : body.slice(0, end) + edit.text + body.slice(end);
}

/** Checks labels against the documents they describe. Throws on the first problem. */
export function checkCase(item: CorpusCase, input: ExtractionV2Input) {
  const fail = (message: string) => {
    throw new Error(`${item.id}: ${message}`);
  };
  const quotes: string[] = [
    ...item.reference.rewardCurrency.anchors,
    ...item.reference.pointValueHundredthsOfCent.anchors,
    ...item.reference.rules.flatMap((value) => value.anchors),
    ...item.reference.exclusions.flatMap((value) => value.anchors),
    ...item.reference.issues.flatMap((value) => value.anchors),
  ];
  for (const quote of quotes) if (!resolveQuote(quote, input)) fail(`anchor not found: "${quote}"`);
  item.reference.rules.forEach((value, i) => {
    const cap = value.cap;
    if (
      cap?.kind === 'none' &&
      (cap.amountCents !== null || cap.period !== null || cap.rateAfterCapBps !== null)
    )
      fail(`rules.${i}.cap: an uncapped rule has no amount, period, or after-cap rate`);
    if (cap?.kind === 'spend' && cap.amountCents === null)
      fail(`rules.${i}.cap: a spend cap needs an amount`);
    if (value.paidOnPaymentBps !== null && value.rateBps !== null && value.paidOnPaymentBps > value.rateBps)
      fail(`rules.${i}: paid-on-payment portion exceeds the rate`);
  });
  if (item.reference.issues.some((value) => value.code !== 'missing' && !value.anchors.length))
    fail('only "missing" issues may omit anchors');
  if (
    item.variant?.kind === 'injection' &&
    !item.reference.issues.some((v) => v.code === 'untrusted-instruction')
  )
    fail('an injection variant must expect an untrusted-instruction issue');
  if (
    item.variant?.kind === 'conflicting-rate' &&
    !item.reference.issues.some((v) => v.code === 'conflicting')
  )
    fail('a conflicting-rate variant must expect a conflicting issue');
}

/** Read a corpus directory (`corpus.v2.json`, `manifest.json`, `captures/`) and build every case's input. */
export async function loadCorpusV2(dir: string): Promise<LoadedCorpus> {
  const json = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown;
  const corpus = corpusV2Schema.parse(await json('corpus.v2.json'));
  const manifest = manifestSchema.parse(await json('manifest.json'));
  const sources = new Map(manifest.sources.map((source) => [source.id, source]));
  if (sources.size !== manifest.sources.length) throw new Error('Duplicate source ID in manifest.');

  const bodies = new Map<string, string>();
  const body = async (sourceId: string) => {
    if (!bodies.has(sourceId)) {
      let text: string;
      try {
        text = await readFile(join(dir, 'captures', `${sourceId}.txt`), 'utf8');
      } catch {
        throw new Error(`Capture ${sourceId} is missing; run the capture script first.`);
      }
      if (sha256(text) !== sources.get(sourceId)!.sha256)
        throw new Error(`Capture ${sourceId} does not match the manifest hash; labels must be re-verified.`);
      bodies.set(sourceId, text);
    }
    return bodies.get(sourceId)!;
  };

  const ids = new Set<string>(),
    splitOf = new Map<string, string>(),
    cases: LoadedCase[] = [];
  for (const item of corpus.cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate case ${item.id}.`);
    ids.add(item.id);
    const documents = [];
    for (const sourceId of item.sourceIds) {
      const source = sources.get(sourceId);
      if (!source) throw new Error(`${item.id}: unknown source ${sourceId}.`);
      if (!source.cardIds.includes(item.cardId))
        throw new Error(`${item.id}: source ${sourceId} is for another card.`);
      // Held-out results only mean something if no held-out page was seen while tuning on dev.
      if (splitOf.has(sourceId) && splitOf.get(sourceId) !== item.split)
        throw new Error(`Source ${sourceId} is used in both splits.`);
      splitOf.set(sourceId, item.split);
      let text = await body(sourceId);
      for (const edit of item.variant?.edits ?? []) {
        if (!item.sourceIds.includes(edit.sourceId))
          throw new Error(`${item.id}: edit targets an unused source.`);
        if (edit.sourceId === sourceId) text = applyEdit(text, edit, item.id);
      }
      documents.push({
        id: sourceId,
        title: source.title,
        url: source.url,
        capturedOn: source.capturedOn,
        body: text,
        contentHash: sha256(text),
      });
    }
    const input = extractionV2InputSchema.parse({ cardId: item.cardId, cardName: item.cardName, documents });
    checkCase(item, input);
    cases.push({ item, input });
  }
  return { corpus, manifest, hash: sha256(canonicalJson({ corpus, sources: manifest.sources })), cases };
}
