// What each stage reads, as hashed input references (wiki/system/card-expansion-pipeline.md, "Inputs hashed").
import { join } from 'node:path';
import { CURATION_DEFAULTS } from '../../../apps/api/src/curation/curation-model.ts';
import {
  ABSENT_SHA256,
  anchorsHash,
  fileSha256,
  isAnchorPath,
  jsonSha256,
  labelsHash,
  splitAnchors,
} from './hash.ts';
import type { InputRef } from './hash.ts';
import { issuerSlugOf } from './files.ts';
import type { Batch, CardEntry, FindingsCard } from './files.ts';
import type { Stage } from './state.ts';

/** Bumped by hand when a stage's output changes for the same inputs. */
export const STAGE_VERSIONS: Record<Stage, string> = {
  research: 'research.1',
  capture: 'capture.1',
  extract: 'extract.1',
  draft: 'draft.1',
  verify: 'verify.1',
  adjudicate: 'adjudicate.1',
  apply: 'apply.1',
  overlay: 'overlay.1',
  build: 'build.1',
  eval: 'eval.1',
};

/** The extraction configuration `scripts/extract-cards.mjs` uses by default (its `sameConfiguration` keys + limits). */
export const EXTRACT_CONFIG = {
  provider: 'codex',
  model: CURATION_DEFAULTS.model,
  effort: CURATION_DEFAULTS.effort,
  prompt: CURATION_DEFAULTS.prompt,
  selection: CURATION_DEFAULTS.selection,
  outputTokens: CURATION_DEFAULTS.codexOutputTokens,
  limits: {
    attemptTimeoutMs: CURATION_DEFAULTS.attemptTimeoutMs,
    totalTimeoutMs: CURATION_DEFAULTS.totalTimeoutMs,
    maxInputTokens: 64_000,
    maxOutputTokens: 8192,
  },
} as const;

export const RESEARCHER_AGENT = '.claude/agents/card-researcher.md';
export const VERIFIER_BRIEF = 'evals/curation/expansion/verification/README.md';
export const DRAFT_SCRIPT = 'scripts/draft-expansion-labels.mjs';

export interface StageInputs {
  stageVersion: string;
  config: unknown;
  inputs: InputRef[];
  /** Gitignored inputs that are hashed but absent here: the hash cannot be computed. */
  missingHashed: string[];
  /** Gitignored inputs the stage reads to run (captures) that are absent here. */
  missingToRun: string[];
}

/** Null when an upstream output the stage needs is not in the batch files yet. */
export type MaybeInputs = StageInputs | null;

const strip = (hash: string): string => hash.replace(/^sha256:/, '');
const hashed = (hash: string | null): string => hash ?? ABSENT_SHA256;

/** The card's findings with adjudication removed and anchor-path `current` values dropped: what the verifier wrote,
 * invariant under the mechanical anchor rebase. */
export function verifierFindings(card: FindingsCard): unknown {
  const copy = JSON.parse(JSON.stringify(card)) as Record<string, unknown>;
  delete copy.verdictAdjudication;
  const scrub = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(scrub);
    else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      delete record.adjudication;
      if (typeof record.path === 'string' && isAnchorPath(record.path)) delete record.current;
      Object.values(record).forEach(scrub);
    }
  };
  scrub(copy);
  return copy;
}

async function conventionRefs(batch: Batch, issuerSlug: string): Promise<InputRef[]> {
  const dir = join(batch.dir, 'verification', 'conventions');
  return [
    { ref: 'convention:general.md', sha256: hashed(await fileSha256(join(dir, 'general.md'))) },
    { ref: `convention:${issuerSlug}.md`, sha256: hashed(await fileSha256(join(dir, `${issuerSlug}.md`))) },
  ];
}

const captureMissing = async (batch: Batch, card: CardEntry): Promise<string[]> => {
  const missing: string[] = [];
  for (const sourceId of card.sourceIds)
    if (batch.manifest.has(sourceId) && !(await fileSha256(join(batch.dir, 'captures', `${sourceId}.txt`))))
      missing.push(`captures/${sourceId}.txt`);
  return missing;
};

export async function researchInputs(batch: Batch, issuerSlug: string): Promise<StageInputs> {
  const issuer = batch.meta.issuers.find((entry) => entry.slug === issuerSlug) ?? null;
  return {
    stageVersion: STAGE_VERSIONS.research,
    config: {},
    inputs: [
      {
        ref: `request:${issuerSlug}`,
        sha256: jsonSha256({
          issuer,
          requestedCards: batch.meta.requestedCards,
          refresh: batch.meta.refresh,
        }),
      },
      {
        ref: `agent:${RESEARCHER_AGENT}`,
        sha256: hashed(await fileSha256(join(batch.root, RESEARCHER_AGENT))),
      },
    ],
    missingHashed: [],
    missingToRun: [],
  };
}

export async function cardInputs(batch: Batch, stage: Stage, card: CardEntry): Promise<MaybeInputs> {
  const base = {
    stageVersion: STAGE_VERSIONS[stage],
    missingHashed: [] as string[],
    missingToRun: [] as string[],
  };
  const issuerSlug = issuerSlugOf(batch, card.issuer);
  const manifestRefs = card.sourceIds.flatMap((sourceId) => {
    const entry = batch.manifest.get(sourceId);
    return entry ? [{ ref: `manifest:${sourceId}`, sha256: entry.sha256 }] : [];
  });
  switch (stage) {
    case 'capture': {
      const inputs: InputRef[] = [];
      for (const sourceId of card.sourceIds) {
        const source = batch.sources.get(sourceId);
        inputs.push({
          ref: `source:${sourceId}`,
          sha256: source ? jsonSha256({ id: source.id, url: source.url, kind: source.kind }) : ABSENT_SHA256,
        });
        if (sourceId in batch.hints)
          inputs.push({ ref: `hint:${sourceId}`, sha256: jsonSha256(batch.hints[sourceId]) });
      }
      return { ...base, config: {}, inputs };
    }
    case 'extract':
      return {
        ...base,
        config: EXTRACT_CONFIG,
        inputs: manifestRefs,
        missingToRun: await captureMissing(batch, card),
      };
    case 'draft': {
      const trace = await fileSha256(join(batch.dir, 'extractions', `${card.id}.json`));
      const inputs: InputRef[] = [
        ...manifestRefs,
        { ref: `script:${DRAFT_SCRIPT}`, sha256: hashed(await fileSha256(join(batch.root, DRAFT_SCRIPT))) },
      ];
      if (card.research)
        inputs.push({
          ref: `research:${card.research}`,
          sha256: hashed(await fileSha256(join(batch.root, card.research))),
        });
      if (trace) inputs.push({ ref: `trace:${card.id}`, sha256: trace });
      return {
        ...base,
        config: {},
        inputs,
        missingHashed: trace ? [] : [`extractions/${card.id}.json`],
        missingToRun: await captureMissing(batch, card),
      };
    }
    case 'verify': {
      const draft = batch.draft.get(card.id);
      if (!draft) return null;
      return {
        ...base,
        config: {},
        inputs: [
          { ref: `draft-labels:${card.id}`, sha256: strip(labelsHash(draft)) },
          {
            ref: `note-labels:${card.id}`,
            sha256: jsonSha256(splitAnchors(batch.notes.get(card.id) ?? null).labels),
          },
          {
            ref: `brief:${VERIFIER_BRIEF}`,
            sha256: hashed(await fileSha256(join(batch.root, VERIFIER_BRIEF))),
          },
        ],
      };
    }
    case 'adjudicate': {
      const findings = batch.findings.get(card.id);
      if (!findings) return null;
      return {
        ...base,
        config: {},
        inputs: [
          { ref: `findings:${card.id}`, sha256: jsonSha256(verifierFindings(findings.card)) },
          ...(await conventionRefs(batch, issuerSlug)),
        ],
      };
    }
    case 'apply': {
      const draft = batch.draft.get(card.id);
      const findings = batch.findings.get(card.id);
      if (!draft || !findings) return null;
      return {
        ...base,
        config: { version: `${batch.id}.v1` },
        inputs: [
          { ref: `draft-case:${card.id}`, sha256: jsonSha256(draft) },
          { ref: `findings-adjudicated:${card.id}`, sha256: jsonSha256(findings.card) },
          // The adjudicator's label-lint acks of the card (only when there are any, so other hashes stay as they were).
          ...(findings.acks.length
            ? [{ ref: `lint-acks:${card.id}`, sha256: jsonSha256(findings.acks) }]
            : []),
        ],
      };
    }
    case 'overlay': {
      const corpusCase = batch.corpus.get(card.id);
      if (!corpusCase) return null;
      return {
        ...base,
        config: {},
        inputs: [
          { ref: `corpus-labels:${card.id}`, sha256: strip(labelsHash(corpusCase)) },
          ...(await conventionRefs(batch, issuerSlug)),
          {
            ref: 'programs:reward-programs.json',
            sha256: hashed(await fileSha256(join(batch.dir, 'reward-programs.json'))),
          },
        ],
      };
    }
    default:
      throw new Error(`${stage} is not a per-card stage with inputs.`);
  }
}

/** Build and eval: every active card's corpus case and overlay entry, the batch's merchants and programs. */
export async function batchInputs(
  batch: Batch,
  stage: 'build' | 'eval',
  cardIds: string[],
): Promise<StageInputs> {
  const inputs: InputRef[] = [];
  for (const cardId of cardIds) {
    inputs.push({ ref: `corpus:${cardId}`, sha256: jsonSha256(batch.corpus.get(cardId) ?? null) });
    inputs.push({ ref: `overlay:${cardId}`, sha256: jsonSha256(batch.overlay.get(cardId) ?? null) });
  }
  for (const name of ['merchants.json', 'reward-programs.json'])
    inputs.push({ ref: `file:${name}`, sha256: hashed(await fileSha256(join(batch.dir, name))) });
  return { stageVersion: STAGE_VERSIONS[stage], config: {}, inputs, missingHashed: [], missingToRun: [] };
}

/** The draft case's current labels and anchors hashes, or null without a draft case. */
export function draftSplit(batch: Batch, cardId: string): { labelsHash: string; anchorsHash: string } | null {
  const draft = batch.draft.get(cardId);
  return draft ? { labelsHash: labelsHash(draft), anchorsHash: anchorsHash(draft) } : null;
}
