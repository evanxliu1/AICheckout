import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClaudeProvider, type ClaudeOptions } from '../claude.ts';
import { createCodexProvider, type CodexOptions } from '../codex.ts';
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
  options: { concurrency: number; live: boolean },
): Promise<{ bundle: ObservationBundle; stopped: boolean }> {
  const task = extractionTaskV2(configuration.prompt, configuration.selection);
  let stopped = false;
  const observations = await mapConcurrent(jobs, options.concurrency, async ({ value, repeat }, index) => {
    if (stopped) return undefined;
    const trace = await executeTask(task, value.input, providerFor(value), {
      limits: options.live ? CODEX_LIMITS : { maxInputTokens: 64_000 },
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
    return { caseId: value.item.id, repeat, trace } as unknown as Observation;
  });
  return {
    bundle: {
      schemaVersion: 2,
      corpus: { version: loaded.corpus.version, hash: loaded.hash },
      experiment: experimentName(configuration),
      provenance: options.live ? 'live-collected' : 'scripted-diagnostic',
      configuration,
      observations: observations.filter((o): o is Observation => o !== undefined),
    },
    stopped,
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
async function providerFor(configuration: Configuration): Promise<(value: LoadedCase) => ExtractionProvider> {
  const { provider, effort } = configuration;
  if (provider.id === 'fixture')
    return provider.model === 'abstain.2'
      ? () => abstainingProviderV2()
      : (value: LoadedCase) => referenceProvider(value.item);
  if (provider.id === 'claude-cli') {
    const claude = createClaudeProvider({
      model: provider.model,
      effort: (effort ?? 'low') as ClaudeOptions['effort'],
    });
    return () => claude;
  }
  if (provider.id !== 'codex-cli') throw new Error(`Provider ${provider.id} is not available.`);
  const codex = await createCodexProvider({
    model: provider.model,
    reasoningEffort: (effort ?? 'low') as CodexOptions['reasoningEffort'],
  });
  return () => codex;
}

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
      effort: { type: 'string', default: 'low' },
      prompt: { type: 'string', default: 'guided.1' },
      selection: { type: 'string', default: 'full' },
      split: { type: 'string', default: 'dev' },
      'allow-heldout': { type: 'boolean', default: false },
      repeat: { type: 'string', default: '1' },
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
    stopped = false;
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
      existing = bundleSchema.parse(JSON.parse(await readFile(join(output, 'observations.json'), 'utf8')));
      if (existing.corpus.hash !== loaded.hash)
        throw new Error('Cannot resume: the corpus or its captures changed since the saved run.');
      configuration = existing.configuration;
    } else {
      if (!(values.provider in PROVIDER_IDS))
        throw new Error(`--provider must be one of ${Object.keys(PROVIDER_IDS).join(', ')}.`);
      if (!(values.prompt in PROMPTS))
        throw new Error(`--prompt must be one of ${Object.keys(PROMPTS).join(', ')}.`);
      if (!(SELECTIONS as readonly string[]).includes(values.selection))
        throw new Error(`--selection must be one of ${SELECTIONS.join(', ')}.`);
      if (!['dev', 'heldout', 'all'].includes(values.split))
        throw new Error('--split must be dev, heldout, or all.');
      const live = values.provider !== 'fixture';
      const fixtureModel = values.model ?? 'reference-echo.1';
      if (live && !values.model) throw new Error(`--provider ${values.provider} requires --model.`);
      if (!live && !['reference-echo.1', 'abstain.2'].includes(fixtureModel))
        throw new Error('Fixture --model must be reference-echo.1 or abstain.2.');
      configuration = {
        provider: live
          ? { id: PROVIDER_IDS[values.provider], model: values.model!, mode: 'subscription' }
          : { id: 'fixture', model: fixtureModel, mode: 'fixture' },
        effort: live ? values.effort : null,
        prompt: values.prompt as PromptVersion,
        selection: values.selection as Configuration['selection'],
        split: values.split as Split,
        repeat: positiveInt('repeat', values.repeat, 1, 10),
      };
    }
    if (configuration.split !== 'dev' && !values['allow-heldout'])
      throw new Error('Held-out cases need --allow-heldout. Never tune prompts on held-out results.');
    const live = configuration.provider.id !== 'fixture';
    const jobs = missingSlots(loaded, configuration, existing?.observations, values.case).slice(0, limit);
    if (existing)
      console.log(`Resuming ${output}: ${existing.observations.length} saved, ${jobs.length} to run.`);
    const collected = await collect(loaded, configuration, await providerFor(configuration), jobs, {
      concurrency,
      live,
    });
    stopped = collected.stopped;
    bundle = existing ? mergeBundles(existing, collected.bundle) : collected.bundle;
  }
  const report = evaluate(loaded, bundle);
  if (!values.resume) {
    // A new directory and exclusive files preserve older experiment evidence.
    await mkdir(resolve(output, '..'), { recursive: true });
    await mkdir(output, { mode: 0o700 });
  }
  // A resumed run replaces its files only with a superset, written whole and then renamed into place.
  const write = async (name: string, text: string) => {
    if (!values.resume) return writeFile(join(output, name), text, { flag: 'wx', mode: 0o600 });
    await writeFile(join(output, `${name}.tmp`), text, { mode: 0o600 });
    await rename(join(output, `${name}.tmp`), join(output, name));
  };
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
  if (stopped) {
    console.log(`Usage limit reached. Resume later with: npm run eval:v2 -- --resume ${output}`);
    process.exitCode = EXIT_RATE_LIMITED;
  } else if (!report.complete) process.exitCode = 1;
  return report;
}
