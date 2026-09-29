import { z } from 'zod';
import { canonicalJson } from '../canonical.ts';
import type { ExtractionProvider, TaskTrace } from '../runner.ts';
import { buildContextV2, PROMPTS, type PromptVersion, type Selection } from './context.ts';
import type { CorpusCase, LoadedCase, LoadedCorpus } from './corpus.ts';
import { extractionV2Schema, type ExtractionV2 } from './schema.ts';
import { byCategory, SCORER_VERSION, scoreCase, summarize, type CaseScore, type Summary } from './score.ts';

export const SELECTIONS = ['full', 'keyword-window.1'] as const satisfies readonly Selection[];
export type Split = 'dev' | 'heldout' | 'all';

const key = z.string().regex(/^[a-zA-Z0-9._/:-]{1,160}$/);
export const configurationSchema = z.strictObject({
  provider: z.strictObject({ id: key, model: key, mode: z.enum(['fixture', 'subscription', 'metered']) }),
  effort: key.nullable(),
  prompt: z.enum(Object.keys(PROMPTS) as [PromptVersion, ...PromptVersion[]]),
  selection: z.enum(SELECTIONS),
  split: z.enum(['dev', 'heldout', 'all']),
  repeat: z.number().int().min(1).max(10),
});
export type Configuration = z.infer<typeof configurationSchema>;

const traceSchema = z.looseObject({
  runId: z.string(),
  status: z.string(),
  durationMs: z.number().int().nonnegative(),
  documents: z.array(z.strictObject({ id: z.string(), contentHash: z.string() })),
  context: z.looseObject({ hash: z.string() }).optional(),
  attempts: z.array(
    z.looseObject({
      outcome: z.string().optional(),
      usage: z.strictObject({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    }),
  ),
  extraction: extractionV2Schema.optional(),
});
export const bundleSchema = z.strictObject({
  schemaVersion: z.literal(2),
  corpus: z.strictObject({ version: key, hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  experiment: key,
  provenance: z.enum(['scripted-diagnostic', 'live-collected', 'imported-unverified']),
  configuration: configurationSchema,
  observations: z
    .array(z.strictObject({ caseId: key, repeat: z.number().int().min(1).max(10), trace: traceSchema }))
    .max(2000),
});
export type ObservationBundle = z.infer<typeof bundleSchema>;

export const selectCases = (loaded: LoadedCorpus, split: Split) =>
  loaded.cases.filter(({ item }) => split === 'all' || item.split === split);

export type Observation = ObservationBundle['observations'][number];
export const slotOf = (o: { caseId: string; repeat: number }) => `${o.caseId}#${o.repeat}`;

/** A run the provider refused for usage or rate limits; it measures nothing and should be run again. */
export const rateLimited = (trace: { status: string; attempts: { outcome?: string }[] }) =>
  trace.status === 'provider_error' && trace.attempts.at(-1)?.outcome === 'rate-limit';

/** Every `caseId#repeat` slot a configuration plans, in corpus order, minus those already observed. */
export function missingSlots(
  loaded: LoadedCorpus,
  configuration: Configuration,
  observed: Iterable<{ caseId: string; repeat: number }> = [],
  caseIds?: readonly string[],
) {
  const seen = new Set(Array.from(observed, slotOf));
  return selectCases(loaded, configuration.split)
    .filter(({ item }) => !caseIds || caseIds.includes(item.id))
    .flatMap((value) =>
      Array.from({ length: configuration.repeat }, (_, i) => ({ value, repeat: i + 1 })).filter(
        (slot) => !seen.has(slotOf({ caseId: value.item.id, repeat: slot.repeat })),
      ),
    );
}

/**
 * Append new observations to a saved bundle. The result is a strict superset: same corpus, configuration,
 * and experiment, every old observation kept, and no slot or run ID twice.
 */
export function mergeBundles(existing: ObservationBundle, added: ObservationBundle): ObservationBundle {
  const same = (key: 'corpus' | 'configuration' | 'experiment') =>
    canonicalJson(existing[key]) === canonicalJson(added[key]);
  if (!same('corpus')) throw new Error('Cannot resume: the corpus or its captures changed.');
  if (!same('configuration') || !same('experiment'))
    throw new Error('Cannot resume: the saved run used a different configuration.');
  if (existing.provenance !== added.provenance) throw new Error('Cannot resume: provenance differs.');
  const slots = new Set<string>(),
    runs = new Set<string>();
  const observations = [...existing.observations, ...added.observations];
  for (const o of observations) {
    if (slots.has(slotOf(o)) || runs.has(o.trace.runId))
      throw new Error(`Duplicate observation ${slotOf(o)}.`);
    slots.add(slotOf(o));
    runs.add(o.trace.runId);
  }
  return { ...existing, observations };
}

/** The labeled answer written as a model reply, citing each field with its rule's anchors. */
export function referenceAnswer(item: CorpusCase): ExtractionV2 {
  const ref = item.reference;
  return {
    schemaVersion: 2,
    cardId: item.cardId,
    rewardCurrency: { value: ref.rewardCurrency.value, evidence: ref.rewardCurrency.anchors },
    pointValueHundredthsOfCent: {
      value: ref.pointValueHundredthsOfCent.value,
      evidence: ref.pointValueHundredthsOfCent.anchors,
    },
    rules: ref.rules.map((rule) => {
      const cite = <T>(value: T) => ({ value, evidence: value === null ? [] : rule.anchors });
      return {
        category: rule.category,
        issuerWording: rule.issuerWording,
        rateBps: cite(rule.rateBps),
        paidOnPaymentBps: cite(rule.paidOnPaymentBps),
        cap: cite(rule.cap),
        activation: cite(rule.activation),
        usMerchantsOnly: cite(rule.usMerchantsOnly),
        limitedTime: cite(rule.limitedTime),
        definition: [],
      };
    }),
    exclusions: ref.exclusions.map((value) => ({ text: value.text, evidence: value.anchors })),
    issues: ref.issues.map((value) => ({
      code: value.code,
      detail: 'Labeled issue.',
      evidence: value.anchors,
    })),
  };
}

const reply = (output: unknown) => ({
  finishReason: 'stop' as const,
  usage: { inputTokens: 0, outputTokens: 0 },
  text: JSON.stringify(output),
});

/** Fixture that answers with the reference labels: every metric should be perfect. */
export function referenceProvider(item: CorpusCase): ExtractionProvider {
  return {
    id: 'fixture',
    model: 'reference-echo.1',
    mode: 'fixture',
    pricing: { input: 0, output: 0 },
    invoke: async () => reply(referenceAnswer(item)),
  };
}

/** Fixture that states nothing and reports the sources as insufficient. Reads only the model-visible request. */
export function abstainingProviderV2(): ExtractionProvider {
  return {
    id: 'fixture',
    model: 'abstain.2',
    mode: 'fixture',
    pricing: { input: 0, output: 0 },
    invoke: async (request) => {
      const { target } = JSON.parse(request.user) as { target: { cardId: string } };
      return reply({
        schemaVersion: 2,
        cardId: target.cardId,
        rewardCurrency: { value: null, evidence: [] },
        pointValueHundredthsOfCent: { value: null, evidence: [] },
        rules: [],
        exclusions: [],
        issues: [{ code: 'missing', detail: 'Scripted abstention; no model was called.', evidence: [] }],
      });
    },
  };
}

/** Re-derive what each observation claims to have run on and reject anything that does not match. */
function verify(
  loaded: LoadedCase,
  bundle: ObservationBundle,
  trace: ObservationBundle['observations'][0]['trace'],
) {
  const { item, input } = loaded;
  const expected = input.documents.map((document) => ({
    id: document.id,
    contentHash: document.contentHash,
  }));
  if (canonicalJson(trace.documents) !== canonicalJson(expected))
    throw new Error(`Observation for ${item.id} was collected on different source text.`);
  const context = buildContextV2(input, bundle.configuration.prompt, bundle.configuration.selection);
  if (trace.context && trace.context.hash !== context.hash)
    throw new Error(`Observation for ${item.id} used a different prompt or context.`);
  if (['evidence_valid', 'needs_review'].includes(trace.status) !== Boolean(trace.extraction))
    throw new Error(`Observation for ${item.id} has an inconsistent extraction.`);
}

export function evaluate(loaded: LoadedCorpus, rawBundle: unknown) {
  const bundle = bundleSchema.parse(rawBundle);
  if (bundle.corpus.hash !== loaded.hash)
    throw new Error('The corpus or its captures changed since these observations were collected.');
  const selected = selectCases(loaded, bundle.configuration.split);
  const byId = new Map(selected.map((value) => [value.item.id, value]));
  const seen = new Set<string>(),
    runs = new Set<string>();
  const cases: CaseScore[] = bundle.observations.map(({ caseId, repeat, trace }) => {
    const loadedCase = byId.get(caseId);
    const slot = `${caseId}#${repeat}`;
    if (!loadedCase || seen.has(slot) || runs.has(trace.runId) || repeat > bundle.configuration.repeat)
      throw new Error(`Unexpected or duplicate observation ${slot}.`);
    seen.add(slot);
    runs.add(trace.runId);
    verify(loadedCase, bundle, trace);
    return scoreCase(loadedCase.item, loadedCase.input, trace as unknown as TaskTrace<ExtractionV2>, repeat);
  });
  const missing = selected.flatMap(({ item }) =>
    Array.from({ length: bundle.configuration.repeat }, (_, i) => `${item.id}#${i + 1}`).filter(
      (slot) => !seen.has(slot),
    ),
  );
  const repeats = Array.from({ length: bundle.configuration.repeat }, (_, i) =>
    summarize(cases.filter((value) => value.repeat === i + 1)),
  );
  const variants = [...new Set(cases.map((value) => value.variant))].sort();
  return {
    schemaVersion: 2,
    scorerVersion: SCORER_VERSION,
    experiment: bundle.experiment,
    provenance: bundle.provenance,
    configuration: bundle.configuration,
    corpus: {
      version: loaded.corpus.version,
      hash: loaded.hash,
      origin: loaded.corpus.origin,
      annotationStatus: loaded.corpus.annotationStatus,
    },
    planned: selected.length * bundle.configuration.repeat,
    observed: cases.length,
    complete: missing.length === 0,
    missing,
    overall: summarize(cases),
    repeats,
    byVariant: Object.fromEntries(
      variants.map((kind) => [kind, summarize(cases.filter((value) => value.variant === kind))]),
    ),
    byCategory: byCategory(cases),
    cases,
  };
}
export type Report = ReturnType<typeof evaluate>;

const pct = (value: { correct: number; total: number; rate: number | null }) =>
  value.rate === null ? 'n/a' : `${(value.rate * 100).toFixed(1)}% (${value.correct}/${value.total})`;

function headline(summary: Summary): [string, string][] {
  return [
    ['Rule recall', pct(summary.ruleRecall)],
    ['Rule precision', pct(summary.rulePrecision)],
    ['Field accuracy (matched rules)', pct(summary.fieldAccuracy)],
    ['Field accuracy (end to end)', pct(summary.endToEndFieldAccuracy)],
    ['Card-level field accuracy', pct(summary.cardFieldAccuracy)],
    ['Claim precision', pct(summary.claimPrecision)],
    ['Unsupported claims', String(summary.unsupportedClaims)],
    ['Evidence validity (quotes resolved)', pct(summary.evidenceValidity)],
    ['Expected-issue recall', pct(summary.issueRecall)],
    ['Exclusion recall', pct(summary.exclusionRecall)],
    ['False-clean cases', String(summary.falseClean)],
    ['Latency p50 / p95', `${summary.latencyMs.p50 ?? 'n/a'} ms / ${summary.latencyMs.p95 ?? 'n/a'} ms`],
    [
      'Mean tokens in / out',
      summary.tokens ? `${summary.tokens.meanInput} / ${summary.tokens.meanOutput}` : 'n/a',
    ],
  ];
}

export function reportMarkdown(report: Report) {
  const c = report.configuration;
  const table = (rows: string[][]) =>
    `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n` +
    rows
      .slice(1)
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n') +
    '\n';
  const lines = [
    `# Extraction v2 evaluation: ${report.experiment}`,
    '',
    report.provenance === 'scripted-diagnostic'
      ? '**Scripted diagnostic: no model was called.**'
      : report.provenance === 'live-collected'
        ? '**Live model run collected by this CLI.**'
        : '**Imported observations; provenance not independently verified.**',
    '',
    `Provider \`${c.provider.id}\` · model \`${c.provider.model}\`${c.effort ? ` (${c.effort})` : ''} · prompt \`${c.prompt}\` · selection \`${c.selection}\` · split \`${c.split}\` · repeat ${c.repeat}.`,
    '',
    `Corpus \`${report.corpus.version}\` (${report.corpus.origin}, ${report.corpus.annotationStatus}), hash \`${report.corpus.hash.slice(0, 12)}\`. Scorer ${report.scorerVersion}.`,
    '',
    `Observed ${report.observed}/${report.planned} runs.${report.complete ? '' : ` Missing: ${report.missing.join(', ')}.`}`,
    '',
    '## Overall',
    '',
    table([['Measure', 'Result'], ...headline(report.overall)]),
  ];
  if (report.repeats.length > 1)
    lines.push(
      '## By repeat',
      '',
      table([
        ['Repeat', 'Rule recall', 'Field accuracy (end to end)', 'Claim precision', 'Issue recall'],
        ...report.repeats.map((s, i) => [
          String(i + 1),
          pct(s.ruleRecall),
          pct(s.endToEndFieldAccuracy),
          pct(s.claimPrecision),
          pct(s.issueRecall),
        ]),
      ]),
    );
  lines.push(
    '## Per field (matched rules)',
    '',
    table([
      ['Field', 'Accuracy'],
      ...Object.entries(report.overall.perField).map(([name, value]) => [name, pct(value)]),
    ]),
    '## By variant',
    '',
    table([
      ['Variant', 'Runs', 'Rule recall', 'Field accuracy', 'Issue recall', 'False-clean'],
      ...Object.entries(report.byVariant).map(([kind, s]) => [
        kind,
        String(s.cases),
        pct(s.ruleRecall),
        pct(s.fieldAccuracy),
        pct(s.issueRecall),
        String(s.falseClean),
      ]),
    ]),
    '## Errors by category',
    '',
    table([
      ['Category', 'Missed rules', 'Field errors', 'Fields'],
      ...Object.entries(report.byCategory).map(([category, value]) => [
        category,
        String(value.missedRules),
        String(value.fieldErrors),
        Object.entries(value.fields)
          .map(([field, n]) => `${field} ×${n}`)
          .join(', '),
      ]),
    ]),
    '## Cases',
    '',
    table([
      [
        'Case',
        'Repeat',
        'Status',
        'Rules (matched/ref/pred)',
        'Field errors',
        'Unsupported',
        'Issues found',
        'False-clean',
      ],
      ...report.cases.map((value) => [
        value.caseId,
        String(value.repeat),
        value.status,
        `${value.rules.matched}/${value.rules.reference}/${value.rules.predicted}`,
        String(value.fieldErrors.length),
        String(value.claims.unsupported),
        `${value.issues.filter((i) => i.found).length}/${value.issues.length}`,
        value.falseClean ? 'yes' : 'no',
      ]),
    ]),
  );
  return lines.join('\n');
}
