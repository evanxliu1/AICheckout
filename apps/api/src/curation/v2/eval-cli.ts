import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createCodexProvider, type CodexOptions } from '../codex.ts';
import { executeTask, type ExtractionProvider } from '../runner.ts';
import { PROMPTS, type PromptVersion } from './context.ts';
import { loadCorpusV2, type LoadedCase, type LoadedCorpus } from './corpus.ts';
import {
  abstainingProviderV2,
  evaluate,
  referenceProvider,
  reportMarkdown,
  selectCases,
  SELECTIONS,
  type Configuration,
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

async function collect(
  loaded: LoadedCorpus,
  configuration: Configuration,
  providerFor: (value: LoadedCase) => ExtractionProvider,
  options: { concurrency: number; limit: number; live: boolean },
): Promise<ObservationBundle> {
  const task = extractionTaskV2(configuration.prompt, configuration.selection);
  const cases = selectCases(loaded, configuration.split).slice(0, options.limit);
  const jobs = cases.flatMap((value) =>
    Array.from({ length: configuration.repeat }, (_, i) => ({ value, repeat: i + 1 })),
  );
  const observations = await mapConcurrent(jobs, options.concurrency, async ({ value, repeat }, index) => {
    const trace = await executeTask(task, value.input, providerFor(value), {
      limits: options.live ? CODEX_LIMITS : { maxInputTokens: 64_000 },
    });
    if (options.live)
      console.log(
        `[${index + 1}/${jobs.length}] ${value.item.id}#${repeat}: ${trace.status} (${trace.durationMs} ms)`,
      );
    // Keep the trace but not the captured text: observations reference sources by hash.
    return { caseId: value.item.id, repeat, trace };
  });
  const c = configuration;
  return {
    schemaVersion: 2,
    corpus: { version: loaded.corpus.version, hash: loaded.hash },
    experiment: [c.provider.model, c.effort, c.prompt, c.selection, c.split]
      .filter(Boolean)
      .join('.')
      .toLowerCase(),
    provenance: options.live ? 'live-collected' : 'scripted-diagnostic',
    configuration,
    observations: observations as unknown as ObservationBundle['observations'],
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
        const report = evaluate(
          loaded,
          await collect(loaded, configuration, provider, { concurrency: 4, limit: Infinity, live: false }),
        );
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
      corpus: { type: 'string' },
      replay: { type: 'string' },
      output: { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  });
  const loaded = await loadCorpusV2(
    resolve(root, values.corpus ?? (values.check ? FIXTURE_CORPUS : REAL_CORPUS)),
  );
  if (values.check) {
    if (values.provider !== 'fixture' || values.replay)
      throw new Error('--check runs the fixture providers only.');
    await check(loaded);
    return undefined;
  }

  let bundle: ObservationBundle | unknown;
  if (values.replay) {
    const saved = JSON.parse(await readFile(resolve(root, values.replay), 'utf8'));
    bundle = {
      ...saved,
      provenance: saved.provenance === 'scripted-diagnostic' ? saved.provenance : 'imported-unverified',
    };
  } else {
    if (!['fixture', 'codex'].includes(values.provider))
      throw new Error('--provider must be fixture or codex.');
    if (!(values.prompt in PROMPTS))
      throw new Error(`--prompt must be one of ${Object.keys(PROMPTS).join(', ')}.`);
    if (!(SELECTIONS as readonly string[]).includes(values.selection))
      throw new Error(`--selection must be one of ${SELECTIONS.join(', ')}.`);
    if (!['dev', 'heldout', 'all'].includes(values.split))
      throw new Error('--split must be dev, heldout, or all.');
    if (values.split !== 'dev' && !values['allow-heldout'])
      throw new Error('Held-out cases need --allow-heldout. Never tune prompts on held-out results.');
    const repeat = Number(values.repeat),
      concurrency = Number(values.concurrency),
      limit = values.limit === undefined ? Infinity : Number(values.limit);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) throw new Error('--repeat must be 1 to 10.');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
      throw new Error('--concurrency must be 1 to 8.');
    if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1))
      throw new Error('--limit must be positive.');
    const live = values.provider === 'codex';
    const fixtureModel = values.model ?? 'reference-echo.1';
    if (live && !values.model) throw new Error('--provider codex requires --model.');
    if (!live && !['reference-echo.1', 'abstain.2'].includes(fixtureModel))
      throw new Error('Fixture --model must be reference-echo.1 or abstain.2.');
    const codex = live
      ? await createCodexProvider({
          model: values.model!,
          reasoningEffort: values.effort as CodexOptions['reasoningEffort'],
        })
      : undefined;
    const configuration: Configuration = {
      provider: codex
        ? { id: codex.id, model: codex.model, mode: codex.mode }
        : { id: 'fixture', model: fixtureModel, mode: 'fixture' },
      effort: live ? values.effort : null,
      prompt: values.prompt as PromptVersion,
      selection: values.selection as Configuration['selection'],
      split: values.split as Split,
      repeat,
    };
    const providerFor = codex
      ? () => codex
      : fixtureModel === 'abstain.2'
        ? () => abstainingProviderV2()
        : (value: LoadedCase) => referenceProvider(value.item);
    bundle = await collect(loaded, configuration, providerFor, { concurrency, limit, live });
  }
  const report = evaluate(loaded, bundle);
  const output = resolve(
    root,
    values.output ??
      `evals/curation/runs/v2-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  );
  // A new directory and exclusive files preserve older experiment evidence.
  await mkdir(resolve(output, '..'), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  const write = (name: string, text: string) =>
    writeFile(join(output, name), text, { flag: 'wx', mode: 0o600 });
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
  if (!report.complete) process.exitCode = 1;
  return report;
}
