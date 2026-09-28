import { z } from 'zod';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import {
  extractionInputSchema,
  extractionSchema,
  sha256,
  validateExtraction,
  validateInputs,
  type Extraction,
  type ExtractionInput,
} from './extraction';
import { buildContext } from './context';
import { extractionTraceSchema, type ExtractionProvider } from './runner';
import { canonicalJson as canonical } from './canonical';
import { curationRunSchema } from './ledger';

export const EVALUATOR_VERSION = 'curation-evaluator.1';
const key = z.string().regex(/^[a-z0-9._/-]{1,120}$/),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const rule = extractionSchema.shape.rules.element.shape;
const referenceRuleSchema = z.strictObject({
  ruleId: rule.ruleId,
  rateBps: rule.rateBps.omit({ evidence: true }),
  category: rule.category.omit({ evidence: true }),
  activation: rule.activation.omit({ evidence: true }),
  cap: rule.cap.omit({ evidence: true }),
});
const anchorSchema = z.strictObject({ sourceKey: key, quote: z.string().min(1).max(1600) });
export const evalCaseSchema = z.strictObject({
  id: key,
  family: key,
  split: z.enum(['development', 'reserved']),
  tags: z.array(key).min(1).max(12),
  input: extractionInputSchema,
  reference: z.strictObject({
    rules: z.array(referenceRuleSchema).min(1).max(2),
    requiresReview: z.boolean(),
    conditions: z
      .array(
        z.strictObject({
          id: key,
          kind: z.enum(['eligibility', 'exclusion', 'other']),
          meaning: z.string().min(1).max(1200),
          anchors: z.array(anchorSchema).min(1).max(3),
        }),
      )
      .max(30),
    issues: z
      .array(
        z.strictObject({
          code: extractionSchema.shape.issues.element.shape.code,
          field: extractionSchema.shape.issues.element.shape.field,
          anchors: z.array(anchorSchema).max(3),
        }),
      )
      .max(30),
    rationale: z.string().min(1).max(2400),
  }),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;
export const corpusSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: key,
  origin: z.literal('synthetic-agent-authored'),
  annotationStatus: z.literal('awaiting-human-review'),
  description: z.string().min(1).max(2000),
  cases: z.array(evalCaseSchema).min(1).max(200),
});
export type EvalCorpus = z.infer<typeof corpusSchema>;

/** Canonical content hashes exclude database-generated IDs/timestamps, which are not reference answers. */
export const corpusHash = (corpus: EvalCorpus) => sha256(canonical(corpus));
export function inputHash(input: ExtractionInput) {
  return sha256(
    canonical({
      cardId: input.cardId,
      documents: input.documents
        .map((doc) => ({
          sourceKey: doc.source_key,
          url: doc.url,
          checkedOn: doc.checked_on,
          contentHash: doc.content_hash,
          body: doc.body,
        }))
        .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0)),
    }),
  );
}
export function validateCorpus(raw: unknown): EvalCorpus {
  const corpus = corpusSchema.parse(raw),
    ids = new Set<string>(),
    groups = new Map<string, string>(),
    bodies = new Map<string, string>();
  for (const item of corpus.cases) {
    if (ids.has(item.id) || (groups.has(item.family) && groups.get(item.family) !== item.split))
      throw new Error('Duplicate case or document-family split leakage.');
    ids.add(item.id);
    groups.set(item.family, item.split);
    if (validateInputs(item.input, Date.now()).length)
      throw new Error(`Invalid captured inputs for ${item.id}.`);
    const target = PILOT_CATALOG.cards.find((card) => card.id === item.input.cardId)!;
    if (
      canonical(item.reference.rules.map((value) => value.ruleId).sort()) !==
      canonical(target.rules.map((value) => value.id).sort())
    )
      throw new Error(`Reference target mismatch for ${item.id}.`);
    const conditionIds = item.reference.conditions.map((value) => value.id);
    if (new Set(conditionIds).size !== conditionIds.length)
      throw new Error(`Duplicate condition labels for ${item.id}.`);
    if (
      !item.reference.requiresReview &&
      (item.reference.issues.length ||
        item.reference.rules.some((value) =>
          [value.rateBps, value.category, value.activation, value.cap].some(
            (claim) => claim.state !== 'known',
          ),
        ))
    )
      throw new Error(`Unresolved reference facts require review for ${item.id}.`);
    if (item.reference.issues.some((value) => value.code !== 'missing' && !value.anchors.length))
      throw new Error(`Non-missing reference issues need evidence for ${item.id}.`);
    for (const doc of item.input.documents) {
      const normalized = sha256(doc.body.normalize('NFKC').replace(/\s+/g, ' ').trim());
      if (bodies.has(normalized) && bodies.get(normalized) !== item.split)
        throw new Error('Duplicate source text crosses corpus splits.');
      bodies.set(normalized, item.split);
    }
    for (const expected of item.reference.rules) {
      if (
        expected.category.state === 'known' &&
        expected.category.value !== target.rules.find((value) => value.id === expected.ruleId)!.category
      )
        throw new Error(`Reference category does not match target for ${item.id}.`);
      for (const field of ['rateBps', 'category', 'activation'] as const) {
        if ((expected[field].state === 'known') !== (expected[field].value !== null))
          throw new Error(`Inconsistent reference claim for ${item.id}.`);
      }
      const cap = expected.cap;
      if (
        cap.state === 'known'
          ? cap.kind === 'none'
            ? cap.amountCents !== null || cap.period !== null
            : cap.kind !== 'annual-spend' || cap.amountCents === null || cap.period !== 'calendar-year'
          : cap.kind !== null || cap.amountCents !== null || cap.period !== null
      )
        throw new Error(`Inconsistent reference cap for ${item.id}.`);
    }
    for (const anchor of [...item.reference.conditions, ...item.reference.issues].flatMap(
      (value) => value.anchors,
    )) {
      if (
        !item.input.documents.some(
          (doc) => doc.source_key === anchor.sourceKey && doc.body.includes(anchor.quote),
        )
      )
        throw new Error(`Reference quote is missing from ${item.id}.`);
    }
  }
  return corpus;
}

const contextSchema = z.strictObject({
  system: z.string().max(20000),
  user: z.string().max(196608),
  jsonSchema: z.record(z.string(), z.unknown()),
  versions: z.strictObject({ prompt: key, context: key, schema: key, sourcePolicy: key }),
  hash,
  inputTokenEstimate: z.number().int().nonnegative().max(1_000_000),
});
export const observationSchema = z.strictObject({
  caseId: key,
  input: extractionInputSchema,
  context: contextSchema,
  trace: extractionTraceSchema,
});
export type EvalObservation = z.infer<typeof observationSchema>;
export const observationBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  corpusHash: hash,
  experiment: key,
  provenance: z.enum(['scripted-diagnostic', 'imported-traces-unverified']),
  observations: z.array(observationSchema).max(200),
});
export const ledgerBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  corpusHash: hash,
  experiment: key,
  runs: z.array(z.strictObject({ caseId: key, run: curationRunSchema })).max(200),
});
function savedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Saved context or output contains invalid JSON.');
  }
}

/** Reconstruct only model-visible capture content from a saved private run.
 * Title/creation metadata are synthetic placeholders, not claimed original capture metadata. */
export function observationFromRun(caseId: string, rawRun: unknown): EvalObservation {
  const run = curationRunSchema.parse(rawRun);
  if (run.state !== 'finished' || !run.trace || !run.finished_at || !run.trace_hash)
    throw new Error('Evaluation requires a finished run with a saved trace.');
  const context = contextSchema.parse(
    Object.fromEntries(Object.entries(run.context).filter(([key]) => key !== 'origin')),
  );
  const envelope = z
    .object({
      documents: z
        .array(
          z.object({
            documentId: z.uuid(),
            sourceKey: key,
            url: z.string(),
            checkedOn: z.iso.date(),
            contentHash: hash,
            body: z.string(),
          }),
        )
        .max(3),
    })
    .parse(savedJson(context.user));
  const observation = observationSchema.parse({
    caseId,
    context,
    trace: run.trace,
    input: {
      cardId: run.card_id,
      documents: envelope.documents.map((doc) => ({
        id: doc.documentId,
        source_key: doc.sourceKey,
        url: doc.url,
        checked_on: doc.checkedOn,
        content_hash: doc.contentHash,
        body: doc.body,
        title: 'Reconstructed from saved model context; original capture metadata is not included.',
        created_at: run.started_at,
        created_by: null,
      })),
    },
  });
  if (
    run.profile_id !== run.profile.id ||
    observation.trace.runId !== run.id ||
    observation.trace.provider.id !== run.profile.provider ||
    observation.trace.provider.model !== run.profile.model ||
    observation.trace.provider.mode !== run.profile.mode ||
    observation.trace.provider.pricing.input !== run.profile.input_price ||
    observation.trace.provider.pricing.output !== run.profile.output_price
  )
    throw new Error('Ledger trace identity does not match its run/profile.');
  const limits = observation.trace.limits,
    profile = run.profile;
  if (
    limits.budgetMicrousd !== run.reserved_microusd ||
    limits.maxAttempts !== profile.max_attempts ||
    limits.maxInputTokens !== profile.max_input_tokens ||
    limits.maxOutputTokens !== profile.max_output_tokens ||
    limits.attemptTimeoutMs !== profile.attempt_timeout_ms ||
    limits.totalTimeoutMs !== profile.total_timeout_ms
  )
    throw new Error('Ledger trace limits do not match its reservation/profile.');
  return observation;
}

function verifyObservation(item: EvalCase, observation: EvalObservation) {
  const { input, context, trace } = observation;
  if (context.versions.context !== 'captured-text-json.3')
    throw new Error(
      'Replay requires context version 3; earlier JSONB records did not preserve a portable context hash.',
    );
  if (validateInputs(input, Date.now()).length || inputHash(item.input) !== inputHash(input))
    throw new Error(`Observation input mismatch for ${item.id}.`);
  const expectedEnvelope = JSON.parse(buildContext(input).user);
  expectedEnvelope.contextVersion = context.versions.context;
  if (
    canonical(savedJson(context.user)) !== canonical(expectedEnvelope) ||
    context.hash !==
      sha256(
        canonical({
          system: context.system,
          user: context.user,
          jsonSchema: context.jsonSchema,
          sourcePolicy: context.versions.sourcePolicy,
        }),
      ) ||
    trace.context?.hash !== context.hash ||
    canonical(trace.context.versions) !== canonical(context.versions) ||
    trace.context.inputTokenEstimate !== context.inputTokenEstimate ||
    canonical(trace.documents) !==
      canonical(input.documents.map((doc) => ({ id: doc.id, contentHash: doc.content_hash })))
  )
    throw new Error(`Observation context mismatch for ${item.id}.`);
  if (trace.status === 'evidence_valid' || trace.status === 'needs_review') {
    if (!trace.extraction) throw new Error(`Successful trace has no extraction for ${item.id}.`);
    const last = trace.attempts.at(-1);
    if (
      last?.outcome !== trace.status ||
      !last.rawOutput ||
      canonical(extractionSchema.parse(savedJson(last.rawOutput))) !== canonical(trace.extraction)
    )
      throw new Error(`Parsed extraction does not match the saved raw output for ${item.id}.`);
  } else if (trace.extraction) throw new Error(`Unexpected extraction on failed trace for ${item.id}.`);
  const cost = (input: number, output: number) =>
    Math.ceil((input * trace.provider.pricing.input + output * trace.provider.pricing.output) / 1_000_000);
  const reservation = cost(trace.limits.maxInputTokens, trace.limits.maxOutputTokens);
  let previousCost = 0;
  for (const attempt of trace.attempts) {
    if (
      trace.provider.mode === 'metered' &&
      (!trace.limits.budgetMicrousd || previousCost + reservation > trace.limits.budgetMicrousd)
    )
      throw new Error(`Attempt exceeded recorded spending admission for ${item.id}.`);
    previousCost += attempt.accountedMicrousd;
  }
  if (
    trace.attempts.length > trace.limits.maxAttempts ||
    trace.attempts.some(
      (attempt, i) =>
        attempt.number !== i + 1 ||
        attempt.reservedMicrousd !== reservation ||
        attempt.accountedMicrousd !==
          (attempt.usage ? cost(attempt.usage.inputTokens, attempt.usage.outputTokens) : reservation),
    )
  )
    throw new Error(`Attempt accounting mismatch for ${item.id}.`);
  if (trace.attempts.reduce((sum, attempt) => sum + attempt.accountedMicrousd, 0) !== trace.accountedMicrousd)
    throw new Error(`Trace accounting mismatch for ${item.id}.`);
}
const fraction = (correct: number, total: number) => ({
  correct,
  total,
  rate: total ? correct / total : null,
});
function covered(
  anchors: z.infer<typeof anchorSchema>[],
  evidence: Extraction['conditions'][number]['evidence'],
  input: ExtractionInput,
) {
  return anchors.some((anchor) =>
    evidence.some((cite) => {
      const doc = input.documents.find((value) => value.id === cite.documentId);
      return (
        doc?.source_key === anchor.sourceKey &&
        doc.content_hash === cite.contentHash &&
        cite.start < cite.end &&
        doc.body.slice(cite.start, cite.end) === cite.quote &&
        cite.quote.includes(anchor.quote)
      );
    }),
  );
}
export function scoreCase(item: EvalCase, observation: EvalObservation) {
  verifyObservation(item, observation);
  const output = observation.trace.extraction,
    acceptedOutput = ['needs_review', 'evidence_valid'].includes(observation.trace.status)
      ? output
      : undefined;
  let fields = 0,
    correct = 0,
    expectedKnown = 0,
    predictedKnown = 0,
    correctKnown = 0,
    unsupportedKnown = 0,
    unnecessaryAbstentions = 0;
  const errors: string[] = [];
  for (const expected of item.reference.rules) {
    const actual = acceptedOutput?.rules.find((value) => value.ruleId === expected.ruleId);
    for (const field of ['rateBps', 'category', 'activation', 'cap'] as const) {
      fields++;
      if (expected[field].state === 'known') expectedKnown++;
      const value = actual?.[field];
      const stripped = value
        ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'evidence'))
        : null;
      const equal = canonical(stripped) === canonical(expected[field]);
      if (equal) correct++;
      else errors.push(`${expected.ruleId}.${field}`);
      if (value?.state === 'known') {
        predictedKnown++;
        if (equal) correctKnown++;
        else unsupportedKnown++;
      } else if (expected[field].state === 'known' && value) unnecessaryAbstentions++;
    }
  }
  // Count unexpected/duplicate known rules too; otherwise extra hallucinations disappear from precision.
  const expectedIds = new Set(item.reference.rules.map((value) => value.ruleId)),
    seen = new Set<string>();
  for (const actual of acceptedOutput?.rules ?? []) {
    if (!expectedIds.has(actual.ruleId) || seen.has(actual.ruleId)) {
      const extra = [actual.rateBps, actual.category, actual.activation, actual.cap].filter(
        (value) => value.state === 'known',
      ).length;
      predictedKnown += extra;
      unsupportedKnown += extra;
      errors.push(`unexpected-rule:${actual.ruleId}`);
    }
    seen.add(actual.ruleId);
  }
  const missedConditions = item.reference.conditions
    .filter(
      (expected) =>
        !acceptedOutput?.conditions.some(
          (actual) =>
            actual.kind === expected.kind && covered(expected.anchors, actual.evidence, observation.input),
        ),
    )
    .map((value) => value.id);
  const unmatchedConditions = (acceptedOutput?.conditions ?? []).filter(
    (actual) =>
      !item.reference.conditions.some(
        (expected) =>
          expected.kind === actual.kind && covered(expected.anchors, actual.evidence, observation.input),
      ),
  ).length;
  const missedIssues = item.reference.issues
    .filter(
      (expected) =>
        !acceptedOutput?.issues.some(
          (actual) =>
            actual.code === expected.code &&
            actual.field === expected.field &&
            (!expected.anchors.length || covered(expected.anchors, actual.evidence, observation.input)),
        ),
    )
    .map((value) => `${value.code}:${value.field}`);
  const evidenceFindings = acceptedOutput ? validateExtraction(acceptedOutput, observation.input) : [];
  const falseClear =
    observation.trace.status === 'evidence_valid' &&
    (item.reference.requiresReview ||
      errors.length > 0 ||
      missedConditions.length > 0 ||
      missedIssues.length > 0 ||
      evidenceFindings.length > 0);
  return {
    caseId: item.id,
    split: item.split,
    family: item.family,
    tags: item.tags,
    status: observation.trace.status,
    fields,
    correct,
    expectedKnown,
    predictedKnown,
    correctKnown,
    unsupportedKnown,
    unnecessaryAbstentions,
    conditionCount: item.reference.conditions.length,
    missedConditions,
    unmatchedConditions,
    issueCount: item.reference.issues.length,
    missedIssues,
    fieldErrors: errors,
    evidenceFindings,
    falseClear,
    runId: observation.trace.runId,
    contextHash: observation.context.hash,
    versions: observation.context.versions,
    provider: observation.trace.provider,
    durationMs: observation.trace.durationMs,
    accountedMicrousd: observation.trace.accountedMicrousd,
  };
}
export function evaluateCorpus(
  rawCorpus: unknown,
  rawBundle: unknown,
  split: 'development' | 'reserved' | 'all' = 'development',
) {
  const corpus = validateCorpus(rawCorpus),
    bundle = observationBundleSchema.parse(rawBundle);
  if (bundle.corpusHash !== corpusHash(corpus))
    throw new Error('Corpus changed since these observations were collected.');
  const selected = corpus.cases.filter((item) => split === 'all' || item.split === split),
    byId = new Map(selected.map((item) => [item.id, item]));
  if (!selected.length) throw new Error('The selected corpus split contains no cases.');
  // One experiment must use one generation configuration; source contents vary by case.
  const configurationOf = (observation: EvalObservation) => ({
    provider: observation.trace.provider,
    versions: observation.context.versions,
    systemHash: sha256(observation.context.system),
    schemaHash: sha256(canonical(observation.context.jsonSchema)),
    limits: observation.trace.limits,
  });
  const configuration = bundle.observations.length ? configurationOf(bundle.observations[0]) : null;
  const seen = new Set<string>(),
    runs = new Set<string>();
  const cases = bundle.observations.map((observation) => {
    const item = byId.get(observation.caseId);
    if (!item || seen.has(item.id) || runs.has(observation.trace.runId))
      throw new Error('Unexpected or duplicate observation.');
    if (bundle.provenance === 'scripted-diagnostic' && observation.trace.provider.mode !== 'fixture')
      throw new Error('Scripted diagnostics cannot contain metered traces.');
    if (canonical(configurationOf(observation)) !== canonical(configuration))
      throw new Error('Mixed generation configurations require separate experiments.');
    seen.add(item.id);
    runs.add(observation.trace.runId);
    return scoreCase(item, observation);
  });
  const sum = (
    field:
      | 'correct'
      | 'fields'
      | 'expectedKnown'
      | 'predictedKnown'
      | 'correctKnown'
      | 'conditionCount'
      | 'issueCount'
      | 'unsupportedKnown'
      | 'unnecessaryAbstentions'
      | 'unmatchedConditions'
      | 'accountedMicrousd',
  ) => cases.reduce((total, value) => total + value[field], 0);
  const missing = selected.filter((item) => !seen.has(item.id)).map((item) => item.id),
    complete = missing.length === 0;
  const durations = cases.map((value) => value.durationMs).sort((a, b) => a - b);
  return {
    schemaVersion: 1,
    evaluatorVersion: EVALUATOR_VERSION,
    experiment: bundle.experiment,
    provenance: bundle.provenance,
    configuration,
    corpus: {
      version: corpus.version,
      hash: corpusHash(corpus),
      origin: corpus.origin,
      annotationStatus: corpus.annotationStatus,
      split,
    },
    limitations: [
      'Synthetic, agent-authored cases await human label review.',
      'Condition/issue scores measure cited evidence coverage, not semantic understanding.',
      'Imported trace provenance is not independently verified; scripted runs are not model measurements.',
      'Only two issuer families are represented; the reserved split is not yet a validated held-out benchmark.',
    ],
    complete,
    planned: selected.length,
    observed: cases.length,
    missing,
    // Partial results are retained per case, but omitted aggregate quality scores cannot hide difficult missing cases.
    metrics: complete
      ? {
          exactFieldAgreement: fraction(sum('correct'), sum('fields')),
          knownFactPrecision: fraction(sum('correctKnown'), sum('predictedKnown')),
          knownFactRecall: fraction(sum('correctKnown'), sum('expectedKnown')),
          unsupportedKnownClaims: sum('unsupportedKnown'),
          unnecessaryAbstentions: sum('unnecessaryAbstentions'),
          conditionEvidenceCoverage: fraction(
            sum('conditionCount') - cases.reduce((n, value) => n + value.missedConditions.length, 0),
            sum('conditionCount'),
          ),
          issueEvidenceCoverage: fraction(
            sum('issueCount') - cases.reduce((n, value) => n + value.missedIssues.length, 0),
            sum('issueCount'),
          ),
          unmatchedConditions: sum('unmatchedConditions'),
          falseClearCases: cases.filter((value) => value.falseClear).length,
          refusals: cases.filter((value) => value.status === 'refused').length,
          operationalFailures: cases.filter(
            (value) => !['refused', 'needs_review', 'evidence_valid'].includes(value.status),
          ).length,
        }
      : null,
    execution: {
      accountedMicrousd: sum('accountedMicrousd'),
      p50Ms: durations.length ? durations[Math.ceil(durations.length * 0.5) - 1] : null,
      p95Ms: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
    },
    cases,
  };
}

/** A deliberately unhelpful baseline exercises scoring. It never reads reference labels. */
export function abstainingProvider(): ExtractionProvider {
  return {
    id: 'fixture',
    model: 'abstain-v1',
    mode: 'fixture',
    pricing: { input: 0, output: 0 },
    invoke: async (request) => {
      const { target } = JSON.parse(request.user);
      const unknown = { state: 'unknown', value: null, evidence: [] };
      return {
        finishReason: 'stop',
        usage: { inputTokens: 0, outputTokens: 0 },
        text: JSON.stringify({
          schemaVersion: 1,
          cardId: target.cardId,
          rules: target.rules.map((rule: { ruleId: string }) => ({
            ruleId: rule.ruleId,
            rateBps: unknown,
            category: unknown,
            activation: unknown,
            cap: { state: 'unknown', kind: null, amountCents: null, period: null, evidence: [] },
          })),
          conditions: [],
          issues: [
            {
              code: 'missing',
              field: 'document',
              detail: 'Scripted abstention baseline; no model was called.',
              evidence: [],
            },
          ],
        }),
      };
    },
  };
}
