// Stage 5, apply (plan section 6): deterministic. The evidence rule sets `category`: the drafted candidate stays only
// with an issuer-terms quote supporting it (`issuer`), or a store-page quote plus an mcc-lookup quote (`corroborated`);
// otherwise `general-merchandise` with `default` and no sources. Any disputed field holds the whole record out of the
// release and lists it for Evan; there is no adjudicator. Records go to evals/merchants/db/records/<id>.json, quotes to
// evidence/<id>.json, cited sources to release-config.json.
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
  /\b(exclud\w*|except|excepting|excepted|exceptions?|other than|not (?:includ|qualif|eligib|earn|count)\w*|do(?:es)? not|don't|doesn't|aren't|are not|is not|isn't|ineligible|will not|only)\b/i;
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

const CLAUSE_BREAK = /[;:.]|\b(?:but|excluding|except(?:ing)?|other than|not including)\b/i;

/** An issuer quote is category evidence for `category` only when one clause of it names this store (its name or
 * domain label, on word boundaries), says purchases earn (earn, rewards, cash back, points, a rate) and names that
 * category, with no exclusion, limit or "only" wording in that clause. "3% at grocery stores including Kroger;
 * excluding warehouse clubs" counts for Kroger; "superstores like Costco excluded", "Netflix is an example of a
 * streaming service", "Costco purchases earn only 1%" and a bare "Kroger" do not. */
export function issuerQuoteEarns(quote: string, name: string, domain: string, category: string): boolean {
  const words = ISSUER_CATEGORY_WORDS[category];
  if (!words) return false;
  const normal = (s: string) => s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\u00a0/g, ' ');
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const label = domainLabel(domain);
  const names = [normal(name.trim()), ...(label.length >= 5 ? [label] : [])].map(escape);
  const named = new RegExp(`(?<![A-Za-z0-9])(?:${names.join('|')})(?![A-Za-z0-9])`, 'i');
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

/** The apply rule for one store. Pure: no files. Structured so a further basis (for example an issuer's category
 * definition plus the store's own pages) could be added where `basis` is decided. */
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
  if (candidate && candidate !== 'general-merchandise' && draft.kind !== 'processor') {
    if (kinds.has('issuer-terms')) basis = 'issuer';
    else if (kinds.has('store-page') && kinds.has('mcc-lookup')) basis = 'corroborated';
  }
  const citedIds = basis === 'default' ? [] : [...new Set(categoryQuotes.map((e) => e.sourceId))];
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
    const outcome = applyStore({
      domain: store.domain,
      id: store.id ?? null,
      name: researched.name,
      hosts: store.hosts ?? researched.hosts,
      draft: draftFile.draft,
      verification: verified.fields,
      sources: manifest.sources.filter((s) => s.domain === store.domain),
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
