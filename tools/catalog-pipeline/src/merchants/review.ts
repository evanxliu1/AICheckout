// Stage 6, build: `npm run merchants` (scripts/build-merchants-v1.mjs) and evals/merchants/db/review.md, the table Evan
// reads: only the deviations from the default (bonus categories with their evidence quotes, brands, processors,
// physicalGoods false, disabled, held-out records). Default records are counted, not listed.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { merchantRecordSchema } from '../../../../packages/rewards-core/src/merchant-release.ts';
import type { MerchantRecord } from '../../../../packages/rewards-core/src/types.ts';
import type { Env } from '../run.ts';
import { refusedLookup } from './apply.ts';
import { MCC_RESULTS, MIN_ROWS, mccResultsSchema } from './mcc.ts';
import type { MccResults } from './mcc.ts';
import {
  AUDIT_FIXES_FILE,
  BATCHES_DIR,
  EVIDENCE_DIR,
  OVERRIDES_FILE,
  RECORDS_DIR,
  RELEASE_CONFIG,
  REVIEW_FILE,
  applyReportSchema,
  auditFixesFileSchema,
  evidenceFileSchema,
  loadBatch,
  overridesFileSchema,
  readJson,
  readJsonOrNull,
  releaseConfigSchema,
  writeState,
} from './files.ts';
import type { ApplyReport, EvidenceFile } from './files.ts';

export interface ReviewInput {
  version: string;
  verifiedAt: string;
  records: MerchantRecord[];
  evidence: Map<string, EvidenceFile>;
  heldOut: {
    batch: string;
    domain: string;
    disputed: { field: string; reason: string | null }[];
    reason?: 'defunct' | 'out-of-scope';
  }[];
  /** Stores whose own pages were bot-walled: name and hosts rest on research and issuer captures. */
  botWalled: { batch: string; domain: string }[];
  /** Default records built from research after three failed draft gates, and hosts dropped on the verifier's word. */
  fallbacks: { batch: string; domain: string; id: string }[];
  droppedHosts: { batch: string; domain: string; id: string; hosts: string[] }[];
  /** Coordinator field corrections applied (overrides.json) and notes for Evan. */
  overridden: { batch: string; domain: string; id: string; changes: string[] }[];
  notes: string[];
  /** Records changed by the blind audit's adjudication (evals/merchants/db/audit/fixes.json, Phase 14.5). */
  fixes?: { release: string; id: string; field: string; from: string; to: string; reason: string }[];
  /** The `mcc` basis run (evals/merchants/db/mcc/results.json, 2026-10-11): every store with matched rows. */
  mcc?: MccResults;
  downgraded: { batch: string; domain: string; id: string; reason: string | null }[];
  /** Drafted candidates the evidence rule refused, with the rule's reason and the drafter's notes (conflicts such as
   * an issuer listing the store under another category show here). */
  refused: {
    batch: string;
    domain: string;
    id: string;
    candidate: string;
    reason: string;
    notes: string | null;
  }[];
  /** Granted categories another issuer contradicts (excludes the store or lists it elsewhere); the record follows
   * the rule. */
  conflicts: { batch: string; domain: string; id: string; category: string; conflict: string }[];
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The MCC evidence section: every store with at least MIN_ROWS matched rows in the public card-transaction
 * datasets (store, rows, dominant category and share, minority codes, cross-issuer conflicts, outcome), stores with
 * fewer rows counted. The datasets are in-person and card-not-present government purchasing, disclosed here. */
export function mccSection(mcc: MccResults | undefined): string[] {
  if (!mcc) return [];
  const listed = mcc.stores.filter((s) => s.usable >= MIN_ROWS);
  const few = mcc.stores.length - listed.length;
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  const conflicts = (s: MccResults['stores'][number]) =>
    [
      ...s.conflicts.map(
        (c) =>
          `${c.description}${c.code ? ` (${c.code}` : ' ('}${c.category === 'general-merchandise' ? '' : `, ${c.category}`}) ×${c.rows}`,
      ),
      ...s.issuerConflicts.map((c) => `issuer: ${c}`),
    ].join('<br>');
  return [
    `## MCC evidence: public card-transaction datasets, for Evan (${listed.length} stores with ${MIN_ROWS}+ rows; ${mcc.stores.filter((s) => s.outcome === 'granted').length} granted)`,
    '',
    `Run ${mcc.appliedOn} on ${mcc.datasets.map((d) => `${d.id} (${d.rows.toLocaleString('en-US')} rows)`).join(', ')}: openly licensed government purchase-card transactions (in-person and card-not-present government purchasing, not consumer online checkout). A store's rows are those whose merchant descriptor matches its committed descriptor rule (mcc/descriptors.json); fuel rows of a separate code are set aside; a category is granted at ${MIN_ROWS}+ rows with one category holding 80%+ of them, mapped through mcc/codes.json (Visa Merchant Data Standards Manual, April 2026). \`issuer\` evidence outranks the data (kept-issuer); a marketplace gets dining only; the store's own pages or the coordinator may veto. ${few} more stores matched fewer than ${MIN_ROWS} rows and are not listed; ${mcc.unmatched} records matched no row.`,
    '',
    '| Record | Rows (usable) | Dominant category | Share | Minority codes and issuer conflicts | Outcome |',
    '| --- | --- | --- | --- | --- | --- |',
    ...listed.map(
      (s) =>
        `| ${s.id} | ${s.rows} (${s.usable}${s.fuelRows ? `, ${s.fuelRows} fuel set aside` : ''}) | ${s.dominant?.category ?? ''}${s.dominant?.code ? ` (${s.dominant.code})` : ''} | ${s.dominant ? pct(s.dominant.share) : ''} | ${cell(conflicts(s))} | ${s.outcome}${s.reason ? `: ${cell(s.reason)}` : ''}${s.changed ? ` (was ${s.previous.category}, ${s.previous.basis})` : ''} |`,
    ),
    '',
  ];
}

export function reviewMarkdown(input: ReviewInput): string {
  const sorted = [...input.records].sort((a, b) => a.id.localeCompare(b.id));
  const categories = sorted.filter((r) => r.evidence.basis !== 'default');
  const brands = sorted.filter((r) => r.brandIds.length);
  const processors = sorted.filter((r) => r.kind === 'processor');
  const services = sorted.filter((r) => !r.physicalGoods && r.kind !== 'processor');
  const disabled = sorted.filter((r) => r.disabled);
  const defaults = sorted.filter(
    (r) =>
      r.evidence.basis === 'default' &&
      !r.brandIds.length &&
      r.kind === 'merchant' &&
      r.physicalGoods &&
      !r.disabled,
  );
  const lines = [
    `# Merchant release review: ${input.version}`,
    '',
    `Generated by \`pipeline merchants run build\`; deviations from the default record only (plan section 6). ${sorted.length} records, verified ${input.verifiedAt.slice(0, 10)}; ${defaults.length} are plain default records (merchant, physical goods, general-merchandise, no brands) and are not listed.`,
    '',
    `## Bonus categories (${categories.length})`,
    '',
    '| Record | Hosts | Category | Basis | Evidence (source: quote) |',
    '| --- | --- | --- | --- | --- |',
    ...categories.map((r) => {
      // Only the cited sources' quotes: a definition record shows its store-page and issuer definition quotes.
      const quotes = (input.evidence.get(r.id)?.quotes ?? [])
        .filter((q) => r.evidence.sourceIds.includes(q.sourceId))
        .filter((q) => q.supports === 'category' || q.supports === 'definition')
        .map(
          (q) =>
            `${q.sourceId} (${q.kind}${q.supports === 'definition' ? ', definition' : ''}): "${cell(q.quote)}"`,
        )
        .join('<br>');
      return `| ${r.id} | ${r.hosts.join(', ')} | ${r.category} | ${r.evidence.basis} | ${quotes} |`;
    }),
    '',
    `## Brands (${brands.length})`,
    '',
    '| Record | Hosts | Brands |',
    '| --- | --- | --- |',
    ...brands.map((r) => `| ${r.id} | ${r.hosts.join(', ')} | ${r.brandIds.join(', ')} |`),
    '',
    `## Processors (${processors.length})`,
    '',
    '| Record | Hosts |',
    '| --- | --- |',
    ...processors.map((r) => `| ${r.id} | ${r.hosts.join(', ')} |`),
    '',
    `## Services, no physical goods (${services.length})`,
    '',
    '| Record | Hosts | Kind |',
    '| --- | --- | --- |',
    ...services.map((r) => `| ${r.id} | ${r.hosts.join(', ')} | ${r.kind} |`),
    '',
    `## Disabled (${disabled.length})`,
    '',
    ...(disabled.length ? disabled.map((r) => `- ${r.id}`) : ['None.']),
    '',
    `## Downgraded to the default category: evidence disputed, for Evan (${input.downgraded.length})`,
    '',
    "| Batch | Store | Record | Verifier's reason |",
    '| --- | --- | --- | --- |',
    ...input.downgraded.map((d) => `| ${d.batch} | ${d.domain} | ${d.id} | ${cell(d.reason ?? '')} |`),
    '',
    `## Candidates the evidence rule refused, for Evan (${input.refused.length})`,
    '',
    "| Batch | Store | Record | Candidate | Rule's reason | Drafter's notes |",
    '| --- | --- | --- | --- | --- | --- |',
    ...input.refused.map(
      (r) =>
        `| ${r.batch} | ${r.domain} | ${r.id} | ${r.candidate} | ${cell(r.reason)} | ${cell(r.notes ?? '')} |`,
    ),
    '',
    `## Conflicts: a granted category another issuer contradicts, for Evan (${input.conflicts.length})`,
    '',
    '| Batch | Store | Record | Category | Issuer sentence |',
    '| --- | --- | --- | --- | --- |',
    ...input.conflicts.map(
      (c) => `| ${c.batch} | ${c.domain} | ${c.id} | ${c.category} | ${cell(c.conflict)} |`,
    ),
    '',
    `## Bot-walled stores: name and hosts from research and issuer captures (${input.botWalled.length})`,
    '',
    ...(input.botWalled.length ? input.botWalled.map((b) => `- ${b.batch}: ${b.domain}`) : ['None.']),
    '',
    `## Default records from research after three failed draft gates (${input.fallbacks.length})`,
    '',
    ...(input.fallbacks.length
      ? input.fallbacks.map((f) => `- ${f.batch}: ${f.domain} (${f.id})`)
      : ['None.']),
    '',
    `## Coordinator field corrections (overrides.json) (${input.overridden.length})`,
    '',
    ...(input.overridden.length
      ? input.overridden.map((o) => `- ${o.batch}: ${o.id}: ${cell(o.changes.join('; '))}`)
      : ['None.']),
    '',
    `## Audit fixes: records changed on the blind audit's adjudication (${input.fixes?.length ?? 0})`,
    '',
    ...(input.fixes?.length
      ? [
          '| Release | Record | Field | Before | After | Adjudicator |',
          '| --- | --- | --- | --- | --- | --- |',
          ...input.fixes.map(
            (f) =>
              `| ${f.release} | ${f.id} | ${f.field} | ${cell(f.from)} | ${cell(f.to)} | ${cell(f.reason)} |`,
          ),
        ]
      : ['None.']),
    '',
    ...mccSection(input.mcc),
    `## Notes for Evan (${input.notes.length})`,
    '',
    ...(input.notes.length ? input.notes.map((n) => `- ${cell(n)}`) : ['None.']),
    '',
    `## Hosts dropped on the verifier's word (${input.droppedHosts.length})`,
    '',
    ...(input.droppedHosts.length
      ? input.droppedHosts.map((d) => `- ${d.batch}: ${d.id} dropped ${d.hosts.join(', ')}`)
      : ['None.']),
    '',
    `## Excluded: defunct, parked or typo domains, or out of scope (${input.heldOut.filter((h) => h.reason).length})`,
    '',
    ...(input.heldOut.some((h) => h.reason)
      ? input.heldOut
          .filter((h) => h.reason)
          .map((h) => `- ${h.batch}: ${h.domain} (${h.reason}: ${cell(h.disputed[0]?.reason ?? '')})`)
      : ['None.']),
    '',
    `## Held out: disputed fields, for Evan (${input.heldOut.filter((h) => !h.reason).length})`,
    '',
    "| Batch | Store | Field | Verifier's reason |",
    '| --- | --- | --- | --- |',
    ...input.heldOut
      .filter((h) => !h.reason)
      .flatMap((h) =>
        h.disputed.map((d) => `| ${h.batch} | ${h.domain} | ${d.field} | ${cell(d.reason ?? '')} |`),
      ),
    '',
  ];
  return lines.join('\n');
}

export async function collectReview(root: string): Promise<ReviewInput> {
  const config = await readJson(join(root, RELEASE_CONFIG), releaseConfigSchema);
  const records: MerchantRecord[] = [];
  for (const name of (await readdir(join(root, RECORDS_DIR))).filter((n) => n.endsWith('.json')).sort())
    records.push(
      merchantRecordSchema.parse(JSON.parse(await readFile(join(root, RECORDS_DIR, name), 'utf8'))),
    );
  const evidence = new Map<string, EvidenceFile>();
  for (const name of (await readdir(join(root, EVIDENCE_DIR)).catch(() => [] as string[])).filter((n) =>
    n.endsWith('.json'),
  )) {
    const file = evidenceFileSchema.parse(JSON.parse(await readFile(join(root, EVIDENCE_DIR, name), 'utf8')));
    evidence.set(file.id, file);
  }
  const heldOut: ReviewInput['heldOut'] = [];
  const downgraded: ReviewInput['downgraded'] = [];
  const refused: ReviewInput['refused'] = [];
  const conflicts: ReviewInput['conflicts'] = [];
  const botWalled: ReviewInput['botWalled'] = [];
  const fallbacks: ReviewInput['fallbacks'] = [];
  const droppedHosts: ReviewInput['droppedHosts'] = [];
  const overridden: ReviewInput['overridden'] = [];
  const notes = (await readJsonOrNull(join(root, OVERRIDES_FILE), overridesFileSchema))?.notes ?? [];
  const fixes = (await readJsonOrNull(join(root, AUDIT_FIXES_FILE), auditFixesFileSchema))?.fixes ?? [];
  for (const batch of (await readdir(join(root, BATCHES_DIR)).catch(() => [] as string[])).sort()) {
    const report: ApplyReport | null = await readJsonOrNull(
      join(root, BATCHES_DIR, batch, 'apply-report.json'),
      applyReportSchema,
    );
    for (const h of report?.heldOut ?? [])
      heldOut.push({
        batch,
        domain: h.domain,
        disputed: h.disputed,
        ...(h.reason ? { reason: h.reason } : {}),
      });
    for (const domain of report?.botWalled ?? []) botWalled.push({ batch, domain });
    for (const r of report?.records ?? []) {
      if (r.downgraded) downgraded.push({ batch, domain: r.domain, id: r.id, reason: r.downgraded.reason });
      if (r.refused) refused.push({ batch, domain: r.domain, id: r.id, ...r.refused });
      for (const conflict of r.conflicts ?? [])
        conflicts.push({ batch, domain: r.domain, id: r.id, category: r.category, conflict });
      if (r.fallback) fallbacks.push({ batch, domain: r.domain, id: r.id });
      if (r.droppedHosts?.length)
        droppedHosts.push({ batch, domain: r.domain, id: r.id, hosts: r.droppedHosts });
      if (r.overridden?.length) overridden.push({ batch, domain: r.domain, id: r.id, changes: r.overridden });
    }
  }
  const forum = config.sources.filter((s) => s.kind === 'mcc-lookup' && refusedLookup(s.url));
  if (forum.length)
    throw new Error(
      `forum threads and deep-link-forbidding hosts are no merchant-code lookups: ${forum.map((s) => s.id).join(', ')}`,
    );
  const mcc = await readJsonOrNull(join(root, MCC_RESULTS), mccResultsSchema);
  return {
    version: config.version,
    verifiedAt: config.verifiedAt,
    records,
    evidence,
    heldOut,
    downgraded,
    refused,
    conflicts,
    botWalled,
    fallbacks,
    droppedHosts,
    overridden,
    notes,
    fixes,
    ...(mcc ? { mcc } : {}),
  };
}

export async function runBuild(env: Env, batchId?: string): Promise<number> {
  // Refuses a release that cites a forum thread as a lookup before anything is written.
  const review = await collectReview(env.root);
  const code = await env.exec('node', ['scripts/build-merchants-v1.mjs']);
  if (code !== 0) {
    env.log('build: the release is invalid; fix the records first.');
    return code;
  }
  await writeFile(join(env.root, REVIEW_FILE), reviewMarkdown(review));
  env.log(`Wrote ${REVIEW_FILE}.`);
  if (batchId) {
    const batch = await loadBatch(env.root, batchId);
    const now = env.now();
    batch.state.stages.build = { status: 'done', finishedAt: now.toISOString() };
    await writeState(batch.dir, batch.state, now);
  }
  return 0;
}
