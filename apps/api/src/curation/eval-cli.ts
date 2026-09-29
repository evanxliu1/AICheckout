import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { buildContext, PROMPT_VERSION } from './context.ts';
import { createCodexProvider, type CodexOptions } from './codex.ts';
import { runExtraction } from './runner.ts';
import {
  abstainingProvider,
  corpusHash,
  evaluateCorpus,
  ledgerBundleSchema,
  observationFromRun,
  validateCorpus,
  type EvalObservation,
} from './evaluation.ts';

// Agentic CLIs are slower than a raw completion call; allow longer attempts than the hosted defaults.
const CODEX_LIMITS = { attemptTimeoutMs: 240_000, totalTimeoutMs: 480_000, maxOutputTokens: 8192 };

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
    `**${PROVENANCE_NOTE[report.provenance]}**\n\n` +
    (report.configuration
      ? `Provider: ${report.configuration.provider.id} · model \`${report.configuration.provider.model}\` · prompt ${report.configuration.versions.prompt}.\n\n`
      : '') +
    `Corpus: ${report.corpus.version}; split: ${report.corpus.split}; labels: ${report.corpus.annotationStatus}.\n\n` +
    `Corpus SHA-256: \`${report.corpus.hash}\`. Evaluator: ${report.evaluatorVersion}.\n\n` +
    `Observed ${report.observed}/${report.planned} cases. ${report.complete ? 'Complete selected set.' : `Missing: ${report.missing.join(', ')}.`}\n\n` +
    '| Measure | Result |\n| --- | --- |\n' +
    rows.map(([name, value]) => `| ${name} | ${value} |`).join('\n') +
    `\n\nRecorded execution: p50 ${report.execution.p50Ms ?? 'n/a'} ms; p95 ${report.execution.p95Ms ?? 'n/a'} ms; ${report.execution.accountedMicrousd} accounted micro-USD. Latency is wall-clock time per case as measured by the runner.\n\n` +
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
const PROVENANCE_NOTE = {
  'scripted-diagnostic': 'Scripted diagnostic — no model was called.',
  'live-collected': 'Live model run collected by this CLI.',
  'imported-traces-unverified': 'Imported trace analysis — provenance is not independently verified.',
} as const;

/** Run `task` over `items` with at most `limit` in flight, preserving input order. */
async function mapConcurrent<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index], index);
      }
    }),
  );
  return results;
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
      // codex mode: live extraction through the local Codex CLI (ChatGPT subscription).
      model: { type: 'string' },
      effort: { type: 'string', default: 'low' },
      concurrency: { type: 'string', default: '3' },
      limit: { type: 'string' },
    },
  });
  if (
    !['fixture', 'codex', 'replay', 'ledger'].includes(values.mode) ||
    !['development', 'reserved', 'all'].includes(values.split)
  )
    throw new Error('Use fixture/codex/replay/ledger mode and development/reserved/all split.');
  if (values.split !== 'development' && !values['allow-reserved'])
    throw new Error(
      'Reserved cases require explicit --allow-reserved; do not tune prompts on their results.',
    );
  const imports = values.mode === 'replay' || values.mode === 'ledger';
  if (imports !== Boolean(values.observations) || (values.check && values.mode !== 'fixture'))
    throw new Error('Replay/ledger requires --observations; --check is only for scripted diagnostics.');
  if ((values.mode === 'codex') !== Boolean(values.model))
    throw new Error('Codex mode requires --model (and --model is only used by codex mode).');
  const split = values.split as 'development' | 'reserved' | 'all';
  const corpus = validateCorpus(await jsonFile(resolve(root, values.corpus), 4 * 1024 * 1024));
  let bundle: unknown;
  if (values.mode === 'codex') {
    const concurrency = Number(values.concurrency),
      limit = values.limit === undefined ? Infinity : Number(values.limit);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
      throw new Error('--concurrency must be an integer from 1 to 8.');
    if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1))
      throw new Error('--limit must be a positive integer.');
    const provider = await createCodexProvider({
      model: values.model!,
      reasoningEffort: values.effort as CodexOptions['reasoningEffort'],
    });
    const cases = corpus.cases.filter((item) => split === 'all' || item.split === split).slice(0, limit);
    const observations = await mapConcurrent(cases, concurrency, async (item, index) => {
      const trace = await runExtraction(item.input, provider, { limits: CODEX_LIMITS });
      console.log(`[${index + 1}/${cases.length}] ${item.id}: ${trace.status} (${trace.durationMs} ms)`);
      return { caseId: item.id, input: item.input, context: buildContext(item.input), trace };
    });
    bundle = {
      schemaVersion: 1,
      corpusHash: corpusHash(corpus),
      experiment: `codex.${provider.model}.${values.effort}.${PROMPT_VERSION}`.toLowerCase(),
      provenance: 'live-collected',
      observations,
    };
  } else if (values.mode === 'fixture') {
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
