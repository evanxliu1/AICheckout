// `pipeline run <stage>`: the CLI stages, each wrapping an existing script with --dir <batch dir>. Outputs are
// written by the script; state is written after them (temp file + rename), so an interrupted run simply re-runs.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveBatch } from './derive.ts';
import type { BatchView } from './derive.ts';
import { captureReportSchema, loadBatch, statePath, traceFileSchema } from './files.ts';
import type { Batch } from './files.ts';
import { fileSha256, jsonSha256, labelsHash, anchorsHash } from './hash.ts';
import { EXTRACT_CONFIG, STAGE_VERSIONS } from './inputs.ts';
import { emptyCardState, writeState } from './state.ts';
import type { CardStage, CliStage, Stage, StageRecord } from './state.ts';

export type Exec = (command: string, args: string[]) => Promise<number>;

export interface Env {
  root: string;
  now: () => Date;
  exec: Exec;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
}

export interface RunOptions {
  only?: string[];
  concurrency?: number;
  waitMinutes?: number;
}

/** Stages that call a model; they never run where CI or RENDER is set. */
export const MODEL_STAGES = new Set<string>(['extract']);
export const EXIT_USAGE_LIMIT = 3;
const DEFAULT_PAUSE_MINUTES = 15;
/** Trace statuses that pass the extract gate (apps/api/src/curation/runner.ts). */
const EXTRACT_OK = new Set(['evidence_valid', 'needs_review']);
const CAPTURE_DELAY_MS = 2500;

export function refuseModelStage(stage: string, env: Record<string, string | undefined>): string | null {
  if (!MODEL_STAGES.has(stage)) return null;
  const where = ['CI', 'RENDER'].filter((name) => env[name]);
  return where.length
    ? `Refusing to run the model stage ${stage}: ${where.join(' and ')} set. Live models run only on the owner's machine (wiki/ops/live-model-runs.md).`
    : null;
}

function record(stage: CardStage, view: BatchView, cardId: string, fields: Partial<StageRecord>, now: Date) {
  const card = view.cards.find((entry) => entry.cardId === cardId)!;
  const derived = card.stages[stage];
  const previous = derived.record;
  return {
    stageVersion: STAGE_VERSIONS[stage as Stage],
    ...(derived.inputHash ? { inputHash: derived.inputHash } : {}),
    finishedAt: now.toISOString(),
    attempts: (previous?.attempts ?? 0) + 1,
    ...fields,
  } as StageRecord;
}

function setCard(batch: Batch, cardId: string, stage: CardStage, value: StageRecord): void {
  const cardState = (batch.state.cards[cardId] ??= emptyCardState());
  cardState.stages[stage] = value;
}

export async function runStage(
  env: Env,
  batchId: string,
  stage: CliStage,
  options: RunOptions = {},
): Promise<number> {
  if (stage === 'eval') {
    env.log('run eval: the eval stage and handoff arrive in Phase 8 milestone 5; nothing was run.');
    return 2;
  }
  const refusal = refuseModelStage(stage, env.env);
  if (refusal) {
    env.log(refusal);
    return 1;
  }
  let batch = await loadBatch(env.root, batchId);
  let view = await deriveBatch(batch, env.now());

  if (stage === 'build') {
    if (!view.build.ready) {
      env.log(`run build: not ready (${view.build.status}); every active card's overlay must be done.`);
      return 1;
    }
    const code = await env.exec('npm', ['run', 'catalog:v3']);
    const catalog = await fileSha256(join(env.root, 'packages/rewards-core/src/catalog-v3.ts'));
    batch.state.batchStages.build = {
      status: code === 0 ? 'done' : 'failed-gate',
      stageVersion: STAGE_VERSIONS.build,
      ...(view.build.inputHash ? { inputHash: view.build.inputHash } : {}),
      finishedAt: env.now().toISOString(),
      attempts: (batch.state.batchStages.build?.attempts ?? 0) + 1,
      ...(code === 0 && catalog
        ? { outputs: [{ ref: 'file:packages/rewards-core/src/catalog-v3.ts', sha256: catalog }] }
        : {}),
      ...(code === 0 ? {} : { reason: 'build-failed' }),
    };
    await writeState(statePath(batch.dir), batch.state, env.now());
    return code === 0 ? 0 : 1;
  }

  const only = options.only ? new Set(options.only) : null;
  if (only)
    for (const id of only)
      if (!view.cards.some((card) => card.cardId === id)) {
        env.log(`run ${stage}: unknown card ${id} in --only.`);
        return 1;
      }
  const targets = view.cards
    .filter((card) => !only || only.has(card.cardId))
    .filter(
      (card) =>
        card.stages[stage].ready &&
        !card.stages[stage].inputsMissing &&
        ['pending', 'stale', 'failed-gate'].includes(card.stages[stage].status),
    )
    .map((card) => card.cardId);
  const missing = view.cards.filter(
    (card) =>
      (!only || only.has(card.cardId)) &&
      (card.stages[stage].status === 'inputs-missing' || card.stages[stage].inputsMissing),
  );
  if (missing.length)
    env.log(
      `run ${stage}: inputs missing on this machine for ${missing.map((card) => card.cardId).join(', ')}; skipped.`,
    );
  if (!targets.length) {
    env.log(`run ${stage}: nothing to run.`);
    return 0;
  }
  env.log(`run ${stage}: ${targets.length} card(s): ${targets.join(', ')}`);

  if (stage === 'capture') {
    const sourceIds = [
      ...new Set(targets.flatMap((id) => batch.cards.find((card) => card.id === id)!.sourceIds)),
    ];
    const reportName = `parts/report.pipeline-${env.now().toISOString().replace(/[:.]/g, '-')}.json`;
    await mkdir(join(batch.dir, 'parts'), { recursive: true });
    const args = [
      'scripts/capture-issuer-pages.mjs',
      '--dir',
      batch.rel,
      '--only',
      sourceIds.join(','),
      '--delay-ms',
      String(CAPTURE_DELAY_MS),
      '--report',
      reportName,
    ];
    if (await fileSha256(join(batch.dir, 'capture-hints.json')))
      args.push('--hints', `${batch.rel}/capture-hints.json`);
    const code = await env.exec('node', args);
    await env.exec('node', ['scripts/expansion-capture-report.mjs', '--dir', batch.rel]);
    const report = await readFile(join(batch.dir, reportName), 'utf8')
      .then((text) => captureReportSchema.parse(JSON.parse(text)))
      .catch(() => []);
    const reportById = new Map(report.map((row) => [row.id, row]));
    batch = await loadBatch(env.root, batchId);
    view = await deriveBatch(batch, env.now());
    for (const id of targets) {
      const card = batch.cards.find((entry) => entry.id === id)!;
      const outputs = [];
      let flags = 0;
      for (const sourceId of card.sourceIds) {
        const row = reportById.get(sourceId);
        const entry = batch.manifest.get(sourceId);
        const file = await fileSha256(join(batch.dir, 'captures', `${sourceId}.txt`));
        if (!row?.ok || !entry || file !== entry.sha256) flags++;
        else flags += row.flags?.length ? 1 : 0;
        if (entry) outputs.push({ ref: `manifest:${sourceId}`, sha256: entry.sha256 });
      }
      setCard(
        batch,
        id,
        'capture',
        record(
          'capture',
          view,
          id,
          {
            status: flags ? 'failed-gate' : 'done',
            outputs,
            metrics: { sources: card.sourceIds.length, flags },
            ...(flags ? { reason: 'capture-flagged' } : {}),
          },
          env.now(),
        ),
      );
    }
    await writeState(statePath(batch.dir), batch.state, env.now());
    return code === 0 ? 0 : 1;
  }

  if (stage === 'extract') {
    let pending = targets;
    for (;;) {
      const code = await env.exec('node', [
        'scripts/extract-cards.mjs',
        '--dir',
        batch.rel,
        '--only',
        pending.join(','),
        '--concurrency',
        String(options.concurrency ?? 8),
        '--wait-minutes',
        '0',
      ]);
      batch = await loadBatch(env.root, batchId);
      view = await deriveBatch(batch, env.now());
      const paused: string[] = [];
      for (const id of pending) {
        const trace = await readTrace(batch, id);
        const ok = trace && traceMatches(batch, trace) && EXTRACT_OK.has(trace.trace.status);
        const sha = await fileSha256(join(batch.dir, 'extractions', `${id}.json`));
        if (ok && sha)
          setCard(
            batch,
            id,
            'extract',
            record(
              'extract',
              view,
              id,
              { status: 'done', outputs: [{ ref: `trace:${id}`, sha256: sha }] },
              env.now(),
            ),
          );
        else if (code === EXIT_USAGE_LIMIT && !(trace && traceMatches(batch, trace))) {
          paused.push(id);
          const until = new Date(
            env.now().getTime() + (options.waitMinutes || DEFAULT_PAUSE_MINUTES) * 60_000,
          );
          setCard(
            batch,
            id,
            'extract',
            record(
              'extract',
              view,
              id,
              { status: 'paused', pausedUntil: until.toISOString(), reason: 'usage-limit' },
              env.now(),
            ),
          );
        } else
          setCard(
            batch,
            id,
            'extract',
            record('extract', view, id, { status: 'failed-gate', reason: 'extract-failed' }, env.now()),
          );
      }
      await writeState(statePath(batch.dir), batch.state, env.now());
      if (code !== EXIT_USAGE_LIMIT) return code === 0 ? 0 : 1;
      if (!paused.length) return 0;
      if (!options.waitMinutes) {
        env.log(
          `run extract: usage limit; ${paused.length} card(s) paused. Re-run later, or pass --wait-minutes.`,
        );
        return EXIT_USAGE_LIMIT;
      }
      env.log(
        `run extract: usage limit; waiting ${options.waitMinutes} minutes before resuming ${paused.length} card(s).`,
      );
      await env.sleep(options.waitMinutes * 60_000);
      pending = paused;
    }
  }

  if (stage === 'draft') {
    const code = await env.exec('node', ['scripts/draft-expansion-labels.mjs', '--dir', batch.rel]);
    batch = await loadBatch(env.root, batchId);
    for (const id of targets) {
      const draft = batch.draft.get(id);
      setCard(
        batch,
        id,
        'draft',
        record(
          'draft',
          view,
          id,
          code === 0 && draft
            ? {
                status: 'done',
                outputs: [{ ref: `corpus-draft:${id}`, sha256: jsonSha256(draft) }],
                labelsHash: labelsHash(draft),
                anchorsHash: anchorsHash(draft),
              }
            : { status: 'failed-gate', reason: code === 0 ? 'no-draft-case' : 'draft-error' },
          env.now(),
        ),
      );
    }
    await writeState(statePath(batch.dir), batch.state, env.now());
    return code === 0 ? 0 : 1;
  }

  // apply
  const code = await env.exec('node', [
    'scripts/apply-expansion-verification.mjs',
    '--dir',
    batch.rel,
    '--version',
    `${batch.id}.v1`,
  ]);
  batch = await loadBatch(env.root, batchId);
  for (const id of targets) {
    const corpusCase = batch.corpus.get(id);
    const findings = batch.findings.get(id)?.card;
    if (
      code === 0 &&
      !corpusCase &&
      findings?.verdict === 'drop-card' &&
      findings.verdictAdjudication?.decision === 'accepted'
    ) {
      batch.state.cards[id] ??= emptyCardState();
      batch.state.cards[id].dropped = 'drop-card';
      continue;
    }
    setCard(
      batch,
      id,
      'apply',
      record(
        'apply',
        view,
        id,
        code === 0 && corpusCase
          ? { status: 'done', outputs: [{ ref: `corpus:${id}`, sha256: jsonSha256(corpusCase) }] }
          : { status: 'failed-gate', reason: code === 0 ? 'not-in-corpus' : 'apply-errors' },
        env.now(),
      ),
    );
  }
  await writeState(statePath(batch.dir), batch.state, env.now());
  return code === 0 ? 0 : 1;
}

async function readTrace(batch: Batch, cardId: string) {
  try {
    return traceFileSchema.parse(
      JSON.parse(await readFile(join(batch.dir, 'extractions', `${cardId}.json`), 'utf8')),
    );
  } catch {
    return null;
  }
}

/** The saved trace was made with the batch's configuration on the pages the manifest has now. */
function traceMatches(batch: Batch, trace: NonNullable<Awaited<ReturnType<typeof readTrace>>>): boolean {
  const config = trace.configuration as Record<string, unknown>;
  const sameConfig = (['provider', 'model', 'effort', 'prompt', 'selection', 'outputTokens'] as const).every(
    (key) => config[key] === EXTRACT_CONFIG[key],
  );
  return (
    sameConfig &&
    trace.documents.every(
      (document) =>
        batch.manifest.get(document.id)?.sha256 === (document.sourceSha256 ?? document.contentHash),
    )
  );
}
