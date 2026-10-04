// Status derivation, the derived queue and `next` (wiki/system/card-expansion-pipeline.md, "Derived queue").
// Nothing here writes: statuses are computed from state.json, the batch files and the input hashes each time.
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { BATCHES_CONFIG_PATH } from '../../../scripts/lib/catalog-batches.mjs';
import { inputHash } from './hash.ts';
import { batchInputs, cardInputs, draftSplit, researchInputs } from './inputs.ts';
import type { MaybeInputs } from './inputs.ts';
import { issuerSlugOf } from './files.ts';
import type { Batch } from './files.ts';
import { CARD_STAGES, emptyCardState } from './state.ts';
import type { CardStage, StageRecord, Status } from './state.ts';

export interface Derived {
  status: Status;
  /** The input hash computed now (absent when it cannot be computed). */
  inputHash?: string;
  /** False while an upstream stage is not done: the stage cannot run yet. */
  ready: boolean;
  /** Stale because an upstream stage is, not because this stage's own inputs changed. */
  propagated?: boolean;
  /** Stale, but a gitignored input the stage runs with (a capture) is not on this machine. */
  inputsMissing?: boolean;
  record?: StageRecord;
}

export interface CardView {
  cardId: string;
  issuer: string;
  stages: Record<CardStage, Derived>;
  /** Draft anchors moved under unchanged labels since verification: `rebase-anchors` re-points the findings. */
  rebaseAnchors: boolean;
}

export const QUEUE_CODES = [
  'capture-flagged',
  'gate-failed',
  'needs-reverify',
  'convention-needed',
  'scope-question',
  'publish',
] as const;
export type QueueCode = (typeof QUEUE_CODES)[number];
export interface QueueItem {
  batch: string;
  cardId?: string;
  issuer?: string;
  stage: string;
  code: QueueCode;
  ref: string;
  owner: string;
}

export interface BatchView {
  batch: Batch;
  research: Record<string, Derived>;
  cards: CardView[];
  build: Derived;
  eval: Derived;
  queue: QueueItem[];
  /** The build config's version when it is published (a plain `run build` would refuse), else null. */
  publishedConfigVersion: string | null;
  /** The version `next` suggests for a proposed build while the config's version is published. */
  suggestedVersion: string;
}

export const AGENTS: Record<string, string> = {
  research: 'card-researcher',
  verify: 'card-verifier',
  adjudicate: 'card-adjudicator',
  overlay: 'card-overlay-author',
};

/** One stage's status from its record, its inputs now, and its upstream stage. */
export function deriveStage(
  record: StageRecord | undefined,
  stage: string,
  inputs: MaybeInputs,
  upstream: Derived | null,
  now: Date,
): Derived {
  const done = record?.status === 'done';
  if (record?.status === 'dropped') return { status: 'dropped', ready: false, record };
  if (upstream && upstream.status !== 'done') {
    // Staleness propagates down; a stage waiting on upstream is pending. Upstream inputs missing on this
    // machine does not by itself invalidate a downstream stage that is done.
    if (upstream.status !== 'inputs-missing' || !done)
      return { status: done ? 'stale' : 'pending', ready: false, propagated: done, record };
  }
  if (!inputs) return { status: done ? 'stale' : 'pending', ready: true, record };
  if (inputs.missingHashed.length) return { status: 'inputs-missing', ready: true, record };
  const hash = inputHash(stage, inputs.stageVersion, inputs.config, inputs.inputs);
  // A computable hash that differs is `stale` even without the captures, so staleness shows (and propagates) in
  // every checkout; `inputs-missing` is for stages that would otherwise run.
  const missing = inputs.missingToRun.length > 0;
  const runnable = (status: Status): Derived =>
    status === 'stale'
      ? { status, inputHash: hash, ready: true, record, ...(missing ? { inputsMissing: true } : {}) }
      : { status: missing ? 'inputs-missing' : status, inputHash: hash, ready: true, record };
  switch (record?.status) {
    case 'done':
      return record.inputHash === hash
        ? { status: 'done', inputHash: hash, ready: true, record }
        : runnable('stale');
    case 'failed-gate':
      return record.inputHash === hash ? runnable('failed-gate') : runnable('stale');
    case 'paused':
      if (record.pausedUntil && new Date(record.pausedUntil) > now)
        return { status: 'paused', inputHash: hash, ready: true, record };
      return runnable('pending');
    case 'stale':
      return runnable('stale');
    default:
      return runnable('pending');
  }
}

const upstreamOf = (stages: Partial<Record<CardStage, Derived>>, stage: CardStage): Derived | undefined => {
  const index = CARD_STAGES.indexOf(stage);
  return index > 0 ? stages[CARD_STAGES[index - 1]] : undefined;
};

export async function deriveBatch(batch: Batch, now: Date): Promise<BatchView> {
  const research: Record<string, Derived> = {};
  for (const issuer of batch.meta.issuers) {
    const record = batch.state.issuers[issuer.slug]?.stages.research;
    research[issuer.slug] = deriveStage(
      record,
      'research',
      await researchInputs(batch, issuer.slug),
      null,
      now,
    );
  }

  const cards: CardView[] = [];
  for (const card of batch.cards) {
    const cardState = batch.state.cards[card.id] ?? emptyCardState();
    const issuer = issuerSlugOf(batch, card.issuer);
    const stages: Partial<Record<CardStage, Derived>> = {};
    for (const stage of CARD_STAGES) {
      const record = cardState.stages[stage];
      if (cardState.dropped) stages[stage] = { status: 'dropped', ready: false, record };
      else if (stage === 'freshness') stages[stage] = { status: 'pending', ready: false, record };
      else {
        let upstream =
          stage === 'capture'
            ? (research[issuer] ?? { status: 'pending', ready: false })
            : upstreamOf(stages, stage)!;
        // Overlay hashes the corpus labels itself: an apply that is stale only because the draft anchors moved
        // (its own inputs changed, nothing upstream of it) does not make the overlay stale.
        if (stage === 'overlay' && upstream.status === 'stale' && !upstream.propagated)
          upstream = { status: 'done', ready: true };
        stages[stage] = deriveStage(record, stage, await cardInputs(batch, stage, card), upstream, now);
      }
    }
    const verify = stages.verify!;
    const split = draftSplit(batch, card.id);
    const rebaseAnchors =
      verify.status === 'done' &&
      !!split &&
      !!verify.record?.anchorsHash &&
      verify.record.anchorsHash !== split.anchorsHash;
    cards.push({ cardId: card.id, issuer, stages: stages as Record<CardStage, Derived>, rebaseAnchors });
  }

  const active = cards.filter(
    (card) => !batch.state.cards[card.cardId]?.dropped && !batch.state.cards[card.cardId]?.heldOut,
  );
  const anyStale = cards.some((card) => Object.values(card.stages).some((stage) => stage.status === 'stale'));
  const allOverlaid = active.length > 0 && active.every((card) => card.stages.overlay.status === 'done');
  const buildUpstream: Derived = anyStale
    ? { status: 'stale', ready: false }
    : { status: allOverlaid ? 'done' : 'pending', ready: allOverlaid };
  const activeIds = active.map((card) => card.cardId);
  const build = deriveStage(
    batch.state.batchStages.build,
    'build',
    allOverlaid ? await batchInputs(batch, 'build', activeIds) : null,
    buildUpstream,
    now,
  );
  const evalStage = deriveStage(
    batch.state.batchStages.eval,
    'eval',
    build.status === 'done' ? await batchInputs(batch, 'eval', activeIds) : null,
    build,
    now,
  );
  const view: BatchView = {
    batch,
    research,
    cards,
    build,
    eval: evalStage,
    queue: [],
    publishedConfigVersion: await publishedConfigVersion(batch.root),
    suggestedVersion: suggestedVersion(batch.id, now),
  };
  view.queue = deriveQueue(view);
  return view;
}

/** The committed build config's version if it is in `publishedVersions` (null without a readable config). */
async function publishedConfigVersion(root: string): Promise<string | null> {
  try {
    const config = JSON.parse(await readFile(join(root, BATCHES_CONFIG_PATH), 'utf8')) as {
      version?: string;
      publishedVersions?: string[];
    };
    return config.version && config.publishedVersions?.includes(config.version) ? config.version : null;
  } catch {
    return null;
  }
}

/** A suggested new catalog version for a batch: `<today>.<batch without its month>.1`, e.g. 2026-10-04.wells-fargo.1. */
export const suggestedVersion = (batchId: string, now: Date): string =>
  `${now.toISOString().slice(0, 10)}.${batchId.replace(/-\d{4}-\d{2}$/, '')}.1`;

function deriveQueue(view: BatchView): QueueItem[] {
  const { batch } = view;
  const items: QueueItem[] = [];
  const statePath = `${batch.rel}/pipeline/state.json`;
  const reasonItem = (record: StageRecord | undefined, base: Omit<QueueItem, 'code' | 'owner' | 'ref'>) => {
    if (record?.reason === 'convention-needed')
      items.push({
        ...base,
        code: 'convention-needed',
        ref: `${batch.rel}/verification/conventions`,
        owner: 'session',
      });
    if (record?.reason === 'scope-question')
      items.push({ ...base, code: 'scope-question', ref: `${batch.rel}/pipeline/batch.json`, owner: 'evan' });
  };
  for (const [issuer, derived] of Object.entries(view.research)) {
    if (derived.status === 'failed-gate')
      items.push({
        batch: batch.id,
        issuer,
        stage: 'research',
        code: 'gate-failed',
        ref: statePath,
        owner: AGENTS.research,
      });
    reasonItem(derived.record, { batch: batch.id, issuer, stage: 'research' });
  }
  for (const card of view.cards) {
    for (const stage of CARD_STAGES) {
      const derived = card.stages[stage];
      const base = { batch: batch.id, cardId: card.cardId, stage };
      if (derived.status === 'failed-gate') {
        if (stage === 'capture' && derived.record?.reason === 'capture-flagged')
          items.push({
            ...base,
            code: 'capture-flagged',
            ref: `${batch.rel}/capture-report.md`,
            owner: 'session',
          });
        else items.push({ ...base, code: 'gate-failed', ref: statePath, owner: AGENTS[stage] ?? 'session' });
      }
      reasonItem(derived.record, base);
    }
    const findings = batch.findings.get(card.cardId);
    if (
      findings?.card.verdict === 'drop-card' &&
      findings.card.verdictAdjudication?.decision === 'rejected' &&
      card.stages.verify.status !== 'dropped'
    )
      items.push({
        batch: batch.id,
        cardId: card.cardId,
        stage: 'verify',
        code: 'needs-reverify',
        ref: relative(batch.root, findings.file),
        owner: AGENTS.verify,
      });
  }
  // A proposed build (`run build --proposed`) ships nothing, so there is nothing for Evan to publish.
  if (view.build.status === 'done' && view.eval.status === 'done' && !view.build.record?.proposed)
    items.push({ batch: batch.id, stage: 'publish', code: 'publish', ref: statePath, owner: 'evan' });
  return items;
}

export interface NextStep {
  kind: 'cli' | 'agent' | 'queue' | 'wait' | 'handoff';
  batch?: string;
  stage: string;
  issuer?: string;
  cardIds?: string[];
  command?: string;
  agent?: string;
  code?: QueueCode;
  until?: string;
  reason: string;
}

const pipeline = (args: string): string => `npm run pipeline -- ${args}`;
const ACTIONABLE = new Set<Status>(['pending', 'stale', 'failed-gate']);
/** Runs of a CLI stage whose gate failed before `next` hands the card to the session. */
export const GATE_ATTEMPTS = 2;

/** The single next actionable step of one batch. */
export function nextStep(view: BatchView): NextStep {
  const id = view.batch.id;
  // 1. Queue items that block progress and need the session or Evan (not the publish item; that is the handoff).
  const blocking = view.queue.find((item) =>
    ['capture-flagged', 'convention-needed', 'scope-question'].includes(item.code),
  );
  if (blocking) {
    // Every item of the same stage and code in one step, so a fix-and-retry loop handles them together.
    const same = view.queue.filter((item) => item.code === blocking.code && item.stage === blocking.stage);
    const cardIds = [...new Set(same.flatMap((item) => (item.cardId ? [item.cardId] : [])))];
    return {
      kind: 'queue',
      batch: id,
      stage: blocking.stage,
      issuer: blocking.issuer,
      cardIds: cardIds.length ? cardIds : undefined,
      code: blocking.code,
      reason: `${blocking.code} (owner ${blocking.owner}): see ${blocking.ref}`,
    };
  }
  // 2. Anchor-only re-draft: re-point the findings before anything downstream runs.
  const rebase = view.cards.filter((card) => card.rebaseAnchors).map((card) => card.cardId);
  if (rebase.length)
    return {
      kind: 'cli',
      batch: id,
      stage: 'verify',
      cardIds: rebase,
      command: pipeline(`rebase-anchors --batch ${id}`),
      reason: 'rebase anchors: the draft anchors changed under unchanged labels; verification stands',
    };
  // 3. Research per issuer.
  for (const [issuer, derived] of Object.entries(view.research))
    if (derived.status === 'pending' || derived.status === 'stale')
      return agentStep(id, 'research', issuer, [], `research ${derived.status}`);
    else if (derived.status === 'failed-gate') return queueGate(id, 'research', issuer, []);
  // 4. Card stages in order; the first stage with work wins.
  let waitUntil: string | null = null;
  for (const stage of CARD_STAGES) {
    if (stage === 'freshness') continue;
    const cards = view.cards.filter((card) => card.stages[stage].ready);
    const reverify = stage === 'verify' ? view.queue.filter((item) => item.code === 'needs-reverify') : [];
    if (reverify.length) {
      // A verify packet is per issuer: every card of the first card's issuer that needs re-verification.
      const issuer = view.cards.find((entry) => entry.cardId === reverify[0].cardId)!.issuer;
      const ids = view.cards
        .filter((card) => card.issuer === issuer && reverify.some((item) => item.cardId === card.cardId))
        .map((card) => card.cardId);
      return agentStep(id, 'verify', issuer, ids, 'needs-reverify: a rejected drop-card verdict');
    }
    const failed = cards.filter((card) => card.stages[stage].status === 'failed-gate');
    if (failed.length && AGENTS[stage])
      return queueGate(
        id,
        stage,
        failed[0].issuer,
        failed.map((c) => c.cardId),
      );
    // A CLI stage whose gate failed GATE_ATTEMPTS times goes to the session instead of another run.
    const stuck = AGENTS[stage]
      ? []
      : cards.filter(
          (card) =>
            card.stages[stage].status === 'failed-gate' &&
            (card.stages[stage].record?.attempts ?? 0) >= GATE_ATTEMPTS,
        );
    // Every failed card of the stage goes with it (they share the gate-failed code), not only the stuck ones.
    if (stuck.length)
      return {
        ...queueGate(
          id,
          stage,
          stuck[0].issuer,
          cards.filter((card) => card.stages[stage].status === 'failed-gate').map((card) => card.cardId),
        ),
        reason: `gate-failed at ${stage} after ${GATE_ATTEMPTS} attempts (owner session): see the gate errors, fix the cause, then run again`,
      };
    const todo = cards.filter(
      (card) => ACTIONABLE.has(card.stages[stage].status) && !card.stages[stage].inputsMissing,
    );
    if (todo.length) {
      if (AGENTS[stage]) {
        const issuer = todo[0].issuer;
        const ids = todo.filter((card) => card.issuer === issuer).map((card) => card.cardId);
        return agentStep(id, stage, issuer, ids, `${stage}: ${ids.length} card(s) pending or stale`);
      }
      const ids = todo.map((card) => card.cardId);
      return {
        kind: 'cli',
        batch: id,
        stage,
        cardIds: ids,
        command: pipeline(`run ${stage} --batch ${id} --only ${ids.join(',')}`),
        reason: `${stage}: ${ids.length} card(s) pending, stale or failed`,
      };
    }
    const missing = cards.filter(
      (card) => card.stages[stage].status === 'inputs-missing' || card.stages[stage].inputsMissing,
    );
    if (missing.length)
      return {
        kind: 'queue',
        batch: id,
        stage,
        cardIds: missing.map((card) => card.cardId),
        reason: `inputs-missing: captures or traces are not on this machine; run in the checkout that holds them`,
      };
    for (const card of cards) {
      const until =
        card.stages[stage].status === 'paused' ? card.stages[stage].record?.pausedUntil : undefined;
      if (until && (!waitUntil || until < waitUntil)) waitUntil = until;
    }
  }
  if (waitUntil)
    return {
      kind: 'wait',
      batch: id,
      stage: 'extract',
      until: waitUntil,
      reason: `usage limit: paused until ${waitUntil}`,
    };
  // 5. Batch stages, then the handoff.
  for (const [stage, derived] of [
    ['build', view.build],
    ['eval', view.eval],
  ] as const)
    if (derived.ready && derived.status !== 'done') {
      // A published config version is never rebuilt: build the batch as a proposal under a new version instead.
      const published = stage === 'build' ? view.publishedConfigVersion : null;
      return {
        kind: 'cli',
        batch: id,
        stage,
        command: pipeline(
          `run ${stage} --batch ${id}${published ? ` --proposed --version ${view.suggestedVersion}` : ''}`,
        ),
        reason: published
          ? `${stage} ${derived.status}; the config's version ${published} is published, so this builds a proposal under a new version (check it is not in publishedVersions; to ship, see the skill)`
          : `${stage} ${derived.status}`,
      };
    }
  if (view.build.status === 'done' && view.eval.status === 'done')
    return {
      kind: 'handoff',
      batch: id,
      stage: 'publish',
      command: pipeline(`handoff --batch ${id}`),
      reason: view.build.record?.proposed
        ? `all stages done; the build is proposed (${view.build.record.catalogVersion}) and ships nothing: open the PR with the batch data`
        : 'all stages done: open the PR; Evan publishes in the review app',
    };
  return {
    kind: 'wait',
    batch: id,
    stage: 'none',
    reason: 'nothing actionable: waiting on open packets or upstream',
  };
}

function agentStep(
  batch: string,
  stage: string,
  issuer: string,
  cardIds: string[],
  reason: string,
): NextStep {
  return {
    kind: 'agent',
    batch,
    stage,
    issuer,
    cardIds: cardIds.length ? cardIds : undefined,
    agent: AGENTS[stage],
    command: pipeline(`claim ${stage} --batch ${batch} --issuer ${issuer}`),
    reason: `${reason}; claim the packet, start ${AGENTS[stage]} with it, then accept (an open packet: accept or release it)`,
  };
}

function queueGate(batch: string, stage: string, issuer: string, cardIds: string[]): NextStep {
  return {
    kind: 'queue',
    batch,
    stage,
    issuer,
    cardIds: cardIds.length ? cardIds : undefined,
    code: 'gate-failed',
    agent: AGENTS[stage],
    reason: `gate-failed at ${stage}: fix the file named by the gate errors and accept again`,
  };
}
