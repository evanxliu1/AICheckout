// Phase 14.5 blind audit, step 3: compare the auditor's labels with the release deterministically (plan section 7).
//
//   node evals/merchants/db/audit/score.mjs
//
// Reads population.json, release.json, the committed evidence files, labels/packet-*.json (each re-checked with the
// labels gate when its packet directory is present) and, when it exists, adjudication.json (a third agent's verdict on
// every disagreement). Writes comparison.json (counts before and after adjudication, exact one-sided 95%
// Clopper–Pearson upper bounds, every disagreement) and adjudication-input.json (both sides' quotes for the
// adjudicator). Quotes in these files are the auditor's and the evidence files' (25 words or fewer each).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clopperPearsonUpper } from '../../../reader/stats.mjs';
import { checkLabels, loadPacket } from './check-labels.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DB = join(ROOT, 'evals/merchants/db');
const AUDIT = join(DB, 'audit');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const readJsonOrNull = (path) => readJson(path).catch(() => null);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const round = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);
const bound = (x, n) => (n ? { x, n, rate: round(x / n), upper95: round(clopperPearsonUpper(x, n)) } : { x: 0, n: 0, rate: null, upper95: null });

/** The disagreements of one store: record vs auditor on category, brands, kind and goods. */
export function compareStore(record, label) {
  const out = [];
  const bonusRecord = record.category !== 'general-merchandise';
  const bonusAuditor = label.category !== 'general-merchandise' && label.category !== 'cant-tell';
  if (bonusRecord && label.category !== record.category)
    out.push({
      field: 'category',
      type: 'wrong-bonus',
      subtype: label.category === 'cant-tell' ? 'cant-tell' : bonusAuditor ? 'different' : 'unsupported',
      record: `${record.category} (${record.evidence.basis})`,
      auditor: label.category === 'cant-tell' ? 'cant-tell' : `${label.category} (${label.basis})`,
    });
  if (!bonusRecord && bonusAuditor)
    out.push({
      field: 'category',
      type: 'missed-bonus',
      subtype: 'auditor-bonus',
      record: `${record.category} (${record.evidence.basis})`,
      auditor: `${label.category} (${label.basis})`,
    });
  if (label.brandIds !== 'cant-tell' && !same(record.brandIds, label.brandIds))
    out.push({
      field: 'brandIds',
      type: 'wrong-brand',
      subtype: record.brandIds.every((b) => label.brandIds.includes(b)) ? 'auditor-adds' : label.brandIds.every((b) => record.brandIds.includes(b)) ? 'auditor-drops' : 'different',
      record: record.brandIds.join(', ') || '(none)',
      auditor: label.brandIds.join(', ') || '(none)',
    });
  if (label.kind !== 'cant-tell' && label.kind !== record.kind)
    out.push({ field: 'kind', type: 'wrong-kind', subtype: 'different', record: record.kind, auditor: label.kind });
  if (label.physicalGoods !== 'cant-tell' && label.physicalGoods !== record.physicalGoods)
    out.push({ field: 'physicalGoods', type: 'wrong-goods', subtype: 'different', record: String(record.physicalGoods), auditor: String(label.physicalGoods) });
  return out;
}

/** Whether a disagreement still counts against the record after the adjudicator's verdict. A record error stands
 * when the adjudicator sides with the auditor or with neither (the record asserted something that does not hold); a
 * missed bonus stands only when the adjudicator sides with the auditor. Without a verdict the disagreement stands. */
export function standsAfter(disagreement, verdict) {
  if (!verdict) return true;
  if (disagreement.type === 'missed-bonus') return verdict === 'auditor';
  return verdict !== 'record';
}

export async function score() {
  const population = await readJson(join(AUDIT, 'population.json'));
  const release = await readJson(join(DB, 'release.json'));
  const records = new Map(release.merchants.map((r) => [r.id, r]));
  const adjudication = await readJsonOrNull(join(AUDIT, 'adjudication.json'));
  const verdicts = new Map((adjudication?.decisions ?? []).map((d) => [`${d.domain}|${d.field}`, d]));
  const labels = new Map();
  const auditorModels = new Set();
  const gateErrors = [];
  for (const name of (await readdir(join(AUDIT, 'labels')).catch(() => [])).filter((n) => /^packet-\d+\.json$/.test(n)).sort()) {
    const file = await readJson(join(AUDIT, 'labels', name));
    auditorModels.add(file.auditor?.model);
    const packetDir = join(AUDIT, 'packets', String(file.packet));
    const packet = await readJsonOrNull(join(packetDir, 'packet.json'));
    if (packet) {
      const { lists, sheets } = await loadPacket(packetDir);
      for (const e of checkLabels({ packet, labels: file, sheets, lists })) gateErrors.push(`${name}: ${e}`);
    }
    for (const store of file.stores) labels.set(store.domain, { ...store, packet: file.packet });
  }
  if (gateErrors.length) throw new Error(`labels fail the gate:\n${gateErrors.join('\n')}`);

  const stores = [];
  const disagreements = [];
  const noRecord = [];
  const unlabelled = [];
  for (const entry of population.stores) {
    const label = labels.get(entry.domain);
    if (!label) {
      unlabelled.push(entry.domain);
      continue;
    }
    const record = entry.recordId ? records.get(entry.recordId) : null;
    if (!record) {
      noRecord.push({ domain: entry.domain, reasons: entry.reasons, auditor: { kind: label.kind, physicalGoods: label.physicalGoods, brandIds: label.brandIds, category: label.category, basis: label.basis }, notes: label.notes });
      continue;
    }
    const evidence = (await readJsonOrNull(join(DB, 'evidence', `${record.id}.json`)))?.quotes ?? [];
    const found = compareStore(record, label).map((d) => {
      const verdict = verdicts.get(`${entry.domain}|${d.field}`) ?? null;
      return {
        domain: entry.domain,
        recordId: record.id,
        packet: label.packet,
        sets: setsOf(entry, record),
        ...d,
        auditorQuotes: label.quotes,
        auditorNotes: label.notes,
        recordQuotes: evidence,
        recordSources: record.evidence.sourceIds,
        adjudication: verdict ? { verdict: verdict.verdict, reason: verdict.reason } : null,
        standsAfterAdjudication: standsAfter(d, verdict?.verdict),
      };
    });
    disagreements.push(...found);
    stores.push({
      domain: entry.domain,
      recordId: record.id,
      sets: setsOf(entry, record),
      record: { kind: record.kind, physicalGoods: record.physicalGoods, brandIds: record.brandIds, category: record.category, basis: record.evidence.basis },
      auditor: { kind: label.kind, physicalGoods: label.physicalGoods, brandIds: label.brandIds, category: label.category, basis: label.basis },
      cantTell: ['kind', 'physicalGoods', 'brandIds', 'category'].filter((f) => label[f] === 'cant-tell'),
      disagreements: found.map((d) => d.type),
    });
  }

  const counts = {};
  for (const set of ['all', 'bonus', 'brands', 'processors', 'held-out', 'held-out-frozen', 'post-freeze']) {
    const inSet = stores.filter((s) => s.sets.includes(set));
    const dis = disagreements.filter((d) => d.sets.includes(set));
    const by = (type, after, subtypes = null) =>
      dis.filter((d) => d.type === type && (!subtypes || subtypes.includes(d.subtype)) && (!after || d.standsAfterAdjudication)).length;
    const bonusRecords = inSet.filter((s) => s.record.category !== 'general-merchandise').length;
    const defaultRecords = inSet.length - bonusRecords;
    const brandDen = set === 'all' || set === 'brands' ? inSet.filter((s) => s.record.brandIds.length).length : inSet.length;
    const section = (after) => ({
      wrongBonus: { ...bound(by('wrong-bonus', after, ['different', 'unsupported']), bonusRecords), cantTell: by('wrong-bonus', after, ['cant-tell']), includingCantTell: bound(by('wrong-bonus', after), bonusRecords) },
      missedBonus: bound(by('missed-bonus', after), defaultRecords),
      wrongBrand: { ...bound(by('wrong-brand', after), set === 'all' || set === 'brands' ? brandDen : inSet.length), adds: by('wrong-brand', after, ['auditor-adds']), drops: by('wrong-brand', after, ['auditor-drops']), different: by('wrong-brand', after, ['different']) },
      wrongKind: bound(by('wrong-kind', after), inSet.length),
      wrongGoods: bound(by('wrong-goods', after), inSet.length),
    });
    counts[set] = {
      stores: inSet.length,
      bonusRecords,
      defaultRecords,
      brandRecords: inSet.filter((s) => s.record.brandIds.length).length,
      processors: inSet.filter((s) => s.record.kind === 'processor').length,
      cantTell: Object.fromEntries(['kind', 'physicalGoods', 'brandIds', 'category'].map((f) => [f, inSet.filter((s) => s.cantTell.includes(f)).length])),
      before: section(false),
      after: adjudication ? section(true) : null,
    };
  }
  const categories = {};
  for (const s of stores) {
    const key = s.record.category;
    categories[key] = categories[key] ?? { records: 0, auditorAgrees: 0, auditorOther: 0, auditorCantTell: 0 };
    categories[key].records += 1;
    if (s.auditor.category === key) categories[key].auditorAgrees += 1;
    else if (s.auditor.category === 'cant-tell') categories[key].auditorCantTell += 1;
    else categories[key].auditorOther += 1;
  }
  const comparison = {
    schemaVersion: 1,
    release: release.version,
    scoredOn: new Date().toISOString().slice(0, 10),
    auditorModels: [...auditorModels],
    adjudicated: adjudication ? { model: adjudication.adjudicator?.model ?? null, decisions: adjudication.decisions.length } : null,
    population: { stores: population.stores.length, labelled: labels.size, withRecord: stores.length, withoutRecord: noRecord.length, unlabelled },
    counts,
    categories,
    disagreements,
    noRecord,
  };
  await writeFile(join(AUDIT, 'comparison.json'), `${JSON.stringify(comparison, null, 1)}\n`);
  await writeFile(
    join(AUDIT, 'adjudication-input.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        release: release.version,
        note: 'One item per disagreement between the release record and the blind auditor. The adjudicator reads both sides\' quotes (and the packet sheet for context) and writes adjudication.json: { domain, field, verdict: record | auditor | neither, reason }.',
        items: disagreements.map((d) => ({
          domain: d.domain,
          recordId: d.recordId,
          field: d.field,
          type: d.type,
          record: d.record,
          auditor: d.auditor,
          recordQuotes: d.recordQuotes,
          auditorQuotes: d.auditorQuotes,
          auditorNotes: d.auditorNotes,
          sheet: `evals/merchants/db/audit/packets/${d.packet}/stores/${d.domain}.md`,
        })),
      },
      null,
      1,
    )}\n`,
  );
  return comparison;
}

function setsOf(entry, record) {
  const sets = ['all'];
  if (record.category !== 'general-merchandise') sets.push('bonus');
  if (record.brandIds.length) sets.push('brands');
  if (record.kind === 'processor') sets.push('processors');
  if (entry.reasons.includes('held-out')) {
    sets.push('held-out');
    sets.push(entry.postFreeze ? 'post-freeze' : 'held-out-frozen');
  }
  return sets;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const c = await score();
  const line = (set) => {
    const s = c.counts[set];
    const b = s.after ?? s.before;
    return `${set}: ${s.stores} stores; wrong bonus ${b.wrongBonus.x}/${b.wrongBonus.n} (≤ ${b.wrongBonus.upper95 ?? '-'}; cant-tell ${b.wrongBonus.cantTell}); missed ${b.missedBonus.x}/${b.missedBonus.n}; wrong brand ${b.wrongBrand.x}/${b.wrongBrand.n}; wrong kind ${b.wrongKind.x}; wrong goods ${b.wrongGoods.x}`;
  };
  console.log(`labelled ${c.population.labelled} of ${c.population.stores}; ${c.disagreements.length} disagreements${c.adjudicated ? ' (after adjudication)' : ' (before adjudication)'}`);
  for (const set of Object.keys(c.counts)) console.log(line(set));
  if (c.population.unlabelled.length) console.log(`unlabelled: ${c.population.unlabelled.join(', ')}`);
}
