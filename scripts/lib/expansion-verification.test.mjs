import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyVerification,
  buildCorpus,
  loadExpansion,
  verificationFileSchema,
  verificationReport,
} from './expansion-verification.mjs';

const fixture = fileURLToPath(new URL('../fixtures/expansion-verification/', import.meta.url));
const load = async (edit = () => {}) => {
  const state = await loadExpansion(fixture);
  edit(state.files[0].data);
  return state;
};
const card = (data, cardId) => data.cards.find((entry) => entry.cardId === cardId);

test('the fixture applies: accepted fixes and additions land, rejected ones do not', async () => {
  const state = await load();
  const result = applyVerification(state);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.fromEntries(result.statuses), {
    'acme-cash': 'fixed',
    'acme-miles': 'confirmed',
    'acme-store': 'dropped',
    'acme-plain': 'no-entry',
  });
  assert.deepEqual(
    result.cases.map((item) => item.cardId),
    ['acme-cash', 'acme-miles'],
  );
  const cash = result.cases[0].reference;
  assert.equal(cash.rules[0].cap.amountCents, 600000);
  assert.ok(cash.rules[0].anchors.includes('on up to $6,000 in purchases per calendar year, then 1%.'));
  assert.equal(cash.rules[1].rateBps, 100);
  assert.equal(cash.rules[2].category, 'gas');
  assert.equal(cash.exclusions[0].text, 'Balance transfers and cash advances');

  const notes = Object.fromEntries(result.productNotes.map((entry) => [entry.cardId, entry.hints]));
  assert.deepEqual(notes['acme-cash'], []);
  assert.equal(notes['acme-miles'][0].verification, 'confirmed');
  assert.equal(notes['acme-miles'][0].anchorMethod, 'verifier');

  const corpus = buildCorpus(result.cases, result.files);
  assert.equal(corpus.annotationStatus, 'agent-verified');
  assert.equal(corpus.version, 'expansion.v1');
  const report = verificationReport({
    cards: state.cards,
    statuses: result.statuses,
    entries: result.entries,
  });
  assert.match(report, /\| Acme Bank \| 4 \| 1 \| 1 \| 1 \| 0 \| 0 \| 1 \|/);
  assert.match(report, /\| `rules\.\*\.cap\.amountCents` \| 1 \| 0 \| 0 \| 0 \|/);
  assert.match(report, /\| `rules\.\*\.rateBps` \| 0 \| 0 \| 1 \| 0 \|/);
});

test('a card is not verified without an adjudicator or with an undecided finding', async () => {
  let result = applyVerification(await load((data) => (data.adjudicator = null)));
  assert.deepEqual(result.errors, []);
  assert.equal(result.cases.length, 0);
  assert.equal(result.statuses.get('acme-miles'), 'awaiting-adjudication');

  result = applyVerification(await load((data) => delete card(data, 'acme-cash').fixes[0].adjudication));
  assert.equal(result.statuses.get('acme-cash'), 'awaiting-adjudication');
  assert.deepEqual(
    result.cases.map((item) => item.cardId),
    ['acme-miles'],
  );
});

test('a modified adjudication applies the adjudicator value', async () => {
  const result = applyVerification(
    await load((data) => {
      card(data, 'acme-cash').fixes[0].adjudication = {
        decision: 'modified',
        reason: 'Amount right, period checked.',
        corrected: 600000,
        anchor: { sourceId: 'acme-cash-terms', quote: 'up to $6,000 in purchases' },
      };
    }),
  );
  assert.deepEqual(result.errors, []);
  assert.ok(result.cases[0].reference.rules[0].anchors.includes('up to $6,000 in purchases'));
});

test('quotes must be verbatim in the named capture, from the card, and at most 25 words', async () => {
  const long = Array.from({ length: 26 }, () => 'word').join(' ');
  let result = applyVerification(
    await load((data) => (card(data, 'acme-cash').fixes[0].anchor.quote = 'up to $600 in purchases')),
  );
  assert.ok(result.errors.some((error) => /quote not found in acme-cash-terms/.test(error)));
  result = applyVerification(
    await load((data) => (card(data, 'acme-cash').fixes[0].anchor.sourceId = 'acme-miles-terms')),
  );
  assert.ok(result.errors.some((error) => /not a source of this card/.test(error)));
  result = applyVerification(await load((data) => (card(data, 'acme-cash').fixes[0].anchor.quote = long)));
  assert.ok(result.errors.some((error) => /at most 25 words/.test(error)));
});

test('a stale current value, a missing path, or an unknown card is an error', async () => {
  let result = applyVerification(await load((data) => (card(data, 'acme-cash').fixes[0].current = 50000)));
  assert.ok(result.errors.some((error) => /not the stated current value/.test(error)));
  result = applyVerification(
    await load((data) => (card(data, 'acme-cash').fixes[0].path = 'reference.rules.9.cap.amountCents')),
  );
  assert.ok(result.errors.some((error) => /does not exist in the draft/.test(error)));
  result = applyVerification(await load((data) => (card(data, 'acme-miles').cardId = 'acme-unknown')));
  assert.ok(result.errors.some((error) => /not in cards.json/.test(error)));
});

test('the schema enforces verdict rules', () => {
  const base = {
    schemaVersion: 1,
    issuer: 'Acme Bank',
    verifier: { agent: 'a', model: 'm', date: '2026-10-02', filesRead: ['x'] },
    adjudicator: null,
  };
  const parse = (entry) => verificationFileSchema.safeParse({ ...base, cards: [entry] }).success;
  assert.equal(parse({ cardId: 'acme-miles', verdict: 'confirmed' }), true);
  assert.equal(parse({ cardId: 'acme-store', verdict: 'drop-card' }), false);
  assert.equal(parse({ cardId: 'acme-cash', verdict: 'fixed' }), false);
  assert.equal(
    parse({
      cardId: 'acme-cash',
      verdict: 'confirmed',
      fixes: [{ path: 'reference.rules.0.rateBps', current: 1, corrected: 2, note: 'n' }],
    }),
    false,
  );
});

test('an undrafted card can be verified from its captures alone', async () => {
  const anchor = { sourceId: 'acme-plain-terms', quote: 'Earn 1.5% cash back on every purchase.' };
  const adjudication = { decision: 'accepted', reason: 'Stated.' };
  const result = applyVerification(
    await load((data) =>
      data.cards.push({
        cardId: 'acme-plain',
        verdict: 'fixed',
        fixes: [
          {
            path: 'reference.rewardCurrency.value',
            current: null,
            corrected: 'cash-back',
            anchor,
            note: 'Cash back.',
            adjudication,
          },
        ],
        addedRules: [
          {
            rule: {
              category: 'all-purchases',
              issuerWording: 'every purchase',
              rateBps: 150,
              paidOnPaymentBps: 0,
              cap: null,
              activation: null,
              usMerchantsOnly: null,
              limitedTime: null,
            },
            anchors: [anchor],
            note: 'Base rate.',
            adjudication,
          },
        ],
      }),
    ),
  );
  assert.deepEqual(result.errors, []);
  const plain = result.cases.find((item) => item.cardId === 'acme-plain');
  assert.equal(plain.reference.rules[0].rateBps, 150);
  assert.deepEqual(plain.reference.rewardCurrency.anchors, [anchor.quote]);
});
