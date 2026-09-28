import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { buildContext } from './context';
import { runExtraction } from './runner';
import {
  abstainingProvider,
  corpusHash,
  evaluateCorpus,
  ledgerBundleSchema,
  observationFromRun,
  validateCorpus,
  type EvalObservation,
} from './evaluation';

async function jsonFile(path: string, max: number) {
  const info = await stat(path);
  if (!info.isFile() || info.size > max)
    throw new Error('Evaluation input must be a bounded regular JSON file.');
  const bytes = await readFile(path);
  if (bytes.byteLength > max) throw new Error('Evaluation input is too large.');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Evaluation input must be valid UTF-8 JSON.');
  }
}
function markdown(report: ReturnType<typeof evaluateCorpus>) {
  const metric = (value: { correct: number; total: number; rate: number | null }) =>
    `${value.correct}/${value.total} (${value.rate === null ? 'n/a' : `${(value.rate * 100).toFixed(2)}%`})`;
  const rows = report.metrics
    ? [
        ['Exact field agreement', metric(report.metrics.exactFieldAgreement)],
        ['Known fact precision', metric(report.metrics.knownFactPrecision)],
        ['Known fact recall', metric(report.metrics.knownFactRecall)],
        ['Incorrect/unsupported known claims', report.metrics.unsupportedKnownClaims],
        ['Condition evidence coverage', metric(report.metrics.conditionEvidenceCoverage)],
        ['Required issue evidence coverage', metric(report.metrics.issueEvidenceCoverage)],
        ['Unnecessary field abstentions', report.metrics.unnecessaryAbstentions],
        ['False clear cases', report.metrics.falseClearCases],
        [
          'Refusals / operational failures',
          `${report.metrics.refusals} / ${report.metrics.operationalFailures}`,
        ],
      ]
    : [['Aggregate scores', 'Withheld: observations are incomplete.']];
  return (
    `# Curation evaluation: ${report.experiment}\n\n` +
    `**${report.provenance === 'scripted-diagnostic' ? 'Scripted diagnostic — no model was called.' : 'Imported trace analysis — provenance is not independently verified.'}**\n\n` +
    `Corpus: ${report.corpus.version}; split: ${report.corpus.split}; labels: ${report.corpus.annotationStatus}.\n\n` +
    `Corpus SHA-256: \`${report.corpus.hash}\`. Evaluator: ${report.evaluatorVersion}.\n\n` +
    `Observed ${report.observed}/${report.planned} cases. ${report.complete ? 'Complete selected set.' : `Missing: ${report.missing.join(', ')}.`}\n\n` +
    '| Measure | Result |\n| --- | --- |\n' +
    rows.map(([name, value]) => `| ${name} | ${value} |`).join('\n') +
    `\n\nRecorded execution: p50 ${report.execution.p50Ms ?? 'n/a'} ms; p95 ${report.execution.p95Ms ?? 'n/a'} ms; ${report.execution.accountedMicrousd} accounted micro-USD. These are fixture measurements or imported trace values, not independently verified provider latency/billing.\n\n` +
    report.limitations.map((value) => `- ${value}`).join('\n') +
    '\n\n' +
    '| Case | Outcome | Field errors | Missed conditions | Missed issues | False clear |\n| --- | --- | ---: | ---: | ---: | --- |\n' +
    report.cases
      .map(
        (value) =>
          `| ${value.caseId} | ${value.status} | ${value.fieldErrors.length} | ${value.missedConditions.length} | ${value.missedIssues.length} | ${value.falseClear ? 'yes' : 'no'} |`,
      )
      .join('\n') +
    '\n'
  );
}
export async function runEvaluationCli(args: string[], root: string) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      mode: { type: 'string', default: 'fixture' },
      corpus: { type: 'string', default: 'evals/curation/corpus.v1.json' },
      split: { type: 'string', default: 'development' },
      observations: { type: 'string' },
      output: { type: 'string' },
      'allow-reserved': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
    },
  });
  if (
    !['fixture', 'replay', 'ledger'].includes(values.mode) ||
    !['development', 'reserved', 'all'].includes(values.split)
  )
    throw new Error('Use fixture/replay/ledger mode and development/reserved/all split.');
  if (values.split !== 'development' && !values['allow-reserved'])
    throw new Error(
      'Reserved cases require explicit --allow-reserved; do not tune prompts on their results.',
    );
  if (values.mode !== 'fixture' ? !values.observations || values.check : Boolean(values.observations))
    throw new Error('Replay/ledger requires --observations; --check is only for scripted diagnostics.');
  const split = values.split as 'development' | 'reserved' | 'all';
  const corpus = validateCorpus(await jsonFile(resolve(root, values.corpus), 4 * 1024 * 1024));
  let bundle: unknown;
  if (values.mode === 'fixture') {
    const observations: EvalObservation[] = [];
    for (const item of corpus.cases.filter((item) => split === 'all' || item.split === split)) {
      // Only captured inputs enter the harness. Reference labels stay in the scorer.
      observations.push({
        caseId: item.id,
        input: item.input,
        context: buildContext(item.input),
        trace: await runExtraction(item.input, abstainingProvider()),
      });
    }
    bundle = {
      schemaVersion: 1,
      corpusHash: corpusHash(corpus),
      experiment: 'abstain-baseline.1',
      provenance: 'scripted-diagnostic',
      observations,
    };
  } else {
    const imported = await jsonFile(resolve(root, values.observations!), 32 * 1024 * 1024);
    if (values.mode === 'ledger') {
      const manifest = ledgerBundleSchema.parse(imported);
      bundle = {
        schemaVersion: 1,
        corpusHash: manifest.corpusHash,
        experiment: manifest.experiment,
        provenance: 'imported-traces-unverified',
        observations: manifest.runs.map((value) => observationFromRun(value.caseId, value.run)),
      };
    } else bundle = { ...imported, provenance: 'imported-traces-unverified' };
  }
  const report = evaluateCorpus(corpus, bundle, split);
  if (values.check) {
    if (
      !report.complete ||
      !report.metrics ||
      report.metrics.knownFactRecall.rate !== 0 ||
      report.execution.accountedMicrousd !== 0 ||
      report.cases.some((value) => value.status !== 'needs_review')
    )
      throw new Error('Scripted abstention diagnostic regressed.');
    console.log(
      `PASS: ${report.observed} synthetic ${split} cases; abstention baseline has zero known-fact recall. No model accuracy is measured.`,
    );
    return report;
  }
  const output = resolve(
    root,
    values.output ??
      `evals/curation/runs/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  );
  // A new directory and exclusive files preserve older experiment evidence.
  await mkdir(resolve(output, '..'), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  await writeFile(join(output, 'observations.json'), JSON.stringify(bundle, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(join(output, 'report.md'), markdown(report), { flag: 'wx', mode: 0o600 });
  console.log(`Saved ${report.provenance} (${report.observed}/${report.planned} cases) to ${output}`);
  if (!report.complete) process.exitCode = 1;
  return report;
}
