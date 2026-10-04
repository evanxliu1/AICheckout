// `pipeline eval`: the batch's eval stage (wiki/system/card-expansion-pipeline.md, stage 10). It wraps
// `scripts/expansion-pipeline-metrics.mjs` (draft → verified metrics, committed files only) and
// `scripts/score-expansion-traces.mjs` (re-score the batch's saved traces against its verified corpus; needs the
// batch's captures and traces, `inputs-missing` otherwise), adds the agreement of the batch's verified labels with the
// frozen `expansion.v1` labels for refreshed cards and the per-stage timings state and the extraction summary record,
// and writes the text-free `pipeline/eval.json`. No model is called: the optional gpt-5.5 cross-model run is started
// by the coordinator from the printed command, and `--cross-model-run DIR` only scores it.
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { matchRules } from '../../../apps/api/src/curation/v2/score.ts';
import { deriveBatch } from './derive.ts';
import { loadBatch, statePath } from './files.ts';
import type { Batch } from './files.ts';
import { fileSha256 } from './hash.ts';
import { STAGE_VERSIONS } from './inputs.ts';
import type { Env } from './run.ts';
import { CARD_STAGES, ISSUER_STAGES, writeJsonAtomic, writeState } from './state.ts';
import type { StageRecord } from './state.ts';

/** The frozen layer the agreement compares with (never written by the pipeline). */
export const FROZEN_CORPUS = 'evals/curation/expansion/corpus.json';
export const EVAL_FILE = 'pipeline/eval.json';
/** Rule value fields compared for agreement: `RULE_VALUE_FIELDS` of scripts/lib/expansion-metrics.mjs without
 * `category` (the match key) and `issuerWording` (wording, not a value). */
export const AGREEMENT_RULE_FIELDS = [
  'rateBps',
  'paidOnPaymentBps',
  'cap',
  'activation',
  'usMerchantsOnly',
  'limitedTime',
] as const;
/** `CARD_VALUE_FIELDS` of scripts/lib/expansion-metrics.mjs: reward currency and point value. */
export const AGREEMENT_CARD_FIELDS = ['rewardCurrency', 'pointValueHundredthsOfCent'] as const;

interface Fraction {
  agree: number;
  total: number;
  rate: number | null;
}
const fraction = (agree: number, total: number): Fraction => ({
  agree,
  total,
  rate: total ? Number((agree / total).toFixed(4)) : null,
});

type LabelRule = Record<string, unknown> & { category: string; issuerWording?: string; rateBps?: number };
interface LabelCase {
  cardId: string;
  reference: {
    rewardCurrency?: { value: unknown };
    pointValueHundredthsOfCent?: { value: unknown };
    rules?: LabelRule[];
    exclusions?: unknown[];
    issues?: { code?: string }[];
  };
}

export interface CardAgreement {
  cardId: string;
  rules: { frozen: number; batch: number; matched: number };
  onlyFrozen: string[];
  onlyBatch: string[];
  ruleFields: Record<(typeof AGREEMENT_RULE_FIELDS)[number], Fraction>;
  cardFields: Record<(typeof AGREEMENT_CARD_FIELDS)[number], boolean>;
  exclusions: { frozen: number; batch: number };
  issues: { frozen: number; batch: number };
}

/**
 * Agreement of a batch's verified labels with the frozen expansion.v1 labels of the same cards. Rules are paired
 * within a category by the v2 scorer's `matchRules` (closest issuer wording, then an equal rate): corpus v2 labels
 * have no condition fields beyond the compared values, so category is the match key. Both sides are agent-verified,
 * so this is agreement between two label sets, not accuracy.
 */
export function labelAgreement(frozenCases: LabelCase[], batchCases: LabelCase[]) {
  const frozen = new Map(frozenCases.map((item) => [item.cardId, item]));
  const cards: CardAgreement[] = [];
  for (const item of [...batchCases].sort((a, b) => a.cardId.localeCompare(b.cardId))) {
    const before = frozen.get(item.cardId);
    if (!before) continue;
    const frozenRules = before.reference.rules ?? [];
    const batchRules = item.reference.rules ?? [];
    const asPredicted = (rule: LabelRule) => ({
      ...rule,
      issuerWording: rule.issuerWording ?? '',
      rateBps: { value: rule.rateBps ?? null },
    });
    const pairs = matchRules(frozenRules as never, batchRules.map(asPredicted) as never);
    const ruleFields = Object.fromEntries(
      AGREEMENT_RULE_FIELDS.map((field) => [
        field,
        fraction(
          pairs.filter(([f, b]) => isDeepStrictEqual(frozenRules[f][field], batchRules[b][field])).length,
          pairs.length,
        ),
      ]),
    ) as CardAgreement['ruleFields'];
    const cardFields = Object.fromEntries(
      AGREEMENT_CARD_FIELDS.map((field) => [
        field,
        isDeepStrictEqual(before.reference[field]?.value ?? null, item.reference[field]?.value ?? null),
      ]),
    ) as CardAgreement['cardFields'];
    const matchedFrozen = new Set(pairs.map(([f]) => f));
    const matchedBatch = new Set(pairs.map(([, b]) => b));
    cards.push({
      cardId: item.cardId,
      rules: { frozen: frozenRules.length, batch: batchRules.length, matched: pairs.length },
      onlyFrozen: frozenRules.filter((_, i) => !matchedFrozen.has(i)).map((rule) => rule.category),
      onlyBatch: batchRules.filter((_, i) => !matchedBatch.has(i)).map((rule) => rule.category),
      ruleFields,
      cardFields,
      exclusions: {
        frozen: before.reference.exclusions?.length ?? 0,
        batch: item.reference.exclusions?.length ?? 0,
      },
      issues: { frozen: before.reference.issues?.length ?? 0, batch: item.reference.issues?.length ?? 0 },
    });
  }
  const sum = (pick: (card: CardAgreement) => number) => cards.reduce((n, card) => n + pick(card), 0);
  const frozenRules = sum((card) => card.rules.frozen);
  const batchRules = sum((card) => card.rules.batch);
  const matched = sum((card) => card.rules.matched);
  const ruleFields = Object.fromEntries(
    AGREEMENT_RULE_FIELDS.map((field) => [
      field,
      fraction(
        sum((card) => card.ruleFields[field].agree),
        matched,
      ),
    ]),
  );
  const allRuleFields = fraction(
    AGREEMENT_RULE_FIELDS.reduce((n, field) => n + sum((card) => card.ruleFields[field].agree), 0),
    matched * AGREEMENT_RULE_FIELDS.length,
  );
  const cardFields = Object.fromEntries(
    AGREEMENT_CARD_FIELDS.map((field) => [
      field,
      fraction(cards.filter((card) => card.cardFields[field]).length, cards.length),
    ]),
  );
  return {
    frozen: 'expansion.v1',
    measure: 'agreement-not-accuracy',
    note: 'Agreement between two agent-verified label sets (this batch and the frozen expansion.v1) on the same cards; neither is human-verified, so this is not accuracy.',
    matching: 'same category, then closest issuer wording and an equal rate (v2 scorer matchRules)',
    overall: {
      cards: cards.length,
      /** Same rules, rule and card field values, and exclusion and issue counts (counts only: their texts are not
       * compared). */
      cardsIdentical: cards.filter(
        (card) =>
          card.rules.matched === card.rules.frozen &&
          card.rules.matched === card.rules.batch &&
          AGREEMENT_RULE_FIELDS.every((field) => card.ruleFields[field].agree === card.rules.matched) &&
          AGREEMENT_CARD_FIELDS.every((field) => card.cardFields[field]) &&
          card.exclusions.frozen === card.exclusions.batch &&
          card.issues.frozen === card.issues.batch,
      ).length,
      rules: {
        frozen: frozenRules,
        batch: batchRules,
        matched,
        onlyFrozen: frozenRules - matched,
        onlyBatch: batchRules - matched,
      },
      ruleFields,
      allRuleFields,
      cardFields,
      exclusions: {
        frozen: sum((card) => card.exclusions.frozen),
        batch: sum((card) => card.exclusions.batch),
      },
      issues: { frozen: sum((card) => card.issues.frozen), batch: sum((card) => card.issues.batch) },
    },
    cards,
  };
}

interface StageTiming {
  records: number;
  done: number;
  attempts: number;
  paused: number;
  firstFinishedAt: string | null;
  lastFinishedAt: string | null;
  models: string[];
}

function stageTiming(records: StageRecord[]): StageTiming {
  const finished = records
    .map((record) => record.finishedAt ?? record.acceptedAt)
    .filter(Boolean) as string[];
  finished.sort();
  return {
    records: records.length,
    done: records.filter((record) => record.status === 'done').length,
    attempts: records.reduce((n, record) => n + (record.attempts ?? 0), 0),
    paused: records.filter((record) => record.status === 'paused' || record.reason === 'usage-limit').length,
    firstFinishedAt: finished[0] ?? null,
    lastFinishedAt: finished.at(-1) ?? null,
    models: [...new Set(records.map((record) => record.model).filter(Boolean) as string[])].sort(),
  };
}

interface SummaryCard {
  cardId: string;
  runs?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Per-stage timings from state and model minutes and tokens per card from `extraction-summary.json`. */
export function timings(batch: Batch, summary: { cards?: SummaryCard[] } | null) {
  const stages: Record<string, StageTiming> = {};
  stages.research = stageTiming(
    Object.values(batch.state.issuers).flatMap((issuer) =>
      issuer.stages.research ? [issuer.stages.research] : [],
    ),
  );
  for (const stage of CARD_STAGES) {
    if (stage === 'freshness') continue;
    stages[stage] = stageTiming(
      Object.values(batch.state.cards).flatMap((card) => (card.stages[stage] ? [card.stages[stage]] : [])),
    );
  }
  stages.build = stageTiming(batch.state.batchStages.build ? [batch.state.batchStages.build] : []);
  const ids = new Set(batch.cards.map((card) => card.id));
  const num = (value: unknown) => (typeof value === 'number' ? value : null);
  const cards = (summary?.cards ?? [])
    .filter((card) => ids.has(card.cardId))
    .map((card) => ({
      cardId: card.cardId,
      runs: num(card.runs),
      modelMinutes: num(card.durationMs) === null ? null : Number((card.durationMs! / 60_000).toFixed(2)),
      inputTokens: num(card.inputTokens),
      outputTokens: num(card.outputTokens),
    }));
  const total = (key: 'modelMinutes' | 'inputTokens' | 'outputTokens') =>
    cards.length && cards.every((card) => card[key] !== null)
      ? Number(cards.reduce((n, card) => n + card[key]!, 0).toFixed(2))
      : null;
  const extract = summary
    ? {
        cards,
        totals: {
          cards: cards.length,
          modelMinutes: total('modelMinutes'),
          inputTokens: total('inputTokens'),
          outputTokens: total('outputTokens'),
        },
      }
    : null;
  // Agent stages: the run time and tokens `accept --duration-ms/--tokens` records on each issuer's stage record.
  const agentRecords = Object.values(batch.state.issuers).flatMap((issuer) =>
    ISSUER_STAGES.flatMap((stage) => (issuer.stages[stage] ? [issuer.stages[stage]] : [])),
  );
  const agentTotal = (key: 'durationMs' | 'tokens') =>
    agentRecords.some((record) => record[key] !== undefined)
      ? agentRecords.reduce((n, record) => n + (record[key] ?? 0), 0)
      : null;
  const agentMs = agentTotal('durationMs');
  const agentTokens = agentTotal('tokens');
  const perCard = (value: number | null) =>
    value === null || !batch.cards.length ? null : Number((value / batch.cards.length).toFixed(2));
  const agentMinutes = agentMs === null ? null : Number((agentMs / 60_000).toFixed(2));
  return {
    startedAt: null,
    unavailable: [
      'startedAt: state records finishedAt and acceptedAt only',
      ...(agentMs === null && agentTokens === null
        ? ['agent stages (research, verify, adjudicate, overlay): no model minutes or tokens are recorded']
        : []),
      ...(summary ? [] : ['extract: no extraction-summary.json in the batch']),
    ],
    stages,
    extract,
    agentStages: {
      modelMinutes: agentMinutes,
      tokens: agentTokens,
      perCard: { modelMinutes: perCard(agentMinutes), tokens: perCard(agentTokens) },
    },
  };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

/** Counts and rates of a score-expansion-traces.mjs row (no configuration strings, no text). */
function scoreRow(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const { planned, observed, complete, overall } = row as Record<string, unknown>;
  return { planned, observed, complete, overall };
}

export interface EvalOptions {
  crossModelRun?: string;
}

export async function runEval(env: Env, batchId: string, options: EvalOptions = {}): Promise<number> {
  let batch = await loadBatch(env.root, batchId);
  const view = await deriveBatch(batch, env.now());
  if (!view.eval.ready) {
    env.log(`eval: not ready (build ${view.build.status}); run the build first.`);
    return 1;
  }
  const rel = batch.rel;
  const work = await mkdtemp(join(tmpdir(), 'pipeline-eval-'));
  try {
    // (a) Pipeline metrics from committed files.
    const metricsFile = join(work, 'metrics.json');
    const metricsCode = await env.exec('node', [
      'scripts/expansion-pipeline-metrics.mjs',
      '--dir',
      rel,
      '--output',
      metricsFile,
    ]);
    if (metricsCode !== 0 || !(await exists(metricsFile))) {
      await recordEval(env, batch, view.eval.inputHash, { status: 'failed-gate', reason: 'metrics-failed' });
      env.log('eval: the pipeline metrics do not reconcile (see the script output above).');
      return 1;
    }
    const metrics = (await readJson(metricsFile)) as Record<string, unknown>;

    // (b) Re-score the saved traces, (c) score the cross-model run: both need the batch's captures and traces.
    const missing: string[] = [];
    const sourceIds = new Set<string>();
    for (const cardId of batch.corpus.keys()) {
      if (!(await exists(join(batch.dir, 'extractions', `${cardId}.json`))))
        missing.push(`extractions/${cardId}.json`);
      for (const sourceId of batch.cards.find((card) => card.id === cardId)?.sourceIds ?? [])
        sourceIds.add(sourceId);
    }
    for (const sourceId of [...sourceIds].sort())
      if (!(await exists(join(batch.dir, 'captures', `${sourceId}.txt`))))
        missing.push(`captures/${sourceId}.txt`);
    if (options.crossModelRun && !(await exists(join(options.crossModelRun, 'observations.json')))) {
      env.log(`eval: --cross-model-run ${options.crossModelRun} has no observations.json.`);
      return 2;
    }
    let traces: Record<string, unknown> = { status: 'inputs-missing', missing: missing.length };
    let crossModel: Record<string, unknown> = options.crossModelRun
      ? { status: 'inputs-missing' }
      : { status: 'not-run' };
    if (!missing.length) {
      const scoresFile = join(work, 'scores.json');
      const args = [
        'scripts/score-expansion-traces.mjs',
        '--dir',
        rel,
        '--captures',
        `${rel}/captures`,
        '--traces',
        `${rel}/extractions`,
        '--output',
        scoresFile,
        ...(options.crossModelRun ? ['--run', options.crossModelRun] : []),
      ];
      const code = await env.exec('node', args);
      if (code !== 0 || !(await exists(scoresFile))) {
        await recordEval(env, batch, view.eval.inputHash, {
          status: 'failed-gate',
          reason: 'rescore-failed',
        });
        env.log('eval: re-scoring the saved traces failed (see the script output above).');
        return 1;
      }
      const scores = (await readJson(scoresFile)) as Record<string, Record<string, unknown>>;
      const subsets = (block: Record<string, unknown>) => ({
        all: scoreRow(block.all as Record<string, unknown>),
        drafted: scoreRow(block.drafted as Record<string, unknown>),
        undrafted: scoreRow(block.undrafted as Record<string, unknown>),
        byIssuer: block.byIssuer ?? null,
      });
      const luna = scores.lunaRescore;
      traces = {
        status: 'scored',
        scorerVersion: scores.scorerVersion,
        corpus: { version: scores.corpus.version, hash: scores.corpus.hash, cases: scores.corpus.cases },
        upperBound: true,
        files: (luna.traces as Record<string, unknown>).files,
        scored: (luna.traces as Record<string, unknown>).scored,
        skipped: ((luna.traces as Record<string, unknown>).skipped as unknown[]).length,
        ...subsets(luna),
      };
      if (options.crossModelRun)
        crossModel = { status: 'scored', model: 'gpt-5.5', effort: 'low', ...subsets(scores.crossModel) };
    }
    if (!options.crossModelRun) {
      env.log('eval: the optional cross-model run is started by the coordinator, never by the CLI:');
      await env.exec('node', [
        'scripts/score-expansion-traces.mjs',
        '--print-command',
        '--dir',
        rel,
        '--captures',
        `${rel}/captures`,
      ]);
    }

    // Agreement with the frozen expansion.v1 labels, for refreshed cards.
    const frozenPath = join(env.root, FROZEN_CORPUS);
    const frozen = (await exists(frozenPath))
      ? ((await readJson(frozenPath)) as { cases: LabelCase[] }).cases
      : [];
    const agreementResult = labelAgreement(frozen, [...batch.corpus.values()] as unknown as LabelCase[]);
    const agreement = agreementResult.cards.length ? agreementResult : null;

    const summaryPath = join(batch.dir, 'extraction-summary.json');
    const summary = (await exists(summaryPath))
      ? ((await readJson(summaryPath)) as { cards?: SummaryCard[] })
      : null;

    // The definitions are the script's prose; eval.json points to the script instead.
    const pipeline = { ...metrics };
    delete pipeline.definitions;
    delete pipeline.generatedBy;
    const result = {
      schemaVersion: 1,
      batch: batch.id,
      generatedBy: 'npm run pipeline -- eval',
      annotationStatus: 'agent-verified',
      pipeline: { ...pipeline, definitions: 'scripts/expansion-pipeline-metrics.mjs' },
      traces,
      crossModel,
      agreement,
      timings: timings(batch, summary),
    };
    const out = join(batch.dir, EVAL_FILE);
    await writeJsonAtomic(out, result);
    batch = await loadBatch(env.root, batchId);
    await recordEval(env, batch, view.eval.inputHash, {
      status: 'done',
      outputs: [{ ref: `file:${EVAL_FILE}`, sha256: (await fileSha256(out))! }],
    });
    env.log(evalSummary(result));
    env.log(`eval: wrote ${rel}/${EVAL_FILE}`);
    return 0;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function recordEval(
  env: Env,
  batch: Batch,
  inputHash: string | undefined,
  fields: Partial<StageRecord>,
): Promise<void> {
  batch.state.batchStages.eval = {
    status: 'pending',
    stageVersion: STAGE_VERSIONS.eval,
    ...(inputHash ? { inputHash } : {}),
    finishedAt: env.now().toISOString(),
    attempts: (batch.state.batchStages.eval?.attempts ?? 0) + 1,
    ...fields,
  } as StageRecord;
  await writeState(statePath(batch.dir), batch.state, env.now());
}

const pct = (rate: unknown) => (typeof rate === 'number' ? `${(rate * 100).toFixed(1)}%` : 'n/a');

/** The stdout summary of an eval result. */
export function evalSummary(result: {
  batch: string;
  pipeline: Record<string, unknown>;
  traces: Record<string, unknown>;
  crossModel: Record<string, unknown>;
  agreement: ReturnType<typeof labelAgreement> | null;
  timings: ReturnType<typeof timings>;
}): string {
  const totals = (result.pipeline.totals ?? {}) as Record<string, number>;
  const findings = (result.pipeline.findings ?? {}) as Record<string, number>;
  const overall = (row: unknown) =>
    ((row as { overall?: Record<string, { rate: number | null }> } | null)?.overall ?? {}) as Record<
      string,
      { rate: number | null }
    >;
  const lines = [
    `eval ${result.batch} (labels agent-verified, not human-verified)`,
    `  pipeline: ${totals.cards} cards, ${totals.inCorpus} in corpus (${totals.drafted} drafted, ${totals.undrafted} undrafted), ${totals.confirmed} confirmed, ${totals.fixed} fixed, ${totals.dropped} dropped`,
    `  draft → verified: rule-field correction ${pct(totals.ruleFieldCorrectionRate)} (${totals.ruleFieldsChanged}/${totals.ruleFieldValues}), card-field ${pct(totals.cardFieldCorrectionRate)}, rules removed ${totals.rulesRemoved}, added ${totals.rulesAdded}`,
    `  findings: accepted ${findings.accepted}, modified ${findings.modified}, rejected ${findings.rejected}`,
  ];
  if (result.traces.status === 'scored') {
    const all = overall(result.traces.all);
    lines.push(
      `  trace re-score (upper bound: labels seeded from these traces): end-to-end field accuracy ${pct(all.endToEndFieldAccuracy?.rate)}, rule recall ${pct(all.ruleRecall?.rate)}, rule precision ${pct(all.rulePrecision?.rate)}`,
    );
  } else
    lines.push(
      `  trace re-score: inputs-missing (${result.traces.missing} capture or trace files are not on this machine; run eval in the checkout that holds them)`,
    );
  if (result.crossModel.status === 'scored') {
    const all = overall(result.crossModel.all);
    lines.push(
      `  cross-model gpt-5.5 low: end-to-end field accuracy ${pct(all.endToEndFieldAccuracy?.rate)}, rule recall ${pct(all.ruleRecall?.rate)}, rule precision ${pct(all.rulePrecision?.rate)}`,
    );
  } else lines.push(`  cross-model: ${result.crossModel.status}`);
  if (result.agreement) {
    const a = result.agreement.overall;
    lines.push(
      `  agreement with expansion.v1 (two agent-verified label sets; agreement, not accuracy): ${a.cards} cards, ${a.cardsIdentical} identical; rules matched ${a.rules.matched} (only expansion.v1 ${a.rules.onlyFrozen}, only this batch ${a.rules.onlyBatch}); rule fields ${pct(a.allRuleFields.rate)} (${a.allRuleFields.agree}/${a.allRuleFields.total}); exclusions ${a.exclusions.frozen} → ${a.exclusions.batch}, issues ${a.issues.frozen} → ${a.issues.batch}`,
    );
  } else
    lines.push(
      '  agreement with expansion.v1: no refreshed card (none of the batch cards is in expansion.v1)',
    );
  const extract = result.timings.extract;
  lines.push(
    extract
      ? `  extract: ${extract.totals.cards} cards, model minutes ${extract.totals.modelMinutes ?? 'n/a'}, tokens in ${extract.totals.inputTokens ?? 'n/a'} / out ${extract.totals.outputTokens ?? 'n/a'}`
      : '  extract: no extraction-summary.json (minutes and tokens unknown)',
  );
  return lines.join('\n');
}
