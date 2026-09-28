import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildContext } from '../src/curation/context.ts';
import { canonicalJson } from '../src/curation/canonical.ts';
import {
  abstainingProvider,
  corpusHash,
  evaluateCorpus,
  inputHash,
  observationFromRun,
  validateCorpus,
  type EvalCase,
  type EvalCorpus,
  type EvalObservation,
} from '../src/curation/evaluation.ts';
import { runExtraction, extractionTraceSchema } from '../src/curation/runner.ts';
import { extractionFixture } from './curation-fixture.ts';
import type { CurationRun } from '../src/curation/ledger.ts';

async function sample(change?: (fixture: ReturnType<typeof extractionFixture>) => void) {
  const f = extractionFixture();
  change?.(f);
  f.reply.text = JSON.stringify(f.output);
  const item: EvalCase = {
    id: 'qs-score',
    family: 'capital-one/score',
    split: 'development',
    tags: ['ordinary'],
    input: f.input,
    reference: {
      rules: [
        {
          ruleId: 'quicksilver-base',
          rateBps: { state: 'known', value: 150 },
          category: { state: 'known', value: 'all-eligible' },
          activation: { state: 'known', value: false },
          cap: { state: 'known', kind: 'none', amountCents: null, period: null },
        },
      ],
      conditions: [
        {
          id: 'eligible',
          kind: 'eligibility',
          meaning: 'Only eligible purchases earn the reward.',
          anchors: [{ sourceKey: 'capital-one-quicksilver-benefits', quote: 'all eligible purchases' }],
        },
      ],
      issues: [],
      requiresReview: false,
      rationale: 'Explicit authored reference values; independent of the provider reply.',
    },
  };
  const corpus: EvalCorpus = {
    schemaVersion: 1,
    version: 'score-test.1',
    origin: 'synthetic-agent-authored',
    annotationStatus: 'awaiting-human-review',
    description: 'Scorer verification only.',
    cases: [item],
  };
  const observation: EvalObservation = {
    caseId: item.id,
    input: f.input,
    context: buildContext(f.input),
    trace: await runExtraction(f.input, f.provider),
  };
  const bundle = {
    schemaVersion: 1 as const,
    corpusHash: corpusHash(corpus),
    experiment: 'score-test.1',
    provenance: 'scripted-diagnostic' as const,
    observations: [observation],
  };
  return { ...f, item, corpus, observation, bundle, report: () => evaluateCorpus(corpus, bundle) };
}
const loadCorpus = async () =>
  validateCorpus(
    JSON.parse(await readFile(new URL('../../../evals/curation/corpus.v1.json', import.meta.url), 'utf8')),
  );

it('validates all 60 synthetic cases, two disjoint issuer families, exact anchors, and explicit unreviewed provenance', async () => {
  const corpus = await loadCorpus();
  expect(corpus.cases).toHaveLength(60);
  expect(corpus.annotationStatus).toBe('awaiting-human-review');
  expect(corpus.cases.filter((item) => item.split === 'development')).toHaveLength(30);
  expect(corpus.cases.filter((item) => item.split === 'reserved')).toHaveLength(30);
  expect(
    new Set(corpus.cases.filter((item) => item.split === 'reserved').map((item) => item.family)),
  ).toEqual(new Set(['amex/bce/synthetic-v1']));
  expect(new Set(corpus.cases.flatMap((item) => item.tags))).toEqual(
    new Set([
      'ordinary',
      'numeric',
      'format',
      'utf16',
      'activation',
      'missing',
      'cap',
      'conflicting',
      'ambiguous',
      'unsupported',
      'validity',
      'eligibility',
      'exclusion',
      'adversarial',
    ]),
  );
});
it('scores explicit known facts and evidence coverage without claiming semantic or model accuracy', async () => {
  const f = await sample(),
    report = f.report();
  expect(report.complete).toBe(true);
  expect(report.metrics?.exactFieldAgreement).toEqual({ correct: 4, total: 4, rate: 1 });
  expect(report.metrics?.conditionEvidenceCoverage).toEqual({ correct: 1, total: 1, rate: 1 });
  expect(report.metrics?.falseClearCases).toBe(0);
  expect(report.limitations.join(' ')).toContain('not semantic understanding');
  expect(report.provenance).toBe('scripted-diagnostic');
});
it('catches a missed condition even when the kernel calls the extraction evidence_valid', async () => {
  const f = await sample((f) => {
    f.output.conditions = [];
  });
  expect(f.observation.trace.status).toBe('evidence_valid');
  expect(f.report().metrics).toMatchObject({
    falseClearCases: 1,
    conditionEvidenceCoverage: { correct: 0, total: 1, rate: 0 },
    exactFieldAgreement: { rate: 1 },
  });
  expect(f.report().cases[0].missedConditions).toEqual(['eligible']);
});
it('separates incorrect known claims from field abstention and does not reward omission', async () => {
  const wrong = await sample((f) => {
    f.output.rules[0].rateBps.value = 250;
  });
  expect(wrong.report().metrics).toMatchObject({
    unsupportedKnownClaims: 1,
    knownFactPrecision: { correct: 3, total: 4 },
    knownFactRecall: { correct: 3, total: 4 },
  });
  const abstain = await sample((f) => {
    f.output.rules[0].rateBps = { state: 'unknown', value: null, evidence: [] };
  });
  expect(abstain.report().metrics).toMatchObject({
    unsupportedKnownClaims: 0,
    unnecessaryAbstentions: 1,
    knownFactPrecision: { correct: 3, total: 3, rate: 1 },
    knownFactRecall: { correct: 3, total: 4, rate: 0.75 },
  });
});
it('counts hallucinated additional rules in known-fact precision', async () => {
  const f = await sample((f) => {
    f.output.rules.push({ ...structuredClone(f.output.rules[0]), ruleId: 'invented-rule' });
  });
  expect(f.report().metrics).toMatchObject({
    unsupportedKnownClaims: 4,
    knownFactPrecision: { correct: 4, total: 8, rate: 0.5 },
  });
});
it('requires the correct condition kind and a valid exact citation, not just a copied meaning', async () => {
  const f = await sample((f) => {
    f.output.conditions[0].evidence[0].start++;
  });
  expect(f.report().metrics?.conditionEvidenceCoverage.rate).toBe(0);
  const wrongKind = await sample((f) => {
    f.output.conditions[0].kind = 'exclusion';
  });
  expect(wrongKind.report().metrics?.conditionEvidenceCoverage.rate).toBe(0);
});
it('tracks required issue coverage and conservative false-clear decisions', async () => {
  const f = await sample();
  f.item.reference.requiresReview = true;
  f.item.reference.issues = [
    {
      code: 'unsupported-condition',
      field: 'conditions',
      anchors: [{ sourceKey: f.input.documents[0].source_key, quote: 'eligible purchases' }],
    },
  ];
  f.bundle.corpusHash = corpusHash(f.corpus);
  expect(f.report().metrics).toMatchObject({
    issueEvidenceCoverage: { correct: 0, total: 1 },
    falseClearCases: 1,
  });
});
it('withholds aggregate scores for incomplete observations and rejects cherry-picked unknown IDs', async () => {
  const f = await sample();
  f.bundle.observations = [];
  expect(f.report()).toMatchObject({ complete: false, metrics: null, missing: ['qs-score'] });
  f.bundle.observations = [{ ...f.observation, caseId: 'unselected-case' }];
  expect(f.report).toThrow('Unexpected or duplicate');
});
it.each(['case', 'run'])('rejects duplicated observation %s identity', async (kind) => {
  const f = await sample();
  if (kind === 'run') {
    const item = structuredClone(f.item);
    item.id = 'another-case';
    f.corpus.cases.push(item);
    f.bundle.corpusHash = corpusHash(f.corpus);
  }
  f.bundle.observations.push({ ...f.observation, caseId: kind === 'run' ? 'another-case' : f.item.id });
  expect(f.report).toThrow('Unexpected or duplicate');
});
it.each(['corpus', 'input', 'prompt', 'hash', 'raw-output', 'cost'])(
  'rejects changed or inconsistent %s',
  async (kind) => {
    const f = await sample();
    if (kind === 'corpus') f.item.reference.rules[0].rateBps.value = 250;
    if (kind === 'input') {
      f.observation.input = structuredClone(f.input);
      f.observation.input.documents[0].body += ' extra';
    }
    if (kind === 'prompt') f.observation.context.system += ' changed';
    if (kind === 'hash') f.observation.trace.context!.hash = '0'.repeat(64);
    if (kind === 'raw-output') f.observation.trace.attempts[0].rawOutput = '{}';
    if (kind === 'cost') f.observation.trace.accountedMicrousd = 1;
    expect(f.report).toThrow();
  },
);
it('does not print private source/output snippets when saved JSON is malformed', async () => {
  const f = await sample();
  f.observation.trace.attempts[0].rawOutput = 'PRIVATE_SOURCE_TEXT';
  expect(f.report).toThrow('Saved context or output contains invalid JSON.');
  f.observation.context.user = 'PRIVATE_SOURCE_TEXT';
  expect(f.report).toThrow('Saved context or output contains invalid JSON.');
});
it('verifies canonical context hashes after database-style key reordering', async () => {
  const f = await sample();
  const reverse = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverse)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, child]) => [key, reverse(child)]),
          )
        : value;
  f.observation.context.jsonSchema = reverse(f.observation.context.jsonSchema) as Record<string, unknown>;
  expect(f.report().metrics?.exactFieldAgreement.rate).toBe(1);
  expect(canonicalJson({ z: [2, 1], a: 'x' })).toBe(canonicalJson({ a: 'x', z: [2, 1] }));
  expect(canonicalJson({ z: [2, 1] })).not.toBe(canonicalJson({ z: [1, 2] }));
});
it('hashes corpus content and labels, while input signatures allow generated capture IDs', async () => {
  const f = await sample(),
    original = corpusHash(f.corpus),
    input = structuredClone(f.input);
  input.documents[0].id = randomUUID();
  input.documents[0].created_by = randomUUID();
  expect(inputHash(input)).toBe(inputHash(f.input));
  f.item.reference.rationale += ' reviewed later';
  expect(corpusHash(f.corpus)).not.toBe(original);
});
it.each(['family', 'body', 'anchor', 'truth', 'review', 'category', 'issue-evidence'])(
  'rejects invalid corpus %s',
  async (kind) => {
    const f = await sample();
    if (kind === 'family' || kind === 'body') {
      const second = structuredClone(f.item);
      second.id = 'other';
      second.split = 'reserved';
      if (kind === 'body') second.family = 'different-family';
      f.corpus.cases.push(second);
    }
    if (kind === 'anchor') f.item.reference.conditions[0].anchors[0].quote = 'Missing text';
    if (kind === 'truth') f.item.reference.rules[0].rateBps.state = 'unknown';
    if (kind === 'review') f.item.reference.rules[0].rateBps = { state: 'unknown', value: null };
    if (kind === 'category') f.item.reference.rules[0].category.value = 'us-online-retail';
    if (kind === 'issue-evidence') {
      f.item.reference.requiresReview = true;
      f.item.reference.issues = [{ code: 'ambiguous', field: 'rate', anchors: [] }];
    }
    expect(() => validateCorpus(f.corpus)).toThrow();
  },
);
it('rejects empty splits instead of returning a complete zero-case experiment', async () => {
  const f = await sample();
  expect(() => evaluateCorpus(f.corpus, { ...f.bundle, observations: [] }, 'reserved')).toThrow(
    'contains no cases',
  );
});
it.each(['model', 'prompt', 'limits'])(
  'rejects mixed %s configurations within one experiment',
  async (kind) => {
    const f = await sample(),
      second = structuredClone(f.item),
      observation = structuredClone(f.observation);
    second.id = 'second';
    observation.caseId = second.id;
    observation.trace.runId = randomUUID();
    f.corpus.cases.push(second);
    f.bundle.corpusHash = corpusHash(f.corpus);
    f.bundle.observations.push(observation);
    if (kind === 'model') observation.trace.provider.model = 'different-model';
    if (kind === 'prompt') observation.context.system += ' changed';
    if (kind === 'limits') observation.trace.limits.maxOutputTokens++;
    expect(f.report).toThrow('Mixed generation configurations');
  },
);
it('rejects a recorded metered attempt that could not have passed its spending admission', async () => {
  const f = await sample(),
    trace = f.observation.trace;
  trace.provider.mode = 'metered';
  trace.provider.pricing = { input: 1_000_000, output: 1_000_000 };
  trace.attempts[0].reservedMicrousd = trace.limits.maxInputTokens + trace.limits.maxOutputTokens;
  trace.attempts[0].accountedMicrousd = trace.accountedMicrousd =
    trace.attempts[0].usage!.inputTokens + trace.attempts[0].usage!.outputTokens;
  expect(() => evaluateCorpus(f.corpus, { ...f.bundle, provenance: 'imported-traces-unverified' })).toThrow(
    'spending admission',
  );
});
it('rejects metered traces labeled as scripted diagnostics', async () => {
  const f = await sample();
  f.observation.trace.provider.mode = 'metered';
  f.observation.trace.provider.pricing = { input: 1, output: 1 };
  expect(f.report).toThrow('Scripted diagnostics cannot contain metered traces');
});
it('the baseline receives no labels, answers unknown, and remains zero cost', async () => {
  const f = await sample(),
    trace = await runExtraction(f.input, abstainingProvider());
  f.observation.trace = trace;
  expect(f.report().metrics).toMatchObject({
    knownFactRecall: { correct: 0, total: 4, rate: 0 },
    conditionEvidenceCoverage: { rate: 0 },
    unnecessaryAbstentions: 4,
  });
  expect(f.report().execution.accountedMicrousd).toBe(0);
  expect(extractionTraceSchema.safeParse(trace).success).toBe(true);
  expect(buildContext(f.input).user).not.toContain('rationale');
});
it('imports a finished ledger run without depending on original capture IDs or key order', async () => {
  const f = await sample(),
    now = new Date().toISOString();
  const run: CurationRun = {
    id: f.observation.trace.runId,
    requested_by: randomUUID(),
    session_id: randomUUID(),
    request_key: randomUUID(),
    request_hash: 'a'.repeat(64),
    profile_id: 'fixture',
    profile: {
      id: 'fixture',
      enabled: true,
      provider: 'fixture',
      model: 'synthetic-v1',
      mode: 'fixture',
      input_price: 0,
      output_price: 0,
      max_input_tokens: 48000,
      max_output_tokens: 4096,
      max_attempts: 2,
      attempt_timeout_ms: 10000,
      total_timeout_ms: 15000,
    },
    card_id: f.input.cardId,
    context: {
      ...f.observation.context,
      origin: { draftId: randomUUID(), revision: 1, catalogHash: 'b'.repeat(64) },
    },
    context_hash: 'c'.repeat(64),
    budget_day: now.slice(0, 10),
    reserved_microusd: 0,
    state: 'finished',
    started_at: now,
    finished_at: now,
    deadline_at: now,
    trace: JSON.parse(JSON.stringify(f.observation.trace)),
    trace_hash: 'd'.repeat(64),
    interruption_note: null,
  };
  f.bundle.observations = [observationFromRun(f.item.id, run)];
  expect(f.report().metrics?.exactFieldAgreement.rate).toBe(1);
  run.profile.model = 'wrong-model';
  expect(() => observationFromRun(f.item.id, run)).toThrow('identity does not match');
  run.profile.model = 'synthetic-v1';
  run.profile.max_output_tokens++;
  expect(() => observationFromRun(f.item.id, run)).toThrow('limits do not match');
  run.state = 'interrupted';
  expect(() => observationFromRun(f.item.id, run)).toThrow('finished run');
});
