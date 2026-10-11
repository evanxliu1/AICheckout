// Phase 14.5 blind audit, step 1: the audit population and its packets (plan section 7).
//
// Population: every record whose evidence basis is not `default`, every record with brands, every processor record,
// and all 60 domains of the frozen held-out list (whatever they became). Each store's packet sheet carries ONLY what
// the pipeline captured about it: its own store pages in full (tier B: the batch's store-page captures; tier A: the
// homepage render), excerpts of any merchant-code lookup page around its name, and excerpts of the issuer pages
// around its name. Nothing derived from a draft, a verification, a record or review.md goes into a sheet. The
// issuers' category definitions are one shared file per packet, mined from the fixed definition pages.
//
//   node evals/merchants/db/audit/build-packets.mjs [--size 25]
//
// Writes evals/merchants/db/audit/population.json (committed: domains, tiers, reasons, capture counts) and
// evals/merchants/db/audit/packets/<n>/ (gitignored: capture text).
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_V3 } from '../../../../packages/rewards-core/src/catalog-v3.ts';
import { MERCHANT_CATEGORIES_V3 } from '../../../../packages/rewards-core/src/types.ts';
import { storeNamed } from '../../../../tools/catalog-pipeline/src/merchants/apply.ts';
import {
  DEFINITION_PAGES,
  definitionWindows,
  listIssuerCaptures,
  windows,
} from '../../../../tools/catalog-pipeline/src/merchants/capture.ts';
import { domainLabel } from '../../../../tools/catalog-pipeline/src/merchants/candidates.ts';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DB = join(ROOT, 'evals/merchants/db');
export const AUDIT_DIR = join(DB, 'audit');
const PACKETS_DIR = join(AUDIT_DIR, 'packets');
const AGENT_FILE = '.claude/agents/merchant-auditor.md';
/** The one held-out record that changed after the freeze (seed run rules, freeze honesty). */
export const POST_FREEZE = ['gap.com'];

const PAGE_CHARS = 8000;
const MAX_PAGES = 3;
const ISSUER_CHARS = 10000;
const LOOKUP_CHARS = 3000;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const readText = async (path) => readFile(path, 'utf8').catch(() => null);
const exists = (path) =>
  readFile(path).then(
    () => true,
    () => false,
  );

/** Record id → batch domain, from every batch's apply report (tier B); tier A and legacy records fall back to a
 * candidate whose fixed id or domain matches. */
async function recordDomains(records, candidates) {
  const byId = new Map();
  for (const batch of (await readdir(join(DB, 'batches'))).sort()) {
    const report = await readJson(join(DB, 'batches', batch, 'apply-report.json')).catch(() => null);
    if (!report) continue;
    for (const r of report.records) byId.set(r.id, { domain: r.domain, batch });
  }
  const out = new Map();
  for (const record of records) {
    const known = byId.get(record.id);
    if (known) {
      out.set(record.id, known);
      continue;
    }
    const fixed = candidates.find((c) => c.id === record.id);
    const host = candidates.find((c) => record.hosts.includes(c.domain));
    const candidate = fixed ?? host;
    if (!candidate) throw new Error(`no candidate domain for record ${record.id}`);
    out.set(record.id, { domain: candidate.domain, batch: null });
  }
  return out;
}

/** The batch that holds a tier-B domain's captures (the last batch that lists it). */
async function batchOf() {
  const map = new Map();
  for (const batch of (await readdir(join(DB, 'batches'))).sort()) {
    const meta = await readJson(join(DB, 'batches', batch, 'batch.json')).catch(() => null);
    if (!meta) continue;
    for (const s of meta.stores) map.set(s.domain, batch);
  }
  return map;
}

const cut = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max)}\n\n[… ${text.length - max} more characters not shown]`;

const section = (heading, body) => [`## ${heading}`, '', '```', body.trim(), '```', ''];

export async function buildPopulation() {
  const release = await readJson(join(DB, 'release.json'));
  const heldout = (await readJson(join(ROOT, 'evals/merchants/pipeline-heldout-domains.json'))).domains;
  const candidates = (await readJson(join(DB, 'candidates.json'))).candidates;
  const byDomain = new Map(candidates.map((c) => [c.domain, c]));
  const domains = await recordDomains(release.merchants, candidates);
  const batches = await batchOf();
  const population = new Map();
  const add = (domain, reason, record) => {
    const entry = population.get(domain) ?? {
      domain,
      tier: byDomain.get(domain)?.tier ?? null,
      batch: batches.get(domain) ?? null,
      recordId: null,
      reasons: [],
      postFreeze: POST_FREEZE.includes(domain),
    };
    if (record) entry.recordId = record.id;
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    population.set(domain, entry);
  };
  for (const record of release.merchants) {
    const { domain } = domains.get(record.id);
    if (record.evidence.basis !== 'default') add(domain, 'bonus-category', record);
    if (record.brandIds.length) add(domain, 'brands', record);
    if (record.kind === 'processor') add(domain, 'processor', record);
  }
  for (const h of heldout) {
    const record = release.merchants.find((r) => domains.get(r.id).domain === h.domain) ?? null;
    add(h.domain, 'held-out', record);
  }
  return {
    release,
    population: [...population.values()].sort((a, b) => a.domain.localeCompare(b.domain)),
  };
}

async function storeSheet(entry, release, issuerCaptures) {
  const record = release.merchants.find((r) => r.id === entry.recordId) ?? null;
  // The needle for the issuer and lookup excerpts is the record's display name: for tier B the research name the
  // verifier confirmed (so one verified field reaches the sheet as a search term, never as a label), for tier A the
  // homepage's own metadata; the domain label when there is no record.
  const name = record?.name ?? domainLabel(entry.domain);
  const named = storeNamed(name, entry.domain);
  const lines = [
    `# ${entry.domain}: captured pages and excerpts`,
    '',
    'Sections are source ids; quote spans verbatim from inside one section. A section under 300 characters is likely a bot wall or an error page.',
    '',
  ];
  const counts = { storePages: 0, lookups: 0, issuerExcerpts: 0, botWalled: 0 };
  if (entry.tier === 'B' && entry.batch) {
    const dir = join(DB, 'batches', entry.batch);
    const manifest = await readJson(join(dir, 'manifest.json'));
    const sources = manifest.sources.filter((s) => s.domain === entry.domain);
    const pages = sources.filter((s) => s.kind === 'store-page').slice(0, MAX_PAGES);
    for (const page of pages) {
      const text = await readText(join(dir, 'captures', `${page.id}.txt`));
      if (text === null) continue;
      counts.storePages += 1;
      if (text.trim().length < 300) counts.botWalled += 1;
      lines.push(...section(`${page.id} (store page) ${page.url}`, cut(text, PAGE_CHARS)));
    }
    if (!counts.storePages) lines.push('## store pages', '', 'No store page was captured for this domain.', '');
    for (const lookup of sources.filter((s) => s.kind === 'mcc-lookup')) {
      const text = await readText(join(dir, 'captures', `${lookup.id}.txt`));
      if (text === null) continue;
      const excerpts = windows(text, named, 400, 4);
      if (!excerpts.length) continue;
      counts.lookups += 1;
      lines.push(
        ...section(
          `${lookup.id} (merchant-code lookup page, excerpts around the store's name) ${lookup.url}`,
          cut(excerpts.join('\n\n[…]\n\n'), LOOKUP_CHARS),
        ),
      );
    }
    let used = 0;
    for (const issuer of sources.filter((s) => s.kind === 'issuer-terms')) {
      const text = await readText(join(dir, 'captures', `${issuer.id}.windows.${entry.domain}.txt`));
      if (!text || !text.trim() || used >= ISSUER_CHARS) continue;
      counts.issuerExcerpts += 1;
      const body = cut(text, ISSUER_CHARS - used);
      used += body.length;
      lines.push(...section(`${issuer.id} (issuer page, excerpts around the store's name) ${issuer.url}`, body));
    }
  } else {
    const manifest = (await readJson(join(DB, 'tier-a-manifest.json'))).stores[entry.domain];
    const text = await readText(join(DB, 'tier-a-captures', `${entry.domain}.txt`));
    if (text !== null && manifest) {
      counts.storePages = 1;
      if (text.trim().length < 300) counts.botWalled += 1;
      lines.push(...section(`${entry.domain}-home (store page, homepage render) ${manifest.url}`, cut(text, PAGE_CHARS)));
    } else lines.push('## store pages', '', 'No store page was captured for this domain (the homepage could not be fetched).', '');
    // Tier A had no issuer mining; mine the catalog's issuer captures the way the pipeline does (name windows, at most
    // five captures), so a held-out long-tail store sees any issuer sentence naming it.
    let used = 0;
    const hits = [];
    for (const capture of issuerCaptures) {
      const text = await readText(capture.path);
      if (!text || !named.test(text)) continue;
      hits.push({ capture, text, count: text.match(new RegExp(named.source, 'gi')).length });
    }
    hits.sort((a, b) => b.count - a.count);
    for (const { capture, text } of hits.slice(0, 5)) {
      if (used >= ISSUER_CHARS) break;
      const body = cut(windows(text, named).join('\n\n[…]\n\n'), ISSUER_CHARS - used);
      used += body.length;
      counts.issuerExcerpts += 1;
      lines.push(...section(`${capture.id} (issuer page, excerpts around the store's name) ${capture.url}`, body));
    }
  }
  if (!counts.issuerExcerpts) lines.push('## issuer pages', '', 'No issuer page names this store.', '');
  return { text: lines.join('\n'), counts };
}

/** The issuers' category definitions: the definition sentences of the fixed definition pages, as the drafter saw
 * them (wider windows), from the catalog's issuer captures. */
async function issuerDefinitions(issuerCaptures) {
  const lines = [
    '# Issuer category definitions (excerpts)',
    '',
    'Sentences of the issuer pages that describe a category, with their surroundings. Sections are source ids. A definition covers a store only as the evidence rule in the agent file says.',
    '',
  ];
  for (const id of DEFINITION_PAGES) {
    const capture = issuerCaptures.find((c) => c.id === id);
    if (!capture) continue;
    const text = await readText(capture.path);
    if (!text) continue;
    const excerpts = definitionWindows(text, 250, 10);
    if (!excerpts.length) continue;
    lines.push(...section(`${id} (issuer page) ${capture.url}`, excerpts.join('\n\n[…]\n\n')));
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const sizeAt = argv.indexOf('--size');
  const size = sizeAt >= 0 ? Number(argv[sizeAt + 1]) : 25;
  const { release, population } = await buildPopulation();
  const issuerCaptures = await listIssuerCaptures(ROOT);
  await rm(PACKETS_DIR, { recursive: true, force: true });
  const packets = Math.ceil(population.length / size);
  const per = Math.ceil(population.length / packets);
  const definitions = await issuerDefinitions(issuerCaptures);
  const lists = JSON.stringify(
    {
      brands: CATALOG_V3.brands.map((b) => ({ id: b.id, name: b.name })),
      categories: [...MERCHANT_CATEGORIES_V3],
    },
    null,
    2,
  );
  for (let n = 1; n <= packets; n += 1) {
    const stores = population.slice((n - 1) * per, n * per);
    const dir = join(PACKETS_DIR, String(n));
    await mkdir(join(dir, 'stores'), { recursive: true });
    await writeFile(join(dir, 'issuer-definitions.md'), definitions);
    await writeFile(join(dir, 'catalog-lists.json'), lists);
    const inputs = [AGENT_FILE, relative(ROOT, join(dir, 'catalog-lists.json')), relative(ROOT, join(dir, 'issuer-definitions.md'))];
    for (const entry of stores) {
      const { text, counts } = await storeSheet(entry, release, issuerCaptures);
      entry.captures = counts;
      entry.packet = n;
      const path = join(dir, 'stores', `${entry.domain}.md`);
      await writeFile(path, text);
      inputs.push(relative(ROOT, path));
    }
    await writeFile(
      join(dir, 'packet.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          packet: n,
          release: release.version,
          domains: stores.map((s) => s.domain),
          inputs,
          output: `evals/merchants/db/audit/labels/packet-${n}.json`,
        },
        null,
        2,
      ),
    );
  }
  await mkdir(join(AUDIT_DIR, 'labels'), { recursive: true });
  await writeFile(
    join(AUDIT_DIR, 'population.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        release: release.version,
        builtOn: new Date().toISOString().slice(0, 10),
        packets,
        stores: population,
      },
      null,
      1,
    )}\n`,
  );
  const reasons = {};
  for (const s of population) for (const r of s.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
  console.log(
    `population ${population.length} stores (${JSON.stringify(reasons)}), ${packets} packets of up to ${per}; ` +
      `${population.filter((s) => !s.captures.storePages).length} without a store page, ` +
      `${population.filter((s) => s.captures.botWalled).length} with a short (bot-walled) page.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
