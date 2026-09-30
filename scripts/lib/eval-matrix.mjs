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
      // Live providers take an effort; eval:v2 defaults it to low, so the row records the same.
      effort: row.provider === 'fixture' ? null : (row.effort ?? 'low'),
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

const PROVIDER_IDS = { fixture: 'fixture', codex: 'codex-cli', claude: 'claude-cli' };
/** Mirrors HARNESS_STATUSES and RETRY_CAP in evaluate.ts. */
const HARNESS_STATUSES = new Set(['timeout', 'provider_error']);
const RETRY_CAP = 2;

/**
 * Harness-failed observations that `eval:v2 --resume` would still retry, from the saved observations and
 * the failures log (one JSON line per earlier failed attempt), so old reports need not be trusted.
 */
export function retriableCount(observations, failureLines) {
  const seen = new Set(),
    counts = new Map();
  for (const line of failureLines) {
    if (seen.has(line.runId)) continue;
    seen.add(line.runId);
    counts.set(line.slot, (counts.get(line.slot) ?? 0) + 1);
  }
  return observations.filter(
    (o) => HARNESS_STATUSES.has(o.trace.status) && (counts.get(`${o.caseId}#${o.repeat}`) ?? 0) < RETRY_CAP,
  ).length;
}

/** Fields of a saved bundle's configuration that differ from the matrix row (empty when it matches). */
export function configurationMismatch(row, split, saved) {
  const want = {
    'provider.id': PROVIDER_IDS[row.provider] ?? row.provider,
    'provider.model': row.model,
    effort: row.provider === 'fixture' ? null : row.effort,
    prompt: row.prompt,
    selection: row.selection,
    split,
    repeat: row.repeat,
  };
  const got = {
    'provider.id': saved.provider?.id,
    'provider.model': saved.provider?.model,
    effort: saved.effort,
    prompt: saved.prompt,
    selection: saved.selection,
    split: saved.split,
    repeat: saved.repeat,
  };
  return Object.keys(want).filter((key) => want[key] !== got[key]);
}

/**
 * What to do with each configuration given its saved state (`undefined` when the directory has no run yet;
 * otherwise `{observed, planned, complete, retriable, configuration}` read from the saved files): skip
 * complete runs, resume partial ones or ones with retriable harness failures, flag a directory whose saved
 * configuration differs from the row, and start the rest.
 */
export function planRuns(matrix, savedStates, filter = {}) {
  return matrix.configurations
    .filter((c) => !filter.provider || c.provider === filter.provider)
    .filter((c) => !filter.only || c.slug.includes(filter.only))
    .map((configuration) => {
      const saved = savedStates.get(configuration.slug);
      const mismatch = saved?.configuration
        ? configurationMismatch(configuration, matrix.split, saved.configuration)
        : [];
      const action = !saved
        ? 'run'
        : mismatch.length
          ? 'mismatch'
          : saved.complete && !saved.retriable
            ? 'skip'
            : 'resume';
      return {
        configuration,
        action,
        mismatch,
        observed: saved?.observed ?? 0,
        planned: saved?.planned ?? null,
        retriable: saved?.retriable ?? 0,
      };
    });
}

/**
 * Classify one `eval:v2` invocation from its exit code and the report it wrote. A run is complete only when
 * every slot is observed and no timed-out or provider-failed slot may still be retried. A run whose every
 * observed trace ended in `provider_error` after the retries were used up is rejected (for example an
 * unknown model name) so the matrix moves on.
 */
export function classifyRun(exitCode, report) {
  if (exitCode === EXIT_RATE_LIMITED) return 'rate-limited';
  if (!report) return 'failed';
  const statuses = report.overall?.statuses ?? {};
  const observed = report.observed ?? 0;
  if ((report.harness?.retriable ?? 0) > 0) return 'incomplete';
  if (observed > 0 && (statuses.provider_error ?? 0) === observed) return 'rejected';
  return report.complete ? 'complete' : 'incomplete';
}
