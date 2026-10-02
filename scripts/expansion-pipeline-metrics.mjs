// Draft → verified pipeline metrics for the catalog expansion, from committed files only (no captures).
//
//   node scripts/expansion-pipeline-metrics.mjs [--dir evals/curation/expansion]     # print the JSON
//   node scripts/expansion-pipeline-metrics.mjs --check [--results docs/evals/expansion.json]
//
// Reads cards.json, corpus.draft.json, corpus.json and verification/*.json. The output is deterministic (no
// timestamps). --check recomputes the metrics and fails if the `pipeline` section of the results file differs.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { loadPipelineInputs, pipelineMetrics } from './lib/expansion-metrics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/expansion' },
    check: { type: 'boolean', default: false },
    results: { type: 'string', default: 'docs/evals/expansion.json' },
  },
});
const metrics = pipelineMetrics(await loadPipelineInputs(resolve(root, values.dir)));
if (values.check) {
  const saved = JSON.parse(await readFile(resolve(root, values.results), 'utf8')).pipeline;
  if (!isDeepStrictEqual(saved, metrics)) {
    console.error(
      `${values.results}: the pipeline section is out of date; rerun scripts/score-expansion-traces.mjs.`,
    );
    process.exit(1);
  }
  console.log(`${values.results}: pipeline metrics up to date.`);
} else console.log(JSON.stringify(metrics, null, 2));
