import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRewardPrograms, loadRewardPrograms, rewardProgramAnchors } from './reward-programs.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const asOf = '2026-10-02';
const committed = await loadRewardPrograms(root);
const copy = () => structuredClone(committed);
const check = (state, options = { asOf }) => checkRewardPrograms(state.table, state.corpora, options);
const card = (state, cardId) => state.table.cards.find((entry) => entry.cardId === cardId);
const program = (state, programId) => state.table.programs.find((entry) => entry.id === programId);

test('the committed table maps every corpus card to one program', () => {
  assert.deepEqual(check(committed), []);
  const cardIds = new Set(committed.corpora.flatMap((corpus) => corpus.cases.map((item) => item.cardId)));
  assert.equal(cardIds.size, 180);
  assert.equal(committed.table.cards.length, 180);
});

test('cash back is one program at 100 and every cash-back card uses it', () => {
  const cash = committed.table.programs.filter((entry) => entry.currency === 'cash-back');
  assert.deepEqual(
    cash.map((entry) => [entry.id, entry.basis, entry.valueHundredthsOfCent]),
    [['cash-back', 'cash', 100]],
  );
});

test('issuer-stated corpus values are carried on their cards', () => {
  assert.equal(card(committed, 'boa-travel-rewards').statedValueHundredthsOfCent, 60);
  const state = copy();
  card(state, 'boa-travel-rewards').statedValueHundredthsOfCent = 100;
  assert.deepEqual(check(state), ['card boa-travel-rewards: stated value 100 differs from corpus 60']);
});

test('Double Cash maps to cash back over its frozen points label (general rule 1)', () => {
  const entry = card(committed, 'citi-double-cash');
  assert.equal(entry.programId, 'cash-back');
  assert.equal(entry.statedValueHundredthsOfCent, null);
  assert.deepEqual(
    [entry.corpusLabel.currency, entry.corpusLabel.pointValueHundredthsOfCent],
    ['points', 100],
  );
  assert.deepEqual(
    committed.table.cards.filter((entry) => entry.corpusLabel).map((entry) => entry.cardId),
    ['citi-double-cash'],
  );

  const stale = copy();
  card(stale, 'citi-double-cash').corpusLabel.pointValueHundredthsOfCent = 150;
  assert.equal(check(stale).length, 1, 'only points at 1¢ may be overridden');
  const label = copy();
  for (const item of label.corpora[1].cases)
    if (item.cardId === 'citi-double-cash') item.reference.pointValueHundredthsOfCent.value = 150;
  assert.deepEqual(check(label), [
    'card citi-double-cash: corpusLabel does not repeat the corpus label (points, 150)',
  ]);
  const points = copy();
  card(points, 'citi-double-cash').programId = 'citi-thankyou';
  assert.deepEqual(check(points), [
    'card citi-double-cash: a corpusLabel override maps to cash-back with no stated value',
  ]);
  const without = copy();
  delete card(without, 'citi-double-cash').corpusLabel;
  assert.deepEqual(check(without), [
    'card citi-double-cash: stated value null differs from corpus 100',
    'card citi-double-cash: corpus currency points but program cash-back is cash-back',
  ]);
});

test('a missing, duplicated or unknown card fails', () => {
  const state = copy();
  const [first] = state.table.cards.splice(0, 1);
  state.table.cards.push({ ...state.table.cards[0] }, { ...first, cardId: 'acme-unknown' });
  const problems = check(state);
  assert.ok(problems.includes(`card ${first.cardId}: no program`));
  assert.ok(problems.includes(`card ${state.table.cards[0].cardId}: mapped more than once`));
  assert.ok(problems.includes('card acme-unknown: not in any corpus'));
});

test('a card whose currency differs from its program fails', () => {
  const state = copy();
  card(state, 'amex-gold').programId = 'cash-back';
  assert.ok(
    check(state).includes('card amex-gold: corpus currency points but program cash-back is cash-back'),
  );
});

test('an anchor must come from one of the card’s sources and be at most 25 words', () => {
  const state = copy();
  card(state, 'amex-gold').anchor.sourceId = 'chase-sapphire-preferred-product';
  assert.deepEqual(check(state), [
    "card amex-gold: anchor source chase-sapphire-preferred-product is not one of the card's sources",
  ]);
  const long = copy();
  card(long, 'amex-gold').anchor.quote = Array(26).fill('word').join(' ');
  assert.equal(check(long).length, 1);
  assert.match(check(long)[0], /at most 25 words/);
});

test('a published estimate needs the primary publisher, an https URL and a date within 30 days', () => {
  assert.deepEqual(check(committed, { asOf: '2026-11-01' }), []);
  const stale = check(committed, { asOf: '2026-11-02' });
  assert.ok(stale.length > 0);
  assert.ok(stale.every((problem) => /not within 30 days before 2026-11-02/.test(problem)));
  assert.ok(check(committed, { asOf: '2026-10-01' }).length > 0, 'read after the as-of date');

  const other = copy();
  program(other, 'delta-skymiles').estimate.publisher = 'Another Publisher';
  assert.deepEqual(check(other), [
    'program delta-skymiles: estimate from Another Publisher, not the primary publisher',
  ]);
  const noUrl = copy();
  delete program(noUrl, 'delta-skymiles').estimate.url;
  assert.equal(check(noUrl).length, 1);
});

test('a program with no estimate has no value, never an assumed 1 cent', () => {
  const state = copy();
  const unvalued = state.table.programs.find((entry) => entry.basis === 'none');
  assert.equal(unvalued.valueHundredthsOfCent, null);
  unvalued.valueHundredthsOfCent = 100;
  assert.equal(check(state).length, 1);
});

test('an issuer-stated program value needs its quote', () => {
  const state = copy();
  delete program(state, 'gap-encore-points').issuerStated;
  assert.equal(check(state).length, 1);
});

test('every program is used by a card', () => {
  const state = copy();
  state.table.programs.push({ ...program(state, 'edward-jones-loyalty-points'), id: 'acme-points' });
  assert.deepEqual(check(state), ['program acme-points: no card uses it']);
});

test('anchors to check against the captures cover every card and issuer-stated value', () => {
  const anchors = rewardProgramAnchors(committed.table);
  const stated = committed.table.programs.filter((entry) => entry.basis === 'issuer-stated').length;
  assert.equal(anchors.length, 180 + stated);
});
