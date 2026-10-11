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
  VERIFIED_FIELDS,
  applyReportSchema,
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
  sources: Pick<ManifestEntry, 'id' | 'kind' | 'url' | 'capturedOn' | 'sha256'>[];
  /** The mined issuer captures of this store (the windows around its name) by source id, for the exclusion check
   * of the `definition` basis. Absent texts count as no exclusion. */
  issuerTexts?: Record<string, string>;
}

export type ApplyOutcome =
  | {
      outcome: 'record';
      record: MerchantRecord;
      evidence: Omit<EvidenceFile, 'batch' | 'appliedOn'>;
      cited: MerchantSource[];
      /** The verifier disputed `evidence` alone: the record ships on the default category with no sources. */
      downgraded: { reason: string | null } | null;
    }
  | { outcome: 'held-out'; disputed: { field: VerifiedField | 'processor'; reason: string | null }[] };

export const recordId = (domain: string, kind: string, fixed: string | null): string =>
  fixed ?? (kind === 'processor' ? domainLabel(domain) : `${domainLabel(domain)}-us`);

/** Words that make a clause an exclusion, a limit or a base rate rather than an earning statement. */
export const EXCLUSION_WORDING =
  /\b(exclud\w*|except|excepting|excepted|exceptions?|other than|not (?:includ|qualif|eligib|earn|count)\w*|not in|do(?:es)? not|don't|doesn't|aren't|are not|is not|isn't|ineligible|will not|only)\b/i;
/** Wording that says purchases earn something. */
export const EARNING_WORDING =
  /\b(earns?|earning|rewards?|cash ?back|points?|miles|\d+(?:\.\d+)?\s?%|\d+x)\b|\d%/i;
/** Issuer category words → the merchant category they describe. Unlisted categories (general-merchandise) never
 * come from an issuer quote. */
export const ISSUER_CATEGORY_WORDS: Record<string, RegExp> = {
  supermarkets: /\b(grocer(?:y|ies)|supermarkets?)\b/i,
  dining: /\b(restaurants?|dining)\b/i,
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

/** What a store's own page says it is, per category: the issuer words plus the store-side synonyms. */
export const BUSINESS_TYPE_WORDS: Record<string, RegExp> = Object.fromEntries(
  Object.entries({
    supermarkets: /\bgrocer\b/i,
    dining: /\b(food delivery|takeout|take-out)\b/i,
    drugstores: /\bprescriptions?\b/i,
    streaming: /\bstream\b/i,
    'wholesale-clubs': /\bmembership warehouse\b/i,
    entertainment: /\b(theme parks?|live events?)\b/i,
  }).map(([category, extra]) => [
    category,
    new RegExp(`${ISSUER_CATEGORY_WORDS[category].source}|${extra.source}`, 'i'),
  ]),
);
for (const category of Object.keys(ISSUER_CATEGORY_WORDS))
  BUSINESS_TYPE_WORDS[category] ??= ISSUER_CATEGORY_WORDS[category];
/** Kinds of store the issuers' definitions exclude from a category (plan section 2, Evan 2026-10-11: superstores,
 * discount stores and warehouse clubs never get grocery). A store whose own pages call it one of these never gets the
 * category on the `definition` basis. */
export const CATEGORY_EXCLUDED_TYPES: Record<string, RegExp> = {
  supermarkets:
    /\b(superstores?|supercenters?|discount stores?|warehouse clubs?|wholesale clubs?|general merchandise|convenience stores?|department stores?)\b/i,
  drugstores:
    /\b(superstores?|supercenters?|discount stores?|warehouse clubs?|wholesale clubs?|grocer(?:y|ies)|supermarkets?)\b/i,
  dining: /\b(grocer(?:y|ies)|supermarkets?|convenience stores?)\b/i,
};
/** An issuer definition that names delivery services lets a delivery marketplace qualify (dining only). */
export const DELIVERY_WORDING = /\b(deliver(?:y|ies|ed)|takeout|take-out)\b/i;

/** Clause boundaries: a semicolon, a sentence end (a period before whitespace and a capital, not after an abbreviation
 * such as U.S., e.g., Inc.), or a word that turns the rest into an exclusion. A colon is not a boundary ("The U.S.
 * drugstore list is: CVS…" is one clause). */
const CLAUSE_BREAK =
  /;|(?<!\b(?:U\.S|U\.K|e\.g|i\.e|Inc|Co|Corp|Ltd|No|St|vs|etc))\.(?=\s+[A-Z])|\b(?:but|excluding|except(?:ing)?|other than|not including)\b/i;

const normal = (s: string) => s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\u00a0/g, ' ');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const storeNamed = (name: string, domain: string): RegExp => {
  const label = domainLabel(domain);
  const names = [normal(name.trim()), ...(label.length >= 5 ? [label] : [])].map(escape);
  return new RegExp(`(?<![A-Za-z0-9])(?:${names.join('|')})(?![A-Za-z0-9])`, 'i');
};

/** An issuer quote is category evidence for `category` only when one clause of it names this store (its name or
 * domain label, on word boundaries), says purchases earn (earn, rewards, cash back, points, a rate) and names that
 * category, with no exclusion, limit or "only" wording in that clause. "3% at grocery stores including Kroger;
 * excluding warehouse clubs" counts for Kroger; "superstores like Costco excluded", "Netflix is an example of a
 * streaming service", "Costco purchases earn only 1%" and a bare "Kroger" do not. */
export function issuerQuoteEarns(quote: string, name: string, domain: string, category: string): boolean {
  const words = ISSUER_CATEGORY_WORDS[category];
  if (!words) return false;
  const named = storeNamed(name, domain);
  // Clauses are joined to the one before them when they only continue the list ("Kroger, Meijer").
  return normal(quote)
    .split(CLAUSE_BREAK)
    .some(
      (clause) =>
        named.test(clause) &&
        EARNING_WORDING.test(clause) &&
        words.test(clause) &&
        !EXCLUSION_WORDING.test(clause),
    );
}

/** Sentence boundaries for the exclusion check: a semicolon, a blank line or a sentence end; exclusion words do not
 * split, because the exclusion must be read with what it excludes. */
const SENTENCE_BREAK = /;|\n\s*\n|(?<!\b(?:U\.S|U\.K|e\.g|i\.e|Inc|Co|Corp|Ltd|No|St|vs|etc))\.(?=\s+[A-Z])/;

/** An issuer quote is a category definition covering a business type when one clause of it names the category's
 * issuer words with no exclusion, limit or "only" wording ("grocery stores and supermarkets"; "restaurants, including
 * takeout and delivery services"). "Merchants not in the grocery category include wholesale clubs" is not. */
export function definitionQuoteCovers(quote: string, category: string): boolean {
  const words = ISSUER_CATEGORY_WORDS[category];
  if (!words) return false;
  return normal(quote)
    .split(CLAUSE_BREAK)
    .some((clause) => words.test(clause) && !EXCLUSION_WORDING.test(clause));
}

/** A store-page quote shows the business type when it names the category's words ("Grocery Pickup", "home
 * improvement stores") and no kind of store the category excludes ("membership warehouse club" for supermarkets). */
export function storePageShowsType(quote: string, category: string): boolean {
  const words = BUSINESS_TYPE_WORDS[category];
  if (!words) return false;
  const excluded = CATEGORY_EXCLUDED_TYPES[category];
  return words.test(quote) && !(excluded && excluded.test(quote));
}

/** An issuer capture excludes this store from the category when one sentence names the store, has exclusion wording
 * and names the category or a kind of store the category excludes ("purchases at discount stores like Walmart,
 * Target and Costco do not qualify"; "Grocery stores, excluding Walmart and Target"). Conservative: "3% at grocery
 * stores including Kroger, excluding warehouse clubs" in one sentence also counts against Kroger. */
export function issuerExcludes(text: string, name: string, domain: string, category: string): boolean {
  const words = ISSUER_CATEGORY_WORDS[category];
  if (!words) return false;
  const named = storeNamed(name, domain);
  const types = CATEGORY_EXCLUDED_TYPES[category];
  return normal(text)
    .split(SENTENCE_BREAK)
    .some(
      (sentence) =>
        named.test(sentence) &&
        EXCLUSION_WORDING.test(sentence) &&
        (words.test(sentence) || (types !== undefined && types.test(sentence))),
    );
}

/** The `definition` basis (Evan 2026-10-11): the store's own page shows its business type, an issuer's category
 * definition covers that type, no issuer capture excludes the store or its kind of store from the category, and the
 * store sells directly (a marketplace only for `dining` under a definition that names delivery services). Returns the
 * source ids to cite, or null. */
export function definitionBasis(input: ApplyInput, category: string): string[] | null {
  const { draft } = input;
  if (draft.kind === 'processor') return null;
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const kindOf = (id: string) => byId.get(id)?.kind;
  const storeQuotes = draft.evidence.filter(
    (e) =>
      e.supports === 'category' &&
      kindOf(e.sourceId) === 'store-page' &&
      storePageShowsType(e.quote, category),
  );
  let definitions = draft.evidence.filter(
    (e) =>
      e.supports === 'definition' &&
      kindOf(e.sourceId) === 'issuer-terms' &&
      definitionQuoteCovers(e.quote, category),
  );
  if (draft.kind === 'marketplace')
    definitions = category === 'dining' ? definitions.filter((e) => DELIVERY_WORDING.test(e.quote)) : [];
  if (!storeQuotes.length || !definitions.length) return null;
  const excludedType = CATEGORY_EXCLUDED_TYPES[category];
  if (
    excludedType &&
    draft.evidence.some((e) => kindOf(e.sourceId) === 'store-page' && excludedType.test(e.quote))
  )
    return null;
  for (const [id, text] of Object.entries(input.issuerTexts ?? {}))
    if (kindOf(id) === 'issuer-terms' && issuerExcludes(text, input.name, input.domain, category))
      return null;
  return [...new Set([...storeQuotes, ...definitions].map((e) => e.sourceId))];
}

/** The apply rule for one store. Pure: no files. `basis` is decided in one place. */
export function applyStore(input: ApplyInput): ApplyOutcome {
  const disputed = VERIFIED_FIELDS.filter(
    (f) => f !== 'evidence' && input.verification[f].verdict === 'disputed',
  ).map((field) => ({
    field: field as VerifiedField | 'processor',
    reason: input.verification[field].reason,
  }));
  const { draft } = input;
  if (draft.kind === 'processor' && (draft.physicalGoods || draft.brandIds.length))
    disputed.push({ field: 'processor', reason: 'a processor sells no physical goods and has no brands' });
  if (disputed.length) return { outcome: 'held-out', disputed };
  const evidenceDisputed = input.verification.evidence.verdict === 'disputed';
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const candidate = draft.candidateCategory;
  const categoryQuotes = evidenceDisputed
    ? []
    : draft.evidence.filter(
        (e) =>
          e.supports === 'category' &&
          byId.has(e.sourceId) &&
          (byId.get(e.sourceId)!.kind !== 'issuer-terms' ||
            (candidate !== null && issuerQuoteEarns(e.quote, input.name, input.domain, candidate))),
      );
  const kinds = new Set(categoryQuotes.map((e) => byId.get(e.sourceId)!.kind));
  let basis: MerchantRecord['evidence']['basis'] = 'default';
  let citedIds: string[] = [];
  if (candidate && candidate !== 'general-merchandise' && draft.kind !== 'processor') {
    if (kinds.has('issuer-terms')) basis = 'issuer';
    else if (kinds.has('store-page') && kinds.has('mcc-lookup')) basis = 'corroborated';
    if (basis !== 'default') citedIds = [...new Set(categoryQuotes.map((e) => e.sourceId))];
    else if (!evidenceDisputed) {
      const definition = definitionBasis(input, candidate);
      if (definition) {
        basis = 'definition';
        citedIds = definition;
      }
    }
  }
  const record = merchantRecordSchema.parse({
    id: recordId(input.domain, draft.kind, input.id),
    name: input.name,
    hosts: input.hosts,
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
      quotes: evidenceDisputed
        ? []
        : draft.evidence
            .filter((e) => byId.has(e.sourceId))
            .map((e) => ({
              sourceId: e.sourceId,
              kind: byId.get(e.sourceId)!.kind,
              supports: e.supports,
              quote: e.quote,
            })),
    },
    cited,
    downgraded: evidenceDisputed ? { reason: input.verification.evidence.reason } : null,
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
    }[],
    heldOut: [] as { domain: string; disputed: { field: string; reason: string | null }[] }[],
  };
  const sourcesById = new Map(config.sources.map((s) => [s.id, s]));
  let newestCapture = config.verifiedAt.slice(0, 10);
  for (const store of batch.meta.stores) {
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
    const issuerTexts: Record<string, string> = {};
    for (const source of sources.filter((s) => s.kind === 'issuer-terms')) {
      const dir = join(batch.dir, 'captures');
      const text = await readFile(join(dir, `${source.id}.windows.${store.domain}.txt`), 'utf8').catch(() =>
        readFile(join(dir, `${source.id}.txt`), 'utf8').catch(() => null),
      );
      if (text !== null) issuerTexts[source.id] = text;
    }
    const outcome = applyStore({
      domain: store.domain,
      id: store.id ?? null,
      name: researched.name,
      hosts: store.hosts ?? researched.hosts,
      draft: draftFile.draft,
      verification: verified.fields,
      sources,
      issuerTexts,
    });
    if (outcome.outcome === 'held-out') {
      report.heldOut.push({ domain: store.domain, disputed: outcome.disputed });
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
