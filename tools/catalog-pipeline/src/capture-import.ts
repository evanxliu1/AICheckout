// `pipeline capture-import --source <id> --file <text file> --method browser-pane --by <agent> [--status N]`: brings
// in a page's text read in a real browser (the Claude desktop app's browser pane) for a host that answers the capture
// script's headless Chromium with a bot wall. The text goes through the capture stage's own normalization and quality
// gates (scripts/lib/capture-text.mjs: `HTTP <n>`, `short`, `bot-wall?`), is written to captures/<id>.txt with a
// manifest row like the script's plus `method`, `capturedBy` and `capturedAt`, and gets a run-report row in parts/, so
// the capture gate treats it exactly like a scripted capture. A capture that already passed the gate is protected as
// with `run capture` (`changed-capture-kept`): the import refuses to replace it with other text. Replacing a capture
// that failed the gate (the bot-wall page) is not a change of terms, so it carries no `CHANGED since last capture`
// flag. The file must be the page's `document.body.innerText` after the capture script's steps (scroll, open
// `<details>`, expand collapsed buttons), read with the pane's JavaScript tool; how is in
// wiki/system/card-pipeline-commands.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { captureFlags, captureSha256, normalizeCaptureText } from '../../../scripts/lib/capture-text.mjs';
import { captureRecord, latestRows, sourceProblem } from './capture.ts';
import { deriveBatch } from './derive.ts';
import { loadBatch, statePath } from './files.ts';
import { emptyCardState, writeJsonAtomic, writeState } from './state.ts';
import type { Env } from './run.ts';

/** How an imported capture was read. The headless script's rows carry no `method`. */
export const CAPTURE_METHODS = ['browser-pane'] as const;

export interface CaptureImportOptions {
  source: string;
  file: string;
  method: string;
  /** Who read the page, e.g. `claude-code/claude-opus-5-5`. */
  by: string;
  /** The page's HTTP status as the browser saw it (navigation timing `responseStatus`). */
  status?: number;
}

export async function captureImport(
  env: Env,
  batchId: string,
  options: CaptureImportOptions,
): Promise<number> {
  if (!(CAPTURE_METHODS as readonly string[]).includes(options.method)) {
    env.log(`capture-import: --method must be one of ${CAPTURE_METHODS.join(', ')}.`);
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9./-]{0,79}$/.test(options.by)) {
    env.log('capture-import: --by names who read the page, e.g. claude-code/claude-opus-5-5.');
    return 2;
  }
  if (
    options.status !== undefined &&
    !(Number.isInteger(options.status) && options.status >= 100 && options.status < 600)
  ) {
    env.log('capture-import: --status must be an HTTP status code.');
    return 2;
  }
  const batch = await loadBatch(env.root, batchId);
  const source = batch.sources.get(options.source);
  if (!source) {
    env.log(`capture-import: ${options.source} is not a source of ${batchId}.`);
    return 1;
  }
  const raw = await readFile(resolve(env.root, options.file), 'utf8');
  const text = normalizeCaptureText(raw);
  const sha256 = captureSha256(text);
  const flags = captureFlags(text, options.status ?? 200);
  const rows = await latestRows(batch);
  const old = batch.manifest.get(source.id) as { sha256: string; capturedOn?: string } | undefined;
  if (old && old.sha256 !== sha256 && (await sourceProblem(batch, source.id, rows)) === null) {
    env.log(
      `capture-import: ${source.id} already has a capture that passed the gate; the page changed and the existing ` +
        'capture is kept (changed-capture-kept). Refresh the card in a new batch.',
    );
    return 1;
  }
  const now = env.now();
  const today = now.toISOString().slice(0, 10);
  await mkdir(join(batch.dir, 'captures'), { recursive: true });
  await writeFile(join(batch.dir, 'captures', `${source.id}.txt`), text);

  // The manifest row as capture-issuer-pages.mjs writes it, plus how, by whom and when the page was read.
  const manifestPath = join(batch.dir, 'manifest.json');
  const previous = await readFile(manifestPath, 'utf8')
    .then((body) => JSON.parse(body).sources as { id: string }[])
    .catch(() => [] as { id: string }[]);
  const byId = new Map(previous.map((entry) => [entry.id, entry]));
  byId.set(source.id, {
    ...source,
    capturedOn: old?.sha256 === sha256 && old.capturedOn ? old.capturedOn : today,
    sha256,
    length: text.length,
    method: options.method,
    capturedBy: options.by,
    capturedAt: now.toISOString(),
  } as { id: string });
  const order = [...batch.sources.keys()];
  await writeJsonAtomic(manifestPath, {
    schemaVersion: 1,
    sources: [...byId.values()]
      .filter((entry) => order.includes(entry.id))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
  });
  // Named like `run capture`'s reports so latestRows (name order, names carry the time) sees runs in time order.
  const reportName = `report.pipeline-${now.toISOString().replace(/[:.]/g, '-')}-import-${source.id}.json`;
  await writeJsonAtomic(join(batch.dir, 'parts', reportName), [
    {
      id: source.id,
      ok: true,
      status: options.status ?? 200,
      length: text.length,
      flags,
      method: options.method,
    },
  ]);
  await env.exec('node', ['scripts/expansion-capture-report.mjs', '--dir', batch.rel, '--batch']);

  // The capture records of the cards that cite the source, as `run capture` would leave them.
  const fresh = await loadBatch(env.root, batchId);
  const view = await deriveBatch(fresh, now);
  const latest = await latestRows(fresh);
  const done: string[] = [];
  for (const card of fresh.cards.filter((item) => item.sourceIds.includes(source.id))) {
    const record = await captureRecord(fresh, view, card, latest, now);
    (fresh.state.cards[card.id] ??= emptyCardState()).stages.capture = record;
    if (record.status === 'done') done.push(card.id);
  }
  await writeState(statePath(fresh.dir), fresh.state, now);
  env.log(
    `Imported ${source.id} (${options.method}, ${text.length} chars, sha256 ${sha256.slice(0, 12)})` +
      `${flags.length ? `; flagged: ${flags.join(', ')}` : '; no flags'}.` +
      `${done.length ? ` Capture done for ${done.join(', ')}.` : ''}`,
  );
  return flags.length ? 1 : 0;
}
