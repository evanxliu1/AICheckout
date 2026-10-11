// Stage 5, apply (plan section 6): deterministic. The evidence rule sets `category`: the drafted candidate stays only
// with an issuer-terms quote supporting it (`issuer`), a store-page quote plus an mcc-lookup quote (`corroborated`), or
// a store-page quote showing the business type plus an issuer's category definition covering it with no issuer
// exclusion of that store or its kind of store (`definition`, Evan 2026-10-11); otherwise `general-merchandise` with
// `default` and no sources. A disputed `evidence` downgrades; any other disputed field holds the whole record out of
// the release and lists it for Evan; there is no adjudicator. Records go to evals/merchants/db/records/<id>.json,
// quotes to evidence/<id>.json, cited sources to release-config.json.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { merchantRecordSchema } from '../../../../packages/rewards-core/src/merchant-release.ts';
import type { MerchantRecord, MerchantSource } from '../../../../packages/rewards-core/src/types.ts';
import { writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import { domainLabel } from './candidates.ts';
import {
  EVIDENCE_DIR,
  RECORDS_DIR,
  RELEASE_CONFIG,
  DEFUNCT_WORDING,
  EXCLUSIONS_FILE,
  OVERRIDES_FILE,
  overridesFileSchema,
  GOODS_FALSE_WORDING,
  GOODS_UNSETTLED_WORDING,
  VERIFIED_FIELDS,
  applyReportSchema,
  draftHeldOut,
  exclusionsFileSchema,
  readJsonOrNull,
  draftFileSchema,
  loadBatch,
  manifestFileSchema,
  readJson,
  releaseConfigSchema,
  researchFileSchema,
  verificationFileSchema,
  writeState,
} from './files.ts';
import type { Draft, EvidenceFile, ManifestEntry, VerificationFile, VerifiedField } from './files.ts';

export interface ApplyInput {
  domain: string;
  /** The candidate's fixed id (legacy stores, processors) or null. */
  id: string | null;
  name: string;
  hosts: string[];
  draft: Draft;
  verification: VerificationFile['stores'][number]['fields'];
  /** Per-quote verdicts (review 2026-10-11); absent or empty means the field-level `evidence` verdict stands for every
   * quote. */
  quoteVerdicts?: VerificationFile['stores'][number]['quotes'];
  sources: Pick<ManifestEntry, 'id' | 'kind' | 'url' | 'capturedOn' | 'sha256'>[];
  /** The mined issuer captures of this store (the windows around its name) by source id, for the exclusion check
   * of the `definition` basis. Absent texts count as no exclusion. */
  issuerTexts?: Record<string, string>;
  /** The full store-page captures by source id, for the excluded-kinds check of the `definition` basis. */
  storeTexts?: Record<string, string>;
}

export type ApplyOutcome =
  | {
      outcome: 'record';
      record: MerchantRecord;
      evidence: Omit<EvidenceFile, 'batch' | 'appliedOn'>;
      cited: MerchantSource[];
      /** The verifier disputed `evidence` alone: the record ships on the default category with no sources. */
      downgraded: { reason: string | null } | null;
      /** A drafted candidate the evidence rule did not grant, with the rule's reason (review.md lists it). */
      refused: { candidate: string; reason: string } | null;
      /** Cross-issuer conflicts of a granted category (review.md lists them; the record follows the rule). */
      conflicts: string[];
      /** Hosts dropped on the verifier's word (the rest confirmed). */
      droppedHosts: string[];
    }
  | { outcome: 'held-out'; disputed: { field: VerifiedField | 'processor'; reason: string | null }[] };

/** The record id: the candidate's fixed id, else the domain's label (`kroger-us`, `paypal`). A store on a subdomain
 * keeps every label down to the registrable one (`music-apple-us`, `athleta-gap-us`, `disneyland-disney-go-us`), so
 * two stores of one company never share an id (seed 2026-10-11: athleta and bananarepublic both became `gap-us`). */
export const recordId = (domain: string, kind: string, fixed: string | null): string => {
  if (fixed) return fixed;
  const label = domainLabel(domain);
  const labels = domain.split('.');
  const at = labels.indexOf(label);
  // A public suffix other than .com stays in the id (pandora.net → pandora-net-us), so pandora.com and pandora.net
  // never share one (seed 2026-10-11: the tier-A pandora.net record overwrote the tier-B pandora.com one).
  const suffix = labels.slice(at + 1).join('-');
  // .com and .us need no suffix (every record is a U.S. store and ends in -us already: aldi.us → aldi-us).
  const slug = [...labels.slice(0, at + 1), ...(suffix === 'com' || suffix === 'us' ? [] : [suffix])].join(
    '-',
  );
  return kind === 'processor' ? slug : `${slug}-us`;
};

/** Words that make a clause an exclusion, a limit or a base rate rather than an earning statement. A bare "not"
 * catches "Not grocery stores:" lists. */
export const EXCLUSION_WORDING =
  /\b(exclud\w*|except|excepting|excepted|exceptions?|other than|not|don't|doesn't|aren't|isn't|ineligible|only)\b/i;
/** Wording that says purchases earn something. */
export const EARNING_WORDING =
  /\b(earns?|earning|rewards?|cash ?back|points?|miles|\d+(?:\.\d+)?\s?%|\d+x)\b|\d%/i;
/** Wording that opens an inclusion list ("Includes the following streaming providers:", "The U.S. drugstore list
 * is:"); such a list under an earning category names its stores as earning (coordinator, 2026-10-11). Not "like" or
 * "such as": "a $15 credit for streaming purchases like Netflix" and "wholesale clubs such as Costco" are examples in
 * a sentence about something else, not the category's list. */
export const INCLUSION_WORDING = /\b(includes?|included|list (?:is|of)|following)\b|:/i;
/** Wording an issuer uses when it says what a category covers. */
export const DEFINITION_WORDING =
  /\b(includ\w*|such as|means?|defin\w*|consist\w*|categor\w*|\w*stores?|merchants?|list|establishments?|providers?|services?|retailers?|pharmac(?:y|ies))\b/i;
/** A verifier's `hosts` reason that says the store's own domain is no checkout host (held out), as against one that
 * only names extra hosts it could not confirm (dropped; coordinator, 2026-10-11). */
export const HOSTS_UNCONFIRMED_WORDING =
  /\b(no (?:web |online |public )?(?:checkout|cart|ordering)|nothing (?:is )?(?:shown )?(?:being )?(?:bought|sold|purchased)|no issuer capture names|corporate site|links out)\b/i;
/** Wording that makes a definition conditional ("included if they classify as a restaurant merchant"). */
export const CONDITIONAL_WORDING =
  /\b(if|when|unless|provided|may|might|classif\w*|qualif\w*|depend\w*|eligible)\b/i;
/** Hedged merchant lists ("popular merchants in this category", "examples of", "does not control how merchants are
 * categorized") are no issuer evidence (coordinator, 2026-10-11). */
export const HEDGED_WORDING =
  /\b(popular merchants?|examples? of|for example|helpful guide|does not control|may include|typically|generally|among others)\b/i;
/** A quarterly-calendar or rate line is no definition ("Earn 5% … April 1 to June 30, 2026"). */
export const CALENDAR_WORDING =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|quarter(?:ly)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b|\d+(?:\.\d+)?\s?%|\b\d+x\b/i;
/** Issuer category words → the merchant category they describe. Unlisted categories (general-merchandise) never
 * come from an issuer quote. */
export const ISSUER_CATEGORY_WORDS: Record<string, RegExp> = {
  supermarkets: /\b(grocer(?:y|ies)|supermarkets?)\b/i,
  // "Fast food" counts for dining because the only issuer with a fast-food option in the catalog (U.S. Bank Cash+,
  // rule `cash-plus-fast-food`) maps it to the `dining` category (coordinator, 2026-10-11).
  dining: /\b(restaurants?|dining|fast[- ]food)\b/i,
  drugstores: /\b(drug ?stores?|pharmac(?:y|ies))\b/i,
  streaming: /\bstreaming\b/i,
  gas: /\b(gas|fuel|gas stations?)\b/i,
  'ev-charging': /\b(ev charging|electric vehicle charging|charging stations?)\b/i,
  transit: /\b(transit|rideshare|ride-?share|taxis?|trains?|commuter|parking|tolls?)\b/i,
  'department-stores': /\bdepartment stores?\b/i,
  'home-improvement': /\b(home improvement|hardware stores?)\b/i,
  'wholesale-clubs': /\b(wholesale clubs?|warehouse clubs?)\b/i,
  electronics: /\belectronics\b/i,
  entertainment: /\b(entertainment|tickets?|theat(?:er|re)s?|cinemas?|amusement)\b/i,
};

/** What a store's own page says it is, per category: a business-type noun phrase, not a department word ("Shop
 * Electronics at Walmart", "Buy event tickets", "Free parking" and "Stream with Prime Video" show no business type). */
export const BUSINESS_TYPE_WORDS: Record<string, RegExp> = {
  supermarkets: /\b(grocer(?:y|ies)|grocers?|supermarkets?)\b/i,
  dining: /\b(restaurants?|food delivery|takeout|take-out|dining)\b/i,
  drugstores: /\b(drug ?stores?|pharmac(?:y|ies)|prescriptions?)\b/i,
  streaming: /\b(streaming (?:service|platform|subscription|provider)s?|stream\w* service)\b/i,
  gas: /\b(gas stations?|fuel(?:ing)? stations?|filling stations?|gas and convenience)\b/i,
  'ev-charging': /\b(ev charging (?:network|station)s?|charging networks?|electric vehicle charging)\b/i,
  transit:
    /\b(transit (?:agency|authority|system)|public transit|rideshar\w+ (?:company|service|platform|app)|ride-?hailing|commuter rail|railroads?|rail service|toll (?:road|authority)s?|parking (?:operator|garage|facility|lot)s?|taxi (?:service|company))\b/i,
  'department-stores': /\bdepartment stores?\b/i,
  // Furniture and home-decor stores are not home improvement (coordinator, 2026-10-11): the page must show a
  // home-improvement, hardware or building-supply business.
  'home-improvement':
    /\b(home improvement (?:store|retailer|center|chain|products?)s?|hardware (?:store|retailer|chain)s?|home centers?|building (?:supply|supplies|materials?) (?:store|retailer|dealer)s?|lumber ?yards?)\b/i,
  'wholesale-clubs': /\b(wholesale clubs?|warehouse clubs?|membership warehouse)\b/i,
  electronics:
    /\b((?:consumer )?electronics (?:retailer|store|chain|company|superstore)s?|technology retailers?|computer (?:retailer|store)s?)\b/i,
  entertainment:
    /\b(movie theat(?:er|re)s?|cinemas?|theme parks?|amusement parks?|ticketing (?:company|service|platform|marketplace)|live entertainment|entertainment company)\b/i,
};
/** Kinds of store the issuers' definitions exclude (plan section 2, Evan 2026-10-11; coordinator 2026-10-11: applied
 * to every category, minus the category's own type). A store whose own pages call it one of these never gets a
 * category on the `definition` basis, and an issuer sentence naming the store as one excludes it. */
const EXCLUDED_STORE_TYPES = [
  'superstores?',
  'supercenters?',
  'discount (?:store|retailer)s?',
  'warehouse clubs?',
  'wholesale clubs?',
  'membership (?:warehouse|club)s?',
  'club membership',
  'members-only',
  'membership (?:is )?required',
  'paid membership',
  'annual membership',
  'membership fee',
  'department stores?',
  'general merchandise',
  'online marketplaces?',
  'third-party sellers',
] as const;
const CATEGORY_OWN_TYPES: Record<string, RegExp> = {
  'wholesale-clubs': /warehouse|wholesale|membership|members-only/,
  'department-stores': /department/,
};
const CATEGORY_EXTRA_EXCLUDED: Record<string, string[]> = {
  supermarkets: ['convenience stores?'],
  drugstores: ['convenience stores?'],
  dining: ['grocer(?:y|ies)', 'supermarkets?', 'convenience stores?'],
};
export const CATEGORY_EXCLUDED_TYPES: Record<string, RegExp> = Object.fromEntries(
  Object.keys(ISSUER_CATEGORY_WORDS).map((category) => [
    category,
    new RegExp(
      `\\b(${[
        ...EXCLUDED_STORE_TYPES.filter((t) => !CATEGORY_OWN_TYPES[category]?.test(t)),
        ...(CATEGORY_EXTRA_EXCLUDED[category] ?? []),
      ].join('|')})\\b`,
      'i',
    ),
  ]),
);
/** An issuer definition that names delivery services lets a delivery marketplace qualify (dining only). */
export const DELIVERY_WORDING = /\b(deliver(?:y|ies|ed)|takeout|take-out)\b/i;
/** A merchant-code lookup page that is a forum or community thread is no lookup (the research gate refuses them;
 * apply and build refuse one that slipped through before the gate). */
export const FORUM_URL = /forum|community|reddit|thread|discussion|myfico/i;
/** Lookup hosts whose terms forbid deep links (Fiserv's developer portal, 2026-10-11): never cited; the 15 batch
 * citations of its code table were replaced by the Visa Merchant Data Standards Manual, which names the same
 * carriers and hotel brands. */
export const REFUSED_LOOKUP_URL = /fiserv\.dev|fiserv\.com/i;
export const refusedLookup = (url: string): boolean => FORUM_URL.test(url) || REFUSED_LOOKUP_URL.test(url);

/** Clause boundaries: a semicolon, a sentence end (a period before whitespace and a capital, not after an abbreviation
 * such as U.S., e.g., Inc.), or a word that turns the rest into an exclusion. A colon is not a boundary ("The U.S.
 * drugstore list is: CVS…" is one clause). */
const CLAUSE_BREAK =
  /;|(?<!\b(?:U\.S|U\.K|e\.g|i\.e|Inc|Co|Corp|Ltd|No|St|vs|etc))\.(?=\s+[A-Z])|\b(?:but|excluding|except(?:ing)?|other than|not including)\b/i;
/** Sentence boundaries for the exclusion check: a semicolon, a blank line or a sentence end; exclusion words do not
 * split, because the exclusion must be read with what it excludes. */
const SENTENCE_BREAK = /;|\n\s*\n|(?<!\b(?:U\.S|U\.K|e\.g|i\.e|Inc|Co|Corp|Ltd|No|St|vs|etc))\.(?=\s+[A-Z])/;
/** Where an inclusion list starts inside a sentence: what follows is included under what precedes. */
const INCLUSION_START = /\b(includ\w*|such as|like)\b|:/i;

const normal = (s: string) => s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\u00a0/g, ' ');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The store's name (hyphens and soft hyphens inside it optional, so "Wal-Mart" names Walmart) or its domain label
 * when 5+ letters, on word boundaries. */
export const storeNamed = (name: string, domain: string): RegExp => {
  const label = domainLabel(domain);
  const flexible = normal(name.trim())
    .split(/[-\u00ad]/)
    .map((part) => escape(part).replace(/(?<=[A-Za-z])(?=[A-Za-z])/g, '[-\\u00ad]?'))
    .join('[-\\u00ad]?');
  const names = [flexible, ...(label.length >= 5 ? [escape(label)] : [])];
  return new RegExp(`(?<![A-Za-z0-9])(?:${names.join('|')})(?![A-Za-z0-9])`, 'i');
};

/** Whether a clause excludes `category`: it has exclusion wording about the category's words or a kind of store the
 * category excludes, read with direction: in "Merchants not in the grocery category include wholesale clubs such as
 * Costco" the exclusion is grocery's, and what follows "include" is an inclusion for wholesale clubs (coordinator,
 * 2026-10-11: an exclusion counts only within the drafted category). */
export function clauseExcludes(clause: string, category: string): boolean {
  const words = ISSUER_CATEGORY_WORDS[category];
  if (!words || !EXCLUSION_WORDING.test(clause)) return false;
  const types = CATEGORY_EXCLUDED_TYPES[category];
  const start = INCLUSION_START.exec(clause);
  if (start) {
    const head = clause.slice(0, start.index);
    const tail = clause.slice(start.index);
    if (!words.test(head) && words.test(tail) && !EXCLUSION_WORDING.test(tail) && !types.test(tail))
      return false;
  }
  return words.test(clause) || types.test(clause);
}

/** An issuer quote is category evidence for `category` only when one clause of it names this store (its name or
 * domain label, on word boundaries), names that category, and either says purchases earn (earn, rewards, cash back,
 * points, a rate) or is an inclusion list under the category ("Includes the following streaming providers: …
 * Netflix", "The U.S. drugstore list is: CVS Pharmacy…"), with no exclusion of that category in the clause. "3% at
 * grocery stores including Kroger; excluding warehouse clubs" counts for Kroger; "superstores like Costco excluded",
 * "Netflix is an example of a streaming service", "Costco purchases earn only 1%" and a bare "Kroger" do not. */
export function issuerQuoteEarns(quote: string, name: string, domain: string, category: string): boolean {
  const words = ISSUER_CATEGORY_WORDS[category];
  if (!words) return false;
  const named = storeNamed(name, domain);
  // An inclusion list names the category before its opener and the store after it ("Includes the following streaming
  // providers: … Netflix"); "Note: Kroger is a grocery store" and "Q: Does Kroger count…?" are not lists.
  const inclusionList = (clause: string) => {
    for (const start of clause.matchAll(new RegExp(INCLUSION_WORDING.source, 'gi')))
      if (words.test(clause.slice(0, start.index)) && named.test(clause.slice(start.index + start[0].length)))
        return true;
    return false;
  };
  // Clauses are joined to the one before them when they only continue the list ("Kroger, Meijer").
  return normal(quote)
    .split(CLAUSE_BREAK)
    .some(
      (clause) =>
        named.test(clause) &&
        words.test(clause) &&
        (EARNING_WORDING.test(clause) || inclusionList(clause)) &&
        !EXCLUSION_WORDING.test(clause) &&
        !CONDITIONAL_WORDING.test(clause) &&
        !HEDGED_WORDING.test(clause),
    );
}

/** The clause of an issuer quote that defines `category`: it names the category's issuer words with definition
 * wording ("grocery stores and supermarkets", "restaurants, including takeout and delivery services", "the purchases
 * must be made at a drugstore that is included on our list"), and does not exclude the category ("Merchants not in
 * the grocery category include wholesale clubs" defines wholesale clubs, not grocery). "Earn points with our grocery
 * rewards partners" defines nothing. Null when no clause qualifies. */
export function definitionClause(quote: string, category: string): string | null {
  const words = ISSUER_CATEGORY_WORDS[category];
  if (!words) return null;
  for (const clause of normal(quote).split(CLAUSE_BREAK)) {
    if (!words.test(clause) || !DEFINITION_WORDING.test(clause) || clauseExcludes(clause, category)) continue;
    if (CALENDAR_WORDING.test(clause) || HEDGED_WORDING.test(clause)) continue;
    const start = INCLUSION_START.exec(clause);
    // An inclusion list under another category's exclusion: only its tail defines this category.
    if (start && EXCLUSION_WORDING.test(clause.slice(0, start.index))) return clause.slice(start.index);
    if (EXCLUSION_WORDING.test(clause)) continue;
    return clause;
  }
  return null;
}
export const definitionQuoteCovers = (quote: string, category: string): boolean =>
  definitionClause(quote, category) !== null;

/** A store-page quote shows the business type when it names the category's business-type phrase ("Grocery Pickup",
 * "home improvement stores") and no kind of store the category excludes ("membership warehouse club" for
 * supermarkets). The full store pages are checked for excluded kinds by `definitionBasis`. */
export function storePageShowsType(quote: string, category: string): boolean {
  const words = BUSINESS_TYPE_WORDS[category];
  if (!words) return false;
  // A bare navigation word or label ("Grocery", "Grocery Pickup") is no business-type statement: at least three words.
  if (quote.trim().split(/\s+/).length < 3) return false;
  return words.test(quote) && !CATEGORY_EXCLUDED_TYPES[category].test(quote);
}

/** A lookup quote backs a category only when it names the category's words: "MCC 4899 (Cable and other pay
 * television)" never backs streaming. */
export const lookupQuoteNames = (quote: string, category: string): boolean =>
  (ISSUER_CATEGORY_WORDS[category]?.test(quote) || BUSINESS_TYPE_WORDS[category]?.test(quote)) ?? false;

/** An issuer capture excludes this store from the category when one sentence names the store and excludes the
 * category or names the store as a kind of store the category excludes ("purchases at discount stores like Wal-Mart,
 * Target and Costco do not qualify"; "Grocery stores, excluding Walmart and Target"). Conservative: "3% at grocery
 * stores including Kroger, excluding warehouse clubs" in one sentence also counts against Kroger. */
export function issuerExcludes(text: string, name: string, domain: string, category: string): boolean {
  const named = storeNamed(name, domain);
  return normal(text)
    .split(SENTENCE_BREAK)
    .some((sentence) => named.test(sentence) && clauseExcludes(sentence, category));
}

export type DefinitionOutcome = { cited: string[] } | { refused: string };

/** The `definition` basis (Evan 2026-10-11): the store's own page shows its business type, an issuer's category
 * definition covers that type, no issuer capture excludes the store or its kind of store from the category, the
 * store's own pages never call it a kind of store the category excludes, and the store sells directly (a marketplace
 * only for `dining` under a definition whose covering clause names delivery services unconditionally). Returns the
 * source ids to cite, or why it was refused. */
export function definitionBasis(input: ApplyInput, category: string): DefinitionOutcome {
  const { draft } = input;
  if (draft.kind === 'processor') return { refused: 'a processor has no category' };
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const kindOf = (id: string) => byId.get(id)?.kind;
  const storeQuotes = draft.evidence.filter(
    (e) =>
      e.supports === 'category' &&
      kindOf(e.sourceId) === 'store-page' &&
      storePageShowsType(e.quote, category),
  );
  if (!storeQuotes.length) return { refused: `no store-page quote shows a ${category} business type` };
  const definitions = draft.evidence
    .map((e) => ({ ...e, clause: definitionClause(e.quote, category) }))
    .filter((e) => e.supports === 'definition' && kindOf(e.sourceId) === 'issuer-terms' && e.clause !== null);
  if (!definitions.length) return { refused: `no issuer definition quote covers ${category}` };
  let covering = definitions;
  if (draft.kind !== 'merchant') {
    if (category !== 'dining') return { refused: 'a marketplace gets a category only for dining' };
    covering = definitions.filter(
      (e) => DELIVERY_WORDING.test(e.clause!) && !CONDITIONAL_WORDING.test(e.clause!),
    );
    if (!covering.length)
      return { refused: 'no issuer dining definition names delivery services unconditionally' };
  }
  const excludedType = CATEGORY_EXCLUDED_TYPES[category];
  for (const source of input.sources.filter((s) => s.kind === 'store-page')) {
    const text = input.storeTexts?.[source.id];
    if (text === undefined) return { refused: `store page ${source.id} has no capture to check` };
    const hit = excludedType.exec(text);
    if (hit) return { refused: `the store's own page ${source.id} calls it a ${hit[0].toLowerCase()}` };
  }
  for (const source of input.sources.filter((s) => s.kind === 'issuer-terms')) {
    const text = input.issuerTexts?.[source.id];
    if (text === undefined) return { refused: `issuer capture ${source.id} is missing` };
    if (issuerExcludes(text, input.name, input.domain, category))
      return { refused: `issuer page ${source.id} excludes the store or its kind of store from ${category}` };
  }
  return { cited: [...new Set([...storeQuotes, ...covering].map((e) => e.sourceId))] };
}

/** Cross-issuer conflicts of a granted category (review 2026-10-11): sentences of the store's issuer windows that name
 * the store and either exclude the granted category (an `issuer` or `corroborated` record skips the exclusion check) or
 * place it under another category's words. Reported for Evan in review.md; the record still follows the rule. Each
 * entry is the source id and the sentence cut to 25 words. */
export function issuerConflicts(input: ApplyInput, category: string, citedIds: string[]): string[] {
  const named = storeNamed(input.name, input.domain);
  const own = ISSUER_CATEGORY_WORDS[category];
  const others = Object.entries(ISSUER_CATEGORY_WORDS).filter(([c]) => c !== category);
  const out: string[] = [];
  for (const source of input.sources.filter((s) => s.kind === 'issuer-terms')) {
    const text = input.issuerTexts?.[source.id];
    if (text === undefined) continue;
    for (const sentence of normal(text).split(SENTENCE_BREAK)) {
      if (!named.test(sentence)) continue;
      const excludes = clauseExcludes(sentence, category);
      const elsewhere = !own?.test(sentence) && others.some(([, words]) => words.test(sentence));
      if (!excludes && !elsewhere) continue;
      if (!excludes && citedIds.includes(source.id)) continue;
      const words = sentence.trim().split(/\s+/).filter(Boolean);
      // Page chrome (menus, lists of capitalised links) is no sentence: at least six words, mostly lower-case.
      if (words.length < 6 || words.filter((w) => /^[A-Z]/.test(w)).length > words.length / 2) continue;
      out.push(
        `${source.id}: ${excludes ? 'excludes' : 'lists the store under another category'}: "${words.slice(0, 25).join(' ')}${words.length > 25 ? ' …' : ''}"`,
      );
    }
  }
  return out;
}

/** The apply rule for one store. Pure: no files. `basis` is decided in one place. */
export function applyStore(input: ApplyInput): ApplyOutcome {
  const { draft: drafted } = input;
  // A verifier's `physicalGoods` dispute that states the value (coordinator, 2026-10-11) corrects the draft instead
  // of holding the record out; one that cannot settle it still holds out.
  const goodsReason = input.verification.physicalGoods.reason ?? '';
  const goodsValue =
    input.verification.physicalGoods.verdict !== 'disputed'
      ? null
      : /\bfalse\b/i.test(goodsReason) ||
          (GOODS_FALSE_WORDING.test(goodsReason) && !GOODS_UNSETTLED_WORDING.test(goodsReason))
        ? false
        : /\btrue\b/i.test(goodsReason)
          ? true
          : null;
  const draft = goodsValue === null ? drafted : { ...drafted, physicalGoods: goodsValue };
  // A hosts dispute drops the hosts the verifier could not confirm and keeps the record when the store's own domain
  // stands (coordinator, 2026-10-11: Costco keeps costco.com, Old Navy keeps oldnavy.gap.com); a redirect-only host
  // ("max.com redirects to hbomax.com") is dropped too. The record is held out only when the reason says the domain
  // itself is no checkout host or cannot be confirmed, or when nothing would be left.
  const hostsReason = input.verification.hosts.reason ?? '';
  const escapeHost = (h: string) => h.replace(/[.]/g, '\\.');
  const namedIn = (h: string) =>
    new RegExp(`(?<![a-z0-9.-])${escapeHost(h)}(?![a-z0-9-])`, 'i').test(hostsReason);
  const redirectsAway = (h: string) =>
    new RegExp(`(?<![a-z0-9.-])${escapeHost(h)}[^.]*?\\bredirects?\\b`, 'i').test(hostsReason) &&
    !new RegExp(`redirects? to (?:www\\.)?${escapeHost(h)}`, 'i').test(hostsReason);
  // A host is dropped only when the sentence naming it says something negative about it ("appears in no capture",
  // "not confirmed", "redirects"), not when it is merely mentioned ("only oldnavy.gap.com is shown selling").
  const negativeAbout = (h: string) =>
    hostsReason
      .split(/;|\.(?=\s)/)
      .some(
        (part) =>
          new RegExp(`(?<![a-z0-9.-])${escapeHost(h)}(?![a-z0-9-])`, 'i').test(part) &&
          /\b(no|not|never|cannot|can't|unconfirmed|redirects?|fails?|unreachable|missing)\b/i.test(part) &&
          !/\bonly\b/i.test(part.split(new RegExp(escapeHost(h), 'i'))[0] ?? ''),
      );
  let droppedHosts: string[] = [];
  let hostsSettled = false;
  if (input.verification.hosts.verdict === 'disputed') {
    // Hosts the reason names as redirect targets ("redirects to hbomax.com") are kept, not dropped.
    const isTarget = (h: string) =>
      new RegExp(`redirects? to (?:www\\.)?${escapeHost(h)}`, 'i').test(hostsReason);
    const others = input.hosts.filter(
      (h) => h !== input.domain && namedIn(h) && !isTarget(h) && negativeAbout(h),
    );
    const domainRedirects = redirectsAway(input.domain);
    const domainUnconfirmed =
      !domainRedirects && others.length === 0 && HOSTS_UNCONFIRMED_WORDING.test(hostsReason);
    droppedHosts = domainRedirects ? [...others, input.domain] : others;
    const left = input.hosts.filter((h) => !droppedHosts.includes(h));
    // A domain that redirects to another business's site (cedarpoint.com → sixflags.com) leaves no host of its own:
    // the hosts go to the business that checks out there (coordinator rule 6), so the record is held out. A redirect
    // within the same name (max.com → hbomax.com, clubwyndham.com → clubwyndham.wyndhamdestinations.com) keeps it.
    const ownHostLeft = !domainRedirects || left.some((h) => h.includes(domainLabel(input.domain)));
    hostsSettled = !domainUnconfirmed && droppedHosts.length > 0 && left.length > 0 && ownHostLeft;
  }
  const hosts = hostsSettled ? input.hosts.filter((h) => !droppedHosts.includes(h)) : input.hosts;
  const disputed = VERIFIED_FIELDS.filter((f) => {
    if (f === 'evidence' || input.verification[f].verdict !== 'disputed') return false;
    // A null candidate the verifier would raise stays default (coordinator, 2026-10-11): the rule is conservative.
    if (f === 'candidateCategory' && drafted.candidateCategory === null) return false;
    if (f === 'physicalGoods' && goodsValue !== null) return false;
    if (f === 'hosts' && hostsSettled) return false;
    return true;
  }).map((field) => ({
    field: field as VerifiedField | 'processor',
    reason: input.verification[field].reason,
  }));
  if (draft.kind === 'processor' && (draft.physicalGoods || draft.brandIds.length))
    disputed.push({ field: 'processor', reason: 'a processor sells no physical goods and has no brands' });
  if (disputed.length) return { outcome: 'held-out', disputed };
  // Confirmed quotes only (review 2026-10-11): a disputed quote is dropped, not the whole field; without per-quote
  // verdicts the field-level verdict applies to every quote.
  const perQuote = input.quoteVerdicts?.length ? input.quoteVerdicts : null;
  const quoteOk = (i: number) =>
    perQuote
      ? perQuote.find((q) => q.index === i)?.verdict === 'confirmed'
      : input.verification.evidence.verdict !== 'disputed';
  const confirmedEvidence = draft.evidence.filter((_, i) => quoteOk(i));
  const disputedReasons = perQuote
    ? perQuote.filter((q) => q.verdict === 'disputed').map((q) => q.reason ?? '')
    : input.verification.evidence.verdict === 'disputed'
      ? [input.verification.evidence.reason ?? '']
      : [];
  const evidenceDisputed = disputedReasons.length > 0;
  const confirmedDraft = { ...draft, evidence: confirmedEvidence };
  // Forum threads and hosts whose terms forbid deep links are no merchant-code lookups.
  const sources = input.sources.filter((s) => !(s.kind === 'mcc-lookup' && refusedLookup(s.url)));
  const byId = new Map(sources.map((s) => [s.id, s]));
  const candidate = draft.candidateCategory;
  const categoryQuotes = confirmedEvidence.filter((e) => {
    if (e.supports !== 'category' || !byId.has(e.sourceId) || candidate === null) return false;
    const kind = byId.get(e.sourceId)!.kind;
    if (kind === 'issuer-terms') return issuerQuoteEarns(e.quote, input.name, input.domain, candidate);
    if (kind === 'mcc-lookup') return lookupQuoteNames(e.quote, candidate);
    return true;
  });
  const kinds = new Set(categoryQuotes.map((e) => byId.get(e.sourceId)!.kind));
  let basis: MerchantRecord['evidence']['basis'] = 'default';
  let citedIds: string[] = [];
  let refused: { candidate: string; reason: string } | null = null;
  if (candidate && candidate !== 'general-merchandise' && draft.kind !== 'processor') {
    if (kinds.has('issuer-terms')) basis = 'issuer';
    else if (kinds.has('store-page') && kinds.has('mcc-lookup')) basis = 'corroborated';
    if (basis !== 'default') citedIds = [...new Set(categoryQuotes.map((e) => e.sourceId))];
    else {
      const definition = definitionBasis({ ...input, sources, draft: confirmedDraft }, candidate);
      if ('cited' in definition) {
        basis = 'definition';
        citedIds = definition.cited;
      } else refused = { candidate, reason: definition.refused };
    }
  }
  const conflicts =
    basis === 'default'
      ? []
      : issuerConflicts(input, candidate as string, [...new Set(categoryQuotes.map((e) => e.sourceId))]);
  // Downgraded: disputed quotes and no basis from the confirmed ones (with every quote confirmed it may still be
  // refused by the rule, which is reported as `refused`).
  const downgraded =
    evidenceDisputed && basis === 'default' && candidate !== null && candidate !== 'general-merchandise';
  const record = merchantRecordSchema.parse({
    id: recordId(input.domain, draft.kind, input.id),
    name: input.name,
    hosts,
    kind: draft.kind,
    physicalGoods: draft.kind === 'processor' ? false : draft.physicalGoods,
    category: basis === 'default' ? 'general-merchandise' : candidate,
    evidence: { basis, sourceIds: citedIds },
    brandIds: draft.kind === 'processor' ? [] : draft.brandIds,
    disabled: false,
  });
  const cited: MerchantSource[] = citedIds.map((id) => {
    const s = byId.get(id)!;
    return { id: s.id, url: s.url, kind: s.kind, capturedAt: s.capturedOn, sha256: s.sha256 };
  });
  return {
    outcome: 'record',
    record,
    evidence: {
      schemaVersion: 1,
      id: record.id,
      basis,
      quotes: confirmedEvidence
        .filter((e) => byId.has(e.sourceId))
        .map((e) => ({
          sourceId: e.sourceId,
          kind: byId.get(e.sourceId)!.kind,
          supports: e.supports,
          quote: e.quote,
        })),
    },
    cited,
    // The report's note field holds 300 characters; the full per-quote reasons stay in verification.json.
    downgraded: downgraded
      ? { reason: disputedReasons.filter(Boolean).join(' ').slice(0, 300) || null }
      : null,
    refused,
    conflicts,
    droppedHosts: hostsSettled ? droppedHosts : [],
  };
}

export async function runApply(env: Env, batchId: string): Promise<number> {
  const batch = await loadBatch(env.root, batchId);
  if (batch.state.stages.verify.status !== 'done') {
    env.log('apply: verify is not accepted yet.');
    return 1;
  }
  const research = await readJson(join(batch.dir, 'research.json'), researchFileSchema);
  const verification = await readJson(join(batch.dir, 'verification.json'), verificationFileSchema);
  const manifest = await readJson(join(batch.dir, 'manifest.json'), manifestFileSchema);
  const config = await readJson(join(env.root, RELEASE_CONFIG), releaseConfigSchema);
  const today = env.now().toISOString().slice(0, 10);
  const report = {
    schemaVersion: 1 as const,
    batch: batch.id,
    appliedOn: today,
    records: [] as {
      domain: string;
      id: string;
      basis: string;
      category: string;
      downgraded?: { reason: string | null };
      refused?: { candidate: string; reason: string; notes: string | null };
      conflicts?: string[];
      fallback?: 'default-from-research';
      droppedHosts?: string[];
      overridden?: string[];
    }[],
    heldOut: [] as {
      domain: string;
      disputed: { field: string; reason: string | null }[];
      reason?: 'defunct' | 'out-of-scope';
    }[],
    botWalled: [] as string[],
  };
  const sourcesById = new Map(config.sources.map((s) => [s.id, s]));
  let newestCapture = config.verifiedAt.slice(0, 10);
  const exclusions =
    (await readJsonOrNull(join(env.root, EXCLUSIONS_FILE), exclusionsFileSchema))?.excluded ?? [];
  const overrides = (await readJsonOrNull(join(env.root, OVERRIDES_FILE), overridesFileSchema))?.fields ?? [];
  for (const store of batch.meta.stores) {
    const excluded = exclusions.find((e) => e.domain === store.domain);
    if (excluded) {
      report.heldOut.push({
        domain: store.domain,
        disputed: [{ field: 'scope', reason: excluded.note }],
        reason: excluded.reason,
      });
      batch.state.stores[store.domain] = {
        ...batch.state.stores[store.domain],
        apply: 'held-out',
        heldOutFields: ['scope'],
      };
      env.log(`${store.domain}: EXCLUDED (${excluded.reason}).`);
      continue;
    }
    // Held out at the draft stage (the quotes failed the verbatim gate MAX_DRAFT_ATTEMPTS times): no record is
    // written, so an already-authored record of the same id (amazon-us from 14.1) stays in the release unchanged.
    if (draftHeldOut(batch.state, store.domain)) {
      const attempts = batch.state.stores[store.domain]?.draft?.attempts ?? 0;
      report.heldOut.push({
        domain: store.domain,
        disputed: [
          { field: 'draft', reason: `the drafter's quotes failed the verbatim gate ${attempts} times` },
        ],
      });
      batch.state.stores[store.domain] = {
        ...batch.state.stores[store.domain],
        apply: 'held-out',
        heldOutFields: ['draft'],
      };
      env.log(`${store.domain}: HELD OUT (draft).`);
      continue;
    }
    const researched = research.stores.find((s) => s.domain === store.domain);
    const verified = verification.stores.find((s) => s.domain === store.domain);
    if (!researched || !verified) {
      env.log(`apply: ${store.domain} has no research or verification entry.`);
      return 1;
    }
    const draftFile = draftFileSchema.parse(
      JSON.parse(await readFile(join(batch.dir, 'drafts', `${store.domain}.json`), 'utf8')),
    );
    const sources = manifest.sources.filter((s) => s.domain === store.domain);
    const storeTexts: Record<string, string> = {};
    for (const source of sources.filter((s) => s.kind === 'store-page')) {
      const text = await readFile(join(batch.dir, 'captures', `${source.id}.txt`), 'utf8').catch(() => null);
      if (text !== null) storeTexts[source.id] = text;
    }
    const issuerTexts: Record<string, string> = {};
    for (const source of sources.filter((s) => s.kind === 'issuer-terms')) {
      const dir = join(batch.dir, 'captures');
      const text = await readFile(join(dir, `${source.id}.windows.${store.domain}.txt`), 'utf8').catch(() =>
        readFile(join(dir, `${source.id}.txt`), 'utf8').catch(() => null),
      );
      if (text !== null) issuerTexts[source.id] = text;
    }
    // Coordinator field corrections (overrides.json) replace the drafted value before the rule runs and are listed.
    const override = overrides.find((o) => o.domain === store.domain);
    const overridden: string[] = [];
    const draft = { ...draftFile.draft };
    if (override?.physicalGoods !== undefined && override.physicalGoods !== draft.physicalGoods) {
      draft.physicalGoods = override.physicalGoods;
      overridden.push(`physicalGoods → ${override.physicalGoods}: ${override.reason}`);
    }
    if (override?.kind !== undefined && override.kind !== draft.kind) {
      draft.kind = override.kind;
      overridden.push(`kind → ${override.kind}: ${override.reason}`);
    }
    const verifiedFields = { ...verified.fields };
    if (override?.physicalGoods !== undefined)
      verifiedFields.physicalGoods = { verdict: 'confirmed', reason: null };
    if (override?.kind !== undefined) verifiedFields.kind = { verdict: 'confirmed', reason: null };
    const outcome = applyStore({
      domain: store.domain,
      id: store.id ?? null,
      name: researched.name,
      hosts: store.hosts ?? researched.hosts,
      draft,
      verification: verifiedFields,
      quoteVerdicts: verified.quotes,
      sources,
      issuerTexts,
      storeTexts,
    });
    // Bot-walled: no usable store page (every store-page capture missing or under 300 characters).
    const pages = sources.filter((s) => s.kind === 'store-page');
    if (!pages.some((s) => (storeTexts[s.id]?.length ?? 0) >= 300)) report.botWalled.push(store.domain);
    if (outcome.outcome === 'held-out') {
      const defunct = outcome.disputed.some((d) => d.reason !== null && DEFUNCT_WORDING.test(d.reason));
      report.heldOut.push({
        domain: store.domain,
        disputed: outcome.disputed,
        ...(defunct ? { reason: 'defunct' as const } : {}),
      });
      batch.state.stores[store.domain] = {
        ...batch.state.stores[store.domain],
        apply: 'held-out',
        heldOutFields: outcome.disputed.map((d) => d.field),
      };
      env.log(`${store.domain}: HELD OUT (${outcome.disputed.map((d) => d.field).join(', ')}).`);
      continue;
    }
    await writeJsonAtomic(join(env.root, RECORDS_DIR, `${outcome.record.id}.json`), outcome.record);
    await writeJsonAtomic(join(env.root, EVIDENCE_DIR, `${outcome.record.id}.json`), {
      ...outcome.evidence,
      batch: batch.id,
      appliedOn: today,
    });
    for (const source of outcome.cited) {
      sourcesById.set(source.id, source);
      if (source.capturedAt > newestCapture) newestCapture = source.capturedAt;
    }
    report.records.push({
      domain: store.domain,
      id: outcome.record.id,
      basis: outcome.record.evidence.basis,
      category: outcome.record.category,
      ...(outcome.downgraded ? { downgraded: outcome.downgraded } : {}),
      ...(outcome.refused ? { refused: { ...outcome.refused, notes: draftFile.draft.notes } } : {}),
      ...(outcome.conflicts.length ? { conflicts: outcome.conflicts } : {}),
      ...(draftFile.fallback ? { fallback: draftFile.fallback } : {}),
      ...(outcome.droppedHosts.length ? { droppedHosts: outcome.droppedHosts } : {}),
      ...(overridden.length ? { overridden } : {}),
    });
    if (outcome.downgraded)
      env.log(`${store.domain}: DOWNGRADED to the default category (evidence disputed).`);
    batch.state.stores[store.domain] = { ...batch.state.stores[store.domain], apply: 'record' };
    env.log(
      `${store.domain}: ${outcome.record.id} ${outcome.record.kind}, ${outcome.record.category} (${outcome.record.evidence.basis}), brands ${outcome.record.brandIds.join(', ') || 'none'}.`,
    );
  }
  // Sources no record cites any more (a re-apply downgraded a record) leave the release.
  const stillCited = new Set<string>();
  for (const name of (await readdir(join(env.root, RECORDS_DIR))).filter((n) => n.endsWith('.json'))) {
    const record = merchantRecordSchema.parse(
      JSON.parse(await readFile(join(env.root, RECORDS_DIR, name), 'utf8')),
    );
    for (const id of record.evidence.sourceIds) stillCited.add(id);
  }
  for (const id of [...sourcesById.keys()]) if (!stillCited.has(id)) sourcesById.delete(id);
  await writeJsonAtomic(join(env.root, RELEASE_CONFIG), {
    ...config,
    verifiedAt:
      newestCapture > config.verifiedAt.slice(0, 10) ? `${newestCapture}T00:00:00Z` : config.verifiedAt,
    sources: [...sourcesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  });
  await writeJsonAtomic(join(batch.dir, 'apply-report.json'), applyReportSchema.parse(report));
  const now = env.now();
  batch.state.stages.apply = {
    status: 'done',
    finishedAt: now.toISOString(),
    attempts: (batch.state.stages.apply.attempts ?? 0) + 1,
  };
  await writeState(batch.dir, batch.state, now);
  env.log(
    `apply: ${report.records.length} records written, ${report.heldOut.length} held out. Run \`pipeline merchants run build\`.`,
  );
  return 0;
}
