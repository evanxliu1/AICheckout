// The batch state record, pipeline/state.json (wiki/system/card-expansion-pipeline.md, "Batch state record").
// Text-free by construction: every string is an ID, hash, version, code or timestamp limited by a regex, and every
// object is strict, so issuer text or model text cannot be stored here.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { CATALOG_VERSION } from '../../../scripts/lib/catalog-batches.mjs';

export const STAGES = [
  'research',
  'capture',
  'extract',
  'draft',
  'verify',
  'adjudicate',
  'apply',
  'overlay',
  'build',
  'eval',
] as const;
export type Stage = (typeof STAGES)[number];

/** Stages recorded per card (freshness is the Phase 9 slot: always pending in v1). */
export const CARD_STAGES = [
  'capture',
  'extract',
  'draft',
  'verify',
  'adjudicate',
  'apply',
  'overlay',
  'freshness',
] as const;
export type CardStage = (typeof CARD_STAGES)[number];
/** Agent stages: acceptance is recorded per issuer (packet, agent run, model), input hashes per card. */
export const ISSUER_STAGES = ['research', 'verify', 'adjudicate', 'overlay'] as const;
export type IssuerStage = (typeof ISSUER_STAGES)[number];
export const BATCH_STAGES = ['build', 'eval'] as const;
export type BatchStage = (typeof BATCH_STAGES)[number];
export const AGENT_STAGES = new Set<string>(ISSUER_STAGES);
export const CLI_STAGES = ['capture', 'extract', 'draft', 'apply', 'build', 'eval'] as const;
export type CliStage = (typeof CLI_STAGES)[number];

export const STATUSES = [
  'pending',
  'done',
  'stale',
  'failed-gate',
  'paused',
  'inputs-missing',
  'dropped',
] as const;
export type Status = (typeof STATUSES)[number];

export const BATCH_ID = /^[a-z0-9-]+-\d{4}-\d{2}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A model, agent-run or packet ID: one token, no spaces (also `verificationFileSchema`'s `packetId` in
 * scripts/lib/expansion-verification.mjs, which keeps its own copy: scripts do not import the pipeline). */
export const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const id = z.string().regex(SLUG).max(120);
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const hex = z.string().regex(/^[0-9a-f]{64}$/);
/** A short machine code such as `usage-limit` or `capture-flagged`; no spaces, so no sentences. */
const code = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
/** `<kind>:<id or relative path>`, e.g. `manifest:wells-fargo-autograph-product`. */
const ref = z.string().regex(/^[a-z][a-z-]*:[A-Za-z0-9._/-]{1,200}$/);
const timestamp = z.iso.datetime();
const token = z.string().regex(TOKEN);

export const stageRecordSchema = z.strictObject({
  status: z.enum(STATUSES),
  stageVersion: z
    .string()
    .regex(/^[a-z]+\.\d+$/)
    .optional(),
  inputHash: hash.optional(),
  outputs: z.array(z.strictObject({ ref, sha256: hex })).optional(),
  /** Draft: the labels/anchors split of the draft case. Verify: the draft anchors hash the findings were made on. */
  labelsHash: hash.optional(),
  anchorsHash: hash.optional(),
  finishedAt: timestamp.optional(),
  attempts: z.int().nonnegative().optional(),
  metrics: z.record(z.string().regex(/^[a-z][A-Za-z]{0,39}$/), z.int().nonnegative()).optional(),
  pausedUntil: timestamp.optional(),
  reason: code.optional(),
  packetId: token.optional(),
  agentRun: token.optional(),
  model: token.optional(),
  acceptedAt: timestamp.optional(),
  /** Agent stages, issuer record: the subagent's run time and tokens from its completion notice (accept
   * --duration-ms, --tokens), for the cost report (tokens per card = tokens / packet cards). */
  durationMs: z.int().nonnegative().optional(),
  tokens: z.int().nonnegative().optional(),
  /** Build: the catalog version built, and `true` for a proposed build (`run build --proposed`), which ships nothing. */
  catalogVersion: z.string().regex(CATALOG_VERSION).optional(),
  proposed: z.literal(true).optional(),
  /** Research of a batch seeded from a freshness record: no researcher agent ran (`init --refresh-from-freshness`). */
  provenance: z.literal('seeded').optional(),
});
export type StageRecord = z.infer<typeof stageRecordSchema>;

export const cardStateSchema = z.strictObject({
  stages: z.partialRecord(z.enum(CARD_STAGES), stageRecordSchema),
  dropped: code.nullable(),
  heldOut: code.nullable(),
});
export type CardState = z.infer<typeof cardStateSchema>;

/** Reason codes for accepting a flagged capture (`pipeline resolve capture-flagged`); codes, never text. */
export const CAPTURE_FLAG_REASONS = [
  'expected-short-page',
  'false-positive-flag',
  'keep-existing-capture',
] as const;

/** Reason codes for removing a source from a batch (`pipeline drop-source`); codes, never text. */
export const DROP_SOURCE_REASONS = ['bot-wall', 'error-page', 'out-of-scope', 'duplicate'] as const;

export const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batch: z.string().regex(BATCH_ID),
  updatedAt: timestamp,
  cards: z.record(id, cardStateSchema),
  issuers: z.record(
    id,
    z.strictObject({ stages: z.partialRecord(z.enum(ISSUER_STAGES), stageRecordSchema) }),
  ),
  batchStages: z.partialRecord(z.enum(BATCH_STAGES), stageRecordSchema),
  /** Capture flags accepted by the session, per source: valid while the manifest hash is still `sha256`. */
  resolvedFlags: z
    .record(id, z.strictObject({ reason: z.enum(CAPTURE_FLAG_REASONS), sha256: hex, resolvedAt: timestamp }))
    .optional(),
  /** Sources removed from the batch by `pipeline drop-source`, with a reason code; their captures are in
   * captures-dropped/. */
  droppedSources: z
    .record(id, z.strictObject({ reason: z.enum(DROP_SOURCE_REASONS), droppedAt: timestamp }))
    .optional(),
});
export type State = z.infer<typeof stateSchema>;

export function initialState(batch: string, issuerSlugs: string[], now: Date): State {
  return stateSchema.parse({
    schemaVersion: 1,
    batch,
    updatedAt: now.toISOString(),
    cards: {},
    issuers: Object.fromEntries(
      issuerSlugs.map((slug) => [slug, { stages: { research: { status: 'pending' } } }]),
    ),
    batchStages: { build: { status: 'pending' }, eval: { status: 'pending' } },
  });
}

export function emptyCardState(): CardState {
  return { stages: { freshness: { status: 'pending' } }, dropped: null, heldOut: null };
}

export async function readState(path: string): Promise<State> {
  return stateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

/** Validates, then writes through a temporary file renamed into place. */
export async function writeState(path: string, state: State, now: Date): Promise<void> {
  const parsed = stateSchema.parse({ ...state, updatedAt: now.toISOString() });
  await writeJsonAtomic(path, parsed);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}
