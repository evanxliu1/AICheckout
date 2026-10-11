// Phase 14.5, step 6: apply the adjudicated disagreements to the release (plan section 7: fixes after the report
// records the pre-fix numbers). Deterministic: for every decision whose verdict is `auditor`, the record takes the
// auditor's value; a bonus category added this way cites the sources of the auditor's category and definition quotes
// (entries from the batch manifests) and its evidence file holds the auditor's quotes; a refused bonus falls to
// `general-merchandise`, `default`, no sources. `release-config.json` gains the new cited sources, loses the ones no
// record cites, and takes the new version. Every change is listed in fixes.json (review.md shows them).
//
//   node evals/merchants/db/audit/apply-adjudication.mjs --version 2026-10-11.audit.1
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DB = join(ROOT, 'evals/merchants/db');
const AUDIT = join(DB, 'audit');
const BATCH = 'audit-2026-10';
const SUPPORTS = new Set(['kind', 'physicalGoods', 'brand', 'category', 'definition']);

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

async function manifestSources() {
  const byId = new Map();
  for (const batch of (await readdir(join(DB, 'batches'))).sort()) {
    const manifest = await readJson(join(DB, 'batches', batch, 'manifest.json')).catch(() => null);
    for (const s of manifest?.sources ?? []) if (!byId.has(s.id)) byId.set(s.id, s);
  }
  return byId;
}

export async function main(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--version');
  if (at < 0) throw new Error('--version <YYYY-MM-DD.tag.n> is required');
  const version = argv[at + 1];
  const today = new Date().toISOString().slice(0, 10);
  const adjudication = await readJson(join(AUDIT, 'adjudication.json'));
  const comparison = await readJson(join(AUDIT, 'comparison.json'));
  const labels = new Map();
  for (const name of (await readdir(join(AUDIT, 'labels'))).filter((n) => /^packet-\d+\.json$/.test(n)))
    for (const s of (await readJson(join(AUDIT, 'labels', name))).stores) labels.set(s.domain, s);
  const sources = await manifestSources();
  const config = await readJson(join(DB, 'release-config.json'));
  const fixes = [];
  for (const decision of adjudication.decisions) {
    if (decision.verdict !== 'auditor') continue;
    const d = comparison.disagreements.find((x) => x.domain === decision.domain && x.field === decision.field);
    if (!d) throw new Error(`no disagreement for ${decision.domain} ${decision.field}`);
    const label = labels.get(decision.domain);
    const recordPath = join(DB, 'records', `${d.recordId}.json`);
    const record = await readJson(recordPath);
    const before = JSON.stringify(record);
    if (decision.field === 'category') {
      const bonus = label.category !== 'general-merchandise';
      const quotes = label.quotes
        .filter((q) => SUPPORTS.has(q.supports) && sources.has(q.source))
        .map((q) => ({ sourceId: q.source, kind: sources.get(q.source).kind, supports: q.supports, quote: q.quote }));
      let cited = [];
      if (bonus) {
        const wanted =
          label.basis === 'definition'
            ? quotes.filter((q) => (q.supports === 'category' && q.kind === 'store-page') || (q.supports === 'definition' && q.kind === 'issuer-terms'))
            : quotes.filter((q) => q.supports === 'category' && q.kind === (label.basis === 'issuer' ? 'issuer-terms' : q.kind));
        cited = [...new Set(wanted.map((q) => q.sourceId))];
        if (!cited.length) throw new Error(`${decision.domain}: no citable source for ${label.category} (${label.basis})`);
      }
      record.category = bonus ? label.category : 'general-merchandise';
      record.evidence = { basis: bonus ? label.basis : 'default', sourceIds: cited };
      const evidencePath = join(DB, 'evidence', `${record.id}.json`);
      const existing = await readJson(evidencePath).catch(() => null);
      await writeJson(evidencePath, {
        schemaVersion: 1,
        id: record.id,
        basis: record.evidence.basis,
        quotes: bonus ? quotes : (existing?.quotes ?? []),
        batch: BATCH,
        appliedOn: today,
      });
      for (const id of cited) {
        const s = sources.get(id);
        if (!config.sources.some((c) => c.id === id))
          config.sources.push({ id, url: s.url, kind: s.kind, capturedAt: s.capturedOn, sha256: s.sha256 });
      }
    } else if (decision.field === 'brandIds') record.brandIds = [...label.brandIds];
    else if (decision.field === 'kind') record.kind = label.kind;
    else if (decision.field === 'physicalGoods') record.physicalGoods = label.physicalGoods;
    if (JSON.stringify(record) === before) continue;
    await writeJson(recordPath, record);
    fixes.push({ release: version, id: record.id, domain: decision.domain, field: decision.field, from: d.record, to: d.auditor, reason: decision.reason });
  }
  // Sources no record cites any more leave the release.
  const cited = new Set();
  for (const name of (await readdir(join(DB, 'records'))).filter((n) => n.endsWith('.json')))
    for (const id of (await readJson(join(DB, 'records', name))).evidence.sourceIds) cited.add(id);
  config.sources = config.sources.filter((s) => cited.has(s.id)).sort((a, b) => a.id.localeCompare(b.id));
  config.version = version;
  const newest = config.sources.reduce((m, s) => (s.capturedAt > m ? s.capturedAt : m), config.verifiedAt.slice(0, 10));
  if (newest > config.verifiedAt.slice(0, 10)) config.verifiedAt = `${newest}T00:00:00Z`;
  await writeJson(join(DB, 'release-config.json'), config);
  const previous = await readJson(join(AUDIT, 'fixes.json')).catch(() => ({ schemaVersion: 1, fixes: [] }));
  await writeJson(join(AUDIT, 'fixes.json'), { schemaVersion: 1, fixes: [...previous.fixes, ...fixes] });
  console.log(`${fixes.length} records changed for ${version}; ${config.sources.length} cited sources. Run npm run merchants and pipeline merchants review.`);
  for (const f of fixes) console.log(`  ${f.id}: ${f.field} ${f.from} → ${f.to}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
