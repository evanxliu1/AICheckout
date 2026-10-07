#!/usr/bin/env node
// Agreement of two independent labellers on one split (docs/evals/generic-reader-protocol.md#agreement), and the
// merge of agreed labels with the adjudicator's decisions into the split's final labels.
//
//   node evals/merchants/labels/agreement.mjs <labeller-a.json> <labeller-b.json>
//        [--adjudication <adjudication.json> --out <final.json>] [--report <report.json>]
//
// Report (stdout, and --report): counts and rates of expected agreement (same kind, amount and currency, or both
// null with the same reason), currency agreement (the same currency on every displayed row both labellers recorded,
// rows matched by kind and amount; page-states with no such row are not comparable), row agreement (the same set
// of displayed rows), readable agreement and per-tag agreement; the disagreement ids (ids only, no page text); the
// currency-undetermined share of real cart-1 page-states and the counts per currency-evidence rule and of
// currencyConflict, per stream (from retail-frame-3.json); and the protocol's stop rules: expected agreement below
// 90%, or more than 10% of the split's real cart-1 currency-undetermined (the final labels when given, otherwise
// either labeller). Exit 3 when a stop rule fires: the builder stops before the freeze and reports to Evan.
//
// A disagreement is a page-state whose labels differ in readable, displayed rows, expected, expectedReason,
// currencyEvidence or currencyConflict; each needs one adjudicated decision. An agreed page-state's final label is
// the labellers' common fields with the union of their observed tags, confidence low if either was low, and empty
// notes. Adjudication file: { schema: 'reader-adjudication.1', split, adjudicator: {id, model},
// decisions: [{ id, label: <reader-labels.2 label>, reason }] }; refused when a decision's id isn't a disagreement,
// a disagreement has no decision, or the adjudicator is one of the labellers.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  LABEL_SCHEMA,
  Label,
  Note,
  OBSERVED_TAGS,
  SPLITS,
  parseId,
  readLabelFile,
  validateLabelFile,
} from './schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STOP_EXPECTED_AGREEMENT = 0.9;
export const STOP_CURRENCY_UNDETERMINED = 0.1;
export const CORE_FIELDS = [
  'readable',
  'displayed',
  'expected',
  'expectedReason',
  'currencyEvidence',
  'currencyConflict',
];

export const Adjudication = z
  .object({
    schema: z.literal('reader-adjudication.1'),
    split: z.enum(SPLITS),
    adjudicator: z.object({ id: z.string().min(1), model: z.string().min(1) }).strict(),
    decisions: z.array(z.object({ id: z.string().min(1), label: Label, reason: Note }).strict()),
  })
  .strict();

const fileSha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const rowKey = (r) => `${r.kind}|${r.amountMinor}|${r.currency}`;
const rowSet = (rows) => [...new Set(rows.map(rowKey))].sort().join(',');
const amountKey = (a) => (a ? `${a.kind}|${a.amountMinor}|${a.currency}` : null);
const rate = (agree, n) => (n ? Math.round((agree / n) * 10000) / 10000 : null);
const count = (agree, n, extra = {}) => ({ agree, n, rate: rate(agree, n), ...extra });

export const expectedAgrees = (a, b) =>
  a.expected || b.expected
    ? amountKey(a.expected) === amountKey(b.expected)
    : a.expectedReason === b.expectedReason;
export const rowsAgree = (a, b) => rowSet(a.displayed) === rowSet(b.displayed);
/** true, false, or null when no displayed row (by kind and amount) was recorded by both. */
export function currencyAgrees(a, b) {
  let compared = false;
  for (const ra of a.displayed)
    for (const rb of b.displayed)
      if (ra.kind === rb.kind && ra.amountMinor === rb.amountMinor) {
        compared = true;
        if (ra.currency !== rb.currency) return false;
      }
  return compared ? true : null;
}
export const coreAgrees = (a, b) =>
  a.readable === b.readable &&
  rowsAgree(a, b) &&
  expectedAgrees(a, b) &&
  (a.expectedReason ?? null) === (b.expectedReason ?? null) &&
  (a.currencyEvidence ?? null) === (b.currencyEvidence ?? null) &&
  (a.currencyConflict ?? null) === (b.currencyConflict ?? null);

let frameStreams;
const streamOf = (domain) => {
  if (!frameStreams) {
    const frame = JSON.parse(readFileSync(path.join(here, '..', 'retail-frame-3.json'), 'utf8'));
    frameStreams = new Map(frame.domains.map((d) => [d.domain, d.regionGroup === 'us' ? 'us' : 'non-us']));
  }
  return frameStreams.get(domain) ?? 'unknown';
};

/** Currency-undetermined share of real cart-1 and evidence counts per stream, for one set of labels. */
export function currencyReport(labels) {
  const cart1 = labels.filter((l) => l.origin === 'action' && l.state === 'cart-1');
  const undetermined = cart1.filter((l) => l.expectedReason === 'currency-undetermined').length;
  const perStream = {};
  for (const l of labels.filter((x) => x.origin === 'action')) {
    const s = (perStream[streamOf(parseId(l.id)?.domain)] ??= {
      'a-code': 0,
      'b-structured': 0,
      'c-symbol': 0,
      'd-frame': 0,
      currencyConflict: 0,
      'currency-undetermined': 0,
    });
    if (l.currencyEvidence) s[l.currencyEvidence] += 1;
    if (l.currencyConflict) s.currencyConflict += 1;
    if (l.expectedReason === 'currency-undetermined') s['currency-undetermined'] += 1;
  }
  return { realCart1: cart1.length, undetermined, share: rate(undetermined, cart1.length), perStream };
}

/** Compare two parsed labeller files of one split. Throws when they can't be compared. */
export function compare(fa, fb) {
  if (fa.role !== 'labeller' || fb.role !== 'labeller')
    throw new Error('agreement compares two labeller files');
  if (fa.split !== fb.split) throw new Error(`splits differ: ${fa.split} and ${fb.split}`);
  if (fa.labeller.id === fb.labeller.id) throw new Error('the two files have the same labeller');
  const a = new Map(fa.labels.map((l) => [l.id, l]));
  const b = new Map(fb.labels.map((l) => [l.id, l]));
  const onlyA = [...a.keys()].filter((id) => !b.has(id));
  const onlyB = [...b.keys()].filter((id) => !a.has(id));
  if (onlyA.length || onlyB.length)
    throw new Error(
      `the files label different page-states: ${onlyA.length} only in A, ${onlyB.length} only in B`,
    );
  const ids = [...a.keys()].sort();
  for (const id of ids) {
    const [x, y] = [a.get(id), b.get(id)];
    for (const f of ['state', 'origin', 'snapshotSha256', 'domSha256'])
      if (x[f] !== y[f]) throw new Error(`${id}: ${f} differs between the labellers`);
  }
  const tally = (fn) => ids.filter((id) => fn(a.get(id), b.get(id))).length;
  const cur = ids.map((id) => currencyAgrees(a.get(id), b.get(id)));
  const tags = {};
  for (const tag of OBSERVED_TAGS) {
    const t = { both: 0, onlyA: 0, onlyB: 0, neither: 0 };
    for (const id of ids) {
      const [ha, hb] = [a.get(id).observedTags.includes(tag), b.get(id).observedTags.includes(tag)];
      t[ha && hb ? 'both' : ha ? 'onlyA' : hb ? 'onlyB' : 'neither'] += 1;
    }
    if (t.both || t.onlyA || t.onlyB) tags[tag] = { ...t, rate: rate(t.both + t.neither, ids.length) };
  }
  return {
    split: fa.split,
    labellers: [fa.labeller.id, fb.labeller.id],
    n: ids.length,
    expected: count(tally(expectedAgrees), ids.length),
    currency: count(cur.filter((v) => v === true).length, cur.filter((v) => v !== null).length, {
      notComparable: cur.filter((v) => v === null).length,
    }),
    rows: count(tally(rowsAgree), ids.length),
    readable: count(
      tally((x, y) => x.readable === y.readable),
      ids.length,
    ),
    tags,
    disagreements: ids.filter((id) => !coreAgrees(a.get(id), b.get(id))),
    currencyUndetermined: { a: currencyReport(fa.labels), b: currencyReport(fb.labels) },
  };
}

/** The agreed page-state's final label. */
function agreedLabel(x, y) {
  return {
    ...x,
    observedTags: OBSERVED_TAGS.filter((t) => x.observedTags.includes(t) || y.observedTags.includes(t)),
    confidence: x.confidence === 'low' || y.confidence === 'low' ? 'low' : 'high',
    notes: '',
  };
}

/** Merge agreed labels and adjudicated decisions into a final label file (parsed objects in, object out). */
export function merge(fa, fb, adjudication, report, sources = {}) {
  const adj = Adjudication.parse(adjudication);
  if (adj.split !== fa.split) throw new Error(`adjudication is for ${adj.split}, labels for ${fa.split}`);
  if ([fa.labeller.id, fb.labeller.id].includes(adj.adjudicator.id))
    throw new Error('the adjudicator is one of the labellers');
  const dis = new Set(report.disagreements);
  const decided = new Map();
  for (const d of adj.decisions) {
    if (!dis.has(d.id)) throw new Error(`${d.id}: adjudicated but not a disagreement`);
    if (decided.has(d.id)) throw new Error(`${d.id}: decided twice`);
    if (d.label.id !== d.id) throw new Error(`${d.id}: decision label has id ${d.label.id}`);
    decided.set(d.id, d.label);
  }
  const missing = report.disagreements.filter((id) => !decided.has(id));
  if (missing.length) throw new Error(`disagreements without a decision: ${missing.join(', ')}`);
  const b = new Map(fb.labels.map((l) => [l.id, l]));
  const labels = [...fa.labels]
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .map((x) => {
      if (!decided.has(x.id)) return agreedLabel(x, b.get(x.id));
      const d = decided.get(x.id);
      for (const f of ['split', 'state', 'origin', 'snapshotSha256', 'domSha256'])
        if (d[f] !== x[f]) throw new Error(`${x.id}: decision ${f} is not the labelled page-state's`);
      return d;
    });
  const final = {
    schema: LABEL_SCHEMA,
    role: 'final',
    split: fa.split,
    sources,
    adjudicated: [...decided.keys()].sort(),
    labels,
  };
  const v = validateLabelFile(final);
  if (!v.ok)
    throw new Error(
      `final labels invalid: ${v.problems.map((p) => `${p.id ?? ''} ${p.message}`).join('; ')}`,
    );
  return final;
}

/** Stop rules of the protocol on a report (with the final labels' currency report when merged). */
export function stopRules(report) {
  const stop = [];
  if (report.expected.n && report.expected.rate < STOP_EXPECTED_AGREEMENT)
    stop.push('expected-agreement-below-90');
  const cu = report.currencyUndetermined;
  const shares = cu.final ? [cu.final.share] : [cu.a.share, cu.b.share];
  if (shares.some((s) => s !== null && s > STOP_CURRENCY_UNDETERMINED))
    stop.push('currency-undetermined-above-10');
  return stop;
}

function main(argv) {
  const opt = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const [fileA, fileB] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const adjFile = opt('--adjudication');
  const out = opt('--out');
  if (!fileA || !fileB || Boolean(adjFile) !== Boolean(out)) {
    console.error(
      'usage: agreement.mjs <labeller-a.json> <labeller-b.json> [--adjudication <file> --out <final.json>] [--report <file>]',
    );
    return 2;
  }
  const [fa, fb] = [readLabelFile(fileA), readLabelFile(fileB)];
  const report = compare(fa, fb);
  if (adjFile) {
    const sources = {
      labellerA: { file: path.basename(fileA), sha256: fileSha(fileA) },
      labellerB: { file: path.basename(fileB), sha256: fileSha(fileB) },
      adjudication: { file: path.basename(adjFile), sha256: fileSha(adjFile) },
    };
    const final = merge(fa, fb, JSON.parse(readFileSync(adjFile, 'utf8')), report, sources);
    writeFileSync(out, JSON.stringify(final, null, 1) + '\n');
    report.final = { file: out, sha256: fileSha(out), labels: final.labels.length };
    report.currencyUndetermined.final = currencyReport(final.labels);
  }
  report.stop = stopRules(report);
  const text = JSON.stringify(report, null, 1);
  if (opt('--report')) writeFileSync(opt('--report'), text + '\n');
  console.log(text);
  if (report.stop.length)
    console.error(`STOP before the freeze and report to Evan: ${report.stop.join(', ')}`);
  return report.stop.length ? 3 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  }
}
