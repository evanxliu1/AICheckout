// Reward-program valuation table for catalog v3 (`evals/curation/expansion/reward-programs.json`): its format and
// the coverage check against the corpora. Every card of the expansion and real corpora maps to exactly one program
// with a currency anchor of at most 25 words; programs carry a value in hundredths of a cent per unit from a
// published estimate (publisher, URL, date read), an issuer-stated fixed redemption value (with its quote), cash back
// at 100, or none. Card-level issuer-stated values repeat the corpus `pointValueHundredthsOfCent` unchanged, except
// for a card with a `corpusLabel` override: its frozen eval label says points at a stated 1¢ while its terms state a
// percentage cash back, so general rule 1 maps it to `cash-back` (Citi Double Cash, coordinator decision 2026-10-03).
// The override repeats the label it replaces and is allowed only where the engine's cents cannot change.
// Verbatim checks against the captures are in scripts/check-expansion-quotes.mjs (captures are local only).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { MAX_QUOTE_WORDS, wordCount } from './expansion-quotes.mjs';

/** A published estimate is usable for this many days after it was read (the catalog's source-age window). */
export const MAX_ESTIMATE_AGE_DAYS = 30;

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
const date = z.iso.date();
const quoteSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => wordCount(value) <= MAX_QUOTE_WORDS, `a quote is at most ${MAX_QUOTE_WORDS} words`);
const anchorSchema = z.strictObject({ sourceId: id, quote: quoteSchema });
const publisherSchema = z.strictObject({
  publisher: z.string().trim().min(1).max(100),
  url: z.url({ protocol: /^https$/ }),
  readOn: date,
});
const value = z.number().int().positive().max(10000);

const programBase = {
  id,
  name: z.string().trim().min(1).max(100),
  currency: z.enum(['cash-back', 'points']),
};
export const programSchema = z.discriminatedUnion('basis', [
  z.strictObject({
    ...programBase,
    currency: z.literal('cash-back'),
    basis: z.literal('cash'),
    valueHundredthsOfCent: z.literal(100),
  }),
  z.strictObject({
    ...programBase,
    currency: z.literal('points'),
    basis: z.literal('published-estimate'),
    valueHundredthsOfCent: value,
    estimate: publisherSchema,
  }),
  z.strictObject({
    ...programBase,
    currency: z.literal('points'),
    basis: z.literal('issuer-stated'),
    valueHundredthsOfCent: value,
    issuerStated: anchorSchema,
  }),
  z.strictObject({
    ...programBase,
    currency: z.literal('points'),
    basis: z.literal('none'),
    valueHundredthsOfCent: z.null(),
  }),
]);

/**
 * The corpus label a card's mapping departs from, repeated so a label change fails the check, with why. Only
 * points at a stated 1¢ may become cash back (rates in basis points mean the same cents either way).
 */
const corpusLabelSchema = z.strictObject({
  currency: z.literal('points'),
  pointValueHundredthsOfCent: z.literal(100),
  reason: z.string().trim().min(1).max(600),
});

export const programCardSchema = z.strictObject({
  cardId: id,
  corpus: z.string().min(1),
  programId: id,
  statedValueHundredthsOfCent: value.nullable(),
  anchor: anchorSchema,
  corpusLabel: corpusLabelSchema.optional(),
});

export const rewardProgramsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  annotationStatus: z.literal('agent-verified'),
  description: z.string().min(1),
  primaryPublisher: publisherSchema,
  programs: z.array(programSchema).min(1).max(100),
  cards: z.array(programCardSchema).min(1),
});

const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/** One entry per distinct cardId of a corpus (the real corpus repeats cards across cases). */
export function corpusCards(corpus) {
  const cards = new Map();
  for (const item of corpus.cases)
    if (!cards.has(item.cardId))
      cards.set(item.cardId, {
        corpus: corpus.version,
        currency: item.reference.rewardCurrency.value,
        pointValue: item.reference.pointValueHundredthsOfCent.value,
        sourceIds: item.sourceIds,
      });
  return cards;
}

/**
 * Problems with a parsed table against the corpora, as strings (empty when it passes). `asOf` (YYYY-MM-DD) is the
 * date estimates must be fresh for: read on or before it and at most MAX_ESTIMATE_AGE_DAYS before it.
 */
export function checkRewardPrograms(table, corpora, { asOf }) {
  const problems = [];
  const parsed = rewardProgramsSchema.safeParse(table);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const { programs, cards, primaryPublisher } = parsed.data;

  const programById = new Map();
  for (const program of programs) {
    if (programById.has(program.id)) problems.push(`program ${program.id}: duplicate id`);
    programById.set(program.id, program);
    if (program.basis === 'published-estimate') {
      const { publisher, readOn } = program.estimate;
      if (publisher !== primaryPublisher.publisher)
        problems.push(`program ${program.id}: estimate from ${publisher}, not the primary publisher`);
      const age = daysBetween(readOn, asOf);
      if (age < 0 || age > MAX_ESTIMATE_AGE_DAYS)
        problems.push(
          `program ${program.id}: estimate read ${readOn} is not within ${MAX_ESTIMATE_AGE_DAYS} days before ${asOf}`,
        );
    }
  }
  if (programs.filter((program) => program.basis === 'cash').length !== 1)
    problems.push('exactly one cash-back program is required');

  const expected = new Map();
  for (const corpus of corpora)
    for (const [cardId, card] of corpusCards(corpus)) {
      if (expected.has(cardId)) problems.push(`card ${cardId}: in more than one corpus`);
      expected.set(cardId, card);
    }
  const seen = new Set();
  const used = new Set();
  for (const card of cards) {
    const at = `card ${card.cardId}`;
    if (seen.has(card.cardId)) problems.push(`${at}: mapped more than once`);
    seen.add(card.cardId);
    const truth = expected.get(card.cardId);
    if (!truth) {
      problems.push(`${at}: not in any corpus`);
      continue;
    }
    if (card.corpus !== truth.corpus) problems.push(`${at}: corpus is ${truth.corpus}, not ${card.corpus}`);
    const label = card.corpusLabel;
    if (label && (label.currency !== truth.currency || label.pointValueHundredthsOfCent !== truth.pointValue))
      problems.push(
        `${at}: corpusLabel does not repeat the corpus label (${truth.currency}, ${truth.pointValue})`,
      );
    if (label && (card.programId !== 'cash-back' || card.statedValueHundredthsOfCent !== null))
      problems.push(`${at}: a corpusLabel override maps to cash-back with no stated value`);
    if (label && !/\d(\.\d+)?% cash back/i.test(card.anchor.quote))
      problems.push(`${at}: a corpusLabel override needs an anchor stating a percentage cash back`);
    if (!label && card.statedValueHundredthsOfCent !== truth.pointValue)
      problems.push(
        `${at}: stated value ${card.statedValueHundredthsOfCent} differs from corpus ${truth.pointValue}`,
      );
    if (!truth.sourceIds.includes(card.anchor.sourceId))
      problems.push(`${at}: anchor source ${card.anchor.sourceId} is not one of the card's sources`);
    const program = programById.get(card.programId);
    if (!program) {
      problems.push(`${at}: unknown program ${card.programId}`);
      continue;
    }
    used.add(program.id);
    if (!label && program.currency !== truth.currency)
      problems.push(
        `${at}: corpus currency ${truth.currency} but program ${program.id} is ${program.currency}`,
      );
  }
  for (const cardId of expected.keys()) if (!seen.has(cardId)) problems.push(`card ${cardId}: no program`);
  for (const program of programs)
    if (!used.has(program.id)) problems.push(`program ${program.id}: no card uses it`);
  return problems;
}

/** Reads the committed table and both corpora from the repository root. */
export async function loadRewardPrograms(root) {
  const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  return {
    table: await read('evals/curation/expansion/reward-programs.json'),
    corpora: [
      await read('evals/curation/expansion/corpus.json'),
      await read('evals/curation/real/corpus.v2.json'),
    ],
  };
}

/** Anchors and quotes in the table that must be verbatim in a capture: [path, { sourceId, quote }]. */
export function rewardProgramAnchors(table) {
  return [
    ...table.programs
      .filter((program) => program.issuerStated)
      .map((program) => [`programs.${program.id}.issuerStated`, program.issuerStated]),
    ...table.cards.map((card) => [`cards.${card.cardId}.anchor`, card.anchor]),
  ];
}
