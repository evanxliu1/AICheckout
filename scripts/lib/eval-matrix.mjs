// Pure planning logic for scripts/run-eval-matrix.mjs, kept separate so it can be unit tested.

/** Exit status `eval:v2` uses when it stopped on a usage limit. Mirrors EXIT_RATE_LIMITED in eval-cli.ts. */
export const EXIT_RATE_LIMITED = 3;

const safe = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-');

/** Deterministic run directory name for one configuration. */
export function slugFor(configuration, split) {
  const { provider, model, effort, prompt, selection } = configuration;
  return [provider, model, effort ?? 'default', prompt, selection, split].map(safe).join('.');
}

/** Validate a matrix file. Rows are provider-agnostic: `provider` names an `eval:v2 --provider`. */
export function parseMatrix(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Matrix file must be a JSON object.');
  const { split = 'dev', corpus, output = 'evals/curation/runs/matrix', configurations } = raw;
  if (!['dev', 'heldout'].includes(split)) throw new Error('Matrix split must be dev or heldout.');
  if (!Array.isArray(configurations) || !configurations.length)
    throw new Error('Matrix needs a non-empty configurations array.');
  const seen = new Set();
  const rows = configurations.map((row, i) => {
    for (const key of ['provider', 'model', 'prompt', 'selection'])
      if (typeof row[key] !== 'string' || !row[key])
        throw new Error(`configurations[${i}].${key} is required.`);
    const repeat = row.repeat ?? 1,
      concurrency = row.concurrency ?? 3;
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10)
      throw new Error(`configurations[${i}].repeat must be 1 to 10.`);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
      throw new Error(`configurations[${i}].concurrency must be 1 to 8.`);
    const configuration = {
      provider: row.provider,
      model: row.model,
      effort: row.effort ?? null,
      prompt: row.prompt,
      selection: row.selection,
      repeat,
      concurrency,
    };
    const slug = slugFor(configuration, split);
    if (seen.has(slug)) throw new Error(`Duplicate configuration ${slug}.`);
    seen.add(slug);
    return { ...configuration, slug };
  });
  return { split, corpus, output, configurations: rows };
}

/** Command-line arguments for `eval:v2` to run or resume one configuration into `dir`. */
export function evalArgs(configuration, split, dir, { resume = false, corpus } = {}) {
  const args = resume
    ? ['--resume', dir]
    : [
        '--provider',
        configuration.provider,
        '--model',
        configuration.model,
        ...(configuration.effort ? ['--effort', configuration.effort] : []),
        '--prompt',
        configuration.prompt,
        '--selection',
        configuration.selection,
        '--split',
        split,
        '--repeat',
        String(configuration.repeat),
        '--output',
        dir,
      ];
  if (split !== 'dev') args.push('--allow-heldout');
  args.push('--concurrency', String(configuration.concurrency));
  if (corpus) args.push('--corpus', corpus);
  return args;
}

/**
 * What to do with each configuration given the saved report in its directory (or `undefined` when the
 * directory has no run yet): skip complete runs, resume partial ones, start the rest.
 */
export function planRuns(matrix, savedReports, filter = {}) {
  return matrix.configurations
    .filter((c) => !filter.provider || c.provider === filter.provider)
    .filter((c) => !filter.only || c.slug.includes(filter.only))
    .map((configuration) => {
      const report = savedReports.get(configuration.slug);
      const action = !report ? 'run' : report.complete ? 'skip' : 'resume';
      return { configuration, action, observed: report?.observed ?? 0, planned: report?.planned ?? null };
    });
}

/**
 * Classify one `eval:v2` invocation from its exit code and the report it wrote. A run whose every observed
 * trace ended in `provider_error` without a usage limit is treated as rejected (for example an unknown model
 * name) so the matrix moves on instead of retrying it.
 */
export function classifyRun(exitCode, report) {
  if (exitCode === EXIT_RATE_LIMITED) return 'rate-limited';
  if (!report) return 'failed';
  const statuses = report.overall?.statuses ?? {};
  const observed = report.observed ?? 0;
  if (observed > 0 && (statuses.provider_error ?? 0) === observed) return 'rejected';
  if (report.complete) return 'complete';
  return exitCode === 0 ? 'complete' : 'incomplete';
}
