import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClaudeProvider, type ClaudeOptions } from '../claude.ts';
import { cliVersion } from '../cli-version.ts';
import { createCodexProvider, type CodexOptions } from '../codex.ts';
import { CURATION_DEFAULTS } from '../curation-model.ts';
import { executeTask, type ExtractionProvider } from '../runner.ts';
import { PROMPTS, type PromptVersion } from './context.ts';
import { loadCorpusV2, type LoadedCase, type LoadedCorpus } from './corpus.ts';
import {
  abstainingProviderV2,
  bundleSchema,
  evaluate,
  mergeBundles,
  missingSlots,
  rateLimited,
  referenceProvider,
  retryableFailures,
  reportMarkdown,
  slotOf,
  SELECTIONS,
  type Configuration,
  type Observation,
  type ObservationBundle,
  type Report,
  type Split,
} from './evaluate.ts';
import { extractionTaskV2 } from './task.ts';

// Agentic CLIs are slower than a raw completion call, and whole issuer pages are large.
const CODEX_LIMITS = {
  attemptTimeoutMs: 240_000,
  totalTimeoutMs: 480_000,
  maxInputTokens: 64_000,
  maxOutputTokens: 8192,
};
const FIXTURE_CORPUS = 'evals/curation/fixture.v2',
  REAL_CORPUS = 'evals/curation/real';
/** `--provider` names and the provider IDs recorded in traces. Live providers are vendor CLIs on subscriptions. */
const PROVIDER_IDS: Record<string, string> = { fixture: 'fixture', codex: 'codex-cli', claude: 'claude-cli' };
/** Exit status when a live run stopped early on a usage limit; the run directory can be resumed. */
export const EXIT_RATE_LIMITED = 3;
const CHECKPOINT_EVERY = 3;
/** Options that describe the configuration; a resumed run takes its configuration from the saved bundle. */
const CONFIGURATION_FLAGS = [
  '--provider',
  '--model',
  '--effort',
  '--prompt',
  '--selection',
  '--split',
  '--repeat',
  '--codex-output-tokens',
];

/** Earlier harness-failed attempts of a run, one JSON line each (statuses and timings only, no output). */
interface FailureEntry {
  slot: string;
  runId: string;
  status: string;
  outcome?: string;
  startedAt?: string;
  durationMs: number;
  loggedAt: string;
}
async function readFailures(dir: string): Promise<FailureEntry[]> {
  const text = await readFile(join(dir, 'failures.jsonl'), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FailureEntry);
}
/** Distinct failed attempts per slot. */
function failureCounts(entries: FailureEntry[]) {
  const seen = new Set<string>(),
    counts = new Map<string, number>();
  for (const entry of entries) {
    if (seen.has(entry.runId)) continue;
    seen.add(entry.runId);
    counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1);
  }
  return counts;
}
/** Write a file whole and rename it into place, so a crash never leaves a half-written run. */
let tempCounter = 0;
async function writeAtomic(dir: string, name: string, text: string) {
  const temp = join(dir, `${name}.${process.pid}.${tempCounter++}.tmp`);
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, join(dir, name));
}

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

const experimentName = (c: Configuration) =>
  [c.provider.model, c.effort, c.prompt, c.selection, c.split].filter(Boolean).join('.').toLowerCase();

/**
 * Collect the given `caseId#repeat` slots. A usage-limit refusal stops the collection: that slot and the
 * ones not started yet are left out so a resumed run can collect them.
 */
async function collect(
  loaded: LoadedCorpus,
  configuration: Configuration,
  providerFor: (value: LoadedCase) => ExtractionProvider,
  jobs: { value: LoadedCase; repeat: number }[],
  options: {
    concurrency: number;
    live: boolean;
    /** Live attempt/total deadlines; each trace records the limits it ran under. */
    timeouts?: { attemptTimeoutMs: number; totalTimeoutMs: number };
    /** Called with everything collected so far after every few slots, so a crash loses little. */
    onProgress?: (observations: Observation[]) => Promise<void>;
  },
): Promise<{ bundle: ObservationBundle; stopped: boolean }> {
  const task = extractionTaskV2(configuration.prompt, configuration.selection);
  let stopped = false,
    completed = 0,
    checkpoint = Promise.resolve();
  const done: Observation[] = [];
  // Workers finish concurrently; checkpoints are written one at a time, each with everything so far.
  const progress = () => (checkpoint = checkpoint.then(() => options.onProgress?.([...done])));
  const observations = await mapConcurrent(jobs, options.concurrency, async ({ value, repeat }, index) => {
    if (stopped) return undefined;
    const trace = await executeTask(task, value.input, providerFor(value), {
      limits: options.live ? { ...CODEX_LIMITS, ...options.timeouts } : { maxInputTokens: 64_000 },
    });
    const slot = slotOf({ caseId: value.item.id, repeat });
    if (options.live)
      console.log(`[${index + 1}/${jobs.length}] ${slot}: ${trace.status} (${trace.durationMs} ms)`);
    if (rateLimited(trace)) {
      stopped = true;
      console.log(`${slot}: the provider reported a usage limit; stopping.`);
      return undefined;
    }
    // Keep the trace but not the captured text: observations reference sources by hash.
    const observation = { caseId: value.item.id, repeat, trace } as unknown as Observation;
    done.push(observation);
    if (++completed % CHECKPOINT_EVERY === 0) await progress();
    return observation;
  });
  await checkpoint;
  return {
    bundle: {
      ...emptyBundle(loaded, configuration, options.live),
      observations: observations.filter((o): o is Observation => o !== undefined),
    },
    stopped,
  };
}

function emptyBundle(loaded: LoadedCorpus, configuration: Configuration, live: boolean): ObservationBundle {
  return {
    schemaVersion: 2,
    corpus: { version: loaded.corpus.version, hash: loaded.hash, inputsHash: loaded.inputsHash },
    experiment: experimentName(configuration),
    provenance: live ? 'live-collected' : 'scripted-diagnostic',
    configuration,
    observations: [],
  };
}

/** Fixture expectations: the reference echo must score perfectly and abstention must score zero. */
async function check(loaded: LoadedCorpus) {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => ok || failures.push(label);
  let runs = 0;
  for (const prompt of Object.keys(PROMPTS) as PromptVersion[])
    for (const selection of SELECTIONS) {
      for (const model of ['reference-echo.1', 'abstain.2']) {
        const configuration: Configuration = {
          provider: { id: 'fixture', model, mode: 'fixture' },
          effort: null,
          prompt,
          selection,
          split: 'all',
          repeat: 1,
        };
        const provider =
          model === 'abstain.2' ? () => abstainingProviderV2() : (v: LoadedCase) => referenceProvider(v.item);
        const { bundle } = await collect(
          loaded,
          configuration,
          provider,
          missingSlots(loaded, configuration),
          {
            concurrency: 4,
            live: false,
          },
        );
        const report = evaluate(loaded, bundle);
        const o = report.overall,
          at = `${model}/${prompt}/${selection}`;
        runs += report.observed;
        expect(`${at}: incomplete`, report.complete);
        if (model === 'reference-echo.1') {
          for (const [name, value] of Object.entries({
            ruleRecall: o.ruleRecall,
            rulePrecision: o.rulePrecision,
            fieldAccuracy: o.fieldAccuracy,
            endToEndFieldAccuracy: o.endToEndFieldAccuracy,
            cardFieldAccuracy: o.cardFieldAccuracy,
            claimPrecision: o.claimPrecision,
            evidenceValidity: o.evidenceValidity,
            issueRecall: o.issueRecall,
            exclusionRecall: o.exclusionRecall,
          }))
            expect(`${at}: ${name} ${value.correct}/${value.total}`, value.rate === 1);
          expect(`${at}: false-clean`, o.falseClean === 0);
          // Cases with labeled issues must stay in review; clean cases pass the kernel's checks.
          for (const value of report.cases) {
            const wanted = value.issues.length ? 'needs_review' : 'evidence_valid';
            expect(`${at}: ${value.caseId} ${value.status}`, value.status === wanted);
          }
        } else {
          expect(
            `${at}: abstention recalled rules`,
            o.ruleRecall.correct === 0 && o.claimPrecision.total === 0,
          );
          expect(
            `${at}: abstention passed as clean`,
            o.falseClean === 0 && (o.statuses.needs_review ?? 0) === report.observed,
          );
        }
      }
    }
  if (failures.length) throw new Error(`Fixture evaluation regressed:\n${failures.join('\n')}`);
  console.log(
    `PASS: ${loaded.cases.length} fixture cases × ${Object.keys(PROMPTS).length} prompts × ${SELECTIONS.length} selections (${runs} runs). ` +
      'Reference echo scores perfectly; abstention scores zero and stays in review. No model accuracy is measured.',
  );
}

/** The provider a saved or requested configuration names. Live providers go through the Codex CLI only. */
async function providerFor(
  configuration: Configuration,
  bins: { codex?: string; claude?: string } = {},
): Promise<{ providerFor: (value: LoadedCase) => ExtractionProvider; cliVersion?: string }> {
  const { provider, effort } = configuration;
  if (provider.id === 'fixture')
    return {
      providerFor:
        provider.model === 'abstain.2'
          ? () => abstainingProviderV2()
          : (value: LoadedCase) => referenceProvider(value.item),
    };
  if (provider.id === 'claude-cli') {
    const bin = bins.claude ?? process.env.AICHECKOUT_CLAUDE_BIN ?? 'claude';
    const claude = createClaudeProvider({
      model: provider.model,
      effort: (effort ?? 'low') as ClaudeOptions['effort'],
      bin,
    });
    return { providerFor: () => claude, cliVersion: await cliVersion(bin) };
  }
  if (provider.id !== 'codex-cli') throw new Error(`Provider ${provider.id} is not available.`);
  const bin = bins.codex ?? process.env.AICHECKOUT_CODEX_BIN ?? 'codex';
  const codex = await createCodexProvider({
    model: provider.model,
    reasoningEffort: (effort ?? 'low') as CodexOptions['reasoningEffort'],
    bin,
    outputTokens: provider.outputTokens ?? 'total',
  });
  return { providerFor: () => codex, cliVersion: await cliVersion(bin) };
}

/**
 * Option defaults. `--provider codex` with no `--model`, or with the curation model, starts from the
 * curation configuration (curation-model.ts); any other model keeps the Phase 2c defaults and needs `--model`.
 */
export function defaultsFor(provider: string, model: string | undefined) {
  if (provider === 'codex' && (model === undefined || model === CURATION_DEFAULTS.model))
    return CURATION_DEFAULTS;
  return {
    model: undefined,
    effort: 'low',
    prompt: 'guided.1',
    selection: 'full',
    codexOutputTokens: 'total',
  } as const;
}
const isCurationModel = (configuration: Configuration) =>
  configuration.provider.id === PROVIDER_IDS.codex &&
  configuration.provider.model === CURATION_DEFAULTS.model;

const positiveInt = (name: string, raw: string | undefined, fallback: number, max = Infinity) => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`--${name} must be 1 to ${max}.`);
  return value;
};

export async function runEvaluationV2Cli(args: string[], root: string): Promise<Report | undefined> {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      provider: { type: 'string', default: 'fixture' },
      model: { type: 'string' },
      // Defaults for effort, prompt, selection and output tokens depend on the model (see defaultsFor).
      effort: { type: 'string' },
      prompt: { type: 'string' },
      selection: { type: 'string' },
      split: { type: 'string', default: 'dev' },
      'allow-heldout': { type: 'boolean', default: false },
      repeat: { type: 'string', default: '1' },
      'codex-output-tokens': { type: 'string' },
      'attempt-timeout-ms': { type: 'string' },
      'total-timeout-ms': { type: 'string' },
      concurrency: { type: 'string', default: '3' },
      limit: { type: 'string' },
      case: { type: 'string', multiple: true },
      corpus: { type: 'string' },
      replay: { type: 'string' },
      resume: { type: 'string' },
      output: { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  });
  const loaded = await loadCorpusV2(
    resolve(root, values.corpus ?? (values.check ? FIXTURE_CORPUS : REAL_CORPUS)),
  );
  if (values.check) {
    if (values.provider !== 'fixture' || values.replay || values.resume)
      throw new Error('--check runs the fixture providers only.');
    await check(loaded);
    return undefined;
  }
  const defaults = defaultsFor(values.provider, values.model);
  const model = values.model ?? defaults.model,
    effort = values.effort ?? defaults.effort,
    prompt = values.prompt ?? defaults.prompt,
    selection = values.selection ?? defaults.selection,
    outputTokens = values['codex-output-tokens'] ?? defaults.codexOutputTokens;
  const concurrency = positiveInt('concurrency', values.concurrency, 3, 8);
  const limit = positiveInt('limit', values.limit, Infinity);

  const freshOutput = () =>
    resolve(
      root,
      values.output ??
        `evals/curation/runs/v2-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
    );
  const output = values.resume ? resolve(root, values.resume) : freshOutput();
  let bundle: ObservationBundle | unknown,
    stopped = false,
    failures = new Map<string, number>();
  if (values.replay) {
    const saved = JSON.parse(await readFile(resolve(root, values.replay), 'utf8'));
    bundle = {
      ...saved,
      provenance: saved.provenance === 'scripted-diagnostic' ? saved.provenance : 'imported-unverified',
    };
  } else {
    let configuration: Configuration, existing: ObservationBundle | undefined;
    if (values.resume) {
      if (values.output) throw new Error('--resume writes back to the same directory; drop --output.');
      const given = CONFIGURATION_FLAGS.filter((flag) =>
        args.some((a) => a === flag || a.startsWith(`${flag}=`)),
      );
      if (given.length)
        throw new Error(`--resume takes the configuration from the saved run; drop ${given.join(', ')}.`);
      existing = bundleSchema.parse(JSON.parse(await readFile(join(output, 'observations.json'), 'utf8')));
      // Bundles saved before inputs hashes existed are accepted: every observation is verified below against
      // the documents and context it ran on, so a relabeled corpus still resumes.
      if (existing.corpus.inputsHash && existing.corpus.inputsHash !== loaded.inputsHash)
        throw new Error('Cannot resume: the corpus inputs or captures changed since the saved run.');
      configuration = existing.configuration;
    } else {
      if (!(values.provider in PROVIDER_IDS))
        throw new Error(`--provider must be one of ${Object.keys(PROVIDER_IDS).join(', ')}.`);
      if (!(prompt in PROMPTS))
        throw new Error(`--prompt must be one of ${Object.keys(PROMPTS).join(', ')}.`);
      if (!(SELECTIONS as readonly string[]).includes(selection))
        throw new Error(`--selection must be one of ${SELECTIONS.join(', ')}.`);
      if (!['total', 'visible'].includes(outputTokens))
        throw new Error('--codex-output-tokens must be total or visible.');
      if (!['dev', 'heldout', 'all'].includes(values.split))
        throw new Error('--split must be dev, heldout, or all.');
      const live = values.provider !== 'fixture';
      const fixtureModel = model ?? 'reference-echo.1';
      if (live && !model) throw new Error(`--provider ${values.provider} requires --model.`);
      if (!live && !['reference-echo.1', 'abstain.2'].includes(fixtureModel))
        throw new Error('Fixture --model must be reference-echo.1 or abstain.2.');
      configuration = {
        provider: live
          ? {
              id: PROVIDER_IDS[values.provider],
              model: model!,
              mode: 'subscription',
              ...(values.provider === 'codex' && outputTokens === 'visible'
                ? { outputTokens: 'visible' as const }
                : {}),
            }
          : { id: 'fixture', model: fixtureModel, mode: 'fixture' },
        effort: live ? effort : null,
        prompt: prompt as PromptVersion,
        selection: selection as Configuration['selection'],
        split: values.split as Split,
        repeat: positiveInt('repeat', values.repeat, 1, 10),
      };
    }
    if (configuration.split !== 'dev' && !values['allow-heldout'])
      throw new Error('Held-out cases need --allow-heldout. Never tune prompts on held-out results.');
    // The provider (and its CLI version) is resolved before any failure is logged, so a resume that cannot
    // run (a missing binary, for example) does not use up retries.
    const provider = await providerFor(configuration);
    if (provider.cliVersion) {
      const saved = configuration.provider.cliVersions ?? (existing ? ['unrecorded'] : []);
      const comparable = saved.filter((v) => v !== 'unknown' && v !== 'unrecorded');
      if (provider.cliVersion !== 'unknown' && comparable.length && !comparable.includes(provider.cliVersion))
        console.warn(
          `Warning: this run was collected under CLI ${comparable.join(', ')}; continuing under ${provider.cliVersion}.`,
        );
      if (!saved.includes(provider.cliVersion))
        configuration = {
          ...configuration,
          provider: { ...configuration.provider, cliVersions: [...saved, provider.cliVersion] },
        };
    }
    if (existing) {
      existing = { ...existing, configuration };
      // Harness failures are not model results: log them and run their slots again, up to the cap.
      const logged = await readFailures(output);
      failures = failureCounts(logged);
      // Only slots this invocation will actually run (--case, --limit) are taken out of the saved run.
      const retryable = retryableFailures(existing, failures);
      const retryableSlots = new Set(retryable.map(slotOf));
      const planned = new Set(
        missingSlots(
          loaded,
          configuration,
          existing.observations.filter((o) => !retryableSlots.has(slotOf(o))),
          values.case,
        )
          .slice(0, limit)
          .map((s) => slotOf({ caseId: s.value.item.id, repeat: s.repeat })),
      );
      const retry = retryable.filter((o) => planned.has(slotOf(o)));
      const known = new Set(logged.map((entry) => entry.runId));
      for (const o of retry) {
        if (known.has(o.trace.runId)) continue;
        const trace = o.trace as unknown as { startedAt?: string; attempts: { outcome?: string }[] };
        const entry: FailureEntry = {
          slot: slotOf(o),
          runId: o.trace.runId,
          status: o.trace.status,
          outcome: trace.attempts.at(-1)?.outcome,
          startedAt: trace.startedAt,
          durationMs: o.trace.durationMs,
          loggedAt: new Date().toISOString(),
        };
        await appendFile(join(output, 'failures.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
        failures.set(entry.slot, (failures.get(entry.slot) ?? 0) + 1);
      }
      const retrySlots = new Set(retry.map(slotOf));
      existing = {
        ...existing,
        observations: existing.observations.filter((o) => !retrySlots.has(slotOf(o))),
      };
      if (retry.length) console.log(`Retrying ${retry.length} timed-out or provider-failed slots.`);
    }
    const live = configuration.provider.id !== 'fixture';
    const jobs = missingSlots(loaded, configuration, existing?.observations, values.case).slice(0, limit);
    if (existing)
      console.log(`Resuming ${output}: ${existing.observations.length} saved, ${jobs.length} to run.`);

    if (!values.resume) {
      // A new directory preserves older experiment evidence; files inside it are replaced atomically. An
      // empty bundle is written at once so a crash before the first checkpoint leaves a resumable run, and
      // a directory left empty by such a crash is reused.
      await mkdir(resolve(output, '..'), { recursive: true });
      await mkdir(output, { mode: 0o700 }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
        const files = await readdir(output);
        if (files.length) throw error;
      });
      await writeAtomic(
        output,
        'observations.json',
        JSON.stringify(emptyBundle(loaded, configuration, live), null, 2) + '\n',
      );
    }
    const saved = existing;
    // Runs of the curation model (new or resumed) get its longer deadlines unless a flag says otherwise.
    const deadlines = isCurationModel(configuration) ? CURATION_DEFAULTS : CODEX_LIMITS;
    const timeouts = {
      attemptTimeoutMs: positiveInt(
        'attempt-timeout-ms',
        values['attempt-timeout-ms'],
        deadlines.attemptTimeoutMs,
        600_000,
      ),
      totalTimeoutMs: positiveInt(
        'total-timeout-ms',
        values['total-timeout-ms'],
        deadlines.totalTimeoutMs,
        900_000,
      ),
    };
    const collected = await collect(loaded, configuration, provider.providerFor, jobs, {
      timeouts,
      concurrency,
      live,
      onProgress: async (observations) => {
        const partial = { ...emptyBundle(loaded, configuration, live), observations };
        const merged = saved ? mergeBundles(saved, partial) : partial;
        await writeAtomic(output, 'observations.json', JSON.stringify(merged, null, 2) + '\n');
      },
    });
    stopped = collected.stopped;
    bundle = existing ? mergeBundles(existing, collected.bundle) : collected.bundle;
  }
  const report = evaluate(loaded, bundle, { failures });
  if (values.replay) {
    await mkdir(resolve(output, '..'), { recursive: true });
    await mkdir(output, { mode: 0o700 });
  }
  const write = (name: string, text: string) => writeAtomic(output, name, text);
  if (!values.replay) await write('observations.json', JSON.stringify(bundle, null, 2) + '\n');
  await write('report.json', JSON.stringify(report, null, 2) + '\n');
  await write('report.md', reportMarkdown(report));
  const o = report.overall;
  const show = (v: { rate: number | null }) => (v.rate === null ? 'n/a' : `${(v.rate * 100).toFixed(1)}%`);
  console.log(
    `${report.experiment}: rule recall ${show(o.ruleRecall)}, field accuracy ${show(o.endToEndFieldAccuracy)} end to end, ` +
      `claim precision ${show(o.claimPrecision)}, issue recall ${show(o.issueRecall)}, false-clean ${o.falseClean}.`,
  );
  console.log(`Saved ${report.provenance} (${report.observed}/${report.planned} runs) to ${output}`);
  if (report.harness.failed)
    console.log(
      `Harness failures: ${report.harness.failed} (${report.harness.retriable} retriable with --resume).`,
    );
  if (stopped) {
    console.log(`Usage limit reached. Resume later with: npm run eval:v2 -- --resume ${output}`);
    process.exitCode = EXIT_RATE_LIMITED;
  } else if (!report.complete || report.harness.retriable) process.exitCode = 1;
  return report;
}
