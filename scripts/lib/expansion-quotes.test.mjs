import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANY_AMOUNT,
  ANY_RATE,
  amountRegex,
  bestWindow,
  captureIndex,
  clipWords,
  keywordPatterns,
  longCaptureRun,
  markdownUnits,
  rateRegex,
  rateRegexFromText,
  shortAnchor,
  stringsOf,
  wordCount,
} from './expansion-quotes.mjs';

// Synthetic issuer-style text (not a real capture).
const SENTENCE =
  'Earn 4X Example Rewards points per dollar spent at restaurants worldwide, on up to $50,000 in purchases per calendar year, then 1X points for the rest of the year.';
const body = `Intro line.\n${SENTENCE}\nPlus, earn a total of 7, for each dollar at Example Hotels.\n`;
const input = { documents: [{ id: 'doc', body }] };

test('rate and amount patterns match the forms captures use, and not neighbouring numbers', () => {
  assert.ok(rateRegex(400).test('Earn 4X points'));
  assert.ok(rateRegex(400).test('4% cash back'));
  assert.ok(rateRegex(700).test('for a total of 7, for each dollar'));
  assert.ok(rateRegex(500).test('Five rewards points per $1'));
  assert.ok(rateRegex(150).test('unlimited 1.5% cash back'));
  assert.ok(!rateRegex(100).test('unlimited 1.5% cash back'));
  assert.ok(!rateRegex(500).test('up to $500 a year'));
  assert.ok(!rateRegex(500).test('up to 5,000 points'));
  assert.ok(amountRegex(5_000_000).test('on up to $50,000 in purchases'));
  assert.ok(amountRegex(150_000).test('on up to $1,500 in purchases.1'));
  assert.ok(amountRegex(600_000).test('the first $6K spent'));
  assert.ok(!amountRegex(500_000).test('on up to $50,000 in purchases'));
  assert.ok(ANY_AMOUNT.test('up to $50,000'));
  assert.ok(!ANY_AMOUNT.test('for every $1 spent'));
  assert.ok(ANY_RATE.test('earn 3% back'));
  assert.equal(rateRegexFromText('5% cash back at partners').source, rateRegex(500).source);
  assert.equal(rateRegexFromText('no rate here'), null);
});

test('bestWindow keeps the required token within 25 words and prefers keyword hits', () => {
  const window = bestWindow(SENTENCE, {
    required: [amountRegex(5_000_000)],
    prefer: keywordPatterns('restaurants calendar'),
  });
  assert.ok(wordCount(window) <= 25);
  assert.match(window, /\$50,000/);
  assert.match(window, /restaurants/);
  assert.equal(bestWindow(SENTENCE, { required: [/nowhere/] }), null);
  assert.equal(bestWindow('short quote', {}), 'short quote');
});

test('shortAnchor keeps short quotes, shortens long ones around the evidence, and resolves in the capture', () => {
  assert.deepEqual(shortAnchor('a total of 7, for each dollar', input), {
    status: 'kept',
    text: 'a total of 7, for each dollar',
  });
  const short = shortAnchor(SENTENCE, input, { required: [rateRegex(400)] });
  assert.equal(short.status, 'shortened');
  assert.ok(wordCount(short.text) <= 25 && short.text.startsWith('Earn 4X'));
  assert.ok(body.includes(short.text));
});

test('shortAnchor flags a stated amount that differs from the draft, and drops a quote without evidence', () => {
  const capSpec = { required: [amountRegex(500_000)], fallback: { required: [ANY_AMOUNT] } };
  const mismatch = shortAnchor(SENTENCE, input, capSpec);
  assert.equal(mismatch.status, 'mismatch');
  assert.match(mismatch.text, /\$50,000/);
  assert.deepEqual(shortAnchor(SENTENCE, input, { required: [rateRegex(900)] }), { status: 'dropped' });
  assert.deepEqual(shortAnchor('not in the capture at all', input), { status: 'unresolved' });
});

test('clipWords cuts free text to 25 words', () => {
  const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
  assert.equal(wordCount(clipWords(long)), 25);
  assert.ok(clipWords(long).endsWith('…'));
  assert.equal(clipWords('  two words '), 'two words');
  assert.equal(clipWords(null), null);
});

test('longCaptureRun finds runs over 25 words regardless of case, spacing and quote marks', () => {
  const index = captureIndex([body.replace('year.', 'year’s end.')]);
  assert.equal(longCaptureRun(clipWords(SENTENCE), index), null);
  const copied = `Notes: ${SENTENCE.toUpperCase().replace(/ /g, '  ')}`;
  assert.ok(longCaptureRun(copied, index));
  assert.equal(longCaptureRun('Earn 4X Example Rewards points', index), null);
  const curly = `${Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')} don’t stop`;
  assert.ok(longCaptureRun(curly.replace('’', "'").replace('w0 ', ''), captureIndex([curly])));
});

test('stringsOf and markdownUnits enumerate the units to check', () => {
  assert.deepEqual(
    [...stringsOf({ a: ['x', { b: 'y' }], n: 1 })],
    [
      ['$.a[0]', 'x'],
      ['$.a[1].b', 'y'],
    ],
  );
  assert.deepEqual(
    markdownUnits('# T\n| a | b |').map(([, unit]) => unit.trim()),
    ['# T', '', 'a', 'b', ''],
  );
});
