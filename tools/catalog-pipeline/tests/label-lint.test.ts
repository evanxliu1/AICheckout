// The label-evidence lint on synthetic rules and anchors (no issuer text).
import { describe, expect, it } from 'vitest';
import { dateRegex, lintCorpusCase, lintOverlay, multiplesIn } from '../src/label-lint.ts';
import type { CorpusCaseLike } from '../src/label-lint.ts';

const rule = (fields: Record<string, unknown>, anchors: string[]) => ({
  rateBps: 100,
  cap: null,
  limitedTime: null,
  issuerWording: 'fake wording',
  ...fields,
  anchors,
});
const card = (currency: string, rules: ReturnType<typeof rule>[]): CorpusCaseLike => ({
  cardId: 'example-bank-alpha',
  reference: { rewardCurrency: { value: currency }, rules },
});
const checks = (item: CorpusCaseLike) =>
  lintCorpusCase(item).map((finding) => `${finding.check} ${finding.path}`);

describe('a) cap amounts, digit-exact', () => {
  const capped = (cents: number, anchor: string) =>
    card('cash-back', [
      rule({ rateBps: 300, cap: { kind: 'spend', amountCents: cents } }, [`fake 3% on up to ${anchor}`]),
    ]);
  it('accepts $5,000, $5000, $5,000.00 and $5k for 500000', () => {
    for (const text of ['$5,000 a year', '$5000 a year', '$5,000.00 a year', '$5k a year', '$5K a year'])
      expect(checks(capped(500_000, text))).toEqual([]);
  });
  it('rejects $50,000 for $5,000 and $5,000 for $50,000', () => {
    expect(checks(capped(500_000, '$50,000 a year'))).toEqual(['cap-amount rules.0.cap.amountCents']);
    expect(checks(capped(5_000_000, '$5,000 a year'))).toEqual(['cap-amount rules.0.cap.amountCents']);
  });
});

describe('b) rates', () => {
  it('a percent, or the sum of the percents stated', () => {
    expect(checks(card('cash-back', [rule({ rateBps: 150 }, ['fake 1.5% back'])]))).toEqual([]);
    expect(checks(card('cash-back', [rule({ rateBps: 300 }, ['fake 1% base', 'fake 2% bonus'])]))).toEqual(
      [],
    );
    expect(checks(card('cash-back', [rule({ rateBps: 300 }, ['fake 2% back'])]))).toEqual([
      'rate rules.0.rateBps',
    ]);
  });
  it('for points: 4X, 1.5x, N points per $1, miles per dollar, number words and totals', () => {
    for (const [rate, text] of [
      [400, 'fake 4X points'],
      [150, 'fake 1.5x miles'],
      [400, 'earn 4 points per $1 spent'],
      [300, 'earn 3 miles per dollar'],
      [300, 'earn three points for every $1.00'],
      [200, 'earn 2 Points (1 base and 1 bonus Point) for every $1'],
      [500, '4 additional points (for a total of 5 points) for each dollar'],
    ] as const)
      expect(checks(card('points', [rule({ rateBps: rate }, [text])])), text).toEqual([]);
  });
  it('rejects 400 points for 4X, and a multiple on a cash-back card', () => {
    expect(checks(card('points', [rule({ rateBps: 400 }, ['fake 400 points bonus'])]))).toEqual([
      'rate rules.0.rateBps',
    ]);
    expect(checks(card('cash-back', [rule({ rateBps: 400 }, ['fake 4X'])]))).toEqual([
      'rate rules.0.rateBps',
    ]);
    expect(multiplesIn('fake 400 points')).toEqual([]);
  });
});

describe('c) end dates', () => {
  it('accepts the common written forms of the date', () => {
    for (const text of [
      'through 12/31/2026',
      'through 12/31/26',
      'until December 31, 2026',
      'until Dec. 31, 2026',
      'ends 2026-12-31',
      'until 31 December 2026',
    ])
      expect(dateRegex('2026-12-31').test(text), text).toBe(true);
    const ok = card('cash-back', [
      rule({ rateBps: 500, limitedTime: { endsOn: '2026-12-31' } }, ['fake 5% through 12/31/2026']),
    ]);
    expect(checks(ok)).toEqual([]);
  });
  it('rejects another date or a missing year', () => {
    expect(dateRegex('2026-12-31').test('through 12/31/2027')).toBe(false);
    expect(dateRegex('2026-12-31').test('through 12/31')).toBe(false);
    expect(dateRegex('2026-01-05').test('until 01/15/2026')).toBe(false);
    const bad = card('cash-back', [
      rule({ rateBps: 500, limitedTime: { endsOn: '2026-12-31' } }, ['fake 5% this quarter']),
    ]);
    expect(checks(bad)).toEqual(['end-date rules.0.limitedTime.endsOn']);
  });
});

describe('d) and e) on the overlay', () => {
  const item = card('cash-back', [
    rule({ rateBps: 500, limitedTime: { endsOn: null } }, ['fake 5% first year']),
  ]);
  const cases = new Map([[item.cardId, item]]);
  const entry = (requires: unknown[]) => ({
    cardId: item.cardId,
    heldOut: null,
    rules: [
      { index: 0, disposition: 'modelled', set: { limitedTime: { startsOn: null, endsOn: null }, requires } },
    ],
  });
  it('a dateless limited-time rule needs a gate', () => {
    expect(lintOverlay(cases, { cards: [entry([])] }).map((f) => f.check)).toEqual(['dateless-limited-time']);
    expect(lintOverlay(cases, { cards: [entry([{ gateId: 'g', optionIds: ['a'] }])] })).toEqual([]);
  });
  it('a store-credit program is in cents and its programDetails agree', () => {
    const program = { id: 'store', unitName: 'cents', redemptionBrandIds: ['b'] };
    expect(
      lintOverlay(cases, {
        cards: [],
        programs: [program],
        programDetails: [{ programId: 'store', unitName: 'cents', redemptionBrandIds: ['b'] }],
      }),
    ).toEqual([]);
    expect(
      lintOverlay(cases, {
        cards: [],
        programs: [{ ...program, unitName: 'Store Points' }],
        programDetails: [{ programId: 'store', unitName: 'cents', redemptionBrandIds: ['b'] }],
      }).map((f) => f.path),
    ).toEqual(['programs.store.unitName', 'programDetails.store']);
    expect(lintOverlay(cases, { cards: [], programs: [program] }).map((f) => f.path)).toEqual([
      'programDetails.store',
    ]);
  });
});
