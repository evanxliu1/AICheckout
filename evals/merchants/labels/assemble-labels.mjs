#!/usr/bin/env node
// Assemble labeller files (`reader-labels.2`, role labeller) from the label workflow's structured output
// (workflows/label.workflow.txt; one labeller per store since 2026-10-08). The labeller agents return only what they
// decide; this adds what they don't: `split` (from splits.json), `state` and `origin: action` (from the id), and
// the hashes: pane `domSha256` = the collected export's SHA-256 (meta.json, re-hashed) and `snapshotSha256` = SHA-256
// of render.json; robot `snapshotSha256` = SHA-256 of the standing capture's manifest.json and `domSha256` = its
// dom.json entry. Labels the workflow didn't ask for, ids it asked for without a label, a store returned twice, and
// optional fields the schema forbids for the label's expected value are reported; nothing is guessed. Writes one
// file per split and prints {split: {labels, problems}}; exit 1 on a problem (the files are still written, so
// validate-labels.mjs can show the schema problems).
//
//   node evals/merchants/labels/assemble-labels.mjs --results <results.json>... --batches <batches.json>
//        --out-dir <dir> [--labeller-id <id>] [--model <model>]
// results.json: the workflow's return value (an array of {batch, stores: [{domain, labels, problems}]}).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LABEL_SCHEMA, parseId, validateLabelFile } from './schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..', '..');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const DECIDED = [
  'readable',
  'displayed',
  'expected',
  'expectedReason',
  'currencyEvidence',
  'currencyConflict',
  'observedTags',
  'confidence',
  'notes',
];

/** The hashes of one page-state: {domSha256, snapshotSha256} or {problem}. */
export function hashesOf(store, state, root = ROOT) {
  if (store.method === 'robot') {
    const m = path.join(root, store.robotDir, state, 'manifest.json');
    if (!existsSync(m)) return { problem: 'robot manifest missing' };
    return { domSha256: readJson(m).files['dom.json'], snapshotSha256: sha256(readFileSync(m)) };
  }
  const dir = path.join(root, 'evals/merchants/capture/data/pane', store.domain, state);
  const render = path.join(dir, 'render.json');
  if (!existsSync(render)) return { problem: 'render.json missing' };
  const meta = readJson(path.join(dir, 'meta.json'));
  if (sha256(readFileSync(path.join(dir, 'dom.json'))) !== meta.sha256)
    return { problem: 'dom.json does not match meta.json' };
  return { domSha256: meta.sha256, snapshotSha256: sha256(readFileSync(render)) };
}

/** Assemble: {files: {split: labellerFile}, problems: {split: [message]}}. */
export function assemble(results, batches, { labeller, root = ROOT } = {}) {
  const asked = new Map();
  const splitOf = new Map();
  for (const batch of batches)
    for (const s of batch) {
      splitOf.set(s.domain, s.split);
      for (const id of s.ids) asked.set(id, s);
    }
  const files = {};
  const problems = {};
  const seenStore = new Set();
  const done = new Set();
  const push = (split, msg) => (problems[split] ??= []).push(msg);
  for (const r of results.flat()) {
    if (!r || r.failed) {
      for (const d of r?.domains ?? []) push(splitOf.get(d) ?? 'unknown', `${d}: labeller agent failed`);
      continue;
    }
    for (const st of r.stores ?? []) {
      if (seenStore.has(st.domain)) push('unknown', `${st.domain}: returned twice`);
      seenStore.add(st.domain);
      for (const l of st.labels ?? []) {
        const s = asked.get(l.id);
        if (!s) {
          push('unknown', `${l.id}: not asked for`);
          continue;
        }
        if (done.has(l.id)) {
          push(s.split, `${l.id}: labelled twice`);
          continue;
        }
        done.add(l.id);
        const state = parseId(l.id)?.state;
        const h = hashesOf(s, state, root);
        if (h.problem) push(s.split, `${l.id}: ${h.problem}`);
        const label = { id: l.id, split: s.split, state, origin: 'action', snapshotSha256: h.snapshotSha256, domSha256: h.domSha256 };
        for (const k of DECIDED) if (l[k] !== undefined && l[k] !== null) label[k] = l[k];
        label.expected = l.expected ?? null;
        label.notes ??= '';
        if (label.expected === null) {
          delete label.currencyEvidence;
          delete label.currencyConflict;
        } else delete label.expectedReason;
        (files[s.split] ??= {
          schema: LABEL_SCHEMA,
          role: 'labeller',
          split: s.split,
          labeller,
          labels: [],
        }).labels.push(label);
      }
    }
  }
  for (const [id, s] of asked) if (!done.has(id)) push(s.split, `${id}: asked for, not labelled`);
  for (const f of Object.values(files)) {
    f.labels.sort((a, b) => (a.id < b.id ? -1 : 1));
    const v = validateLabelFile(f);
    for (const p of v.problems) push(f.split, `${p.id ?? ''}: ${p.message}`);
  }
  return { files, problems };
}

function main(argv) {
  const many = (k) => argv.flatMap((a, i) => (argv[i - 1] === k ? [a] : []));
  const opt = (k, d) => many(k)[0] ?? d;
  const resultsFiles = many('--results');
  const batchesFile = opt('--batches');
  const outDir = opt('--out-dir');
  if (!resultsFiles.length || !batchesFile || !outDir) {
    console.error('usage: assemble-labels.mjs --results <file>... --batches <file> --out-dir <dir>');
    return 2;
  }
  const labeller = { id: opt('--labeller-id', 'labeller-single'), model: opt('--model', 'claude-opus-5-5') };
  const results = resultsFiles.flatMap((f) => readJson(f));
  const { files, problems } = assemble(results, readJson(batchesFile), { labeller });
  const report = {};
  for (const [split, f] of Object.entries(files)) {
    writeFileSync(path.join(outDir, `labeller-${split}.json`), JSON.stringify(f, null, 1) + '\n');
    report[split] = { labels: f.labels.length, problems: problems[split] ?? [] };
  }
  if (problems.unknown) report.unknown = { problems: problems.unknown };
  console.log(JSON.stringify(report, null, 1));
  return Object.values(problems).some((p) => p.length) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  }
}
