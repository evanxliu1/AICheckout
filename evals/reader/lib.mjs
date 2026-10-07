// Shared parts of the reader harness: the frozen inputs (freeze.json, verified by freeze.mjs's check), the run log
// `runs.json` and the held-out run limit (docs/evals/generic-reader-protocol.md#peek-policy-and-stop-rule).
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
  variantData: 'evals/merchants/capture/data/variants',
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
  frozenVariantLabelSha256: sha,
  freezeSha256: sha,
  readerBundleSha256: sha,
  legacyBundleSha256: sha,
  chromium: z.string(),
  pageStates: z.number().int().nonnegative(),
  variants: z.number().int().nonnegative(),
  status: z.enum(['started', 'complete', 'failed']),
  endedUtc: z.iso.datetime().optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.boolean(), z.null()])).optional(),
});
export const RunsFile = z.strictObject({ schema: z.literal(RUNS_SCHEMA), runs: z.array(RunRow) });

export function readRuns(file) {
  if (!existsSync(file)) return { schema: RUNS_SCHEMA, runs: [] };
  return RunsFile.parse(readJson(file));
}
/** Parse runs.json text (for example `git show HEAD:evals/reader/runs.json`). */
export const parseRuns = (text) => RunsFile.parse(JSON.parse(text));
function writeRuns(file, data) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(RunsFile.parse(data), null, 1) + '\n');
  renameSync(tmp, file);
}

/** Run fn while holding `<runs.json>.lock`, created with O_EXCL: a second writer is refused, never waits. */
function withLock(file, fn) {
  const lock = `${file}.lock`;
  let fd;
  try {
    fd = openSync(lock, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST')
      throw new Error(`${lock} exists: another run is writing runs.json (remove it only if no run is active)`);
    throw e;
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

/**
 * Append a row under the lock. With `confirm` (the run's --confirm-heldout-run, or null), the run limit is checked
 * again on runs.json as it is inside the lock, so two concurrent runs can't both take the last held-out run.
 */
export function appendRun(file, row, { confirm } = {}) {
  withLock(file, () => {
    const data = readRuns(file);
    if (data.runs.some((r) => r.runId === row.runId)) throw new Error(`run ${row.runId} is already logged`);
    if (confirm !== undefined) {
      const n = checkRunAllowed(data, row.split, confirm);
      if (n !== row.heldoutRun) throw new Error(`run number ${n} is not the row's ${row.heldoutRun}`);
    }
    data.runs.push(RunRow.parse(row));
    writeRuns(file, data);
  });
}
export function updateRun(file, runId, patch) {
  withLock(file, () => {
    const data = readRuns(file);
    const row = data.runs.find((r) => r.runId === runId);
    if (!row) throw new Error(`run ${runId} is not in ${file}`);
    Object.assign(row, patch);
    writeRuns(file, data);
  });
}

/** Runs of a split already logged (each counts once reader code ran, whatever its status). */
export const runsUsed = (runs, split) => runs.runs.filter((r) => r.split === split).length;

/**
 * Refuse a split the harness doesn't run, a held-out run over the limit, or one without `--confirm-heldout-run <n>`,
 * n being this run's number (used + 1). Returns the run number for a held-out split, null for development.
 */
export function checkRunAllowed(runs, split, confirm) {
  if (!SPLITS.includes(split))
    throw new Error(
      `unknown split ${split}: the harness runs ${SPLITS.join(' and ')} only (a fresh held-out set needs its own freeze and run limit first)`,
    );
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
 * pane snapshots and variant exports re-hashed when their folders are given. Returns accessors.
 */
export function loadFrozen({ root = REPO_ROOT, freezeFile, paneData, variantData }) {
  const file = path.resolve(root, freezeFile ?? DEFAULTS.freeze);
  if (!existsSync(file)) throw new Error(`no freeze file at ${file}: the reader harness runs only on frozen labels`);
  const problems = checkFreeze(file, { data: paneData, variantData, root });
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
    /** The split's variant manifest and frozen variant labels: { manifest, sha256, labels }. */
    variants(split) {
      const m = entry('variant-manifest', split);
      const l = entry('variant-labels', split);
      if (!m || !l) throw new Error(`no frozen variants for ${split}`);
      return { manifest: readJson(abs(m)), sha256: l.sha256, labels: readLabelFile(abs(l)).labels };
    },
    /** Snapshot-manifest entries of a split's real page-states. */
    snapshots(split) {
      return readJson(abs(entry('snapshot-manifest'))).entries.filter((x) => x.split === split);
    },
    /** Domains assigned to a split in the frozen splits.json. */
    splitDomains(split) {
      return readJson(abs(entry('splits')))
        .filter((r) => r.split === split)
        .map((r) => r.domain);
    },
    /** Domains of every split other than development in the frozen splits.json. */
    nonDevelopmentDomains() {
      return readJson(abs(entry('splits')))
        .filter((r) => r.split !== 'development')
        .map((r) => r.domain);
    },
    /** Every retail-frame-3 domain (for the answer-lookup tripwire). */
    frameDomains() {
      return readJson(abs(entry('retail-frame-3'))).domains.map((d) => d.domain);
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
