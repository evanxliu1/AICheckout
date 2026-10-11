// Stage 5, apply (plan section 6): deterministic. The evidence rule sets `category`: the drafted candidate stays only
// with an issuer-terms quote supporting it (`issuer`), or a store-page quote plus an mcc-lookup quote (`corroborated`);
// otherwise `general-merchandise` with `default` and no sources. Any disputed field holds the whole record out of the
// release and lists it for Evan; there is no adjudicator. Records go to evals/merchants/db/records/<id>.json, quotes to
// evidence/<id>.json, cited sources to release-config.json.
import { readFile } from 'node:fs/promises';
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
    }
  | { outcome: 'held-out'; disputed: { field: VerifiedField | 'processor'; reason: string | null }[] };

export const recordId = (domain: string, kind: string, fixed: string | null): string =>
  fixed ?? (kind === 'processor' ? domainLabel(domain) : `${domainLabel(domain)}-us`);

/** The apply rule for one store. Pure: no files. */
export function applyStore(input: ApplyInput): ApplyOutcome {
  const disputed = VERIFIED_FIELDS.filter((f) => input.verification[f].verdict === 'disputed').map(
    (field) => ({
      field: field as VerifiedField | 'processor',
      reason: input.verification[field].reason,
    }),
  );
  const { draft } = input;
  if (draft.kind === 'processor' && (draft.physicalGoods || draft.brandIds.length))
    disputed.push({ field: 'processor', reason: 'a processor sells no physical goods and has no brands' });
  if (disputed.length) return { outcome: 'held-out', disputed };
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const categoryQuotes = draft.evidence.filter((e) => e.supports === 'category' && byId.has(e.sourceId));
  const kinds = new Set(categoryQuotes.map((e) => byId.get(e.sourceId)!.kind));
  let basis: MerchantRecord['evidence']['basis'] = 'default';
  if (
    draft.candidateCategory &&
    draft.candidateCategory !== 'general-merchandise' &&
    draft.kind !== 'processor'
  ) {
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
    category: basis === 'default' ? 'general-merchandise' : draft.candidateCategory,
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
      quotes: draft.evidence
        .filter((e) => byId.has(e.sourceId))
        .map((e) => ({
          sourceId: e.sourceId,
          kind: byId.get(e.sourceId)!.kind,
          supports: e.supports,
          quote: e.quote,
        })),
    },
    cited,
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
    records: [] as { domain: string; id: string; basis: string; category: string }[],
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
    });
    batch.state.stores[store.domain] = { ...batch.state.stores[store.domain], apply: 'record' };
    env.log(
      `${store.domain}: ${outcome.record.id} ${outcome.record.kind}, ${outcome.record.category} (${outcome.record.evidence.basis}), brands ${outcome.record.brandIds.join(', ') || 'none'}.`,
    );
  }
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
