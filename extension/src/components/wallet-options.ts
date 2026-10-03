// Which catalog v3 questions the wallet editor asks for a set of owned cards (Stage 2 M7): chosen
// categories per card, membership and tier questions (gates) once per wallet, and point values per
// program. A question is asked only when a rule that depends on it can apply at a merchant the
// catalog covers, the same test `usageInputs` uses for spend limits and activation.
import { ruleCoversMerchant } from '../domain';
import type { Catalog, CardChoice, CardProductV3, CatalogV3, Gate, RewardProgram } from '../domain';

const v3 = (catalog: Catalog): catalog is CatalogV3 => catalog.schemaVersion === 3;
const covers = (catalog: CatalogV3) => (rule: CardProductV3['rules'][number]) =>
  catalog.merchants.some((merchant) => ruleCoversMerchant(rule, merchant));

/** The `chosen` categories of a card the shopper can answer. `automatic` ones are the issuer's to
 * set and are explained in the results instead. */
export function choiceQuestions(catalog: Catalog, cardId: string): CardChoice[] {
  if (!v3(catalog)) return [];
  const card = catalog.cards.find((c) => c.id === cardId);
  if (!card) return [];
  const applies = covers(catalog);
  return card.choices.filter(
    (choice) =>
      choice.kind === 'chosen' && card.rules.some((r) => r.choice?.choiceId === choice.id && applies(r)),
  );
}

/** Wallet-level questions about the cardholder, each once, with the owned cards that use it. */
export function gateQuestions(catalog: Catalog, cardIds: string[]): { gate: Gate; cards: CardProductV3[] }[] {
  if (!v3(catalog)) return [];
  const applies = covers(catalog);
  return catalog.gates.flatMap((gate) => {
    const cards = catalog.cards.filter(
      (card) =>
        cardIds.includes(card.id) &&
        card.rules.some((r) => applies(r) && r.requires.some((q) => q.gateId === gate.id)),
    );
    return cards.length ? [{ gate, cards }] : [];
  });
}

/** Points programs the owned cards earn (cash back and store rewards have a fixed 1¢ value). */
export function pointPrograms(
  catalog: Catalog,
  cardIds: string[],
): { program: RewardProgram; cards: CardProductV3[] }[] {
  if (!v3(catalog)) return [];
  return catalog.programs.flatMap((program) => {
    if (program.currency !== 'points') return [];
    const cards = catalog.cards.filter((card) => cardIds.includes(card.id) && card.programId === program.id);
    return cards.length ? [{ program, cards }] : [];
  });
}

/** True when an owned points card has no value at all: no override, no issuer-stated value on the
 * card and no value for its program. */
export function unvaluedPrograms(
  catalog: Catalog,
  wallet: { cards: { cardId: string }[]; valueOverrides?: { programId: string }[] },
): RewardProgram[] {
  return pointPrograms(
    catalog,
    wallet.cards.map((c) => c.cardId),
  )
    .filter(
      ({ program, cards }) =>
        program.valuation.basis === 'none' &&
        !wallet.valueOverrides?.some((o) => o.programId === program.id) &&
        cards.some((card) => card.statedValueHundredthsOfCent === null),
    )
    .map(({ program }) => program);
}

/** Parses a value in cents per unit ("1.25", "0.8", "2") to hundredths of a cent: 1 to 10,000
 * (0.01¢ to 100¢), at most two decimals. `null` when it is not such a number. */
export function parseCentsEach(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*¢?\s*$/.exec(text) ?? /^\s*\.(\d{1,2})\s*¢?\s*$/.exec(text);
  if (!match) return null;
  const [whole, fraction] = match.length === 3 ? [match[1], match[2] ?? ''] : ['0', match[1]];
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return value >= 1 && value <= 10_000 ? value : null;
}

/** Hundredths of a cent as the cents text the field shows: 150 → "1.5", 125 → "1.25", 100 → "1". */
export function formatCentsEach(hundredthsOfCent: number): string {
  return String(hundredthsOfCent / 100);
}
