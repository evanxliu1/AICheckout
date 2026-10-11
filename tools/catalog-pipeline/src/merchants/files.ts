// Files of the merchant pipeline (Phase 14.3, wiki/product/phase-14-merchant-database.md section 6): the frozen
// candidate list, a tier-B batch (batch.json, text-free state.json, research, drafts, verification, apply report) and
// the record, evidence and release files under evals/merchants/db/. Every pipeline file is a strict Zod object, so a
// model cannot smuggle a value into a field the stage does not own.
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  merchantHostSchema,
  merchantRecordSchema,
  merchantSourceSchema,
} from '../../../../packages/rewards-core/src/merchant-release.ts';
import {
  MERCHANT_CATEGORIES_V3,
  MERCHANT_KINDS,
  MERCHANT_SOURCE_KINDS,
} from '../../../../packages/rewards-core/src/types.ts';
import { SLUG, TOKEN, writeJsonAtomic } from '../state.ts';

export const DB_DIR = 'evals/merchants/db';
export const BATCHES_DIR = `${DB_DIR}/batches`;
export const CANDIDATES_FILE = `${DB_DIR}/candidates.json`;
export const GROUPS_FILE = `${DB_DIR}/candidate-groups.json`;
export const HELDOUT_FILE = 'evals/merchants/pipeline-heldout-domains.json';
export const FRAME_FILE = 'evals/merchants/retail-frame-3.json';
export const RECORDS_DIR = `${DB_DIR}/records`;
export const EVIDENCE_DIR = `${DB_DIR}/evidence`;
export const RELEASE_CONFIG = `${DB_DIR}/release-config.json`;
export const REVIEW_FILE = `${DB_DIR}/review.md`;
export const TIER_A_MANIFEST = `${DB_DIR}/tier-a-manifest.json`;
export const PROMPT_FILE = 'tools/catalog-pipeline/src/merchants/prompts/merchant-draft.2.md';
export const PROMPT_VERSION = 'merchant-draft.2';
export const RESEARCHER_AGENT = '.claude/agents/merchant-researcher.md';
export const VERIFIER_AGENT = '.claude/agents/merchant-verifier.md';
export const MERCHANT_AGENTS = { research: 'merchant-researcher', verify: 'merchant-verifier' } as const;
export const MERCHANT_AGENT_STAGES = ['research', 'verify'] as const;
export type MerchantAgentStage = (typeof MERCHANT_AGENT_STAGES)[number];
export const MERCHANT_CLI_STAGES = ['capture', 'draft', 'apply', 'build'] as const;
export type MerchantCliStage = (typeof MERCHANT_CLI_STAGES)[number];
export const MERCHANT_STAGES = ['research', 'capture', 'draft', 'verify', 'apply', 'build'] as const;
export type MerchantStage = (typeof MERCHANT_STAGES)[number];
/** Stores per tier-B packet (plan section 6). */
export const PACKET_SIZE = 25;
export const MAX_QUOTE_WORDS = 25;
export const BATCH_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slug = z.string().regex(SLUG).max(120);
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.iso.datetime();
const token = z.string().regex(TOKEN);
export const domainSchema = merchantHostSchema;
/** Own words, short. */
const note = z.string().max(300);

export const TIERS = ['A', 'B'] as const;
export const GROUPS = [
  'catalog-brands',
  'supermarkets',
  'dining',
  'drugstores',
  'streaming',
  'entertainment',
  'home-improvement',
  'wholesale-clubs',
  'department-stores',
  'electronics',
  'transit',
  'processors',
  'legacy',
  'top-stores',
  'held-out-only',
] as const;
export type Group = (typeof GROUPS)[number];

export const candidateSchema = z.strictObject({
  domain: domainSchema,
  tier: z.enum(TIERS),
  groups: z.array(z.enum(GROUPS)).min(1),
  /** Record id when fixed in advance (legacy stores and processors keep the seed's ids). */
  id: slug.optional(),
  /** Every host of the record (processors with several checkout hosts); the domain is the first. */
  hosts: z.array(domainSchema).min(1).optional(),
  /** Catalog brands whose official store this is, for the brand gate and the review table; never shown to a model. */
  brandIds: z.array(slug).optional(),
  /** On the frozen merchant-pipeline-heldout.1 list: the blind audit set; never a dry-run store. */
  heldOut: z.boolean(),
  /** Tier A: the frame band; `moved-to-b` when the brand-name gate moved it. */
  band: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const candidatesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  list: z.literal('merchant-candidates.1'),
  frozenOn: z.iso.date(),
  heldOutList: z.string(),
  sources: z.array(z.strictObject({ file: z.string(), sha256: hex, contributes: z.string().max(200) })),
  counts: z.strictObject({
    total: z.int(),
    tierA: z.int(),
    tierB: z.int(),
    heldOut: z.int(),
    movedToB: z.int(),
    groups: z.record(z.enum(GROUPS), z.int()),
  }),
  candidates: z.array(candidateSchema).min(1),
});
export type CandidatesFile = z.infer<typeof candidatesFileSchema>;

export const batchFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batch: z.string().regex(BATCH_ID),
  createdAt: timestamp,
  /** Development run: the plan's 10-store dry run, excluded from the audit. */
  development: z.boolean(),
  stores: z.array(
    z.strictObject({
      domain: domainSchema,
      groups: z.array(z.enum(GROUPS)).min(1),
      id: slug.optional(),
      hosts: z.array(domainSchema).min(1).optional(),
    }),
  ),
});
export type BatchFile = z.infer<typeof batchFileSchema>;

const stageRecordSchema = z.strictObject({
  status: z.enum(['pending', 'done', 'failed-gate', 'stale']),
  finishedAt: timestamp.optional(),
  attempts: z.int().nonnegative().optional(),
  packetId: token.optional(),
  agentRun: token.optional(),
  model: token.optional(),
  acceptedAt: timestamp.optional(),
  durationMs: z.int().nonnegative().optional(),
  tokens: z.int().nonnegative().optional(),
  /** The prompt file's hash (draft) or the agent file's hash (research, verify) the stage ran with. */
  inputSha256: hex.optional(),
});
export type StageRecord = z.infer<typeof stageRecordSchema>;
const storeStateSchema = z.strictObject({
  draft: z
    .strictObject({
      status: z.enum(['done', 'failed-gate', 'provider-error', 'timeout']),
      inputTokens: z.int().nonnegative(),
      outputTokens: z.int().nonnegative(),
      durationMs: z.int().nonnegative(),
      finishedAt: timestamp,
    })
    .optional(),
  apply: z.enum(['record', 'held-out']).optional(),
  heldOutFields: z.array(z.string().regex(/^[a-zA-Z]+$/)).optional(),
});
export const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batch: z.string().regex(BATCH_ID),
  updatedAt: timestamp,
  stages: z.record(z.enum(MERCHANT_STAGES), stageRecordSchema),
  stores: z.record(domainSchema, storeStateSchema),
});
export type State = z.infer<typeof stateSchema>;

/** The researcher's file: one per packet, URLs and names only. Strict objects: no category, kind, goods flag, brand
 * or merchant code can appear anywhere. */
const urlSchema = z.url({ protocol: /^https$/ }).max(500);
export const researchStoreSchema = z.strictObject({
  domain: domainSchema,
  name: merchantRecordSchema.shape.name,
  hosts: z.array(domainSchema).min(1).max(20),
  /** The store's own pages that show what it sells and how it describes itself (about, FAQ, store locator). */
  storePages: z
    .array(z.strictObject({ url: urlSchema, note: note.nullable() }))
    .min(1)
    .max(3),
  /** Public merchant-code lookup pages naming this store; empty when none was found or a site's terms forbid it. */
  lookupPages: z.array(z.strictObject({ url: urlSchema, note: note.nullable() })).max(3),
  notes: note.nullable(),
});
export const researchFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packetId: z.uuid(),
  batch: z.string().regex(BATCH_ID),
  researchedOn: z.iso.date(),
  provenance: z.strictObject({
    generatedBy: z.literal('merchant-researcher'),
    model: token,
    date: z.iso.date(),
    status: z.literal('agent-research-unverified'),
  }),
  stores: z.array(researchStoreSchema).min(1),
  questions: z.array(note).max(20),
});
export type ResearchFile = z.infer<typeof researchFileSchema>;

/** sources.json and manifest.json of a batch (the capture script's shapes, plus the store domain). */
export const sourceEntrySchema = z.strictObject({
  id: slug,
  domain: domainSchema,
  kind: z.enum(MERCHANT_SOURCE_KINDS),
  url: urlSchema,
  /** Issuer sources: the catalog manifest the capture was copied from, for the record. */
  from: z.string().max(200).optional(),
});
export const sourcesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sources: z.array(sourceEntrySchema),
});
export const manifestEntrySchema = sourceEntrySchema.extend({
  capturedOn: z.iso.date(),
  sha256: hex,
  length: z.int().nonnegative(),
});
export const manifestFileSchema = z.looseObject({ sources: z.array(manifestEntrySchema) });
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/** `definition` (prompt 2): an issuer's published definition of a category, quoted from its own page. */
export const DRAFT_SUPPORTS = ['kind', 'physicalGoods', 'brand', 'category', 'definition'] as const;
/** What luna returns per store (the Codex output schema is `draftJsonSchema`). The model never sets `category`;
 * it proposes `candidateCategory` and apply decides from the evidence rule. */
export const draftSchema = z.strictObject({
  domain: domainSchema,
  kind: z.enum(MERCHANT_KINDS),
  physicalGoods: z.boolean(),
  brandIds: z.array(slug).max(20),
  candidateCategory: z.enum(MERCHANT_CATEGORIES_V3).nullable(),
  evidence: z
    .array(
      z.strictObject({
        sourceId: slug,
        quote: z.string().min(1).max(400),
        supports: z.enum(DRAFT_SUPPORTS),
      }),
    )
    .max(16),
  notes: z.string().max(600).nullable(),
});
export type Draft = z.infer<typeof draftSchema>;
export const draftFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batch: z.string().regex(BATCH_ID),
  promptVersion: z.literal(PROMPT_VERSION),
  promptSha256: hex,
  model: token,
  effort: z.string().regex(/^[a-z]+$/),
  draftedOn: z.iso.date(),
  usage: z.strictObject({ inputTokens: z.int().nonnegative(), outputTokens: z.int().nonnegative() }),
  durationMs: z.int().nonnegative(),
  draft: draftSchema,
});
export type DraftFile = z.infer<typeof draftFileSchema>;
export const draftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'kind', 'physicalGoods', 'brandIds', 'candidateCategory', 'evidence', 'notes'],
  properties: {
    domain: { type: 'string' },
    kind: { type: 'string', enum: [...MERCHANT_KINDS] },
    physicalGoods: { type: 'boolean' },
    brandIds: { type: 'array', items: { type: 'string' } },
    candidateCategory: { type: ['string', 'null'], enum: [...MERCHANT_CATEGORIES_V3, null] },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceId', 'quote', 'supports'],
        properties: {
          sourceId: { type: 'string' },
          quote: { type: 'string' },
          supports: { type: 'string', enum: [...DRAFT_SUPPORTS] },
        },
      },
    },
    notes: { type: ['string', 'null'] },
  },
};

export const VERIFIED_FIELDS = [
  'name',
  'hosts',
  'kind',
  'physicalGoods',
  'brandIds',
  'candidateCategory',
  'evidence',
] as const;
export type VerifiedField = (typeof VERIFIED_FIELDS)[number];
const verdictSchema = z.strictObject({
  verdict: z.enum(['confirmed', 'disputed']),
  /** Required for `disputed`: the verifier's own words. */
  reason: note.nullable(),
});
/** One verdict per drafted evidence quote, in the draft's order (review 2026-10-11): apply uses confirmed quotes only,
 * so one bad quote no longer spoils a record whose other quotes satisfy the rule. */
export const quoteVerdictSchema = verdictSchema.extend({ index: z.int().nonnegative() });
export const verificationFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packetId: z.uuid(),
  batch: z.string().regex(BATCH_ID),
  provenance: z.literal('agent-verified'),
  verifier: z.strictObject({
    agent: z.literal('merchant-verifier'),
    model: token,
    date: z.iso.date(),
    filesRead: z.array(z.string().max(500)).min(1),
  }),
  stores: z
    .array(
      z.strictObject({
        domain: domainSchema,
        fields: z.strictObject(
          Object.fromEntries(VERIFIED_FIELDS.map((field) => [field, verdictSchema])) as Record<
            VerifiedField,
            typeof verdictSchema
          >,
        ),
        /** Per-quote verdicts; `fields.evidence` is their summary (disputed when any quote is). */
        quotes: z.array(quoteVerdictSchema),
      }),
    )
    .min(1),
});
export type VerificationFile = z.infer<typeof verificationFileSchema>;

export const packetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packetId: z.uuid(),
  batch: z.string().regex(BATCH_ID),
  stage: z.enum(MERCHANT_AGENT_STAGES),
  n: z.int().positive(),
  agent: z.string(),
  domains: z.array(domainSchema).min(1),
  inputs: z.array(z.string().min(1)),
  output: z.string().min(1),
  claimedAt: timestamp,
  status: z.enum(['open', 'accepted', 'released']),
  closedAt: timestamp.optional(),
  outputSha256AtClaim: hex.nullable(),
  inputSha256: z.record(z.string(), hex),
  attempts: z.array(z.strictObject({ at: timestamp, result: z.enum(['failed-gate', 'accepted']) })),
});
export type Packet = z.infer<typeof packetSchema>;

/** The committed evidence beside a record: every quote apply used, 25 words or fewer, with its source. */
export const evidenceFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slug,
  batch: z.string().regex(BATCH_ID),
  appliedOn: z.iso.date(),
  basis: merchantRecordSchema.shape.evidence.shape.basis,
  quotes: z.array(
    z.strictObject({
      sourceId: slug,
      kind: z.enum(MERCHANT_SOURCE_KINDS),
      supports: z.enum(DRAFT_SUPPORTS),
      quote: z.string().max(400),
    }),
  ),
});
export type EvidenceFile = z.infer<typeof evidenceFileSchema>;

export const applyReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batch: z.string().regex(BATCH_ID),
  appliedOn: z.iso.date(),
  records: z.array(
    z.strictObject({
      domain: domainSchema,
      id: slug,
      basis: z.string(),
      category: z.string(),
      /** The verifier disputed `evidence` alone: shipped on the default category, listed for Evan. */
      downgraded: z.strictObject({ reason: note.nullable() }).optional(),
      /** A drafted candidate the evidence rule refused, with the rule's reason and the drafter's notes. */
      refused: z
        .strictObject({
          candidate: z.string(),
          reason: z.string().max(300),
          notes: z.string().max(600).nullable(),
        })
        .optional(),
    }),
  ),
  heldOut: z.array(
    z.strictObject({
      domain: domainSchema,
      disputed: z.array(z.strictObject({ field: z.string(), reason: note.nullable() })),
    }),
  ),
});
export type ApplyReport = z.infer<typeof applyReportSchema>;

export const releaseConfigSchema = z.strictObject({
  description: z.string(),
  version: z.string(),
  verifiedAt: timestamp,
  sources: z.array(merchantSourceSchema),
});
export type ReleaseConfig = z.infer<typeof releaseConfigSchema>;

export const batchDir = (root: string, batch: string): string => join(root, BATCHES_DIR, batch);
export const statePath = (dir: string): string => join(dir, 'state.json');

export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path, 'utf8')));
}
export async function readJsonOrNull<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const text = await readFile(path, 'utf8').catch(() => null);
  return text === null ? null : schema.parse(JSON.parse(text));
}

export function initialState(batch: string, now: Date): State {
  return {
    schemaVersion: 1,
    batch,
    updatedAt: now.toISOString(),
    stages: Object.fromEntries(
      MERCHANT_STAGES.map((stage) => [stage, { status: 'pending' }]),
    ) as State['stages'],
    stores: {},
  };
}

export async function readState(dir: string): Promise<State> {
  return readJson(statePath(dir), stateSchema);
}

export async function writeState(dir: string, state: State, now: Date): Promise<void> {
  await writeJsonAtomic(statePath(dir), stateSchema.parse({ ...state, updatedAt: now.toISOString() }));
}

export interface Batch {
  root: string;
  id: string;
  dir: string;
  meta: BatchFile;
  state: State;
}

export async function loadBatch(root: string, id: string): Promise<Batch> {
  const dir = batchDir(root, id);
  const meta = await readJson(join(dir, 'batch.json'), batchFileSchema);
  const state = await readState(dir);
  return { root, id, dir, meta, state };
}

export async function listBatches(root: string): Promise<string[]> {
  await mkdir(join(root, BATCHES_DIR), { recursive: true });
  const names = await readdir(join(root, BATCHES_DIR));
  const out: string[] = [];
  for (const name of names)
    if (await readFile(join(root, BATCHES_DIR, name, 'batch.json'), 'utf8').catch(() => null)) out.push(name);
  return out.sort();
}

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Whitespace-insensitive verbatim search: the quote's words must appear in order, separated by whitespace. */
export function quoteIn(quote: string, capture: string): boolean {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(pattern).test(capture);
}
