#!/usr/bin/env node
// Freeze of the final labels of every split (docs/evals/generic-reader-protocol.md#freeze-and-errata), before any
// reader run on any split. Writes, into --out-dir:
//   snapshot-manifest.json  `reader-snapshots.1`: every labelled real page-state with its dom SHA-256 and render
//                           SHA-256s (pane: render.json, viewport.png, full.png, rebuilt.html from render-pane.mjs,
//                           each re-hashed from the files and checked against the label; robot: the label's manifest
//                           SHA-256, checked against the site's states in sites.json)
//   freeze.json             `reader-freeze.1`: SHA-256 of each final labels file, the variant manifest(s), the
//                           snapshot manifest, currency-minor-units.json, item-price-bands.json, retail-frame-3.json
//                           and splits.json, with the git commit and the UTC time
// `--check` re-hashes every file freeze.json names (and, with --data, every pane snapshot in the manifest) and exits
// 1 on any mismatch; the reader harness refuses to score then. A frozen file is never edited; errata go in
// errata/<split>.json.
//
//   node evals/merchants/labels/freeze.mjs --labels <final-development.json> --labels <final-heldout-a.json>
//        --variants <variant-manifest.json> [--variants ...] --splits <splits.json> --data <capture/data/pane>
//        [--sites <sites.json>] [--commit <sha>] [--utc <iso>] [--out-dir <dir>]
//   node evals/merchants/labels/freeze.mjs --check [<freeze.json>] [--data <capture/data/pane>]
// Paths in freeze.json are relative to the repository root (--root to override).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SPLITS, parseId, readLabelFile } from './schema.mjs';

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

/** Every {state, manifestSha256} recorded anywhere in a robot site record. */
function robotStates(site) {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if (typeof o.state === 'string' && typeof o.manifestSha256 === 'string') out.push(o);
      Object.values(o).forEach(walk);
    }
  };
  walk(site);
  return out;
}

/** Hash a pane page-state's files and check them against render.json and meta.json. */
export function paneSnapshot(dir) {
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
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

/** Snapshot manifest of every real page-state labelled in the final files. Throws on any mismatch. */
export function snapshotManifest(finals, { data, sites }) {
  const siteBy = new Map((sites?.sites ?? []).map((s) => [s.domain, s]));
  const entries = [];
  const problems = [];
  for (const f of finals)
    for (const l of f.labels.filter((x) => x.origin === 'action')) {
      const { domain, state } = parseId(l.id);
      const dir = path.join(data, domain, state);
      if (existsSync(path.join(dir, 'dom.json'))) {
        const s = paneSnapshot(dir);
        problems.push(...s.problems.map((p) => `${l.id}: ${p}`));
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
        const known = robotStates(siteBy.get(domain) ?? {}).some(
          (s) => s.state === state && s.manifestSha256 === l.snapshotSha256,
        );
        if (!known) problems.push(`${l.id}: no pane export and no robot state with this manifest SHA-256`);
        entries.push({
          id: l.id,
          split: f.split,
          method: 'robot',
          snapshotSha256: l.snapshotSha256,
          domSha256: l.domSha256,
        });
      }
    }
  if (problems.length) throw new Error(problems.join('; '));
  entries.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { schema: 'reader-snapshots.1', entries };
}

const rel = (root, p) => path.relative(root, path.resolve(p)).split(path.sep).join('/');

/** Write snapshot-manifest.json and freeze.json; returns the freeze object. */
export function freeze({ labels, variants, splits, data, sites, commit, utc, outDir, root = REPO_ROOT }) {
  if (!labels?.length || !variants?.length || !splits || !data)
    throw new Error('labels, variants, splits and data are needed');
  const finals = labels.map((file) => ({ file, ...readLabelFile(file) }));
  for (const f of finals) if (f.role !== 'final') throw new Error(`${f.file}: not a final labels file`);
  const splitsSeen = finals.map((f) => f.split).sort();
  if (splitsSeen.join() !== [...SPLITS].sort().join())
    throw new Error(
      `freeze needs one final labels file per split (${SPLITS.join(', ')}), got ${splitsSeen.join(', ')}`,
    );
  const manifest = snapshotManifest(finals, {
    data,
    sites: sites ? JSON.parse(readFileSync(sites, 'utf8')) : null,
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
      ...variants.map((v) => entry('variant-manifest', v)),
      entry('snapshot-manifest', manifestPath),
      ...Object.entries(REFERENCE_FILES).map(([role, file]) => entry(role, file)),
      entry('splits', splits),
    ],
  };
  writeFileSync(path.join(outDir, 'freeze.json'), JSON.stringify(out, null, 1) + '\n');
  return out;
}

/** Verify a freeze file: [problem]; empty when every hash matches. */
export function check(freezeFile, { data, root = REPO_ROOT } = {}) {
  const f = JSON.parse(readFileSync(freezeFile, 'utf8'));
  const problems = [];
  if (f.schema !== FREEZE_SCHEMA) problems.push(`not a ${FREEZE_SCHEMA} file`);
  for (const e of f.files ?? []) {
    const p = path.resolve(root, e.path);
    if (!existsSync(p)) problems.push(`${e.path}: missing`);
    else if (fileSha(p) !== e.sha256) problems.push(`${e.path}: SHA-256 differs from the freeze`);
  }
  const m = (f.files ?? []).find((e) => e.role === 'snapshot-manifest');
  if (data && m && existsSync(path.resolve(root, m.path)))
    for (const e of JSON.parse(readFileSync(path.resolve(root, m.path), 'utf8')).entries.filter(
      (x) => x.method === 'pane',
    )) {
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
    variants: many('--variants'),
    splits: one('--splits'),
    data: one('--data'),
    sites: one('--sites') ?? path.join(MERCHANTS, 'sites.json'),
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
