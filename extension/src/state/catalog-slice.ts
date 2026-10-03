// What pages receive of the catalog in effect (Stage 2 M7). The bundled catalog v3 is about 800 KB;
// a page needs the full terms only of the cards it shows, plus a compact list of every card to
// search. Worker-side: built from a catalog the worker already validated.
import type { Catalog, CatalogV3 } from '../domain';

/** One searchable card: enough to list and add it without its terms. */
export interface CardIndexEntry {
  id: string;
  name: string;
  shortName: string;
  /** Catalog v1 has no issuers; its cards are listed under "Cards". */
  issuer: string;
}

export function cardIndex(catalog: Catalog): CardIndexEntry[] {
  return catalog.cards.map((card) => ({
    id: card.id,
    name: card.name,
    shortName: card.shortName,
    issuer: 'issuer' in card ? card.issuer : 'Cards',
  }));
}

/**
 * The catalog restricted to some cards and merchants (all merchants when `merchantIds` is omitted):
 * those cards with their full terms, and what they refer to (their programs, the brands and gates
 * their rules name, the sources they and the merchants cite). It keeps the catalog's version and
 * dates, so it is still "the catalog in effect" for display; it may hold no cards at all, so it is not
 * a publishable catalog and pages do not run the catalog schema on it.
 */
export function catalogSlice(catalog: Catalog, cardIds: Iterable<string>, merchantIds?: string[]): Catalog {
  const wanted = new Set(cardIds);
  const cited = (ids: string[]) => {
    const keep = new Set(ids);
    return catalog.sources.filter((s) => keep.has(s.id));
  };
  if (catalog.schemaVersion === 1) {
    const cards = catalog.cards.filter((c) => wanted.has(c.id));
    return { ...catalog, cards, sources: cited(cards.flatMap((c) => c.rules.flatMap((r) => r.sourceIds))) };
  }
  const inScope = (m: { id: string }) => !merchantIds || merchantIds.includes(m.id);
  if (catalog.schemaVersion === 2) {
    const merchants = catalog.merchants.filter(inScope);
    const cards = catalog.cards.filter((c) => wanted.has(c.id));
    const ruleSources = cards.flatMap((c) => c.rules.flatMap((r) => r.sourceIds));
    const merchantSources = merchants.flatMap((m) => m.mcc.sourceIds);
    return { ...catalog, merchants, cards, sources: cited([...ruleSources, ...merchantSources]) };
  }
  const merchants = catalog.merchants.filter(inScope);
  const merchantSources = merchants.flatMap((m) => m.mcc.sourceIds);
  const cards = catalog.cards.filter((c) => wanted.has(c.id));
  const programIds = new Set(cards.map((c) => c.programId));
  const programs = catalog.programs.filter((p) => programIds.has(p.id));
  const rules = cards.flatMap((c) => c.rules);
  const brandIds = new Set([
    ...merchants.flatMap((m) => m.brandIds),
    ...cards.flatMap((c) => (c.acceptance.kind === 'closed-loop' ? c.acceptance.brandIds : [])),
    ...rules.flatMap((r) => [...r.brandIds, ...r.excludedBrandIds]),
    ...programs.flatMap((p) => p.redemptionBrandIds),
  ]);
  const gateIds = new Set(rules.flatMap((r) => r.requires.map((g) => g.gateId)));
  return {
    ...catalog,
    programs,
    brands: catalog.brands.filter((b) => brandIds.has(b.id)),
    gates: catalog.gates.filter((g) => gateIds.has(g.id)),
    merchants,
    cards,
    sources: cited([
      ...rules.flatMap((r) => r.sourceIds),
      ...merchantSources,
      ...programs.flatMap((p) => (p.valuation.basis === 'issuer-stated' ? p.valuation.sourceIds : [])),
    ]),
  } satisfies CatalogV3;
}
