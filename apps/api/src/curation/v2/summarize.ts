import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCorpusV2, type LoadedCorpus } from './corpus.ts';
import { evaluate, isHarnessFailure, RETRY_CAP, slotOf, type Report } from './evaluate.ts';
import { RULE_FIELDS, SCORER_VERSION, type CaseScore, type Fraction, type Summary } from './score.ts';

/**
 * Re-scores saved run directories with the current scorer and labels. Nothing is read from a saved
 * report.json: every number comes from observations.json, which is verified against the corpus inputs.
 */
const round = (f: Fraction) => ({ ...f, rate: f.rate === null ? null : Number(f.rate.toFixed(4)) });

/** The headline numbers only, for per-repeat and per-variant breakdowns. */
function brief(summary: Summary) {
  return {
    runs: summary.cases,
    ruleRecall: round(summary.ruleRecall),
    rulePrecision: round(summary.rulePrecision),
    fieldAccuracy: round(summary.fieldAccuracy),
    endToEndFieldAccuracy: round(summary.endToEndFieldAccuracy),
    claimPrecision: round(summary.claimPrecision),
    evidenceValidity: round(summary.evidenceValidity),
    issueRecall: round(summary.issueRecall),
    falseClean: summary.falseClean,
  };
}

function metrics(summary: Summary) {
  return {
    ...brief(summary),
    cardFieldAccuracy: round(summary.cardFieldAccuracy),
    unsupportedClaims: summary.unsupportedClaims,
    issueRecallByCode: Object.fromEntries(
      Object.entries(summary.issueRecallByCode).map(([code, f]) => [code, round(f)]),
    ),
    exclusionRecall: round(summary.exclusionRecall),
    statuses: summary.statuses,
    latencyMs: summary.latencyMs,
    perField: Object.fromEntries(RULE_FIELDS.map((field) => [field, round(summary.perField[field])])),
  };
}

/** Counts the report does not aggregate itself: extra and missed rules and field errors by name. */
function errorCounts(cases: CaseScore[]) {
  const count = (record: Record<string, number>, key: string) => (record[key] = (record[key] ?? 0) + 1);
  const extraRules: Record<string, number> = {},
    missedRules: Record<string, number> = {},
    fieldErrors: Record<string, number> = {};
  for (const c of cases) {
    for (const category of c.extraRules) count(extraRules, category);
    for (const category of c.missedRules) count(missedRules, category);
    for (const e of c.fieldErrors) count(fieldErrors, e.field);
  }
  return {
    extraRules,
    missedRules,
    fieldErrors,
    quotesUnresolved: cases.reduce((n, c) => n + (c.evidence.quotes - c.evidence.resolved), 0),
    quotesGiven: cases.reduce((n, c) => n + c.evidence.quotes, 0),
  };
}

interface FailureLine {
  slot: string;
  runId: string;
}
async function failureCounts(dir: string) {
  const text = await readFile(join(dir, 'failures.jsonl'), 'utf8').catch(() => '');
  const seen = new Set<string>(),
    counts = new Map<string, number>();
  for (const line of text.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as FailureLine;
    if (seen.has(entry.runId)) continue;
    seen.add(entry.runId);
    counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1);
  }
  return counts;
}

const mean = (values: number[]) =>
  values.length ? Math.round(values.reduce((n, v) => n + v, 0) / values.length) : null;

export function summarizeReport(id: string, report: Report, bundle: { observations: unknown[] }) {
  const c = report.configuration;
  const traces = bundle.observations as {
    trace: { context?: { inputTokenEstimate: number }; attempts: { usage?: { outputTokens: number } }[] };
  }[];
  const rejected =
    report.complete &&
    report.harness.retriable === 0 &&
    report.observed > 0 &&
    (report.overall.statuses.provider_error ?? 0) === report.observed;
  return {
    id,
    provider: c.provider.id,
    model: c.provider.model,
    effort: c.effort,
    prompt: c.prompt,
    selection: c.selection,
    split: c.split,
    repeat: c.repeat,
    provenance: report.provenance,
    planned: report.planned,
    observed: report.observed,
    complete: report.complete && report.harness.retriable === 0,
    rejected,
    labelsCollectedWith: report.labels.collectedWith,
    cliVersions: c.provider.cliVersions ?? ['unrecorded'],
    /** Timed-out or provider-failed slots left after retries, and the failed attempts retried before. */
    harness: report.harness,
    /** The harness's own estimate of the prompt (system + user + schema), comparable across providers. */
    promptTokenEstimate: mean(
      traces.flatMap((o) => (o.trace.context ? [o.trace.context.inputTokenEstimate] : [])),
    ),
    /** As reported by each vendor CLI; definitions differ (see results.md). */
    providerOutputTokens: mean(
      traces.flatMap((o) => {
        const usage = o.trace.attempts.at(-1)?.usage;
        return usage ? [usage.outputTokens] : [];
      }),
    ),
    overall: metrics(report.overall),
    byRepeat: report.repeats.map(brief),
    byVariant: Object.fromEntries(Object.entries(report.byVariant).map(([k, s]) => [k, brief(s)])),
    byCategory: report.byCategory,
    errors: errorCounts(report.cases),
  };
}
export type RunRow = ReturnType<typeof summarizeReport>;

/** Every run directory (one with observations.json) under `dirs`, re-scored against `corpus`. */
export async function summarizeRuns(corpusDir: string, dirs: string[]) {
  const loaded: LoadedCorpus = await loadCorpusV2(corpusDir);
  const rows: RunRow[] = [];
  for (const base of dirs) {
    const names = (await readdir(base, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of names) {
      const dir = join(base, name);
      const raw = await readFile(join(dir, 'observations.json'), 'utf8').catch(() => undefined);
      if (!raw) continue;
      const bundle = JSON.parse(raw) as { observations: unknown[] };
      const report = evaluate(loaded, bundle, { failures: await failureCounts(dir) });
      rows.push(summarizeReport(name, report, bundle));
    }
  }
  return {
    scorerVersion: SCORER_VERSION,
    retryCap: RETRY_CAP,
    corpus: {
      version: loaded.corpus.version,
      hash: loaded.hash,
      inputsHash: loaded.inputsHash,
      annotationStatus: loaded.corpus.annotationStatus,
    },
    rows,
  };
}

// Re-exported for scripts that bundle this module.
export { isHarnessFailure, slotOf };
