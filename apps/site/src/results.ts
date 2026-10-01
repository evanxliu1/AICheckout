// Reads docs/evals/results.json (copied into the build at build time) into the rows the results
// page shows. Every number on the page comes from this file; nothing is typed in by hand.
import results from '../../../docs/evals/results.json';

type Rate = { correct: number; total: number; rate: number | null } | undefined;
type Run = {
  id: string;
  provider: string;
  model: string;
  effort: string;
  prompt: string;
  selection: string;
  split: string;
  repeat: number;
  complete: boolean;
  rejected: boolean;
  harness: { failed: number };
  overall: {
    runs: number;
    ruleRecall?: Rate;
    claimPrecision?: Rate;
    endToEndFieldAccuracy?: Rate;
    evidenceValidity?: Rate;
    issueRecall?: Rate;
    issueRecallByCode?: Record<string, Rate>;
    falseClean: number;
    latencyMs: { p50: number; p95: number };
  };
};
export type ResultsFile = {
  generatedAt: string;
  scorerVersion: string;
  corpus: { version: string; annotationStatus: string };
  addedAfter: string[];
  runs: Run[];
};

export type ResultRow = {
  id: string;
  split: 'dev' | 'heldout';
  model: string;
  prompt: string;
  selection: string;
  runs: number;
  repeats: number;
  addedAfter: boolean;
  fieldAccuracy: number | null;
  ruleRecall: number | null;
  claimPrecision: number | null;
  evidenceValidity: number | null;
  issueRecall: number | null;
  injectionRecall: number | null;
  falseClean: number;
  harnessFailures: number;
  p50Ms: number;
  p95Ms: number;
};

const rate = (value: Rate) => (value && value.total > 0 ? value.rate : null);
/** "gpt-5.5 (low)" for the Codex rows, where effort is a real setting; Claude rows ran at one effort. */
export const modelLabel = (run: Pick<Run, 'provider' | 'model' | 'effort'>) =>
  run.provider === 'codex-cli' ? `${run.model} (${run.effort})` : run.model;
const providerOrder = (provider: string) => (provider === 'codex-cli' ? 0 : 1);

export function resultRows(file: ResultsFile = results as ResultsFile): ResultRow[] {
  return file.runs
    .filter((run) => run.complete && !run.rejected)
    .sort(
      (a, b) =>
        providerOrder(a.provider) - providerOrder(b.provider) ||
        modelLabel(a).localeCompare(modelLabel(b)) ||
        a.prompt.localeCompare(b.prompt) ||
        a.selection.localeCompare(b.selection),
    )
    .map((run) => ({
      id: run.id,
      split: run.split === 'heldout' ? 'heldout' : 'dev',
      model: modelLabel(run),
      prompt: run.prompt,
      selection: run.selection.replace(/\.\d+$/, ''),
      runs: run.overall.runs,
      repeats: run.repeat,
      addedAfter: file.addedAfter.includes(run.id),
      fieldAccuracy: rate(run.overall.endToEndFieldAccuracy),
      ruleRecall: rate(run.overall.ruleRecall),
      claimPrecision: rate(run.overall.claimPrecision),
      evidenceValidity: rate(run.overall.evidenceValidity),
      issueRecall: rate(run.overall.issueRecall),
      injectionRecall: rate(run.overall.issueRecallByCode?.['untrusted-instruction']),
      falseClean: run.overall.falseClean,
      harnessFailures: run.harness.failed,
      p50Ms: run.overall.latencyMs.p50,
      p95Ms: run.overall.latencyMs.p95,
    }));
}

export const resultsFile = results as ResultsFile;
export const percent = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
export const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
