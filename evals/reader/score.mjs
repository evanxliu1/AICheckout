#!/usr/bin/env node
// Score one logged reader run against the frozen labels (docs/evals/generic-reader-protocol.md, Scoring, Pass bar,
// Reporting). Refuses a run that is not in runs.json (runs are logged before their results are read), a held-out
// run whose row is not in the committed `HEAD:evals/reader/runs.json`, a freeze that fails freeze.mjs's check, and a
// run made on other frozen labels than the current ones.
//
// Outcomes per page-state (E = the label's expected):
//   shown-correct  shown, E not null, same currency, same kind as E and the same amountMinor
//   shown-wrong    shown and not shown-correct (wrong amount, kind or currency, or anything shown when E is null)
//   withheld       withheld; sub-counts withheld with E not null (a coverage miss) and with E null (correct)
//   missing        no output, or a harness error on the page (class `harness-error`); a run with any missing real
//                  page-state cannot pass
// A crash or an unstable stability pair scores as withheld. Precision = shown-correct / shown, with the exact
// one-sided 95% Clopper–Pearson upper bound of the wrong rate and Wilson 95% intervals at three levels: page-state,
// site cluster (a site fails if any of its shown amounts is wrong) and operator cluster (operator from
// retail-frame-3.json; scoring only). Coverage = shown-correct / page-states with E not null, cart-other excluded; a
// cluster's coverage is `allEligibleShownCorrect` (every such page-state of the cluster shown-correct). Rule-of-three
// bounds for every zero count. Breakdowns: stream, state, region group, USD or not, currency (E's, at least 5 sites),
// observed tag. Timing: p95 (nearest rank) over every timed read of the split's real page-states. Criterion 1: page
// upper bound <= 1% and p95 <= 50 ms on the whole split; evidence only on a held-out split. Variants (per transform,
// with the manifest's eligible and skip counts) and the legacy adapters are reported apart, never pooled, and are
// outside criterion 1 and p95. Errata (`evals/merchants/errata/<split>.json`, `reader-errata.1`) are scored beside
// the frozen labels, never instead; only accepted errata apply.
//
//   node evals/reader/score.mjs --run <runId> [--class-only] [--failures] [--record]
//   options: --freeze <freeze.json> --data <capture/data> --variant-data <dir> --runs <runs.json> --runs-dir <dir>
//            --errata <dir>
// --class-only prints counts per class and stream (and per variant transform) only: no domain, amount or text.
// --failures lists failing page-state IDs with their class: development only. --record writes the aggregate metrics
// into the run's runs.json row.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Label, Note, SPLITS } from '../merchants/labels/schema.mjs';
import {
  DEFAULTS,
  REPO_ROOT,
  RUN_LIMITS,
  isHeldout,
  loadFrozen,
  parseId,
  parseRuns,
  readRuns,
  runsUsed,
  updateRun,
} from './lib.mjs';
import { clopperPearsonUpper, percentile, proportion } from './stats.mjs';

export const PRECISION_BAR = 0.01;
export const P95_BAR_MS = 50;
export const MIN_CURRENCY_SITES = 5;
export const STREAM_STATEMENT =
  'A whole-split pass says nothing about either stream alone; each stream has its own bound and coverage.';
const round = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6);

/** Outcome of one output against one label: 'shown-correct' | 'shown-wrong' | 'withheld'. */
export function outcome(label, output) {
  if (!output?.shown) return 'withheld';
  const e = label.expected;
  if (!e) return 'shown-wrong';
  return output.currency === e.currency && output.kind === e.kind && output.amountMinor === e.amountMinor
    ? 'shown-correct'
    : 'shown-wrong';
}

/**
 * Failure class from the label and the output alone (protocol, Class-only analysis). Classes that need the page
 * (region-wrong, distractor-accepted, amount-parse) are left as `needs-analyst` for the class-only analyst.
 */
export function failureClass(label, output) {
  const e = label.expected;
  if (!output?.shown) return e ? 'coverage-miss' : null;
  if (!e)
    return (
      {
        'not-readable': 'unreadable-shown',
        'ambiguous-preferred-kind': 'tie-shown',
        'currency-undetermined': 'currency',
      }[label.expectedReason] ?? 'needs-analyst'
    );
  if (output.currency !== e.currency) return 'currency';
  if (output.kind !== e.kind) return 'kind-wrong';
  if (output.amountMinor !== e.amountMinor) return 'needs-analyst';
  return null;
}

/** Scored rows, one per label, joined with its output (`pick` chooses the generic or legacy reads) and the frame. */
export function scoreRows(labels, outputs, frame, pick = (o) => o) {
  return labels.map((l) => {
    const { domain, transform } = parseId(l.id);
    const f = frame.get(domain);
    if (!f) throw new Error(`${l.id}: domain not in the frozen frame`);
    const raw = outputs.get(l.id);
    const harnessError = Boolean(raw?.harnessError);
    const o = raw && !harnessError ? pick(raw) : null;
    const res = o ? outcome(l, o.output) : 'missing';
    return {
      id: l.id,
      domain,
      operator: f.operator,
      stream: f.stream,
      regionGroup: f.regionGroup,
      state: l.state,
      transform,
      currency: l.expected?.currency ?? null,
      tags: l.observedTags,
      expected: l.expected !== null,
      coverageEligible: l.expected !== null && l.state !== 'cart-other',
      outcome: res,
      class: harnessError ? 'harness-error' : o ? failureClass(l, o.output) : null,
      crash: Boolean(o?.crash),
      unstable: Boolean(o && o.stable === false),
      inconsistent: Boolean(o && !o.crash && o.consistent === false),
      readMs: o?.readMs ?? [],
      overBudget: (o?.readMs ?? []).some((ms) => ms > P95_BAR_MS),
    };
  });
}

function wrongRate(wrong, n) {
  return { ...proportion(wrong, n), clopperPearsonUpper95: round(clopperPearsonUpper(wrong, n)) };
}

/** Cluster-level precision and coverage, clustered by `key` ('domain' or 'operator'). */
function clusterLevel(rows, key) {
  const by = new Map();
  for (const r of rows) by.set(r[key], [...(by.get(r[key]) ?? []), r]);
  const groups = [...by.values()];
  const shown = groups.filter((g) => g.some((r) => r.outcome.startsWith('shown')));
  const failing = shown.filter((g) => g.some((r) => r.outcome === 'shown-wrong'));
  const eligible = groups.filter((g) => g.some((r) => r.coverageEligible));
  const covered = eligible.filter((g) =>
    g.filter((r) => r.coverageEligible).every((r) => r.outcome === 'shown-correct'),
  );
  return {
    n: groups.length,
    wrongRate: wrongRate(failing.length, shown.length),
    precision: proportion(shown.length - failing.length, shown.length),
    allEligibleShownCorrect: proportion(covered.length, eligible.length),
  };
}

/** Outcome counts and bounds of a set of rows at page-state, site and operator level. */
export function summarize(rows) {
  const count = (pred) => rows.filter(pred).length;
  const correct = count((r) => r.outcome === 'shown-correct');
  const wrong = count((r) => r.outcome === 'shown-wrong');
  return {
    pageStates: rows.length,
    sites: new Set(rows.map((r) => r.domain)).size,
    operators: new Set(rows.map((r) => r.operator)).size,
    counts: {
      shownCorrect: correct,
      shownWrong: wrong,
      withheld: count((r) => r.outcome === 'withheld'),
      withheldExpected: count((r) => r.outcome === 'withheld' && r.expected),
      withheldNull: count((r) => r.outcome === 'withheld' && !r.expected),
      missing: count((r) => r.outcome === 'missing'),
      harnessError: count((r) => r.class === 'harness-error'),
      crash: count((r) => r.crash),
      unstable: count((r) => r.unstable),
    },
    pageState: {
      wrongRate: wrongRate(wrong, correct + wrong),
      precision: proportion(correct, correct + wrong),
      coverage: proportion(
        count((r) => r.coverageEligible && r.outcome === 'shown-correct'),
        count((r) => r.coverageEligible),
      ),
    },
    siteCluster: clusterLevel(rows, 'domain'),
    operatorCluster: clusterLevel(rows, 'operator'),
  };
}

const groupBy = (rows, keyOf) => {
  const out = new Map();
  for (const r of rows)
    for (const k of [keyOf(r)].flat()) if (k != null) out.set(k, [...(out.get(k) ?? []), r]);
  return Object.fromEntries([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
};
const mapValues = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

export function timing(rows) {
  const reads = rows.flatMap((r) => r.readMs);
  return {
    timedReads: reads.length,
    p95Ms: percentile(reads),
    maxMs: reads.length ? Math.max(...reads) : null,
    pageStatesOverBudget: rows.filter((r) => r.overBudget).length,
  };
}

/** Criterion 1 on the whole split's real page-states. */
export function criterion1(rows, split) {
  const s = summarize(rows);
  const t = timing(rows);
  const upper = s.pageState.wrongRate.clopperPearsonUpper95;
  const complete = s.counts.missing === 0;
  const precisionMet = upper !== null && upper <= PRECISION_BAR;
  const timeMet = t.p95Ms !== null && t.p95Ms <= P95_BAR_MS;
  return {
    evidence: isHeldout(split),
    wrongRateUpper95: upper,
    siteClusterUpper95: s.siteCluster.wrongRate.clopperPearsonUpper95,
    operatorClusterUpper95: s.operatorCluster.wrongRate.clopperPearsonUpper95,
    p95Ms: t.p95Ms,
    complete,
    precisionMet,
    timeMet,
    passed: complete && precisionMet && timeMet,
    streams: STREAM_STATEMENT,
  };
}

/** Counts per class and stream only. */
export function classCounts(rows, keyOf = (r) => r.stream) {
  const out = {};
  for (const r of rows) {
    const s = (out[keyOf(r)] ??= {});
    const add = (c) => (s[c] = (s[c] ?? 0) + 1);
    if (r.class) add(r.class);
    if (r.crash) add('crash');
    if (r.unstable || r.inconsistent) add('stability');
    if (r.overBudget) add('over-budget');
    if (r.outcome === 'missing' && r.class !== 'harness-error') add('missing');
  }
  return out;
}

/** Variants apart: per transform with bounds and classes, plus the manifest's eligible, generated and skip counts. */
function variantReport(rows, manifest) {
  return {
    labelled: rows.length,
    scored: rows.filter((r) => r.outcome !== 'missing').length,
    robotPages: 'robot captures have no variants',
    eligible: manifest?.counts?.eligible ?? null,
    generated: manifest?.counts?.generated ?? null,
    skips: { byReason: manifest?.skips?.byReason ?? {}, byTransform: manifest?.skips?.byTransform ?? {} },
    byTransform: mapValues(
      groupBy(rows, (r) => r.transform),
      (rs) => ({ ...summarize(rs), shownWrongByClass: shownWrongClasses(rs) }),
    ),
  };
}
function shownWrongClasses(rows) {
  const out = {};
  for (const r of rows.filter((x) => x.outcome === 'shown-wrong')) out[r.class] = (out[r.class] ?? 0) + 1;
  return out;
}

/** Full aggregate report (text-free: no domain, amount or page text). */
export function report({ split, runId, labels, outputs, frame, variantLabels = [], variantManifest = null }) {
  const real = scoreRows(labels, outputs, frame).filter((r) => r.transform === null);
  const variants = scoreRows(variantLabels, outputs, frame);
  const legacyRows = scoreRows(
    labels.filter((l) => outputs.get(l.id)?.legacy),
    outputs,
    frame,
    (o) => o.legacy,
  );
  const sitesPer = (rows) => new Set(rows.map((r) => r.domain)).size;
  const currencies = groupBy(real, (r) => r.currency);
  return {
    runId,
    split,
    criterion1: criterion1(real, split),
    whole: summarize(real),
    timing: timing(real),
    byStream: mapValues(
      groupBy(real, (r) => r.stream),
      summarize,
    ),
    byState: mapValues(
      groupBy(real, (r) => r.state),
      summarize,
    ),
    byRegionGroup: mapValues(
      groupBy(real, (r) => r.regionGroup),
      summarize,
    ),
    byUsd: mapValues(
      groupBy(real, (r) => (r.currency === null ? 'no-expected' : r.currency === 'USD' ? 'USD' : 'non-USD')),
      summarize,
    ),
    byCurrency: mapValues(
      Object.fromEntries(Object.entries(currencies).filter(([, rows]) => sitesPer(rows) >= MIN_CURRENCY_SITES)),
      summarize,
    ),
    currenciesBelowMinSites: Object.keys(currencies).filter((c) => sitesPer(currencies[c]) < MIN_CURRENCY_SITES)
      .length,
    byObservedTag: mapValues(
      groupBy(real, (r) => r.tags),
      summarize,
    ),
    variants: variantReport(variants, variantManifest),
    legacy: { pageStates: legacyRows.length, ...summarize(legacyRows), timing: timing(legacyRows) },
    classes: classCounts(real),
  };
}

export const ERRATA_SCHEMA = 'reader-errata.1';
const Erratum = z.strictObject({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  old: Label,
  new: Label,
  evidence: Note,
  foundBy: z.string().min(1),
  triggeredByReaderOutput: z.boolean(),
  adjudicator: z.strictObject({
    agent: z.string().min(1),
    decision: z.enum(['accepted', 'rejected']),
    reason: Note,
  }),
});
export const ErrataFile = z.strictObject({
  schema: z.literal(ERRATA_SCHEMA),
  split: z.enum(SPLITS),
  errata: z.array(Erratum),
});

/** Validate an errata file against the frozen labels and apply its accepted errata. Throws on any problem. */
export function applyErrata(labels, data, split) {
  const f = ErrataFile.parse(data);
  if (f.split !== split) throw new Error(`errata are for ${f.split}, the run is on ${split}`);
  const byId = new Map(labels.map((l) => [l.id, l]));
  const seen = new Set();
  const fixed = new Map();
  for (const e of f.errata) {
    if (seen.has(e.id)) throw new Error(`erratum ${e.id}: duplicate`);
    seen.add(e.id);
    if (e.old.id !== e.id || e.new.id !== e.id) throw new Error(`erratum ${e.id}: old or new has another id`);
    if (e.new.split !== split) throw new Error(`erratum ${e.id}: new label is not in ${split}`);
    const frozen = byId.get(e.id);
    if (!frozen) throw new Error(`erratum ${e.id}: not a frozen label of ${split}`);
    if (!isDeepStrictEqual(Label.parse(frozen), e.old)) throw new Error(`erratum ${e.id}: old is not the frozen label`);
    if (e.adjudicator.decision === 'accepted') fixed.set(e.id, e.new);
  }
  return {
    errata: f.errata.length,
    accepted: fixed.size,
    rejected: f.errata.length - fixed.size,
    readerTriggered: f.errata.filter((e) => e.triggeredByReaderOutput).length,
    labels: labels.map((l) => fixed.get(l.id) ?? l),
  };
}

function readOutputs(file) {
  const out = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (out.has(row.id)) throw new Error(`${row.id}: two outputs in ${file}`);
    out.set(row.id, row);
  }
  return out;
}

/** A held-out run's row must be in runs.json as committed at HEAD. */
function requireCommittedRow(root, runsPath, runId) {
  const rel = path.relative(root, runsPath).split(path.sep).join('/');
  let text;
  try {
    text = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    throw new Error(`HEAD:${rel} is not readable; commit the held-out run's started row before scoring`);
  }
  if (!parseRuns(text).runs.some((r) => r.runId === runId))
    throw new Error(`run ${runId} is not in the committed HEAD:${rel}; commit the started row before scoring`);
}

/** Score a logged run. Returns the report (or class counts with classOnly). */
export function score({
  runId,
  classOnly = false,
  failures = false,
  record = false,
  root = REPO_ROOT,
  freezeFile = DEFAULTS.freeze,
  data = DEFAULTS.data,
  variantData = DEFAULTS.variantData,
  runsFile = DEFAULTS.runs,
  runsDir = DEFAULTS.runsDir,
  errataDir = DEFAULTS.errata,
}) {
  if (!runId) throw new Error('--run is required');
  const runsPath = path.resolve(root, runsFile);
  const runs = readRuns(runsPath);
  const row = runs.runs.find((r) => r.runId === runId);
  if (!row) throw new Error(`run ${runId} is not logged in runs.json; a run is logged before it is scored`);
  if (failures && isHeldout(row.split))
    throw new Error('--failures lists page-states; held-out results are analysed by class only');
  if (isHeldout(row.split)) requireCommittedRow(root, runsPath, runId);
  const frozen = loadFrozen({
    root,
    freezeFile,
    paneData: path.join(path.resolve(root, data), 'pane'),
    variantData: path.resolve(root, variantData),
  });
  const labels = frozen.labels(row.split);
  const variants = frozen.variants(row.split);
  if (labels.sha256 !== row.frozenLabelSha256 || variants.sha256 !== row.frozenVariantLabelSha256)
    throw new Error(`run ${runId} was made on other frozen labels than the current freeze`);
  const outputs = readOutputs(path.resolve(root, runsDir, runId, 'outputs.jsonl'));
  const known = new Set([...labels.labels, ...variants.labels].map((l) => l.id));
  for (const id of outputs.keys())
    if (!known.has(id)) throw new Error(`an output has no frozen label in ${row.split}`);
  const frame = frozen.frame();
  if (classOnly) {
    const real = scoreRows(labels.labels, outputs, frame).filter((r) => r.transform === null);
    const v = scoreRows(variants.labels, outputs, frame);
    return {
      runId,
      split: row.split,
      classes: classCounts(real),
      variantClasses: classCounts(v, (r) => r.transform),
    };
  }
  const out = {
    runStatus: row.status,
    heldoutRuns: isHeldout(row.split)
      ? { run: row.heldoutRun, used: runsUsed(runs, row.split), limit: RUN_LIMITS[row.split] }
      : null,
    freezeChangedSinceRun: row.freezeSha256 !== frozen.freezeSha256,
    ...report({
      split: row.split,
      runId,
      labels: labels.labels,
      outputs,
      frame,
      variantLabels: variants.labels,
      variantManifest: variants.manifest,
    }),
  };
  const errataFile = path.resolve(root, errataDir, `${row.split}.json`);
  if (existsSync(errataFile)) {
    const fixed = applyErrata(
      [...labels.labels, ...variants.labels],
      JSON.parse(readFileSync(errataFile, 'utf8')),
      row.split,
    );
    const real = scoreRows(fixed.labels, outputs, frame).filter((r) => r.transform === null);
    out.correctedLabels = {
      errata: fixed.errata,
      accepted: fixed.accepted,
      rejected: fixed.rejected,
      readerTriggered: fixed.readerTriggered,
      criterion1: criterion1(real, row.split),
      whole: summarize(real),
    };
  }
  if (failures)
    out.failures = scoreRows([...labels.labels, ...variants.labels], outputs, frame)
      .filter((r) => r.class || r.crash || r.unstable || r.inconsistent)
      .map((r) => ({ id: r.id, outcome: r.outcome, class: r.class, crash: r.crash, unstable: r.unstable }));
  if (record) {
    const c = out.criterion1;
    updateRun(runsPath, runId, {
      metrics: {
        shownCorrect: out.whole.counts.shownCorrect,
        shownWrong: out.whole.counts.shownWrong,
        withheld: out.whole.counts.withheld,
        missing: out.whole.counts.missing,
        precision: out.whole.pageState.precision.rate,
        wrongRateUpper95: c.wrongRateUpper95,
        siteClusterUpper95: c.siteClusterUpper95,
        operatorClusterUpper95: c.operatorClusterUpper95,
        coverage: out.whole.pageState.coverage.rate,
        p95Ms: c.p95Ms,
        criterion1Passed: c.passed,
      },
    });
  }
  return out;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const opts = {
    runId: arg('--run'),
    classOnly: argv.includes('--class-only'),
    failures: argv.includes('--failures'),
    record: argv.includes('--record'),
  };
  for (const [flag, key] of [
    ['--freeze', 'freezeFile'],
    ['--data', 'data'],
    ['--variant-data', 'variantData'],
    ['--runs', 'runsFile'],
    ['--runs-dir', 'runsDir'],
    ['--errata', 'errataDir'],
  ])
    if (arg(flag)) opts[key] = arg(flag);
  console.log(JSON.stringify(score(opts), null, 1));
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
