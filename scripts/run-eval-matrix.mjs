// Runs every configuration in a matrix file through `npm run eval:v2`, one after another, into
// deterministic directories under the matrix output directory. Re-running skips complete configurations
// and resumes partial ones (`eval:v2 --resume`), so a usage-limit stop loses nothing.
//
//   node scripts/run-eval-matrix.mjs [--config evals/curation/matrix.dev.json] [--provider codex|claude]
//        [--only SLUG-SUBSTRING] [--wait-minutes N] [--max-waits N] [--dry-run]
//
// With --wait-minutes, a usage-limit stop sleeps that long and retries (up to --max-waits times) instead of
// exiting. Providers have separate limits, so a second runner with another --provider can run alongside.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { classifyRun, evalArgs, EXIT_RATE_LIMITED, parseMatrix, planRuns } from './lib/eval-matrix.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    config: { type: 'string', default: 'evals/curation/matrix.dev.json' },
    provider: { type: 'string' },
    only: { type: 'string' },
    'wait-minutes': { type: 'string', default: '0' },
    'max-waits': { type: 'string', default: '12' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const waitMinutes = Number(values['wait-minutes']),
  maxWaits = Number(values['max-waits']);
if (!(waitMinutes >= 0) || !(maxWaits >= 0)) throw new Error('--wait-minutes and --max-waits must be >= 0.');

const matrix = parseMatrix(JSON.parse(await readFile(resolve(root, values.config), 'utf8')));
const outputDir = resolve(root, matrix.output);
await mkdir(outputDir, { recursive: true });
const statusPath = join(outputDir, 'matrix-status.json');
const status = await readFile(statusPath, 'utf8').then(JSON.parse, () => ({}));
const saveStatus = () => writeFile(statusPath, JSON.stringify(status, null, 2) + '\n');

const readReport = (dir) => readFile(join(dir, 'report.json'), 'utf8').then(JSON.parse, () => undefined);
/** Saved state from the observations themselves, so a run edited after its report was written is resumed. */
async function savedState(dir) {
  const [report, observations] = await Promise.all([
    readReport(dir),
    readFile(join(dir, 'observations.json'), 'utf8').then(JSON.parse, () => undefined),
  ]);
  if (!observations) return undefined;
  const observed = observations.observations.length,
    planned = report?.planned ?? null;
  return { observed, planned, complete: planned !== null && observed >= planned };
}
const savedReports = new Map();
for (const c of matrix.configurations) savedReports.set(c.slug, await savedState(join(outputDir, c.slug)));

const plan = planRuns(matrix, savedReports, { provider: values.provider, only: values.only });
for (const { configuration, action, observed, planned } of plan)
  console.log(`${action.padEnd(6)} ${configuration.slug}${planned ? ` (${observed}/${planned} saved)` : ''}`);
if (values['dry-run']) process.exit(0);

function runEval(args) {
  return new Promise((done) => {
    const child = spawn('npm', ['run', 'eval:v2', '--', ...args], { cwd: root, stdio: 'inherit' });
    child.on('close', (code) => done(code ?? 1));
  });
}
const sleep = (minutes) => new Promise((done) => setTimeout(done, minutes * 60_000));

let waits = 0;
const rejectedModels = new Set();
for (const { configuration, action } of plan) {
  if (action === 'skip') continue;
  const modelKey = `${configuration.provider}:${configuration.model}`;
  if (rejectedModels.has(modelKey)) {
    // Every run of an earlier configuration failed at the provider (for example an unknown model name).
    status[configuration.slug] = {
      outcome: 'rejected',
      observed: 0,
      planned: null,
      updatedAt: new Date().toISOString(),
    };
    await saveStatus();
    console.log(`\n=== skip ${configuration.slug}: ${modelKey} was rejected by the provider.`);
    continue;
  }
  const dir = join(outputDir, configuration.slug);
  let resume = action === 'resume';
  for (;;) {
    console.log(`\n=== ${resume ? 'resume' : 'run'} ${configuration.slug}`);
    const code = await runEval(evalArgs(configuration, matrix.split, dir, { resume, corpus: matrix.corpus }));
    const report = await readReport(dir);
    const outcome = classifyRun(code, report);
    status[configuration.slug] = {
      outcome,
      observed: report?.observed ?? 0,
      planned: report?.planned ?? null,
      updatedAt: new Date().toISOString(),
    };
    await saveStatus();
    if (outcome !== 'rate-limited') {
      if (outcome === 'rejected') {
        rejectedModels.add(modelKey);
        console.log(`${configuration.slug}: every run failed; recorded as rejected.`);
      }
      break;
    }
    if (waitMinutes === 0 || waits >= maxWaits) {
      console.log(
        `\nStopped on a usage limit. Resume later with:\n  node scripts/run-eval-matrix.mjs --config ${values.config}` +
          (values.provider ? ` --provider ${values.provider}` : ''),
      );
      process.exit(EXIT_RATE_LIMITED);
    }
    waits++;
    console.log(`Usage limit: waiting ${waitMinutes} min (${waits}/${maxWaits}) before resuming.`);
    await sleep(waitMinutes);
    resume = Boolean(await readReport(dir));
  }
}
const summary = plan.map(
  ({ configuration }) => `${configuration.slug}: ${status[configuration.slug]?.outcome ?? 'skipped'}`,
);
console.log(`\nMatrix done.\n${summary.join('\n')}`);
