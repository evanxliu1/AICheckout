// `pipeline eval` and `pipeline handoff` on the synthetic fixture batch. The metrics script runs for real on the
// fixture's committed-style files; the trace scorer is a stub (it needs real captures); the frozen expansion.v1 layer
// is a fake one written into the throwaway root. No issuer text, no model.
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NextStep } from '../src/derive.ts';
import { EVAL_FILE, labelAgreement } from '../src/eval.ts';
import {
  REVIEW_MANIFEST_MODULE,
  captureFolders,
  handoff,
  handoffReport,
  readReviewManifests,
  renderRuleIds,
  reviewAppReadiness,
} from '../src/handoff.ts';
import type { CatalogSummary, HandoffDeps } from '../src/handoff.ts';
import { sha256Hex } from '../src/hash.ts';
import { packetSchema } from '../src/packets.ts';
import type { Packet } from '../src/packets.ts';
import { REPO_ROOT } from '../src/root.ts';
import { sha256Json } from '../../../scripts/lib/catalog-batches.mjs';
import { ALPHA, BATCH, BETA, FIXTURE, captureText, harness, initWithResearch } from './helpers.ts';
import type { Harness } from './helpers.ts';

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const rule = (category: string, rateBps: number, extra: Record<string, unknown> = {}) => ({
  category,
  issuerWording: `fake ${category} words`,
  rateBps,
  paidOnPaymentBps: 0,
  cap: null,
  activation: null,
  usMerchantsOnly: null,
  limitedTime: null,
  anchors: [`fake ${category} words`],
  ...extra,
});
const labels = (
  currency: string,
  point: number | null,
  rules: unknown[],
  issues: unknown[] = [],
  anchors: { currency: string[]; point: string[] } = { currency: [], point: [] },
) => ({
  rewardCurrency: { value: currency, anchors: anchors.currency },
  pointValueHundredthsOfCent: { value: point, anchors: anchors.point },
  rules,
  exclusions: [],
  issues,
});
const SOURCES: Record<string, string[]> = {
  [ALPHA]: ['example-bank-alpha-product'],
  [BETA]: ['example-bank-beta-product', 'example-bank-beta-terms'],
};
const item = (cardId: string, reference: unknown) => ({
  id: cardId,
  cardId,
  cardName: cardId,
  issuer: 'Example Bank',
  split: 'dev',
  sourceIds: SOURCES[cardId] ?? [],
  reference,
});
/** Rule evidence that is in the synthetic captures and states the rule's rate (the apply label lint). */
const said = (wording: string, anchors = [wording]) => ({ issuerWording: wording, anchors });
const EXTRA_CAPTURE_TEXT = 'fake beta dining words 4X points. fake beta travel words 2X points.\n';
const ALPHA_ALL = rule('all-purchases', 200, said('fake alpha words 2% back'));
const BETA_ALL = rule('all-purchases', 100, said('fake beta words 1X points'));
const BETA_TRAVEL = rule('transit', 200, said('fake beta travel words 2X points'));
const ALPHA_ANCHORS = { currency: ['fake alpha words 2% back'], point: [] };
const BETA_ANCHORS = { currency: ['fake beta words 3X points'], point: ['fake beta words 1X points'] };
const betaDining = (rateBps: number, anchor: string) =>
  rule('dining', rateBps, said('fake beta words 3X points', [anchor]));

const DRAFT = {
  schemaVersion: 2,
  version: `${BATCH}.draft.1`,
  cases: [
    item(ALPHA, labels('cash-back', null, [ALPHA_ALL], [], ALPHA_ANCHORS)),
    item(
      BETA,
      labels('points', 100, [betaDining(300, 'fake beta words 3X points'), BETA_ALL], [], BETA_ANCHORS),
    ),
  ],
};
const CORPUS = {
  schemaVersion: 2,
  version: `${BATCH}.v1`,
  annotationStatus: 'agent-verified',
  cases: [
    item(ALPHA, labels('cash-back', null, [ALPHA_ALL], [], ALPHA_ANCHORS)),
    item(
      BETA,
      labels(
        'points',
        100,
        [betaDining(400, 'fake beta dining words 4X points'), BETA_ALL, BETA_TRAVEL],
        [],
        BETA_ANCHORS,
      ),
    ),
  ],
};
const decided = (decision: string) => ({ adjudication: { decision, reason: 'fixture' } });
const anchor = (quote: string) => ({ sourceId: 'example-bank-beta-product', quote });
const travelRule = Object.fromEntries(Object.entries(BETA_TRAVEL).filter(([key]) => key !== 'anchors'));
/** The verifier's findings; `adjudicated` adds the decisions (accepted, rejected, accepted). */
const findingsFile = (adjudicated: boolean) => ({
  schemaVersion: 1,
  issuer: 'Example Bank',
  verifier: { agent: 'fixture', model: 'claude-test', date: '2026-10-04', filesRead: [] as string[] },
  adjudicator: adjudicated
    ? { agent: 'fixture', model: 'claude-test', date: '2026-10-04', filesRead: ['fixture'] }
    : null,
  cards: [
    {
      cardId: ALPHA,
      verdict: 'confirmed',
      reason: null,
      fixes: [],
      addedRules: [],
      addedExclusions: [],
      addedIssues: [],
      productNoteChanges: [],
    },
    {
      cardId: BETA,
      verdict: 'fixed',
      reason: null,
      fixes: [
        {
          op: 'set',
          path: 'reference.rules.0.rateBps',
          current: 300,
          corrected: 400,
          anchor: anchor('fake beta dining words 4X points'),
          note: 'fixture',
          ...(adjudicated ? decided('accepted') : {}),
        },
        {
          op: 'set',
          path: 'reference.rules.1.rateBps',
          current: 100,
          corrected: 150,
          anchor: anchor('fake beta words 1X points'),
          note: 'fixture',
          ...(adjudicated ? decided('rejected') : {}),
        },
      ],
      addedRules: [
        {
          rule: travelRule,
          anchors: [anchor('fake beta travel words 2X points')],
          note: 'fixture',
          ...(adjudicated ? decided('accepted') : {}),
        },
      ],
      addedExclusions: [],
      addedIssues: [],
      productNoteChanges: [],
    },
  ],
});
/** The fake frozen expansion.v1: alpha identical, beta at another dining rate, no travel rule and one issue. */
const FROZEN = {
  schemaVersion: 2,
  version: 'expansion.v1',
  cases: [
    item(ALPHA, labels('cash-back', null, [ALPHA_ALL], [], ALPHA_ANCHORS)),
    item(
      BETA,
      labels(
        'points',
        100,
        [betaDining(300, 'fake beta words 3X points'), BETA_ALL],
        [{ code: 'ambiguous' }],
        BETA_ANCHORS,
      ),
    ),
    item('example-bank-gamma', labels('points', null, [rule('all-purchases', 100)])),
  ],
};

const row = (rate: number) => ({
  planned: 2,
  observed: 2,
  complete: true,
  overall: { runs: 2, endToEndFieldAccuracy: { correct: 9, total: 10, rate } },
});
const SCORES = {
  scorerVersion: 'v2-scorer.2',
  corpus: { version: `${BATCH}.v1`, hash: 'a'.repeat(64), cases: 2 },
  lunaRescore: {
    disclosure: 'not copied to eval.json',
    traces: { files: 2, scored: 2, skipped: [] },
    all: row(0.9),
    drafted: row(0.9),
    undrafted: row(0),
    byIssuer: {},
  },
  crossModel: { status: 'scored', all: row(0.8), drafted: row(0.8), undrafted: row(0), byIssuer: {} },
};

/** Real metrics script on the throwaway batch, a stub trace scorer and print-command. */
function wrapExec(h: Harness): void {
  const inner = h.env.exec;
  h.env.exec = async (command, args) => {
    const flag = (name: string) => args[args.indexOf(name) + 1];
    if (args[0] === 'scripts/expansion-pipeline-metrics.mjs') {
      h.calls.push([command, ...args]);
      return new Promise((done) =>
        execFile(
          'node',
          [args[0], '--dir', join(h.root, flag('--dir')), '--output', flag('--output')],
          { cwd: REPO_ROOT },
          (error) => done(error ? 1 : 0),
        ),
      );
    }
    if (args[0] === 'scripts/score-expansion-traces.mjs') {
      h.calls.push([command, ...args]);
      if (args.includes('--print-command')) {
        h.logs.push('npm run eval:v2 -- (printed cross-model command)');
        return 0;
      }
      await writeFile(flag('--output'), json(SCORES));
      return 0;
    }
    if (args[0] === 'scripts/draft-expansion-labels.mjs') {
      h.calls.push([command, ...args]);
      await writeFile(join(h.dir, 'corpus.draft.json'), json(DRAFT));
      await writeFile(
        join(h.dir, 'product-notes.json'),
        json({ schemaVersion: 1, cards: [ALPHA, BETA].map((cardId) => ({ cardId, hints: [] })) }),
      );
      return 0;
    }
    if (args[0] === 'scripts/apply-expansion-verification.mjs') {
      h.calls.push([command, ...args]);
      await writeFile(join(h.dir, 'corpus.json'), json(CORPUS));
      await writeFile(
        join(h.dir, 'product-notes.verified.json'),
        json({ schemaVersion: 1, cards: [ALPHA, BETA].map((cardId) => ({ cardId, hints: [] })) }),
      );
      return 0;
    }
    return inner(command, args);
  };
}

const ISSUER = 'example-bank';
const claim = async (h: Harness, stage: string) => {
  expect(await h.run('claim', stage, '--batch', BATCH, '--issuer', ISSUER), h.logs.join('\n')).toBe(0);
  const dir = join(h.dir, 'pipeline/packets');
  const files = (await readdir(dir)).sort();
  const packets = await Promise.all(
    files.map(async (file) => packetSchema.parse(JSON.parse(await readFile(join(dir, file), 'utf8')))),
  );
  return packets.find((packet) => packet.status === 'open' && packet.stage === stage)!;
};
const accept = async (h: Harness, stage: string, run: string, durationMs: number, tokens: number) =>
  expect(
    await h.run(
      'accept',
      stage,
      '--batch',
      BATCH,
      '--issuer',
      ISSUER,
      '--agent-run',
      run,
      '--model',
      'claude-test',
      '--duration-ms',
      String(durationMs),
      '--tokens',
      String(tokens),
    ),
    h.logs.join('\n'),
  ).toBe(0);

/** The fixture batch through build by claim / accept and the stage gates, with the eval fixture's labels and a fake
 * frozen layer. */
async function builtBatch(): Promise<Harness> {
  const h = await harness();
  wrapExec(h);
  h.capture.text = (id) => captureText(id) + EXTRA_CAPTURE_TEXT;
  await initWithResearch(h);
  for (const stage of ['capture', 'extract', 'draft'])
    expect(await h.run('run', stage, '--batch', BATCH)).toBe(0);
  const envelope = (packet: Packet) => ({
    packetId: packet.packetId,
    batch: BATCH,
    provenance: 'agent-verified',
  });

  const verify = await claim(h, 'verify');
  const findings = findingsFile(false);
  findings.verifier.filesRead = [...SOURCES[ALPHA], ...SOURCES[BETA]].map(
    (id) => `evals/curation/batches/${BATCH}/captures/${id}.txt`,
  );
  await mkdir(join(verify.output, '..'), { recursive: true });
  await writeFile(verify.output, json({ ...envelope(verify), ...findings }));
  await accept(h, 'verify', 'run-verifier', 60_000, 6000);

  const adjudicate = await claim(h, 'adjudicate');
  // The adjudicator adds decisions to the file as verify accepted it, changing nothing else.
  const decisions = findingsFile(true);
  const file = JSON.parse(await readFile(adjudicate.output, 'utf8'));
  file.packetId = adjudicate.packetId;
  file.adjudicator = decisions.adjudicator;
  file.cards[1].fixes.forEach((fix: object, i: number) => Object.assign(fix, decisions.cards[1].fixes[i]));
  Object.assign(file.cards[1].addedRules[0], decisions.cards[1].addedRules[0]);
  await writeFile(adjudicate.output, json(file));
  await accept(h, 'adjudicate', 'run-adjudicator', 30_000, 3000);
  expect(await h.run('run', 'apply', '--batch', BATCH), h.logs.join('\n')).toBe(0);

  const overlay = await claim(h, 'overlay');
  const fragment = JSON.parse(await readFile(join(FIXTURE, 'overlay-fragment.json'), 'utf8'));
  fragment.packetId = overlay.packetId;
  for (const entry of fragment.cards)
    entry.corpusCaseSha256 = sha256Json(CORPUS.cases.find((card) => card.cardId === entry.cardId));
  await mkdir(join(overlay.output, '..'), { recursive: true });
  await writeFile(overlay.output, json(fragment));
  await accept(h, 'overlay', 'run-overlay', 30_000, 3000);
  expect(await h.run('run', 'build', '--batch', BATCH), h.logs.join('\n')).toBe(0);
  await mkdir(join(h.root, 'evals/curation/expansion'), { recursive: true });
  await writeFile(join(h.root, 'evals/curation/expansion/corpus.json'), json(FROZEN));
  await writeFile(
    join(h.dir, 'extraction-summary.json'),
    json({
      cards: [
        { cardId: ALPHA, runs: 1, durationMs: 120_000, inputTokens: 1000, outputTokens: 100 },
        { cardId: BETA, runs: 2, durationMs: 90_000, inputTokens: 3000, outputTokens: 300 },
      ],
    }),
  );
  return h;
}

const readEval = async (h: Harness) => JSON.parse(await readFile(join(h.dir, EVAL_FILE), 'utf8'));

describe('pipeline eval', () => {
  it('refuses before the build is done', async () => {
    const h = await harness();
    await initWithResearch(h);
    expect(await h.run('eval', '--batch', BATCH)).toBe(1);
    expect(h.logs.at(-1)).toMatch(/not ready/);
  });

  it('writes metrics, the trace re-score, agreement with expansion.v1 and timings, then next hands off', async () => {
    const h = await builtBatch();
    expect(await h.run('eval', '--batch', BATCH)).toBe(0);
    const result = await readEval(h);

    // (a) The real metrics script on the fixture: beta's dining rate fixed, one rule added, one fix rejected.
    expect(result.pipeline.totals).toMatchObject({
      cards: 2,
      inCorpus: 2,
      drafted: 2,
      confirmed: 1,
      fixed: 1,
      dropped: 0,
      draftRules: 3,
      rulesAdded: 1,
      rulesRemoved: 0,
      ruleFieldsChanged: 1,
    });
    expect(result.pipeline.findings).toEqual({ accepted: 2, modified: 0, rejected: 1 });
    expect(result.pipeline.definitions).toBe('scripts/expansion-pipeline-metrics.mjs');

    // (b) The trace re-score (stub) and the printed cross-model command, never a model run.
    expect(result.traces).toMatchObject({ status: 'scored', scored: 2, skipped: 0, upperBound: true });
    expect(result.traces.all.overall.endToEndFieldAccuracy.rate).toBe(0.9);
    expect(result.crossModel).toEqual({ status: 'not-run' });
    expect(h.calls.some((call) => call.includes('--print-command'))).toBe(true);
    expect(h.calls.flat().some((arg) => /eval:v2|codex/.test(arg))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/not copied to eval\.json/);

    // Agreement: two shared cards (gamma is not in the batch), alpha identical.
    expect(result.agreement.measure).toBe('agreement-not-accuracy');
    expect(result.agreement.overall).toMatchObject({
      cards: 2,
      cardsIdentical: 1,
      rules: { frozen: 3, batch: 4, matched: 3, onlyFrozen: 0, onlyBatch: 1 },
      issues: { frozen: 1, batch: 0 },
    });
    expect(result.agreement.overall.ruleFields.rateBps).toEqual({ agree: 2, total: 3, rate: 0.6667 });
    const beta = result.agreement.cards.find((card: { cardId: string }) => card.cardId === BETA);
    expect(beta).toMatchObject({ onlyBatch: ['transit'], onlyFrozen: [] });

    // Timings: what state and the extraction summary record, null where nothing is recorded.
    expect(result.timings.startedAt).toBeNull();
    expect(result.timings.stages.extract).toMatchObject({ records: 2, done: 2, attempts: 2 });
    expect(result.timings.extract.totals).toEqual({
      cards: 2,
      modelMinutes: 3.5,
      inputTokens: 4000,
      outputTokens: 400,
    });
    // Agent stages: what accept recorded on the issuer's verify, adjudicate and overlay records (research has none).
    expect(result.timings.agentStages).toEqual({
      modelMinutes: 2,
      tokens: 12000,
      perCard: { modelMinutes: 1, tokens: 6000 },
    });

    expect(h.logs.join('\n')).toMatch(/agreement with expansion\.v1 \(two agent-verified label sets/);
    const state = await h.state();
    expect(state.batchStages.eval).toMatchObject({ status: 'done', stageVersion: 'eval.1' });
    expect(state.batchStages.eval?.outputs?.[0].ref).toBe(`file:${EVAL_FILE}`);

    h.logs.length = 0;
    expect(await h.run('next', '--batch', BATCH, '--json')).toBe(0);
    expect(JSON.parse(h.logs.at(-1)!) as NextStep).toMatchObject({
      kind: 'handoff',
      command: `npm run pipeline -- handoff --batch ${BATCH}`,
    });
  });

  it('is deterministic: a second run writes the same eval.json', async () => {
    const h = await builtBatch();
    await h.run('eval', '--batch', BATCH);
    const first = await readFile(join(h.dir, EVAL_FILE), 'utf8');
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await h.run('run', 'eval', '--batch', BATCH);
    expect(await readFile(join(h.dir, EVAL_FILE), 'utf8')).toBe(first);
  });

  it('marks the trace re-score inputs-missing without the traces, and still records the metrics', async () => {
    const h = await builtBatch();
    await rm(join(h.dir, 'extractions', `${BETA}.json`));
    expect(await h.run('eval', '--batch', BATCH)).toBe(0);
    const result = await readEval(h);
    expect(result.traces).toEqual({ status: 'inputs-missing', missing: 1 });
    expect(result.pipeline.totals.cards).toBe(2);
    expect(h.calls.some((call) => call.includes('--traces'))).toBe(false);
    expect(h.logs.join('\n')).toMatch(/trace re-score: inputs-missing/);
    await writeFile(
      join(h.root, 'evals/curation/catalog-batches.json'),
      json({ layers: [{ kind: 'batch', id: BATCH }] }),
    );
    const report = await handoffReport(h.env, BATCH, {
      catalog: async () => {
        throw new Error('not built in this test');
      },
      reviewManifests: async () => [],
      git: async () => '',
    });
    expect(report.text).toMatch(
      /Warnings:\n- card example-bank-beta: draft recorded done; its inputs are not on this machine\n- eval: the trace re-score is inputs-missing/,
    );
    expect(report.problems).toEqual(['build: not built in this test']);
  });

  it('scores a cross-model run under CI (no model is called); without captures it is inputs-missing', async () => {
    const h = await builtBatch();
    h.env.env = { CI: 'true' };
    const run = join(h.root, 'cross-model-run');
    await mkdir(run, { recursive: true });
    await writeFile(join(run, 'observations.json'), '{}');
    expect(await h.run('eval', '--batch', BATCH, '--cross-model-run', run)).toBe(0);
    expect((await readEval(h)).crossModel).toMatchObject({
      status: 'scored',
      model: 'gpt-5.5',
      effort: 'low',
    });
    expect(h.calls.at(-1)).toContain('--run');

    await rm(join(h.dir, 'captures'), { recursive: true });
    expect(await h.run('eval', '--batch', BATCH, '--cross-model-run', run)).toBe(0);
    expect((await readEval(h)).crossModel).toEqual({ status: 'inputs-missing' });
    expect(await h.run('eval', '--batch', BATCH, '--cross-model-run', join(h.root, 'nowhere'))).toBe(2);
  });
});

describe('labelAgreement', () => {
  it('matches within a category by wording and counts rules on one side only', () => {
    const frozen = [
      item(
        'c',
        labels('points', 100, [rule('dining', 300), rule('dining', 200, { issuerWording: 'other words' })]),
      ),
    ];
    const batch = [item('c', labels('cash-back', 100, [rule('dining', 300)]))];
    const result = labelAgreement(frozen as never, batch as never);
    expect(result.cards[0]).toMatchObject({
      rules: { frozen: 2, batch: 1, matched: 1 },
      onlyFrozen: ['dining'],
      cardFields: { rewardCurrency: false, pointValueHundredthsOfCent: true },
    });
    expect(result.overall.ruleFields.rateBps).toEqual({ agree: 1, total: 1, rate: 1 });
    expect(labelAgreement(frozen as never, [] as never).cards).toEqual([]);
    // Same rules and fields, but a different issue count: not identical.
    const same = [item('d', labels('points', null, [rule('dining', 300)]))];
    const withIssue = [item('d', labels('points', null, [rule('dining', 300)], [{ code: 'ambiguous' }]))];
    expect(labelAgreement(same as never, same as never).overall.cardsIdentical).toBe(1);
    expect(labelAgreement(same as never, withIssue as never).overall.cardsIdentical).toBe(0);
  });
});

const SHA = (n: number) => String(n).repeat(64).slice(0, 64);

describe('review-app readiness', () => {
  it('reads the manifests the real review app bundles (a reformat of its imports or glob must fail here)', async () => {
    const manifests = await readReviewManifests(REPO_ROOT);
    const paths = manifests.map((manifest) => manifest.path);
    expect(paths.slice(0, 3)).toEqual([
      'evals/curation/real/manifest.json',
      'evals/curation/real/merchant-manifest.json',
      'evals/curation/expansion/manifest.json',
    ]);
    expect(paths).toContain('evals/curation/batches/wells-fargo-2026-10/manifest.json');
    // Batch manifests (sorted), then freshness records (sorted), as the review app's two globs.
    const batches = paths
      .slice(3)
      .filter((path) => /^evals\/curation\/batches\/[^/]+\/manifest\.json$/.test(path));
    const records = paths.slice(3 + batches.length);
    expect(batches).toEqual([...batches].sort());
    expect(records.every((path) => /^evals\/curation\/freshness\/\d{4}-\d{2}-\d{2}\.json$/.test(path))).toBe(
      true,
    );
    expect(records).toEqual([...records].sort());
    expect(manifests.slice(0, 3 + batches.length).every((manifest) => manifest.sources.length > 0)).toBe(
      true,
    );
    expect(REVIEW_MANIFEST_MODULE).toBe('apps/review/src/manifest.ts');
  });

  const manifests = [
    {
      path: 'evals/curation/real/manifest.json',
      sources: [
        { id: 'a', sha256: SHA(1) },
        { id: 'shared', sha256: SHA(2) },
      ],
    },
    {
      path: 'evals/curation/expansion/manifest.json',
      sources: [
        { id: 'shared', sha256: SHA(3) },
        { id: 'b', sha256: SHA(4) },
      ],
    },
  ];

  it('passes when every cited source has its hash in a bundled manifest', () => {
    expect(
      reviewAppReadiness(
        [
          { id: 'a', sha256: SHA(1), dir: null },
          { id: 'b', sha256: SHA(4), dir: null },
        ],
        manifests,
      ),
    ).toEqual({
      ok: true,
      missing: [],
      differs: [],
    });
  });

  it('accepts a source with several dated captures when the cited hash is one of them', () => {
    expect(reviewAppReadiness([{ id: 'shared', sha256: SHA(2), dir: null }], manifests).ok).toBe(true);
    expect(reviewAppReadiness([{ id: 'shared', sha256: SHA(3), dir: null }], manifests).ok).toBe(true);
  });

  it('requires the capture dated checkedOn when a manifest has one, else the newest capture', () => {
    const dated = [
      {
        path: 'evals/curation/expansion/manifest.json',
        sources: [{ id: 'p', sha256: SHA(1), capturedOn: '2026-10-02' }],
      },
      {
        path: 'evals/curation/batches/example-bank-2026-10/manifest.json',
        sources: [{ id: 'p', sha256: SHA(2), capturedOn: '2026-10-04' }],
      },
    ];
    const check = (sha256: string, checkedOn: string) =>
      reviewAppReadiness([{ id: 'p', sha256, dir: null, checkedOn }], dated);
    expect(check(SHA(2), '2026-10-04').ok).toBe(true);
    expect(check(SHA(1), '2026-10-04').differs).toEqual([{ id: 'p', expected: SHA(1), review: [SHA(2)] }]);
    expect(check(SHA(1), '2026-10-02').ok).toBe(true);
    // No capture dated checkedOn (a merchant page dated before its capture, a page re-checked unchanged): newest only.
    expect(check(SHA(2), '2026-11-01').ok).toBe(true);
    expect(check(SHA(1), '2026-11-01').differs).toEqual([{ id: 'p', expected: SHA(1), review: [SHA(2)] }]);
    expect(check(SHA(3), '2026-11-01').ok).toBe(false);
  });

  it('lists a missing hash and a hash that is none of the bundled ones', () => {
    const result = reviewAppReadiness(
      [
        { id: 'new-page', sha256: SHA(5), dir: 'evals/curation/batches/example-bank-2026-10' },
        { id: 'b', sha256: SHA(6), dir: 'evals/curation/batches/example-bank-2026-10' },
        { id: 'shared', sha256: SHA(7), dir: null },
      ],
      manifests,
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['new-page']);
    expect(result.differs).toEqual([
      { id: 'b', expected: SHA(6), review: [SHA(4)] },
      { id: 'shared', expected: SHA(7), review: [SHA(2), SHA(3)] },
    ]);
  });

  it('places captures by the manifest their hash comes from and counts the files present', async () => {
    const h = await harness();
    const text = 'fake capture words\n';
    await mkdir(join(h.root, 'evals/curation/real/merchant-captures'), { recursive: true });
    await writeFile(join(h.root, 'evals/curation/real/merchant-captures/m.txt'), text);
    const result = await captureFolders(
      h.root,
      [
        { id: 'm', sha256: null, dir: null },
        { id: 'x', sha256: SHA(7), dir: 'evals/curation/batches/example-bank-2026-10' },
        { id: 'lost', sha256: null, dir: null },
      ],
      [
        {
          path: 'evals/curation/real/merchant-manifest.json',
          sources: [{ id: 'm', sha256: sha256Hex(text) }],
        },
      ],
    );
    expect(result.unplaced).toEqual(['lost']);
    expect(
      result.folders.map(({ folder, needed, present, matching }) => ({ folder, needed, present, matching })),
    ).toEqual([
      { folder: 'evals/curation/batches/example-bank-2026-10/captures', needed: 1, present: 0, matching: 0 },
      { folder: 'evals/curation/real/merchant-captures', needed: 1, present: 1, matching: 1 },
    ]);
  });
});

describe('rule-ID summary', () => {
  it('renders kept, changed old → new, added and dropped', () => {
    const text = renderRuleIds({
      previous: { version: '2026-10-02.expansion.1', rules: 3, jsonBytes: 1234 },
      kept: ['a-base'],
      changed: [{ cardId: 'card-a', from: 'a-dining', to: 'a-dining-v2' }],
      added: ['a-travel'],
      dropped: ['a-gas'],
    });
    expect(text).toBe(
      [
        'Against `2026-10-02.expansion.1` (3 rules, 1,234 bytes):',
        '- kept 1, changed 1, added 1, dropped 1',
        '- changed `card-a`: `a-dining` → `a-dining-v2`',
        '- added: `a-travel`',
        '- dropped: `a-gas`',
      ].join('\n'),
    );
    const many = renderRuleIds({
      previous: null,
      kept: [],
      changed: [],
      added: Array.from({ length: 52 }, (_, i) => `r${i}`),
      dropped: [],
    });
    expect(many).toMatch(/No previous catalog/);
    expect(many).toMatch(/… and 2 more$/);
  });
});

describe('pipeline handoff', () => {
  const summary = (cited: CatalogSummary['cited']): CatalogSummary => ({
    version: '2026-10-05.wells-fargo.1',
    verifiedAt: '2026-10-04T00:00:00Z',
    expiresAt: '2026-11-03T00:00:00Z',
    oldestSourceDate: '2026-09-29',
    cards: 2,
    rules: 4,
    sources: cited.length,
    jsonBytes: 1000,
    budgetBytes: 786432,
    layers: [{ id: BATCH, kind: 'batch', dir: `evals/curation/batches/${BATCH}`, cards: 2, replaced: 0 }],
    replacedReal: [],
    paymentPathChanges: [],
    heldOut: [],
    dropped: [],
    continuity: { previous: null, kept: [], changed: [], added: ['x-base'], dropped: [] },
    cited,
  });
  const deps = (cited: CatalogSummary['cited'], reviewed: CatalogSummary['cited']): HandoffDeps => ({
    catalog: async () => summary(cited),
    reviewManifests: async () => [
      {
        path: 'evals/curation/expansion/manifest.json',
        sources: reviewed.map(({ id, sha256 }) => ({ id, sha256: sha256! })),
      },
    ],
    git: async (_root, args) => (args[0] === 'rev-parse' ? 'phase8-test\n' : args[0] === 'show' ? null : ''),
  });
  const cited = [
    { id: 'example-bank-alpha-product', sha256: SHA(1), dir: `evals/curation/batches/${BATCH}` },
  ];
  const config = (layers: unknown[]) =>
    json({ schemaVersion: 1, description: 'fixture', version: '2026-10-05.wells-fargo.1', layers });

  it('is not ready before eval, nor when the batch is missing from the build config', async () => {
    const h = await builtBatch();
    await mkdir(join(h.root, 'evals/curation'), { recursive: true });
    await writeFile(join(h.root, 'evals/curation/catalog-batches.json'), config([]));
    const report = await handoffReport(h.env, BATCH, deps(cited, cited));
    expect(report.problems).toEqual([
      'eval: pending',
      `build config: evals/curation/catalog-batches.json has no layer { "kind": "batch", "id": "${BATCH}" }`,
    ]);
    expect(await handoff(h.env, BATCH, deps(cited, cited))).toBe(1);
    expect(h.logs.at(-1)).toMatch(/Not ready:\n- eval: pending/);
  });

  it('is not ready with open packets or a card short of overlay', async () => {
    const h = await builtBatch();
    await mkdir(join(h.dir, 'pipeline/packets'), { recursive: true });
    await writeFile(join(h.dir, 'pipeline/packets/overlay.example-bank.1.json'), '{}');
    const state = await h.state();
    delete state.cards[BETA].stages.overlay;
    await writeFile(join(h.dir, 'pipeline/state.json'), JSON.stringify(state));
    const { problems } = await handoffReport(h.env, BATCH, deps(cited, cited));
    expect(problems).toContain(`card ${BETA}: overlay pending`);
    expect(problems).toContain('open packets: overlay.example-bank.1.json');
  });

  it('is ready after eval; prints the checklist, the capture folders and the publish statements', async () => {
    const h = await builtBatch();
    expect(await h.run('eval', '--batch', BATCH)).toBe(0);
    await writeFile(
      join(h.root, 'evals/curation/catalog-batches.json'),
      config([{ kind: 'batch', id: BATCH }]),
    );
    h.logs.length = 0;
    expect(await handoff(h.env, BATCH, deps(cited, cited))).toBe(0);
    const text = h.logs.join('\n');
    expect(text).toMatch(/Branch: `phase8-test`/);
    expect(text).toMatch(/- \[ \] `npm audit --audit-level=high`/);
    expect(text).toMatch(/independent reviewer subagent/);
    expect(text).toMatch(/None: no new file under supabase\/migrations/);
    expect(text).toMatch(/Every one of the 1 cited sources has its SHA-256 in a bundled manifest/);
    expect(text).toContain(
      `${join(h.root, `evals/curation/batches/${BATCH}/captures`)}\`: 1 cited source(s)`,
    );
    expect(text).toMatch(/Release `2026-10-05\.wells-fargo\.1`, expires 2026-11-03T00:00:00Z/);
    expect(text).toMatch(
      /The CLI has no publish, push or sign-in command\. Evan ticks the attestation and clicks Publish\. Labels are agent-verified, not human-verified\./,
    );
    expect(text).toMatch(/Ready: open the PR/);
    expect(text).not.toMatch(/Real cards refreshed/);
    // A replaced real card: its payment-path changes against release 1 are listed for Evan.
    h.logs.length = 0;
    const withReal = deps(cited, cited);
    withReal.catalog = async () => ({
      ...summary(cited),
      replacedReal: ['amex-blue-cash-everyday'],
      paymentPathChanges: [
        {
          cardId: 'amex-blue-cash-everyday',
          category: 'online-retail',
          ruleIds: ['bce-online-retail'],
          before: ['bnpl'],
          after: [],
        },
      ],
    });
    expect(await handoff(h.env, BATCH, withReal)).toBe(0);
    expect(h.logs.join('\n')).toContain(
      '  - `amex-blue-cash-everyday` online-retail (`bce-online-retail`): bnpl → none',
    );
  });

  it('after a proposed build: summarises its would-be config, says nothing ships, needs no committed layer', async () => {
    const h = await builtBatch();
    const proposed = ['--proposed', '--version', '2026-10-05.wells-fargo.1'];
    expect(await h.run('run', 'build', '--batch', BATCH, ...proposed), h.logs.join('\n')).toBe(0);
    expect(await h.run('eval', '--batch', BATCH), h.logs.join('\n')).toBe(0);
    // The committed build config does not have the batch: a proposed build never registers it.
    await writeFile(join(h.root, 'evals/curation/catalog-batches.json'), config([]));
    const paths: (string | undefined)[] = [];
    const base = deps(cited, cited);
    const report = await handoffReport(h.env, BATCH, {
      ...base,
      catalog: async (root, path) => {
        paths.push(path);
        return base.catalog(root);
      },
    });
    expect(paths).toEqual([`evals/curation/batches/${BATCH}/pipeline/proposed/catalog-batches.json`]);
    expect(report.problems).toEqual([]);
    expect(report.text).toContain(
      '**Proposed build: nothing ships.** Version `2026-10-05.wells-fargo.1` is built into',
    );
    expect(report.text).toMatch(/Ready: open the PR with the checklist above \(.*nothing ships\)\.$/);
  });

  it('blocks publishing when the review app cannot match a cited source', async () => {
    const h = await builtBatch();
    expect(await h.run('eval', '--batch', BATCH)).toBe(0);
    await writeFile(
      join(h.root, 'evals/curation/catalog-batches.json'),
      config([{ kind: 'batch', id: BATCH }]),
    );
    const { text } = await handoffReport(h.env, BATCH, deps(cited, []));
    expect(text).toMatch(/\*\*Publish blocked:\*\* 1 cited source\(s\) are in no bundled manifest/);
    expect(text).toMatch(/must be in a committed manifest the review app bundles/);
    expect(text).toMatch(/merged and Render has deployed main/);
    expect(text).toMatch(/- missing: `example-bank-alpha-product`/);
  });

  it('flags new migrations and a reused version', async () => {
    const h = await builtBatch();
    expect(await h.run('eval', '--batch', BATCH)).toBe(0);
    await writeFile(
      join(h.root, 'evals/curation/catalog-batches.json'),
      config([{ kind: 'batch', id: BATCH }]),
    );
    const ledger = (bytes: number) =>
      json({ catalogs: [{ version: '2026-10-05.wells-fargo.1', jsonBytes: bytes, ruleIds: ['x-base'] }] });
    await writeFile(join(h.root, 'evals/curation/rule-id-ledger.json'), ledger(1000));
    const base = deps(cited, cited);
    const report = await handoffReport(h.env, BATCH, {
      ...base,
      git: async (root, args) =>
        args[0] === 'diff'
          ? 'supabase/migrations/20261005000000_x.sql\n'
          : args[0] === 'show'
            ? ledger(999)
            : base.git(root, args),
    });
    expect(report.text).toMatch(/New on this branch .*`supabase\/migrations\/20261005000000_x\.sql`/);
    expect(report.problems).toEqual([
      'version: 2026-10-05.wells-fargo.1 is on origin/main with other contents; bump "version" in evals/curation/catalog-batches.json and rebuild',
    ]);
  });

  it('exits 1 with no batch and asks for --batch with several', async () => {
    const h = await harness();
    const report = await handoffReport(h.env, undefined, deps(cited, cited));
    expect(report.problems[0]).toMatch(/no pipeline batch/);
    expect(report.text).toMatch(/# Handoff: no pipeline batch/);
    expect(await h.run('handoff')).toBe(1);
  });
});
