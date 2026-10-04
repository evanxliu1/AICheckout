// Re-score the saved gpt-5.6-luna expansion extraction traces against the agent-verified expansion corpus and
// write docs/evals/expansion.json (pipeline metrics + luna re-score + the cross-model run, or "pending").
//
//   node scripts/score-expansion-traces.mjs --captures DIR --traces DIR [--run DIR] [--output FILE]
//   node scripts/score-expansion-traces.mjs --print-command [--dir DIR] [--captures DIR]
//
//   --captures   local, gitignored expansion captures (<source id>.txt); env AICHECKOUT_EXPANSION_CAPTURES
//   --traces     local, gitignored extract-cards.mjs traces (<card id>.json); env AICHECKOUT_EXPANSION_TRACES
//   --dir        the corpus directory, default evals/curation/expansion (a pipeline batch: evals/curation/batches/<id>)
//   --run        an eval:v2 run directory of the cross-model run (observations.json); omitted = pending
//   --output     default docs/evals/expansion.json; "-" prints to stdout
//
// No model is called. Every trace is checked against the corpus inputs (document and context hashes) before it is
// scored with the current v2 scorer. The output has no timestamps and no issuer text, so it is reproducible.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCorpusV2 } from '../apps/api/src/curation/v2/corpus.ts';
import { SCORER_VERSION } from '../apps/api/src/curation/v2/score.ts';
import { loadPipelineInputs, pipelineMetrics } from './lib/expansion-metrics.mjs';
import { bundleFromTraces, scoreSubsets } from './lib/expansion-traces.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const DIR = 'evals/curation/expansion';

/** The cross-model run of decision 4 (wiki/product/phase-7-stage-2.md): gpt-5.5 low, guided.2, keyword-window.1. */
export const CROSS_MODEL = {
  model: 'gpt-5.5',
  effort: 'low',
  prompt: 'guided.2',
  selection: 'keyword-window.1',
  codexOutputTokens: 'visible',
  concurrency: 8,
  output: 'evals/curation/runs/expansion/codex.gpt-5.5.low.guided.2.keyword-window.1.heldout',
};
/** The cross-model run's output directory: CROSS_MODEL.output for expansion.v1, a per-batch folder otherwise. */
export const crossModelOutput = (dir = DIR) =>
  dir === DIR ? CROSS_MODEL.output : CROSS_MODEL.output.replace('/expansion/', `/batches/${basename(dir)}/`);
export const crossModelCommand = (captures = '$EXPANSION_CAPTURES', dir = DIR) =>
  [
    'npm run eval:v2 --',
    `--provider codex --model ${CROSS_MODEL.model} --effort ${CROSS_MODEL.effort}`,
    `--prompt ${CROSS_MODEL.prompt} --selection ${CROSS_MODEL.selection}`,
    `--codex-output-tokens ${CROSS_MODEL.codexOutputTokens}`,
    `--corpus ${dir} --captures ${captures}`,
    `--split heldout --allow-heldout --concurrency ${CROSS_MODEL.concurrency}`,
    `--output ${crossModelOutput(dir)}`,
  ].join(' ');

const DISCLOSURE =
  'Upper bound, not an independent accuracy measure: the labels of the 158 drafted cards were seeded from these same gpt-5.6-luna extractions (corpus.draft.json) and then corrected by Claude verifier agents, so where a verifier left a luna value unchanged it scores as correct. The 15 undrafted cards had no draft; verifiers wrote their labels from the captures. Labels are agent-verified, not human-verified.';
const PROMPT_TUNING =
  'The expansion cards were never used for prompt tuning: guided.2 came from the real.v2.2 dev error analysis on 2026-09-29 (commit 0655c32), the prompt code (apps/api/src/curation/v2/context.ts) has not changed since, and the expansion pages were captured on 2026-10-02. The loader treats every expansion case as held-out.';

async function readTraces(dir) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8'))));
}

async function failureCounts(dir) {
  const text = await readFile(join(dir, 'failures.jsonl'), 'utf8').catch(() => '');
  const seen = new Set(),
    counts = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    if (seen.has(entry.runId)) continue;
    seen.add(entry.runId);
    counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1);
  }
  return counts;
}

export async function scoreExpansion({ dir, captures, traces, run }) {
  const loaded = await loadCorpusV2(dir, { layout: 'expansion', captures });
  const inputs = await loadPipelineInputs(dir);
  const pipeline = pipelineMetrics(inputs);
  const draftedIds = new Set(inputs.draft.cases.map((c) => c.cardId));
  const fromTraces = bundleFromTraces(loaded, await readTraces(traces));
  if (fromTraces.missing.length) throw new Error(`No trace for ${fromTraces.missing.join(', ')}.`);
  const luna = scoreSubsets(loaded, fromTraces.bundle, draftedIds);

  let crossModel = {
    status: 'pending',
    configuration: { provider: 'codex-cli', ...CROSS_MODEL },
    command: crossModelCommand(),
    note: 'gpt-5.5 neither drafted nor verified the labels. Run from the repository root with EXPANSION_CAPTURES set to the local expansion captures folder; then rerun this script with --run.',
  };
  if (run) {
    const bundle = JSON.parse(await readFile(join(run, 'observations.json'), 'utf8'));
    crossModel = { status: 'scored', ...scoreSubsets(loaded, bundle, draftedIds, await failureCounts(run)) };
  }
  return {
    schemaVersion: 1,
    generatedBy: 'scripts/score-expansion-traces.mjs',
    scorerVersion: SCORER_VERSION,
    corpus: {
      version: loaded.corpus.version,
      hash: loaded.hash,
      inputsHash: loaded.inputsHash,
      annotationStatus: loaded.corpus.annotationStatus,
      cases: loaded.cases.length,
      drafted: loaded.cases.filter(({ item }) => draftedIds.has(item.id)).length,
      split: 'heldout (forced at load)',
    },
    promptTuning: PROMPT_TUNING,
    pipeline,
    lunaRescore: {
      disclosure: DISCLOSURE,
      configuration: fromTraces.bundle.configuration,
      traces: {
        files: fromTraces.bundle.observations.length + fromTraces.skipped.length,
        scored: fromTraces.bundle.observations.length,
        skipped: fromTraces.skipped,
        skippedReason: 'card dropped by verification (not in corpus.json)',
      },
      ...luna,
    },
    crossModel,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: DIR },
      captures: { type: 'string', default: process.env.AICHECKOUT_EXPANSION_CAPTURES },
      traces: { type: 'string', default: process.env.AICHECKOUT_EXPANSION_TRACES },
      run: { type: 'string' },
      output: { type: 'string', default: 'docs/evals/expansion.json' },
      'print-command': { type: 'boolean', default: false },
    },
  });
  if (values['print-command']) {
    console.log(crossModelCommand(values.captures ?? '$EXPANSION_CAPTURES', values.dir));
    process.exit(0);
  }
  if (!values.captures || !values.traces)
    throw new Error('--captures and --traces (or AICHECKOUT_EXPANSION_CAPTURES/_TRACES) are required.');
  const result = await scoreExpansion({
    dir: resolve(root, values.dir),
    captures: resolve(root, values.captures),
    traces: resolve(root, values.traces),
    run: values.run ? resolve(root, values.run) : undefined,
  });
  const text = JSON.stringify(result, null, 2) + '\n';
  if (values.output === '-') process.stdout.write(text);
  else await writeFile(resolve(root, values.output), text);
  const pct = (f) => (f.rate === null ? 'n/a' : `${(f.rate * 100).toFixed(1)}% (${f.correct}/${f.total})`);
  for (const key of ['all', 'drafted', 'undrafted']) {
    const o = result.lunaRescore[key].overall;
    console.error(
      `luna ${key} (${o.runs} cards): end-to-end field accuracy ${pct(o.endToEndFieldAccuracy)}, rule recall ${pct(o.ruleRecall)}, rule precision ${pct(o.rulePrecision)}, card fields ${pct(o.cardFieldAccuracy)}, issue recall ${pct(o.issueRecall)}, false-clean ${o.falseClean}`,
    );
  }
  console.error(
    `skipped traces: ${result.lunaRescore.traces.skipped.length}; cross-model: ${result.crossModel.status}`,
  );
}
