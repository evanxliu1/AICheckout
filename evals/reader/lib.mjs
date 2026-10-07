// Shared parts of the reader harness: the frozen inputs (freeze.json, verified by freeze.mjs's check), the run log
// `runs.json` and the held-out run limit (docs/evals/generic-reader-protocol.md#peek-policy-and-stop-rule).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { check as checkFreeze } from '../merchants/labels/freeze.mjs';
import { SPLITS, parseId, readLabelFile } from '../merchants/labels/schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const DEFAULTS = {
  freeze: 'evals/merchants/freeze.json',
  data: 'evals/merchants/capture/data',
  sites: 'evals/merchants/sites.json',
  runs: 'evals/reader/runs.json',
  runsDir: 'evals/reader/runs',
  errata: 'evals/merchants/errata',
};
export const RUNS_SCHEMA = 'reader-runs.1';
/** Held-out runs allowed in Phases 10–17 in total, per split. Development has no limit. */
export const RUN_LIMITS = { 'heldout-a': 2 };
export const isHeldout = (split) => split !== 'development';
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileSha = (file) => sha256(readFileSync(file));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const sha = z.string().regex(/^[0-9a-f]{64}$/);
/** One text-free row of runs.json: no domain, amount, selector or page text. */
export const RunRow = z.strictObject({
  runId: z.string().regex(/^[0-9TZ]+-[a-z-]+-[0-9a-f]{6}$/),
  utc: z.iso.datetime(),
  readerCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  readerDirty: z.boolean(),
  split: z.enum(SPLITS),
  heldoutRun: z.number().int().positive().nullable(),
  frozenLabelSha256: sha,
  freezeSha256: sha,
  readerBundleSha256: sha,
  chromium: z.string(),
  pageStates: z.number().int().nonnegative(),
  status: z.enum(['started', 'complete', 'failed']),
  endedUtc: z.iso.datetime().optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.boolean(), z.null()])).optional(),
});
export const RunsFile = z.strictObject({ schema: z.literal(RUNS_SCHEMA), runs: z.array(RunRow) });

export function readRuns(file) {
  if (!existsSync(file)) return { schema: RUNS_SCHEMA, runs: [] };
  return RunsFile.parse(readJson(file));
}
function writeRuns(file, data) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(RunsFile.parse(data), null, 1) + '\n');
  renameSync(tmp, file);
}
export function appendRun(file, row) {
  const data = readRuns(file);
  if (data.runs.some((r) => r.runId === row.runId)) throw new Error(`run ${row.runId} is already logged`);
  data.runs.push(RunRow.parse(row));
  writeRuns(file, data);
}
export function updateRun(file, runId, patch) {
  const data = readRuns(file);
  const row = data.runs.find((r) => r.runId === runId);
  if (!row) throw new Error(`run ${runId} is not in ${file}`);
  Object.assign(row, patch);
  writeRuns(file, data);
}

/** Runs of a split already logged (each counts once reader code ran, whatever its status). */
export const runsUsed = (runs, split) => runs.runs.filter((r) => r.split === split).length;

/**
 * Refuse a held-out run over the limit or without `--confirm-heldout-run <n>`, n being this run's number (used + 1).
 * Returns the run number for a held-out split, null for development.
 */
export function checkRunAllowed(runs, split, confirm) {
  if (!isHeldout(split)) {
    if (confirm != null) throw new Error('--confirm-heldout-run is for held-out splits only');
    return null;
  }
  const limit = RUN_LIMITS[split];
  if (!limit) throw new Error(`no run limit is defined for ${split}`);
  const used = runsUsed(runs, split);
  if (used >= limit)
    throw new Error(`${split} has used ${used} of ${limit} runs; no further run is allowed (stop rule)`);
  const n = used + 1;
  if (confirm == null)
    throw new Error(`${split} run ${n} of ${limit} needs --confirm-heldout-run ${n} (it counts once it starts)`);
  if (Number(confirm) !== n)
    throw new Error(`--confirm-heldout-run ${confirm} is not this run's number ${n} of ${limit}`);
  return n;
}

/**
 * Load and verify the frozen inputs. Refuses (throws) unless the freeze file exists and freeze.mjs's check passes,
 * pane snapshots re-hashed when `paneData` is given. Returns accessors for one split.
 */
export function loadFrozen({ root = REPO_ROOT, freezeFile, paneData }) {
  const file = path.resolve(root, freezeFile ?? DEFAULTS.freeze);
  if (!existsSync(file)) throw new Error(`no freeze file at ${file}: the reader harness runs only on frozen labels`);
  const problems = checkFreeze(file, { data: paneData, root });
  if (problems.length) throw new Error(`freeze check failed; refusing: ${problems.join('; ')}`);
  const freeze = readJson(file);
  const entry = (role, split) => freeze.files.find((e) => e.role === role && (!split || e.split === split));
  const abs = (e) => path.resolve(root, e.path);
  return {
    freeze,
    freezeSha256: fileSha(file),
    /** The frozen final labels of a split: { file, sha256, labels }. */
    labels(split) {
      const e = entry('labels', split);
      if (!e) throw new Error(`no frozen labels for ${split}`);
      return { file: abs(e), sha256: e.sha256, labels: readLabelFile(abs(e)).labels };
    },
    /** Snapshot-manifest entries of a split's real page-states. */
    snapshots(split) {
      return readJson(abs(entry('snapshot-manifest'))).entries.filter((x) => x.split === split);
    },
    /** domain -> { operator, regionGroup, stream } from the frozen retail-frame-3.json (scoring only). */
    frame() {
      const out = new Map();
      for (const d of readJson(abs(entry('retail-frame-3'))).domains)
        out.set(d.domain, {
          operator: d.operator ?? d.domain,
          regionGroup: d.regionGroup,
          stream: d.regionGroup === 'us' ? 'us' : 'non-us',
        });
      return out;
    },
  };
}

export { parseId };
