// The research gate (wiki/system/card-expansion-pipeline.md, "Gates"): a strict schema for the card-researcher's
// output, research/<issuer-slug>.json. Research chooses cards and pages only: it has no numeric field at all (no rate,
// cap, point value or multiplier), every URL is https on the batch's issuer domain allow-list, and a card already in a
// released corpus may only appear in a refresh batch. Accepting it consolidates the research into cards.json,
// sources.json, exclusions.json and capture-hints.json with scripts/build-expansion-cards.mjs --dir.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Batch } from './files.ts';
import { SLUG, TOKEN } from './state.ts';
import { batchesConfigSchema, BATCHES_CONFIG_PATH } from '../../../scripts/lib/catalog-batches.mjs';

export const SOURCE_KINDS = [
  'product-page',
  'rewards-terms',
  'application-terms',
  'rates-and-fees',
  'rotating-calendar',
  'category-faq',
  'partner-page',
  'benefits-guide-pdf',
] as const;
export const CARD_GROUPS = ['personal-rewards', 'co-brand', 'student', 'secured', 'business'] as const;
export const NETWORKS = ['Visa', 'Mastercard', 'American Express', 'Discover', 'store-only'] as const;
export const MAX_NOTE_CHARS = 300;

const note = z.string().trim().min(1).max(MAX_NOTE_CHARS);
const name = z.string().trim().min(1).max(120);
const url = z.url({ protocol: /^https$/ }).max(2048);

export const researchFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packetId: z.string().min(1),
  batch: z.string().min(1),
  /** The issuer name as in batch.json. */
  issuer: z.string().min(1).max(80),
  researchedOn: z.iso.date(),
  provenance: z.strictObject({
    generatedBy: z.literal('card-researcher'),
    model: z.string().regex(TOKEN),
    date: z.iso.date(),
    status: z.literal('agent-research-unverified'),
  }),
  cards: z
    .array(
      z.strictObject({
        id: z.string().regex(SLUG).max(120),
        name,
        group: z.enum(CARD_GROUPS),
        coBrandPartner: name.nullable(),
        closedLoop: z.boolean(),
        network: z.enum(NETWORKS).nullable(),
        openToNewApplicants: z.boolean(),
        /** As the issuer writes it ("$0", "$95"); a hint for the verify packet, never a label. */
        annualFee: z.string().trim().min(1).max(80).nullable(),
        rewardCurrency: z.enum(['cash-back', 'points', 'miles']),
        officialUrls: z
          .array(z.strictObject({ url, kind: z.enum(SOURCE_KINDS), note: note.optional() }))
          .min(1)
          .max(8),
        notes: note.nullable(),
      }),
    )
    .min(1)
    .max(60),
  /** Cards left out (closed, no rewards, duplicate), in the researcher's words. */
  closedButCommon: z.array(z.strictObject({ name, note })).max(60),
  /** Scope questions for Evan; the session records his answers in batch.json. */
  questions: z.array(note).max(20),
});
export type ResearchFile = z.infer<typeof researchFileSchema>;

/** Keys that would carry a reward value; the strict schema rejects them anyway, this names them plainly. */
const RATE_WORDS = new Set([
  'rate',
  'rates',
  'bps',
  'multiplier',
  'multiple',
  'cap',
  'caps',
  'percent',
  'earn',
]);
const RATE_FIELDS = new Set([
  'rewardsSummary',
  'pointCashValue',
  'pointValue',
  'pointValueHundredthsOfCent',
  'amountCents',
]);
const isRateKey = (key: string): boolean =>
  RATE_FIELDS.has(key) ||
  key.split(/(?=[A-Z])|[^A-Za-z]+/).some((word) => RATE_WORDS.has(word.toLowerCase()));

function rateKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => rateKeys(item, `${path}.${i}`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const at = path ? `${path}.${key}` : key;
    return [...(isRateKey(key) ? [at] : []), ...rateKeys(child, at)];
  });
}

const onDomain = (href: string, domains: string[]): boolean => {
  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
};

/** Card IDs of the corpora the build config releases, except this batch's own. */
export async function releasedCards(root: string, batchId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let config: z.infer<typeof batchesConfigSchema>;
  try {
    config = batchesConfigSchema.parse(JSON.parse(await readFile(join(root, BATCHES_CONFIG_PATH), 'utf8')));
  } catch {
    return out;
  }
  for (const layer of config.layers) {
    if (layer.kind === 'batch' && layer.id === batchId) continue;
    const path =
      layer.kind === 'base'
        ? join(root, layer.dir, layer.corpus)
        : join(root, 'evals/curation/batches', layer.id, 'corpus.json');
    const text = await readFile(path, 'utf8').catch(() => null);
    if (text === null) continue;
    const corpus = JSON.parse(text) as { version: string; cases: { cardId: string }[] };
    for (const item of corpus.cases) if (!out.has(item.cardId)) out.set(item.cardId, corpus.version);
  }
  return out;
}

/** Errors as `<field path>: <problem>`; empty when the research passes. */
export async function researchGate(batch: Batch, issuer: string, data: unknown): Promise<string[]> {
  const errors = rateKeys(data).map((at) => `${at}: no reward values in research (rates come from captures)`);
  const parsed = researchFileSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      if (!(issue.code === 'unrecognized_keys' && issue.keys.every(isRateKey)))
        errors.push(`${issue.path.join('.') || '(file)'}: ${issue.message}`);
    return errors;
  }
  const meta = batch.meta.issuers.find((entry) => entry.slug === issuer)!;
  if (!meta.domains.length) errors.push('batch.json issuers: no domain allow-list for this issuer');
  const released = await releasedCards(batch.root, batch.id);
  const seen = new Set<string>();
  parsed.data.cards.forEach((card, i) => {
    const at = `cards.${i}`;
    if (!card.id.startsWith(`${issuer}-`) || card.id === `${issuer}-`)
      errors.push(`${at}.id: must be <issuer-slug>-<card-slug> (${issuer}-…)`);
    if (seen.has(card.id)) errors.push(`${at}.id: duplicate card id`);
    seen.add(card.id);
    card.officialUrls.forEach((source, j) => {
      if (!onDomain(source.url, meta.domains))
        errors.push(`${at}.officialUrls.${j}.url: not on the issuer domain allow-list`);
    });
    const version = released.get(card.id);
    if (version && !batch.meta.refresh)
      errors.push(`${at}.id: already in the released corpus ${version}, and the batch is not a refresh`);
  });
  return errors;
}
