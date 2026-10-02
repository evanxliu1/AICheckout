import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadPipelineInputs, pipelineMetrics } from './expansion-metrics.mjs';

const rule = (category, rateBps) => ({
  category,
  issuerWording: `${category} wording`,
  rateBps,
  paidOnPaymentBps: 0,
  cap: null,
  activation: null,
  usMerchantsOnly: null,
  limitedTime: null,
  anchors: ['q'],
});
const reference = (rules, currency = 'points') => ({
  rewardCurrency: { value: currency, anchors: ['q'] },
  pointValueHundredthsOfCent: { value: null, anchors: [] },
  rules,
  exclusions: [],
  issues: [{ code: 'ambiguous', anchors: ['q'] }],
});
const accepted = { decision: 'accepted', reason: 'ok' };
const entry = (cardId, verdict, extra = {}) => ({
  cardId,
  verdict,
  fixes: [],
  addedRules: [],
  addedExclusions: [],
  addedIssues: [],
  productNoteChanges: [],
  ...extra,
});

function inputs() {
  const cards = [
    { id: 'a', issuer: 'Bank X' },
    { id: 'b', issuer: 'Bank X' },
    { id: 'c', issuer: 'Bank Y' },
    { id: 'd', issuer: 'Bank Y' },
  ];
  const draft = {
    version: 'draft.1',
    cases: [
      {
        cardId: 'a',
        reference: reference([rule('dining', 300), rule('gas', 200), rule('all-purchases', 100)]),
      },
      { cardId: 'c', reference: reference([rule('all-purchases', 100)]) },
      { cardId: 'd', reference: reference([rule('all-purchases', 150)], 'cash-back') },
    ],
  };
  const corpus = {
    version: 'expansion.test',
    annotationStatus: 'agent-verified',
    cases: [
      // a: dining rate fixed 300 → 400, gas removed, travel added, the issue removed.
      {
        cardId: 'a',
        reference: {
          ...reference([rule('dining', 400), rule('all-purchases', 100), rule('travel', 200)]),
          issues: [],
        },
      },
      { cardId: 'b', reference: reference([rule('all-purchases', 100)]) },
      { cardId: 'd', reference: reference([rule('all-purchases', 150)], 'cash-back') },
    ],
  };
  const files = [
    {
      name: 'x.json',
      data: {
        cards: [
          entry('a', 'fixed', {
            fixes: [
              {
                op: 'set',
                path: 'reference.rules.0.rateBps',
                current: 300,
                corrected: 400,
                adjudication: accepted,
              },
              {
                op: 'set',
                path: 'reference.rules.2.rateBps',
                current: 100,
                corrected: 999,
                adjudication: { decision: 'rejected', reason: 'no' },
              },
              { op: 'remove', path: 'reference.rules.1', current: {}, adjudication: accepted },
              { op: 'remove', path: 'reference.issues.0', current: {}, adjudication: accepted },
            ],
            addedRules: [{ rule: rule('travel', 200), anchors: [], adjudication: accepted }],
          }),
          entry('b', 'fixed', {
            addedRules: [{ rule: rule('all-purchases', 100), anchors: [], adjudication: accepted }],
          }),
        ],
      },
    },
    {
      name: 'y.json',
      data: {
        cards: [
          entry('c', 'drop-card', { reason: 'no earn rate', verdictAdjudication: accepted }),
          entry('d', 'confirmed'),
        ],
      },
    },
  ];
  return { cards, draft, corpus, files };
}

test('counts corrections, removals, additions, confirmed, dropped and undrafted cards', () => {
  const m = pipelineMetrics(inputs());
  assert.deepEqual(
    {
      cards: m.totals.cards,
      inCorpus: m.totals.inCorpus,
      drafted: m.totals.drafted,
      undrafted: m.totals.undrafted,
      confirmed: m.totals.confirmed,
      fixed: m.totals.fixed,
      dropped: m.totals.dropped,
      draftRules: m.totals.draftRules,
      rulesRemoved: m.totals.rulesRemoved,
      rulesAdded: m.totals.rulesAdded,
      verifiedRules: m.totals.verifiedRules,
      draftRulesUnchanged: m.totals.draftRulesUnchanged,
    },
    {
      cards: 4,
      inCorpus: 3,
      drafted: 2,
      undrafted: 1,
      confirmed: 1,
      fixed: 2,
      dropped: 1,
      draftRules: 4, // a: 3, d: 1 (c was dropped)
      rulesRemoved: 1,
      rulesAdded: 2, // one on a, one on undrafted b
      verifiedRules: 5,
      draftRulesUnchanged: 2, // a's base rule and d's
    },
  );
  assert.deepEqual(m.ruleFields.rateBps, { count: 1, total: 3, rate: 0.3333 });
  assert.equal(m.ruleFields.category.count, 0);
  assert.equal(m.totals.ruleFieldsChanged, 1);
  assert.equal(m.totals.ruleFieldValues, 3 * 8);
  assert.equal(m.undraftedRulesAdded, 1);
  assert.deepEqual(m.items, { exclusionsRemoved: 0, exclusionsAdded: 0, issuesRemoved: 1, issuesAdded: 0 });
  assert.deepEqual(m.findings, { accepted: 5, modified: 0, rejected: 1 });
  assert.deepEqual(m.cards.confirmed, ['d']);
  assert.deepEqual(m.cards.valuesUnchanged, ['d']);
  assert.deepEqual(m.cards.dropped, [{ cardId: 'c', issuer: 'Bank Y', drafted: true }]);
  assert.deepEqual(m.cards.undrafted, [{ cardId: 'b', issuer: 'Bank X', rules: 1 }]);
  assert.equal(m.byIssuer['Bank X'].rulesAdded, 2);
  assert.equal(m.byIssuer['Bank Y'].dropped, 1);
});

test('fails when a verified value changed without an applied fix', () => {
  const state = inputs();
  state.corpus.cases[2].reference.rules[0].rateBps = 200;
  assert.throws(() => pipelineMetrics(state), /d: rules\.0\.rateBps changed with no applied fix/);
  const counts = inputs();
  counts.corpus.cases[0].reference.rules.pop();
  assert.throws(() => pipelineMetrics(counts), /a: 3 draft − 1 removed \+ 1 added ≠ 2 verified rules/);
});

test('docs/evals/expansion.json carries the pipeline metrics of the committed files', async () => {
  const dir = fileURLToPath(new URL('../../evals/curation/expansion/', import.meta.url));
  const results = JSON.parse(
    await readFile(new URL('../../docs/evals/expansion.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(results.pipeline, pipelineMetrics(await loadPipelineInputs(dir)));
});
