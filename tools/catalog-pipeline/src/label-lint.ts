// The label-evidence lint (wiki/system/card-expansion-pipeline.md, "Label-evidence lint"): a deterministic check that
// the numbers of each rule are stated in that rule's own evidence. Run at apply (corpus rules: checks a–c) and at
// overlay accept (the catalog rules, corpus rule plus overlay patch, and added rules: checks a–e). Findings name a
// card, a path and a check code; they never carry quote text.
//
// Evidence of a rule: its anchors and its issuer wording (verbatim issuer text either way), plus the anchors of the
// overlay patch that sets fields on it.
//   a) cap-amount   every spend cap's `amountCents` is a dollar figure in the evidence, digit-exact: `$5,000`, `$5000`,
//                   `$5,000.00` or `$5k`/`$5K` for 500000 (`amountRegex`, as the drafting uses); `$50,000` never
//                   matches 500000; "5,000 dollars" or "$5 thousand" are not recognised.
//   b) rate         `rateBps` is a percent stated in the evidence ("1.5%", "3 percent"; `percentsIn` of the v2
//                   validator), or the sum of the percents stated (base + bonus, as the v2 validator allows); for a
//                   points card also a multiple × 100: "4X", "1.5x", "4 points per $1", "3 miles per dollar", "1
//                   BreezePoint for every $1", "three points for every $1.00" (digits or a number word up to twelve,
//                   up to six words, then per / for every / for each / on every / on each / with each $1 or dollar,
//                   also with parentheticals removed: "2 Points (1 base and 1 bonus Point) for every $1"), "total of
//                   7", or their sum. A bare "400 points" is not a multiple, and nor is a multiple on a cash-back card.
//   c) end-date     every `limitedTime.endsOn` is written in the evidence: 2026-12-31, 12/31/2026, 12/31/26,
//                   December 31, 2026, Dec. 31, 2026, Dec 31 2026, December 31st, 2026, 31 December 2026.
//   d) dateless-limited-time   a limited-time rule with neither date needs an overlay gate (`requires` non-empty).
//   e) store-program           a store-credit program's `unitName` is `cents`, and its `programDetails` entry exists
//                   with the same unit name and redemption brands.
import { percentsIn } from '../../../apps/api/src/curation/v2/validate.ts';
import { amountRegex } from '../../../scripts/lib/expansion-quotes.mjs';

export const LINT_CHECKS = [
  'cap-amount',
  'rate',
  'end-date',
  'dateless-limited-time',
  'store-program',
] as const;
export type LintCheck = (typeof LINT_CHECKS)[number];
export interface LintFinding {
  cardId: string | null;
  path: string;
  check: LintCheck;
}

interface Cap {
  kind?: string;
  amountCents?: number | null;
}
interface LimitedTime {
  startsOn?: string | null;
  endsOn?: string | null;
}
interface RuleFields {
  rateBps?: number | null;
  cap?: Cap | null;
  limitedTime?: LimitedTime | null;
  requires?: unknown[];
  issuerWording?: string;
}
interface CorpusRule extends RuleFields {
  anchors: string[];
}
interface Anchor {
  sourceId: string;
  quote: string;
}
export interface CorpusCaseLike {
  cardId: string;
  reference: { rewardCurrency?: { value: string | null }; rules: CorpusRule[] };
}
interface Patch {
  index: number;
  disposition: string;
  set?: RuleFields;
  anchors?: Anchor[];
}
interface AddedRule extends RuleFields {
  key: string;
  anchors: Anchor[];
}
export interface OverlayEntryLike {
  cardId: string;
  heldOut: string | null;
  rules?: Patch[];
  addedRules?: AddedRule[];
}
interface StoreProgram {
  id: string;
  unitName: string;
  redemptionBrandIds: string[];
}
export interface OverlayLike {
  programs?: StoreProgram[];
  programDetails?: { programId: string; unitName: string; redemptionBrandIds: string[] }[];
  cards: OverlayEntryLike[];
}

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
/** A multiple as digits ("1.5") or a number word ("three"). */
const NUMBER = String.raw`(\d{1,2}(?:\.\d{1,2})?|\b(?:${WORDS.join('|')})\b)`;
const MULTIPLE_X = new RegExp(String.raw`(?<![\d.,$])${NUMBER}\s?[x×](?![a-z])`, 'gi');
/** "4 points per $1", "1 BreezePoint for every $1", "three points for every $1.00", "1 rewards point will be earned per
 * $1": a number, up to six words, then per / for every / for each / on every / on each / with each $1 or dollar. */
const MULTIPLE_PER = new RegExp(
  String.raw`(?<![\d.,$])${NUMBER}(?:\s+(?!per\b|for\b|on\b|with\b)[^\s\d$%]+){0,6}?[\s,)]+(?:per|for every|for each|on every|on each|with each)\s+(?:\$1(?:\.00)?(?![\d,.]\d)|(?:one\s+)?dollars?\b)`,
  'gi',
);
/** "for a total of 5 points", "for a total of 7, for each dollar", "for a total of two (2) Points". */
const MULTIPLE_TOTAL = new RegExp(String.raw`\btotal of ${NUMBER}(?![\d,.]?\d)(?!\s*(?:%|percent))`, 'gi');
/** Parentheticals are read both ways: "2 Points (1 base and 1 bonus Point) for every $1" states 2 per $1. */
const withoutParentheticals = (text: string) => text.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ');

const numberOf = (token: string): number => {
  const word = WORDS.indexOf(token.toLowerCase());
  return word >= 0 ? word : Number(token);
};

/** Per-dollar multiples written in a quote, × 100 ("4X" -> 400, "1.5 miles per dollar" -> 150). */
export function multiplesIn(text: string): number[] {
  const out: number[] = [];
  const scan = (body: string, patterns: RegExp[]) => {
    for (const pattern of patterns)
      for (const match of body.matchAll(pattern)) out.push(Math.round(numberOf(match[1]) * 100));
  };
  scan(text, [MULTIPLE_X, MULTIPLE_PER, MULTIPLE_TOTAL]);
  const plain = withoutParentheticals(text);
  if (plain !== text) scan(plain, [MULTIPLE_PER]);
  return out;
}

const statesRate = (rate: number, evidence: string[], points: boolean): boolean => {
  const percents = evidence.flatMap(percentsIn);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  if (percents.includes(rate) || (percents.length > 1 && sum(percents) === rate)) return true;
  if (!points) return false;
  const multiples = evidence.flatMap(multiplesIn);
  return multiples.includes(rate) || (multiples.length > 1 && sum(multiples) === rate);
};

const statesAmount = (cents: number, evidence: string[]): boolean => {
  const pattern = amountRegex(cents) as RegExp;
  return evidence.some((text) => pattern.test(text));
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A pattern matching the common written forms of an ISO date. */
export function dateRegex(iso: string): RegExp {
  const [year, month, day] = iso.split('-').map(Number);
  const name = MONTHS[month - 1];
  const short = name.slice(0, 3) + (name === 'September' ? '(?:t)?' : '');
  const monthName = `(?:${name}|${short}\\.?)`;
  const dayWord = `0?${day}(?:st|nd|rd|th)?`;
  const yy = String(year).slice(2);
  const forms = [
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    `0?${month}/0?${day}/(?:${year}|${yy})`,
    `${monthName}\\s+${dayWord},?\\s+${year}`,
    `${dayWord}\\s+${monthName},?\\s+${year}`,
  ];
  return new RegExp(`(?<![\\d/-])(?:${forms.join('|')})(?![\\d/])`, 'i');
}

const statesDate = (iso: string, evidence: string[]): boolean => {
  const pattern = dateRegex(iso);
  return evidence.some((text) => pattern.test(text));
};

function lintRule(
  cardId: string,
  path: string,
  rule: RuleFields,
  evidence: string[],
  points: boolean,
  withGates: boolean,
): LintFinding[] {
  const out: LintFinding[] = [];
  const add = (field: string, check: LintCheck) => out.push({ cardId, path: `${path}.${field}`, check });
  if (rule.cap?.kind === 'spend' && typeof rule.cap.amountCents === 'number')
    if (!statesAmount(rule.cap.amountCents, evidence)) add('cap.amountCents', 'cap-amount');
  if (typeof rule.rateBps === 'number' && !statesRate(rule.rateBps, evidence, points)) add('rateBps', 'rate');
  const limited = rule.limitedTime;
  if (limited) {
    if (limited.endsOn && !statesDate(limited.endsOn, evidence)) add('limitedTime.endsOn', 'end-date');
    if (withGates && !limited.startsOn && !limited.endsOn && !(rule.requires ?? []).length)
      add('limitedTime', 'dateless-limited-time');
  }
  return out;
}

const isPoints = (item: CorpusCaseLike) => item.reference.rewardCurrency?.value !== 'cash-back';
const wording = (rule: RuleFields) => (rule.issuerWording ? [rule.issuerWording] : []);

/** Checks a–c on a corpus case's rules (the apply gate). */
export function lintCorpusCase(item: CorpusCaseLike): LintFinding[] {
  return item.reference.rules.flatMap((rule, i) =>
    lintRule(
      item.cardId,
      `rules.${i}`,
      rule,
      [...(rule.anchors ?? []), ...wording(rule)],
      isPoints(item),
      false,
    ),
  );
}

/**
 * Checks a–e on the catalog rules of the overlay's cards (corpus rule with its patch applied; added rules), for the
 * cards in `cardIds` (all overlay cards when null), and check e on the store-credit programs.
 */
export function lintOverlay(
  cases: Map<string, CorpusCaseLike>,
  overlay: OverlayLike,
  cardIds: Set<string> | null = null,
): LintFinding[] {
  const out: LintFinding[] = [];
  for (const entry of overlay.cards) {
    if (cardIds && !cardIds.has(entry.cardId)) continue;
    const item = cases.get(entry.cardId);
    if (!item || entry.heldOut) continue;
    const patches = new Map((entry.rules ?? []).map((patch) => [patch.index, patch]));
    item.reference.rules.forEach((rule, i) => {
      const patch = patches.get(i);
      if (patch?.disposition === 'rule-held-out' || patch?.disposition === 'card-held-out') return;
      const fields = { ...rule, ...patch?.set };
      const evidence = [
        ...(rule.anchors ?? []),
        ...wording(rule),
        ...(patch?.anchors ?? []).map((anchor) => anchor.quote),
      ];
      out.push(...lintRule(entry.cardId, `rules.${i}`, fields, evidence, isPoints(item), true));
    });
    for (const added of entry.addedRules ?? [])
      out.push(
        ...lintRule(
          entry.cardId,
          `addedRules.${added.key}`,
          added,
          [...added.anchors.map((anchor) => anchor.quote), ...wording(added)],
          isPoints(item),
          true,
        ),
      );
  }
  const details = new Map((overlay.programDetails ?? []).map((detail) => [detail.programId, detail]));
  for (const program of overlay.programs ?? []) {
    const detail = details.get(program.id);
    if (program.unitName !== 'cents')
      out.push({ cardId: null, path: `programs.${program.id}.unitName`, check: 'store-program' });
    if (
      !detail ||
      detail.unitName !== program.unitName ||
      detail.redemptionBrandIds.join() !== program.redemptionBrandIds.join()
    )
      out.push({ cardId: null, path: `programDetails.${program.id}`, check: 'store-program' });
  }
  return out;
}

/** Findings per check, every check listed. */
export function countByCheck(findings: LintFinding[]): Record<LintCheck, number> {
  const counts = Object.fromEntries(LINT_CHECKS.map((check) => [check, 0])) as Record<LintCheck, number>;
  for (const finding of findings) counts[finding.check]++;
  return counts;
}

export const formatFinding = (finding: LintFinding): string =>
  `${finding.check} ${finding.cardId ?? '(program)'} ${finding.path}`;
