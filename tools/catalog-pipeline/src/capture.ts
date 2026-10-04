// The capture gate (wiki/system/card-expansion-pipeline.md, "Gates"): a card's capture is done when every source it
// cites has a capture whose hash is the manifest's, captured without a flag in its latest run (or with a flag the
// session accepted by reason code). A capture that passed is protected: `run capture` passes it to
// capture-issuer-pages.mjs --protect, so a page that changed since is reported (`changed-capture-kept`) and the dated
// capture stays. `pipeline resolve capture-flagged --source <id> --reason <code>` records an accepted flag.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveBatch } from './derive.ts';
import type { BatchView } from './derive.ts';
import { captureReportSchema, loadBatch, statePath } from './files.ts';
import type { Batch, CardEntry } from './files.ts';
import { fileSha256, jsonSha256 } from './hash.ts';
import { STAGE_VERSIONS } from './inputs.ts';
import { CAPTURE_FLAG_REASONS, emptyCardState, writeState } from './state.ts';
import type { StageRecord } from './state.ts';
import type { Env } from './run.ts';

export type CaptureRow = { id: string; ok: boolean; flags?: string[]; error?: string };

/** The latest run row per source, from the capture-run reports in parts/ (oldest name first; names carry the time). */
export async function latestRows(batch: Batch): Promise<Map<string, CaptureRow>> {
  const dir = join(batch.dir, 'parts');
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => /^report.*\.json$/.test(name))
    .sort();
  const rows = new Map<string, CaptureRow>();
  for (const name of names) {
    const parsed = captureReportSchema.safeParse(JSON.parse(await readFile(join(dir, name), 'utf8')));
    if (parsed.success) for (const row of parsed.data) rows.set(row.id, row as CaptureRow);
  }
  return rows;
}

/** What a source's capture depends on: its entry (URL, kind) and capture hint. */
export const sourceInput = (batch: Batch, sourceId: string): string => {
  const source = batch.sources.get(sourceId);
  return jsonSha256({
    source: source ? { id: source.id, url: source.url, kind: source.kind } : null,
    hint: batch.hints[sourceId] ?? null,
  });
};

/** Why a source fails the capture gate, or null when it passes. */
export async function sourceProblem(
  batch: Batch,
  sourceId: string,
  rows: Map<string, CaptureRow>,
): Promise<string | null> {
  const entry = batch.manifest.get(sourceId);
  if (!entry) return 'not-captured';
  const file = await fileSha256(join(batch.dir, 'captures', `${sourceId}.txt`));
  if (file === null) return 'capture-missing';
  if (file !== entry.sha256) return 'hash-mismatch';
  const resolved = batch.state.resolvedFlags?.[sourceId];
  if (resolved && resolved.sha256 === entry.sha256) return null;
  const row = rows.get(sourceId);
  if (!row) return 'no-run-report';
  if (!row.ok) return row.error === 'changed-capture-kept' ? 'changed-capture-kept' : 'failed';
  return row.flags?.length ? 'flagged' : null;
}

/** The capture record of a card from its sources now. */
export async function captureRecord(
  batch: Batch,
  view: BatchView,
  card: CardEntry,
  rows: Map<string, CaptureRow>,
  now: Date,
): Promise<StageRecord> {
  const derived = view.cards.find((entry) => entry.cardId === card.id)!.stages.capture;
  let flags = 0;
  const outputs = [];
  for (const sourceId of card.sourceIds) {
    if (await sourceProblem(batch, sourceId, rows)) flags++;
    const entry = batch.manifest.get(sourceId);
    if (entry) outputs.push({ ref: `manifest:${sourceId}`, sha256: entry.sha256 });
    outputs.push({ ref: `source-input:${sourceId}`, sha256: sourceInput(batch, sourceId) });
  }
  return {
    status: flags ? 'failed-gate' : 'done',
    stageVersion: STAGE_VERSIONS.capture,
    ...(derived.inputHash ? { inputHash: derived.inputHash } : {}),
    finishedAt: now.toISOString(),
    attempts: (derived.record?.attempts ?? 0) + 1,
    outputs,
    metrics: { sources: card.sourceIds.length, flags },
    ...(flags ? { reason: 'capture-flagged' } : {}),
  };
}

/**
 * The sources a capture run fetches for these cards, and which of them are protected: a source is fetched when it
 * fails the gate or its entry or hint changed since the card's last capture; it is protected when it already has a
 * capture that passed (or a resolved flag), so a changed page never overwrites it.
 */
export async function capturePlan(
  batch: Batch,
  cardIds: string[],
  rows: Map<string, CaptureRow>,
): Promise<{ fetch: string[]; protect: string[] }> {
  const fetch = new Set<string>();
  const protect = new Set<string>();
  for (const cardId of cardIds) {
    const card = batch.cards.find((entry) => entry.id === cardId)!;
    const recorded = new Map(
      (batch.state.cards[cardId]?.stages.capture?.outputs ?? []).map((output) => [output.ref, output.sha256]),
    );
    for (const sourceId of card.sourceIds) {
      const problem = await sourceProblem(batch, sourceId, rows);
      const moved = recorded.get(`source-input:${sourceId}`) !== sourceInput(batch, sourceId);
      if (!problem && !moved) continue;
      fetch.add(sourceId);
      if (!problem || problem === 'changed-capture-kept') protect.add(sourceId);
    }
  }
  return { fetch: [...fetch], protect: [...protect] };
}

/** `pipeline resolve capture-flagged --source <id> --reason <code>`. */
export async function resolveCaptureFlag(
  env: Env,
  batchId: string,
  sourceId: string,
  reason: string,
): Promise<number> {
  if (!(CAPTURE_FLAG_REASONS as readonly string[]).includes(reason)) {
    env.log(`resolve: --reason must be one of ${CAPTURE_FLAG_REASONS.join(', ')}.`);
    return 2;
  }
  const batch = await loadBatch(env.root, batchId);
  const entry = batch.manifest.get(sourceId);
  const file = await fileSha256(join(batch.dir, 'captures', `${sourceId}.txt`));
  if (!batch.sources.has(sourceId) || !entry || file !== entry.sha256) {
    env.log(
      `resolve: ${sourceId} has no capture matching the manifest here; only an existing capture can be accepted.`,
    );
    return 1;
  }
  const now = env.now();
  batch.state.resolvedFlags = {
    ...batch.state.resolvedFlags,
    [sourceId]: {
      reason: reason as (typeof CAPTURE_FLAG_REASONS)[number],
      sha256: entry.sha256,
      resolvedAt: now.toISOString(),
    },
  };
  const rows = await latestRows(batch);
  const view = await deriveBatch(batch, now);
  const updated: string[] = [];
  for (const card of batch.cards.filter((item) => item.sourceIds.includes(sourceId))) {
    const current = batch.state.cards[card.id]?.stages.capture;
    if (current?.status !== 'failed-gate') continue;
    const next = await captureRecord(batch, view, card, rows, now);
    next.attempts = current.attempts;
    (batch.state.cards[card.id] ??= emptyCardState()).stages.capture = next;
    if (next.status === 'done') updated.push(card.id);
  }
  await writeState(statePath(batch.dir), batch.state, now);
  env.log(
    `Resolved ${sourceId} (${reason}).${updated.length ? ` Capture done for ${updated.join(', ')}.` : ''}`,
  );
  return 0;
}
