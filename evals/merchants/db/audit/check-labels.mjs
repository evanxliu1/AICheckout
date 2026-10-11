// Phase 14.5 blind audit: the gate on an auditor's labels file (run by the auditor before it reports, and by
// score.mjs before any comparison). Checks the schema, the packet's domains in order, brand and category ids, the
// 25-word limit on every quote, that every quote is found verbatim (whitespace-insensitive) inside the named section
// of the store's sheet, that a bonus category has a basis and quotes, and that `filesRead` names no file the auditor
// must not see. Errors name paths and fields only, never page text.
//
//   node evals/merchants/db/audit/check-labels.mjs <packet-dir> [labels-file]
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const MAX_QUOTE_WORDS = 25;
export const KINDS = ['merchant', 'marketplace', 'processor', 'cant-tell'];
export const BASES = ['issuer', 'mcc', 'corroborated', 'definition', 'default'];
/** `mcc` (2026-10-11): a descriptor line of the sheet's MCC evidence section (the mcc basis). */
export const SUPPORTS = ['kind', 'physicalGoods', 'brand', 'category', 'definition', 'exclusion', 'mcc'];
/** Paths an auditor must never open (the release side of the comparison). */
export const FORBIDDEN =
  /(^|\/)(records|evidence|drafts|verify)\/|release(-config)?\.json$|review\.md$|overrides\.json$|verification\.json$|apply-report\.json$|research\.json$|merchants-v1\.ts$|audit\/labels[^/]*\/|audit\/comparison|audit\/adjudication|mcc\/results\.json$/;

export const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const normal = (s) => s.replace(/[‘’ʼ]/g, "'").replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** The sections of a sheet by source id (the first token of each `## ` heading). */
export function sheetSections(markdown) {
  const sections = new Map();
  const parts = markdown.split(/^## /m).slice(1);
  for (const part of parts) {
    const id = part.split(/\s/)[0];
    sections.set(id, normal(part));
  }
  return sections;
}

export function checkLabels({ packet, labels, sheets, lists, otherPacketIncluded = false }) {
  const errors = [];
  const at = (path, message) => errors.push(`${path}: ${message}`);
  if (labels.schemaVersion !== 1) at('schemaVersion', 'must be 1');
  if (labels.packet !== packet.packet) at('packet', `must be ${packet.packet}`);
  if (labels.provenance !== 'agent-verified') at('provenance', 'must be "agent-verified"');
  const auditor = labels.auditor ?? {};
  if (auditor.agent !== 'merchant-auditor') at('auditor.agent', 'must be "merchant-auditor"');
  if (typeof auditor.model !== 'string' || !auditor.model) at('auditor.model', 'required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(auditor.date ?? '')) at('auditor.date', 'YYYY-MM-DD');
  if (!Array.isArray(auditor.filesRead) || !auditor.filesRead.length) at('auditor.filesRead', 'required');
  else
    for (const f of auditor.filesRead) {
      if (f.startsWith('/')) at('auditor.filesRead', `${f} is absolute; use paths relative to the repository root`);
      if (FORBIDDEN.test(f)) at('auditor.filesRead', `${f} is a file the auditor must not read`);
      if (!otherPacketIncluded && /audit\/packets\/(\d+)\//.test(f) && Number(f.match(/audit\/packets\/(\d+)\//)[1]) !== packet.packet)
        at('auditor.filesRead', `${f} belongs to another packet`);
    }
  const brands = new Set(lists.brands.map((b) => b.id));
  const categories = new Set(lists.categories);
  const stores = Array.isArray(labels.stores) ? labels.stores : [];
  if (!Array.isArray(labels.stores)) at('stores', 'required array');
  const domains = stores.map((s) => s?.domain);
  if (JSON.stringify(domains) !== JSON.stringify(packet.domains))
    at('stores', `domains must be the packet's ${packet.domains.length} domains in order`);
  for (const store of stores) {
    const p = `stores[${store?.domain ?? '?'}]`;
    if (!store || typeof store !== 'object') {
      at(p, 'object required');
      continue;
    }
    if (!KINDS.includes(store.kind)) at(`${p}.kind`, `one of ${KINDS.join(', ')}`);
    if (![true, false, 'cant-tell'].includes(store.physicalGoods)) at(`${p}.physicalGoods`, 'true, false or "cant-tell"');
    if (store.brandIds !== 'cant-tell') {
      if (!Array.isArray(store.brandIds)) at(`${p}.brandIds`, 'array of catalog brand ids or "cant-tell"');
      else for (const id of store.brandIds) if (!brands.has(id)) at(`${p}.brandIds`, `${id} is not a catalog brand id`);
    }
    const bonus = store.category !== 'general-merchandise' && store.category !== 'cant-tell';
    if (store.category !== 'cant-tell' && !categories.has(store.category))
      at(`${p}.category`, `${store.category} is not a category`);
    if (store.category === 'cant-tell') {
      if (store.basis !== null) at(`${p}.basis`, 'null when the category is "cant-tell"');
    } else if (!BASES.includes(store.basis)) at(`${p}.basis`, `one of ${BASES.join(', ')}`);
    if (bonus && store.basis === 'default') at(`${p}.basis`, 'a bonus category needs issuer, mcc, corroborated or definition');
    if (!bonus && store.basis && store.basis !== 'default') at(`${p}.basis`, 'general-merchandise is default');
    if (store.kind === 'processor' && bonus) at(`${p}.category`, 'a processor has no bonus category');
    if (store.notes !== null && (typeof store.notes !== 'string' || store.notes.length > 300))
      at(`${p}.notes`, 'null or at most 300 characters');
    if (!Array.isArray(store.quotes)) {
      at(`${p}.quotes`, 'array required');
      continue;
    }
    const sections = sheets.get(store.domain) ?? new Map();
    const supports = new Set();
    for (const [i, q] of store.quotes.entries()) {
      const qp = `${p}.quotes[${i}]`;
      if (!q || typeof q.quote !== 'string' || !q.quote.trim()) {
        at(qp, 'quote required');
        continue;
      }
      if (wordCount(q.quote) > MAX_QUOTE_WORDS) at(qp, `over ${MAX_QUOTE_WORDS} words`);
      if (!SUPPORTS.includes(q.supports)) at(`${qp}.supports`, `one of ${SUPPORTS.join(', ')}`);
      supports.add(q.supports);
      const text = sections.get(q.source);
      if (text === undefined) at(`${qp}.source`, `${q.source} is not a section of the store's sheet`);
      else if (!text.includes(normal(q.quote))) at(qp, `not found verbatim in section ${q.source}`);
    }
    if (bonus) {
      if (!supports.has('category') && !supports.has('definition') && !supports.has('mcc'))
        at(`${p}.quotes`, 'a bonus category needs a category, definition or mcc quote');
      if (store.basis === 'mcc' && !supports.has('mcc'))
        at(`${p}.quotes`, 'mcc basis needs a descriptor quote from the MCC evidence section');
      if (store.basis === 'definition' && !(supports.has('category') && supports.has('definition')))
        at(`${p}.quotes`, 'definition basis needs a store-page category quote and an issuer definition quote');
    }
  }
  return errors;
}

export async function loadPacket(packetDir) {
  const packet = JSON.parse(await readFile(join(packetDir, 'packet.json'), 'utf8'));
  const lists = JSON.parse(await readFile(join(packetDir, 'catalog-lists.json'), 'utf8'));
  const sheets = new Map();
  for (const domain of packet.domains) {
    const markdown = await readFile(join(packetDir, 'stores', `${domain}.md`), 'utf8');
    const sections = sheetSections(markdown);
    const definitions = await readFile(join(packetDir, 'issuer-definitions.md'), 'utf8');
    // Definition quotes may come from the shared definitions file: its sections are reachable from every store.
    for (const [id, text] of sheetSections(definitions)) if (!sections.has(id)) sections.set(id, text);
    sheets.set(domain, sections);
  }
  return { packet, lists, sheets };
}

export async function main(argv = process.argv.slice(2)) {
  const [packetDir, labelsArg] = argv;
  if (!packetDir) {
    console.error('usage: node evals/merchants/db/audit/check-labels.mjs <packet-dir> [labels-file]');
    return 2;
  }
  const { packet, lists, sheets } = await loadPacket(packetDir);
  const labelsPath = labelsArg ?? join(ROOT, packet.output);
  const labels = JSON.parse(await readFile(labelsPath, 'utf8'));
  const errors = checkLabels({ packet, labels, sheets, lists });
  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(`${errors.length} error(s) in ${basename(labelsPath)}`);
    return 1;
  }
  console.log(`labels pass (${labels.stores.length} stores, packet ${packet.packet})`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
