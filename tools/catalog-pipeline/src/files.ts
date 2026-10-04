// Zod schemas for every batch file the pipeline reads or writes, and the loader that reads a batch directory.
// Files written by the Phase 7 scripts are read loosely (only the fields the pipeline uses are checked); the
// pipeline's own files (batch.json, state.json) are strict.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { BATCH_ID, SLUG, readState } from './state.ts';
import type { State } from './state.ts';

export const BATCHES_DIR = 'evals/curation/batches';
const slug = z.string().regex(SLUG).max(120);
const domain = z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);

/** pipeline/batch.json: the request. Names and the summary are Evan's words, never issuer text. */
export const batchFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batch: z.string().regex(BATCH_ID),
  issuers: z
    .array(z.strictObject({ name: z.string().min(1).max(80), slug, domains: z.array(domain) }))
    .min(1),
  requestedCards: z.array(z.string().min(1).max(120)).min(1),
  refresh: z.boolean(),
  summary: z.string().max(300).nullable(),
  createdAt: z.iso.datetime(),
});
export type BatchFile = z.infer<typeof batchFileSchema>;

const cardsFileSchema = z.looseObject({
  cards: z.array(
    z.looseObject({
      id: slug,
      issuer: z.string(),
      sourceIds: z.array(z.string()),
      research: z.string().optional(),
    }),
  ),
});
export type CardEntry = z.infer<typeof cardsFileSchema>['cards'][number];
const sourcesFileSchema = z.looseObject({
  sources: z.array(z.looseObject({ id: z.string(), url: z.string(), kind: z.string() })),
});
export type SourceEntry = z.infer<typeof sourcesFileSchema>['sources'][number];
const manifestFileSchema = z.looseObject({
  sources: z.array(z.looseObject({ id: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
});
const hintsFileSchema = z.record(z.string(), z.unknown());
const corpusFileSchema = z.looseObject({
  cases: z.array(z.looseObject({ id: z.string(), cardId: z.string() })),
});
export type CorpusCase = z.infer<typeof corpusFileSchema>['cases'][number];
const productNotesFileSchema = z.looseObject({ cards: z.array(z.looseObject({ cardId: z.string() })) });
const findingsCardSchema = z.looseObject({
  cardId: z.string(),
  verdict: z.string(),
  verdictAdjudication: z.looseObject({ decision: z.string() }).nullish(),
  fixes: z.array(z.looseObject({ path: z.string() })).optional(),
});
export type FindingsCard = z.infer<typeof findingsCardSchema>;
export const findingsFileSchema = z.looseObject({
  issuer: z.string(),
  adjudicator: z.unknown().optional(),
  cards: z.array(findingsCardSchema),
  labelLintAcks: z.array(z.looseObject({ cardId: z.string() })).optional(),
});
const overlayFileSchema = z.looseObject({ cards: z.array(z.looseObject({ cardId: z.string() })) });
/** One row of a capture run report (`capture-issuer-pages.mjs --report`). */
export const captureReportSchema = z.array(
  z.looseObject({ id: z.string(), ok: z.boolean(), flags: z.array(z.string()).optional() }),
);
/** The parts of an extraction trace file (`extract-cards.mjs`) the extract stage checks. */
export const traceFileSchema = z.looseObject({
  cardId: z.string(),
  configuration: z.looseObject({}),
  documents: z.array(
    z.looseObject({ id: z.string(), sourceSha256: z.string().optional(), contentHash: z.string() }),
  ),
  trace: z.looseObject({ status: z.string() }),
});

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  const result = schema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error(`${path}: ${z.prettifyError(result.error)}`);
  return result.data;
}

export interface Findings {
  issuerSlug: string;
  file: string;
  card: FindingsCard;
  /** The file's `labelLintAcks` of this card, as written (the gates validate them). */
  acks: unknown[];
}

/** Everything the status derivation reads from one batch directory. */
export interface Batch {
  id: string;
  root: string;
  dir: string;
  /** Repository-relative directory, as the wrapped scripts' --dir expects. */
  rel: string;
  meta: BatchFile;
  state: State;
  cards: CardEntry[];
  sources: Map<string, SourceEntry>;
  manifest: Map<string, { id: string; sha256: string }>;
  hints: Record<string, unknown>;
  draft: Map<string, CorpusCase>;
  notes: Map<string, unknown>;
  findings: Map<string, Findings>;
  corpus: Map<string, CorpusCase>;
  overlay: Map<string, unknown>;
  packets: string[];
}

export const batchDir = (root: string, id: string): string => join(root, BATCHES_DIR, id);
export const statePath = (dir: string): string => join(dir, 'pipeline', 'state.json');

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export async function listBatches(root: string): Promise<string[]> {
  const names = await readdir(join(root, BATCHES_DIR)).catch(() => [] as string[]);
  return names.filter((name) => BATCH_ID.test(name)).sort();
}

export async function loadBatch(root: string, id: string): Promise<Batch> {
  if (!BATCH_ID.test(id)) throw new Error(`Batch id must match ${BATCH_ID}: ${id}`);
  const dir = batchDir(root, id);
  const meta = await readJson(join(dir, 'pipeline', 'batch.json'), batchFileSchema);
  if (!meta)
    throw new Error(`No batch ${id} (missing ${relative(root, join(dir, 'pipeline', 'batch.json'))}).`);
  const state = await readState(statePath(dir));
  const cards = (await readJson(join(dir, 'cards.json'), cardsFileSchema))?.cards ?? [];
  const sources = (await readJson(join(dir, 'sources.json'), sourcesFileSchema))?.sources ?? [];
  const manifest = (await readJson(join(dir, 'manifest.json'), manifestFileSchema))?.sources ?? [];
  const draft = (await readJson(join(dir, 'corpus.draft.json'), corpusFileSchema))?.cases ?? [];
  const corpus = (await readJson(join(dir, 'corpus.json'), corpusFileSchema))?.cases ?? [];
  const notes = (await readJson(join(dir, 'product-notes.json'), productNotesFileSchema))?.cards ?? [];
  const overlay = (await readJson(join(dir, 'catalog-overlay.json'), overlayFileSchema))?.cards ?? [];
  const findings = new Map<string, Findings>();
  const verificationDir = join(dir, 'verification');
  for (const name of (await readdir(verificationDir).catch(() => [] as string[])).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = await readJson(join(verificationDir, name), findingsFileSchema);
    for (const card of file?.cards ?? [])
      findings.set(card.cardId, {
        issuerSlug: name.slice(0, -5),
        file: join(verificationDir, name),
        card,
        acks: (file?.labelLintAcks ?? []).filter((ack) => ack.cardId === card.cardId),
      });
  }
  const packets = (await readdir(join(dir, 'pipeline', 'packets')).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.json'))
    .sort();
  return {
    id,
    root,
    dir,
    rel: relative(root, dir),
    meta,
    state,
    cards,
    sources: new Map(sources.map((source) => [source.id, source])),
    manifest: new Map(manifest.map((entry) => [entry.id, entry])),
    hints: (await readJson(join(dir, 'capture-hints.json'), hintsFileSchema)) ?? {},
    draft: new Map(draft.map((item) => [item.cardId, item])),
    notes: new Map(notes.map((entry) => [entry.cardId, entry])),
    findings,
    corpus: new Map(corpus.map((item) => [item.cardId, item])),
    overlay: new Map(overlay.map((entry) => [entry.cardId, entry])),
    packets,
  };
}

/** The issuer slug of a card: batch.json's slug for the issuer name, else the name slugified. */
export function issuerSlugOf(batch: Batch, issuerName: string): string {
  return batch.meta.issuers.find((issuer) => issuer.name === issuerName)?.slug ?? slugify(issuerName);
}
