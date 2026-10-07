#!/usr/bin/env node
// Freeze of the final labels of every split (docs/evals/generic-reader-protocol.md#freeze-and-errata), before any
// reader run on any split. Refuses unless:
//   - there is one final labels file per split, each valid reader-labels.2;
//   - each split's agreement report (agreement.mjs --report) has an empty `stop` list and `final.sha256` equal to
//     that split's final labels file;
//   - at most 10% of each split's real cart-1 page-states are currency-undetermined (raw counts, recomputed);
//   - every label's domain is assigned to the label's split in splits.json, and every split domain's real
//     page-states have exactly one final label: pane (sites.json standing status captured by pane) = each collected
//     state export of `records/<domain>.pane.json`; robot = each action state with a manifest in the standing
//     robot capture (the latest `protocolN` block with `states`);
//   - pane: dom.json is the export the committed record collected and the one in meta.json, the render files hash
//     to render.json, and the label's domSha256 and snapshotSha256 (= SHA-256 of render.json) are those; robot: the
//     label's snapshotSha256 is the standing capture's manifest SHA-256 for that state.
// Then writes, into --out-dir:
//   snapshot-manifest.json  `reader-snapshots.1`: every labelled real page-state with its dom SHA-256 and render
//                           SHA-256s (pane) or manifest SHA-256 (robot)
//   freeze.json             `reader-freeze.1`: SHA-256 of each final labels file and agreement report, the variant
//                           manifest(s), the snapshot manifest, currency-minor-units.json, item-price-bands.json,
//                           retail-frame-3.json and splits.json, with the git commit and the UTC time
// `--check` requires every role (labels and agreement report per split, a variant manifest, the snapshot manifest,
// the three reference files, splits), re-hashes every file freeze.json names (and, with --data, every pane snapshot
// in the manifest) and exits 1 on any problem; the reader harness refuses to score then. A frozen file is never
// edited; errata go in errata/<split>.json.
//
//   node evals/merchants/labels/freeze.mjs --labels <final-development.json> --labels <final-heldout-a.json>
//        --report <agreement-development.json> --report <agreement-heldout-a.json>
//        --variants <variant-manifest.json> [--variants ...] --splits evals/merchants/splits.json
//        --data <capture/data/pane> [--records <capture/records>] [--sites <sites.json>] [--commit <sha>]
//        [--utc <iso>] [--out-dir <dir>]
//   node evals/merchants/labels/freeze.mjs --check [<freeze.json>] [--data <capture/data/pane>]
// Paths in freeze.json are relative to the repository root (--root to override).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  collectedStates,
  isPaneCaptured,
  isRobotCaptured,
  standingRobotCapture,
} from '../capture/build-split-input.mjs';
import { currencyReport, undeterminedAboveStop } from './agreement.mjs';
import { SPLITS, STATES, parseId, readLabelFile } from './schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const FREEZE_SCHEMA = 'reader-freeze.1';
export const PROTOCOL = 'generic-reader-protocol.11';
const MERCHANTS = path.join(REPO_ROOT, 'evals', 'merchants');
export const REFERENCE_FILES = {
  'currency-minor-units': path.join(MERCHANTS, 'currency-minor-units.json'),
  'item-price-bands': path.join(MERCHANTS, 'item-price-bands.json'),
  'retail-frame-3': path.join(MERCHANTS, 'retail-frame-3.json'),
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const fileSha = (file) => sha(readFileSync(file));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Hash a pane page-state's files and check them against render.json and meta.json. */
export function paneSnapshot(dir) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const renderText = readFileSync(path.join(dir, 'render.json'));
  const render = JSON.parse(renderText);
  const got = {
    domSha256: fileSha(path.join(dir, 'dom.json')),
    rebuiltSha256: fileSha(path.join(dir, 'rebuilt.html')),
    viewportSha256: fileSha(path.join(dir, 'viewport.png')),
    fullSha256: fileSha(path.join(dir, 'full.png')),
  };
  const problems = [];
  if (got.domSha256 !== meta.sha256) problems.push('dom.json is not the collected export');
  for (const [k, v] of Object.entries(got))
    if (render[k] !== v) problems.push(`${k} differs from render.json`);
  return { snapshotSha256: sha(renderText), ...got, problems };
}

/**
 * The captured real page-states of every split domain: Map(`<domain>/<state>` -> {split, method, sha256}), where
 * sha256 is the collected export's (pane) or the standing manifest's (robot).
 */
export function capturedPageStates(splitRows, { sites, records }) {
  const siteBy = new Map((sites.sites ?? []).map((s) => [s.domain, s]));
  const out = new Map();
  for (const { domain, split } of splitRows) {
    const site = siteBy.get(domain);
    if (site && isPaneCaptured(site)) {
      const record = readJson(path.join(records, `${domain}.pane.json`));
      for (const [state, h] of collectedStates(record))
        out.set(`${domain}/${state}`, { split, method: 'pane', sha256: h });
    } else if (site && isRobotCaptured(site)) {
      for (const s of standingRobotCapture(site).states ?? [])
        if (STATES.includes(s.state) && s.manifestSha256)
          out.set(`${domain}/${s.state}`, { split, method: 'robot', sha256: s.manifestSha256 });
    } else throw new Error(`${domain}: in splits.json but not a standing capture in sites.json`);
  }
  return out;
}

/** Snapshot manifest of every real page-state labelled in the final files. Throws on any mismatch. */
export function snapshotManifest(finals, { data, sites, records, splitRows }) {
  const splitOf = new Map(splitRows.map((r) => [r.domain, r.split]));
  const captured = capturedPageStates(splitRows, { sites, records });
  const entries = [];
  const problems = [];
  const labelled = new Set();
  for (const f of finals)
    for (const l of f.labels.filter((x) => x.origin === 'action')) {
      const { domain, state } = parseId(l.id);
      const assigned = splitOf.get(domain);
      if (!assigned) {
        problems.push(`${l.id}: ${domain} is in no split`);
        continue;
      }
      if (assigned !== f.split) {
        problems.push(`${l.id}: ${domain} is in ${assigned}, the label in ${f.split}`);
        continue;
      }
      const c = captured.get(l.id);
      if (!c) {
        problems.push(`${l.id}: labelled but not a captured real page-state`);
        continue;
      }
      labelled.add(l.id);
      if (c.method === 'pane') {
        const dir = path.join(data, domain, state);
        if (!existsSync(path.join(dir, 'render.json'))) {
          problems.push(`${l.id}: pane snapshot or render missing in the data`);
          continue;
        }
        const s = paneSnapshot(dir);
        problems.push(...s.problems.map((p) => `${l.id}: ${p}`));
        if (s.domSha256 !== c.sha256)
          problems.push(`${l.id}: dom.json is not the export the record collected`);
        if (s.domSha256 !== l.domSha256) problems.push(`${l.id}: label domSha256 is not the export's`);
        if (s.snapshotSha256 !== l.snapshotSha256)
          problems.push(`${l.id}: label snapshotSha256 is not render.json's`);
        entries.push({
          id: l.id,
          split: f.split,
          method: 'pane',
          snapshotSha256: s.snapshotSha256,
          domSha256: s.domSha256,
          rebuiltSha256: s.rebuiltSha256,
          viewportSha256: s.viewportSha256,
          fullSha256: s.fullSha256,
        });
      } else {
        if (l.snapshotSha256 !== c.sha256)
          problems.push(`${l.id}: not the standing robot capture's manifest`);
        entries.push({
          id: l.id,
          split: f.split,
          method: 'robot',
          snapshotSha256: l.snapshotSha256,
          domSha256: l.domSha256,
        });
      }
    }
  for (const id of captured.keys())
    if (!labelled.has(id)) problems.push(`${id}: captured real page-state without a final label`);
  if (problems.length) throw new Error(problems.join('; '));
  entries.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { schema: 'reader-snapshots.1', entries };
}

const rel = (root, p) => path.relative(root, path.resolve(p)).split(path.sep).join('/');

/** Check each split's agreement report and currency-undetermined share; returns [{split, file}] of the reports. */
function checkReports(finals, reports) {
  const bySplit = new Map();
  for (const file of reports) {
    const r = readJson(file);
    if (bySplit.has(r.split)) throw new Error(`two agreement reports for ${r.split}`);
    bySplit.set(r.split, { file, r });
  }
  return finals.map((f) => {
    const rep = bySplit.get(f.split);
    if (!rep) throw new Error(`no agreement report for ${f.split}`);
    if (!Array.isArray(rep.r.stop) || rep.r.stop.length)
      throw new Error(
        `${f.split}: the agreement report has stop rules (${rep.r.stop}); stop and report to Evan`,
      );
    if (rep.r.final?.sha256 !== fileSha(f.file))
      throw new Error(`${f.split}: the agreement report is not for these final labels`);
    const cu = currencyReport(f.labels);
    if (undeterminedAboveStop(cu))
      throw new Error(
        `${f.split}: more than 10% of real cart-1 currency-undetermined (${cu.undetermined} of ${cu.realCart1})`,
      );
    return { split: f.split, file: rep.file };
  });
}

/** Write snapshot-manifest.json and freeze.json; returns the freeze object. */
export function freeze({
  labels,
  reports = [],
  variants,
  splits,
  data,
  sites,
  records,
  commit,
  utc,
  outDir,
  root = REPO_ROOT,
}) {
  if (!labels?.length || !variants?.length || !splits || !data || !sites || !records)
    throw new Error('labels, reports, variants, splits, data, sites and records are needed');
  const finals = labels.map((file) => ({ file, ...readLabelFile(file) }));
  for (const f of finals) if (f.role !== 'final') throw new Error(`${f.file}: not a final labels file`);
  const splitsSeen = finals.map((f) => f.split).sort();
  if (splitsSeen.join() !== [...SPLITS].sort().join())
    throw new Error(
      `freeze needs one final labels file per split (${SPLITS.join(', ')}), got ${splitsSeen.join(', ')}`,
    );
  const reportFiles = checkReports(finals, reports);
  const manifest = snapshotManifest(finals, {
    data,
    sites: readJson(sites),
    records,
    splitRows: readJson(splits),
  });
  const manifestPath = path.join(outDir, 'snapshot-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
  const entry = (role, file, extra = {}) => ({
    role,
    ...extra,
    path: rel(root, file),
    sha256: fileSha(file),
  });
  const out = {
    schema: FREEZE_SCHEMA,
    protocol: PROTOCOL,
    commit: commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    utc: utc ?? new Date().toISOString(),
    files: [
      ...finals.map((f) => entry('labels', f.file, { split: f.split })),
      ...reportFiles.map((r) => entry('agreement-report', r.file, { split: r.split })),
      ...variants.map((v) => entry('variant-manifest', v)),
      entry('snapshot-manifest', manifestPath),
      ...Object.entries(REFERENCE_FILES).map(([role, file]) => entry(role, file)),
      entry('splits', splits),
    ],
  };
  writeFileSync(path.join(outDir, 'freeze.json'), JSON.stringify(out, null, 1) + '\n');
  return out;
}

/** Verify a freeze file: [problem]; empty when every role is there and every hash matches. */
export function check(freezeFile, { data, root = REPO_ROOT } = {}) {
  const f = readJson(freezeFile);
  const problems = [];
  if (f.schema !== FREEZE_SCHEMA) problems.push(`not a ${FREEZE_SCHEMA} file`);
  const files = f.files ?? [];
  const has = (role, split) => files.some((e) => e.role === role && (!split || e.split === split));
  for (const role of ['labels', 'agreement-report'])
    for (const split of SPLITS) if (!has(role, split)) problems.push(`missing role ${role} for ${split}`);
  for (const role of ['variant-manifest', 'snapshot-manifest', ...Object.keys(REFERENCE_FILES), 'splits'])
    if (!has(role)) problems.push(`missing role ${role}`);
  for (const e of files) {
    const p = path.resolve(root, e.path);
    if (!existsSync(p)) problems.push(`${e.path}: missing`);
    else if (fileSha(p) !== e.sha256) problems.push(`${e.path}: SHA-256 differs from the freeze`);
  }
  const m = files.find((e) => e.role === 'snapshot-manifest');
  if (data && m && existsSync(path.resolve(root, m.path)))
    for (const e of readJson(path.resolve(root, m.path)).entries.filter((x) => x.method === 'pane')) {
      const { domain, state } = parseId(e.id);
      const dir = path.join(data, domain, state);
      if (!existsSync(path.join(dir, 'render.json'))) {
        problems.push(`${e.id}: snapshot missing`);
        continue;
      }
      const s = paneSnapshot(dir);
      for (const k of ['snapshotSha256', 'domSha256', 'rebuiltSha256', 'viewportSha256', 'fullSha256'])
        if (s[k] !== e[k]) problems.push(`${e.id}: ${k} differs from the freeze`);
    }
  return problems;
}

function main(argv) {
  const many = (k) => argv.flatMap((a, i) => (argv[i - 1] === k ? [a] : []));
  const one = (k) => many(k)[0];
  const root = one('--root') ?? REPO_ROOT;
  if (argv.includes('--check')) {
    const file =
      argv.find((a, i) => !a.startsWith('--') && !['--data', '--root'].includes(argv[i - 1])) ??
      'evals/merchants/freeze.json';
    const problems = check(path.resolve(root, file), { data: one('--data'), root });
    console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 1));
    return problems.length ? 1 : 0;
  }
  const out = freeze({
    labels: many('--labels'),
    reports: many('--report'),
    variants: many('--variants'),
    splits: one('--splits'),
    data: one('--data'),
    sites: one('--sites') ?? path.join(MERCHANTS, 'sites.json'),
    records: one('--records') ?? path.join(MERCHANTS, 'capture', 'records'),
    commit: one('--commit'),
    utc: one('--utc'),
    outDir: one('--out-dir') ?? MERCHANTS,
    root,
  });
  console.log(JSON.stringify(out, null, 1));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  }
}
