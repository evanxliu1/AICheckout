// The `mcc` evidence basis (Evan, 2026-10-11: "fix the big names, i think we should use MCC codes … that is enough
// evidence"; wiki/decisions/2026-10-11-mcc-evidence-basis.md). Openly licensed government purchase-card datasets give,
// per transaction, the merchant descriptor and the Visa merchant category description. `pipeline merchants mcc` pools
// the rows that match each record's descriptor rule, maps the descriptions to numeric codes through the Visa Merchant
// Data Standards Manual and the codes to catalog categories (codes.json), and grants the category when a store has at
// least 10 matched rows and one category holds at least 80% of them (fuel rows of a separate code are set aside
// first, not counted as conflicts). Deterministic, no model. Datasets stay gitignored under evals/merchants/db/
// mcc-data/; only the manifest (URL, publisher, licence quote, fetch date, SHA-256, rows), the descriptor rules, the
// code map and the results summary are committed. Rows are never committed; the evidence quote per dataset is one
// merchant descriptor with its category description.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { z } from 'zod';
import { merchantRecordSchema } from '../../../../packages/rewards-core/src/merchant-release.ts';
import { MERCHANT_CATEGORIES_V3 } from '../../../../packages/rewards-core/src/types.ts';
import type { MerchantRecord, MerchantSource } from '../../../../packages/rewards-core/src/types.ts';
import { writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import { CATEGORY_EXCLUDED_TYPES, issuerConflicts } from './apply.ts';
import {
  BATCHES_DIR,
  DB_DIR,
  EVIDENCE_DIR,
  RECORDS_DIR,
  RELEASE_CONFIG,
  applyReportSchema,
  evidenceFileSchema,
  manifestFileSchema,
  readJson,
  readJsonOrNull,
  releaseConfigSchema,
} from './files.ts';
import type { EvidenceFile } from './files.ts';

export const MCC_DIR = `${DB_DIR}/mcc`;
export const MCC_DATA_DIR = `${DB_DIR}/mcc-data`;
export const MCC_MANIFEST = `${MCC_DIR}/manifest.json`;
export const MCC_CODES = `${MCC_DIR}/codes.json`;
export const MCC_DESCRIPTORS = `${MCC_DIR}/descriptors.json`;
export const MCC_RESULTS = `${MCC_DIR}/results.json`;
export const MCC_BATCH = 'mcc-2026-10';
/** The grant thresholds (coordinator, 2026-10-11). */
export const MIN_ROWS = 10;
export const MIN_SHARE = 0.8;

const hex = z.string().regex(/^[0-9a-f]{64}$/);
const sourceId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(80);
/** A quote of 25 words or fewer (plan section 2: never copy data; one descriptor with its description). */
const quote = z.string().max(400);

export const mccManifestSchema = z.strictObject({
  description: z.string(),
  fetchedOn: z.iso.date(),
  datasets: z.array(
    z.strictObject({
      /** The release source id (`mcc-dataset-…`). */
      id: sourceId,
      publisher: z.string().max(200),
      title: z.string().max(200),
      /** The dataset page, cited as the release source URL. */
      url: z.url().max(2048),
      downloadUrl: z.url().max(2048).optional(),
      licence: z.strictObject({
        name: z.string().max(80),
        /** 25 words or fewer, from where the licence is stated. */
        quote: quote,
        seenAt: z.string().max(300),
      }),
      /** How the rows were generated (channel), for the disclosure in review.md and the docs. */
      channel: z.string().max(300),
      /** Column names holding the merchant descriptor, the MCC description and, when present, the numeric code. */
      columns: z.strictObject({
        merchant: z.string(),
        description: z.string(),
        code: z.string().optional(),
      }),
      format: z.enum(['csv', 'xlsx']),
      /** Files under evals/merchants/db/mcc-data/, hashed; `rows` and `sha256` are written by the tool and checked
       * on the next run. */
      files: z.array(
        z.strictObject({
          path: z.string().max(200),
          sha256: hex.optional(),
          rows: z.int().nonnegative().optional(),
        }),
      ),
      /** The release source hash: the file's SHA-256 for one file, else the SHA-256 of the files' hashes joined by
       * newlines in path order (written by the tool). */
      sha256: hex.optional(),
    }),
  ),
});
export type MccManifest = z.infer<typeof mccManifestSchema>;

export const mccCodesSchema = z.strictObject({
  description: z.string(),
  visaManual: z.strictObject({
    title: z.string(),
    edition: z.string(),
    url: z.url(),
    sha256: hex,
    marking: z.string(),
    streamingGuidance: quote,
  }),
  /** Codes whose rows are set aside before the share is computed (a grocer's fuel centers, a club's pumps). */
  fuelCodes: z.array(z.int()),
  codes: z.array(
    z.strictObject({
      code: z.int().min(1).max(9999),
      /** The Visa manual's title. */
      title: z.string().max(120),
      category: z.enum(MERCHANT_CATEGORIES_V3),
      /** Regular expressions on the normalised dataset description (upper case, single spaces). */
      descriptions: z.array(z.string().max(120)).min(1),
    }),
  ),
});
export type MccCodes = z.infer<typeof mccCodesSchema>;

export const mccDescriptorsSchema = z.strictObject({
  description: z.string(),
  stores: z.record(
    sourceId,
    z.strictObject({
      /** Regular expressions on the normalised merchant descriptor, matched on word boundaries; they replace the
       * pattern derived from the record's name. */
      patterns: z.array(z.string().max(120)).optional(),
      /** Rows whose descriptor matches one of these are not this store (name collisions). */
      excludes: z.array(z.string().max(120)).optional(),
      /** The store never gets a category from the data (its own pages or the coordinator veto it). */
      veto: z.string().max(300).optional(),
      /** The record is not matched at all (a name that is a common word). */
      skip: z.string().max(300).optional(),
    }),
  ),
});
export type MccDescriptors = z.infer<typeof mccDescriptorsSchema>;

export const mccResultsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  appliedOn: z.iso.date(),
  datasets: z.array(z.strictObject({ id: sourceId, rows: z.int().nonnegative(), files: z.int().positive() })),
  /** Records with no matched row, counted. */
  unmatched: z.int().nonnegative(),
  stores: z.array(
    z.strictObject({
      id: sourceId,
      name: z.string(),
      rows: z.int().nonnegative(),
      fuelRows: z.int().nonnegative(),
      usable: z.int().nonnegative(),
      byDataset: z.record(z.string(), z.int()),
      /** Normalised description → rows, every description seen. */
      byDescription: z.record(z.string(), z.int()),
      /** The most frequent matched descriptors ("MERCHANT | DESCRIPTION", raw fields), for review and audit. */
      descriptors: z.array(z.strictObject({ text: z.string(), rows: z.int() })),
      dominant: z
        .strictObject({
          category: z.string(),
          share: z.number(),
          code: z.int().nullable(),
          description: z.string(),
        })
        .nullable(),
      /** Minority descriptions outside the dominant category (fuel set aside), with code and category. */
      conflicts: z.array(
        z.strictObject({
          description: z.string(),
          code: z.int().nullable(),
          category: z.string(),
          rows: z.int(),
        }),
      ),
      /** Cross-issuer conflicts of a granted category (issuer sentences naming the store), as apply reports them. */
      issuerConflicts: z.array(z.string().max(400)),
      outcome: z.enum([
        'granted',
        'kept-issuer',
        'vetoed',
        'marketplace',
        'processor',
        'too-few-rows',
        'not-dominant',
        'no-bonus-code',
      ]),
      reason: z.string().max(400).nullable(),
      previous: z.strictObject({ basis: z.string(), category: z.string() }),
      changed: z.boolean(),
    }),
  ),
});
export type MccResults = z.infer<typeof mccResultsSchema>;
export type MccStoreResult = MccResults['stores'][number];

/** Upper case, every run of other characters one space: "Grocery Stores, Supermarkets" and "GROCERY STORES
 * SUPERMARKETS" meet; "DOMINO'S #123" becomes "DOMINO S 123". */
export const normalText = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Name suffixes that never appear in a card descriptor. */
const NAME_SUFFIX = /\b(?:INC|LLC|CORP|CORPORATION|CO|COMPANY|LTD|USA|US|ONLINE|OFFICIAL SITE|COM)$/;

/** The descriptor pattern derived from a record's name: its alphanumeric tokens in order, each run of other
 * characters optional ("Best Buy" matches "BESTBUY.COM" and "BEST BUY 00123"; "Domino's" matches "DOMINOS PIZZA"
 * and "DOMINO'S" but not "DOMINO SUGAR"), on word boundaries. Null when fewer than four letters or digits remain
 * (short names such as "Gap" or "H&M" need a hand-written pattern). */
export function derivePattern(name: string): string | null {
  let text = normalText(name.replace(/\.com\b/i, ''));
  for (;;) {
    const trimmed = text.replace(NAME_SUFFIX, '').trim();
    if (trimmed === text || !trimmed) break;
    text = trimmed;
  }
  const tokens = text.split(' ').filter(Boolean);
  if (!tokens.length || tokens.join('').length < 4) return null;
  return tokens.map(escape).join(' ?');
}

export interface Descriptor {
  id: string;
  patterns: RegExp[];
  excludes: RegExp[];
  /** Tokens a descriptor must contain for the patterns to be tried (the first token of each pattern). */
  tokens: string[];
}

const bounded = (source: string) => new RegExp(`(?<![A-Z0-9])(?:${source})(?![A-Z0-9])`);
const firstToken = (source: string) => /^[A-Z0-9]+/.exec(source.replace(/^\(\?:/, ''))?.[0] ?? null;

/** The descriptor rule for a record: the committed override, else the pattern derived from its name. Null when the
 * record is skipped or no pattern can be derived. */
export function descriptorFor(
  record: MerchantRecord,
  overrides: MccDescriptors['stores'],
): Descriptor | null {
  const override = overrides[record.id];
  if (override?.skip) return null;
  const sources = override?.patterns?.length
    ? override.patterns
    : [derivePattern(record.name)].filter((p) => p !== null);
  if (!sources.length) return null;
  const tokens = sources.map(firstToken).filter((t): t is string => t !== null);
  // A pattern must start with a literal token so the index can route rows to it.
  if (tokens.length !== sources.length)
    throw new Error(
      `${record.id}: every descriptor pattern must start with a literal token (${sources.join(' | ')})`,
    );
  return {
    id: record.id,
    patterns: sources.map(bounded),
    excludes: (override?.excludes ?? []).map(bounded),
    tokens,
  };
}

/** Whether a normalised merchant descriptor is this store's. */
export const descriptorMatches = (d: Descriptor, merchant: string): boolean =>
  d.patterns.some((p) => p.test(merchant)) && !d.excludes.some((p) => p.test(merchant));

export interface CodeEntry {
  code: number;
  title: string;
  category: string;
  patterns: RegExp[];
}
export const compileCodes = (codes: MccCodes): CodeEntry[] =>
  codes.codes.map((c) => ({ ...c, patterns: c.descriptions.map((d) => new RegExp(d)) }));

/** The code entry for a normalised description, or null when it is no code the map knows (then the row counts as
 * general merchandise). */
export const codeFor = (description: string, codes: CodeEntry[]): CodeEntry | null =>
  codes.find((c) => c.patterns.some((p) => p.test(description))) ?? null;

export interface Decision {
  rows: number;
  fuelRows: number;
  usable: number;
  dominant: MccStoreResult['dominant'];
  conflicts: MccStoreResult['conflicts'];
  outcome: 'granted' | 'too-few-rows' | 'not-dominant' | 'no-bonus-code';
}

/** The grant rule on a store's description counts (pure). Fuel rows (a grocer's pumps) are set aside unless fuel is
 * itself the dominant category over every row (a gas station); then at least `MIN_ROWS` usable rows and a dominant
 * category of at least `MIN_SHARE` of them, and that category must be a bonus category. Minority descriptions are
 * reported as conflicts. */
export function decide(
  byDescription: Map<string, number>,
  codes: CodeEntry[],
  fuelCodes: number[],
): Decision {
  const fuel = new Set(fuelCodes);
  const perCategory = new Map<string, number>();
  const perDescription = [...byDescription.entries()].map(([description, rows]) => {
    const entry = codeFor(description, codes);
    return {
      description,
      rows,
      code: entry?.code ?? null,
      category: entry?.category ?? 'general-merchandise',
    };
  });
  const rows = perDescription.reduce((n, d) => n + d.rows, 0);
  for (const d of perDescription) perCategory.set(d.category, (perCategory.get(d.category) ?? 0) + d.rows);
  const top = (counts: Map<string, number>) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const overall = top(perCategory);
  const gasDominant = overall?.[0] === 'gas';
  const kept = gasDominant
    ? perDescription
    : perDescription.filter((d) => d.code === null || !fuel.has(d.code));
  const fuelRows = rows - kept.reduce((n, d) => n + d.rows, 0);
  const usable = rows - fuelRows;
  const categories = new Map<string, number>();
  for (const d of kept) categories.set(d.category, (categories.get(d.category) ?? 0) + d.rows);
  const best = top(categories);
  if (!best) return { rows, fuelRows, usable, dominant: null, conflicts: [], outcome: 'too-few-rows' };
  const [category, count] = best;
  const lead = kept.filter((d) => d.category === category).sort((a, b) => b.rows - a.rows)[0];
  const dominant = {
    category,
    share: usable ? count / usable : 0,
    code: lead.code,
    description: lead.description,
  };
  const conflicts = kept
    .filter((d) => d.category !== category)
    .sort((a, b) => b.rows - a.rows)
    .map(({ description, code, category: c, rows: r }) => ({ description, code, category: c, rows: r }));
  const outcome =
    usable < MIN_ROWS
      ? 'too-few-rows'
      : dominant.share < MIN_SHARE
        ? 'not-dominant'
        : category === 'general-merchandise'
          ? 'no-bonus-code'
          : 'granted';
  return { rows, fuelRows, usable, dominant, conflicts, outcome };
}

/** RFC 4180 rows from a CSV file, streamed; a leading BOM is dropped. */
export async function* csvRows(path: string): AsyncGenerator<string[]> {
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let afterQuote = false;
  let first = true;
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    let text = chunk as string;
    if (first) {
      text = text.replace(/^\uFEFF/, '');
      first = false;
    }
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          quoted = false;
          afterQuote = true;
        } else field += c;
        continue;
      }
      if (c === '"') {
        if (afterQuote) field += '"';
        quoted = true;
        afterQuote = false;
        continue;
      }
      afterQuote = false;
      if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        yield row;
        row = [];
      } else if (c !== '\r') field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}

/** The first worksheet of a small .xlsx as rows of strings (shared strings resolved). A minimal reader: the zip's
 * central directory, raw deflate, the sheet's cell XML. Enough for the GSA quarterly files. */
export function xlsxRows(buffer: Buffer): string[][] {
  const entries = new Map<string, Buffer>();
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataStart, dataStart + compressed);
    entries.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode(m[1]));
  const sheetName = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('no worksheet');
  const sheet = entries.get(sheetName)!.toString('utf8');
  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, column, attrs, inner = ''] = cell;
      const index = [...column].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      cells[index] = /t="s"/.test(attrs) && /^\d+$/.test(value) ? shared[Number(value)] : decode(value);
    }
    rows.push(Array.from(cells, (c) => c ?? ''));
  }
  return rows;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The descriptors a row may belong to: those whose anchor token is a prefix of one of the row's tokens
 * ("LOWES 1234" reaches the anchor "LOWE" of "LOWE ?S"; "WHOLEFDS" reaches "WHOLE"). The real test is the pattern. */
export function candidates(normalMerchant: string, byToken: Map<string, Descriptor[]>): Descriptor[] {
  const out: Descriptor[] = [];
  for (const token of normalMerchant.split(' '))
    for (let length = 2; length <= token.length; length += 1) {
      const found = byToken.get(token.slice(0, length));
      if (found) for (const d of found) if (!out.includes(d)) out.push(d);
    }
  return out;
}

interface Tally {
  byDescription: Map<string, number>;
  byDataset: Map<string, number>;
  descriptors: Map<string, number>;
}
const DESCRIPTOR_CAP = 60;

/** Pools every dataset row into the records whose descriptor rule it matches. Returns the tallies by record id and
 * the row count per dataset; verifies (or fills) the manifest's hashes and row counts. */
export async function pool(
  root: string,
  manifest: MccManifest,
  descriptors: Descriptor[],
  log: (line: string) => void,
): Promise<{ tallies: Map<string, Tally>; rows: Map<string, number>; manifest: MccManifest }> {
  const byToken = new Map<string, Descriptor[]>();
  for (const d of descriptors)
    for (const token of d.tokens) byToken.set(token, [...(byToken.get(token) ?? []), d]);
  const tallies = new Map<string, Tally>();
  const rows = new Map<string, number>();
  const feed = (datasetId: string, merchant: string, description: string) => {
    const normalMerchant = normalText(merchant);
    const normalDescription = normalText(description);
    const seen = new Set<Descriptor>();
    for (const d of candidates(normalMerchant, byToken)) {
      if (seen.has(d) || !descriptorMatches(d, normalMerchant)) continue;
      seen.add(d);
      const tally = tallies.get(d.id) ?? {
        byDescription: new Map(),
        byDataset: new Map(),
        descriptors: new Map(),
      };
      tally.byDescription.set(normalDescription, (tally.byDescription.get(normalDescription) ?? 0) + 1);
      tally.byDataset.set(datasetId, (tally.byDataset.get(datasetId) ?? 0) + 1);
      const text = `${merchant.replace(/\s+/g, ' ').trim()} | ${description.replace(/\s+/g, ' ').trim()}`;
      if (tally.descriptors.has(text) || tally.descriptors.size < DESCRIPTOR_CAP)
        tally.descriptors.set(text, (tally.descriptors.get(text) ?? 0) + 1);
      tallies.set(d.id, tally);
    }
  };
  const datasets: MccManifest['datasets'] = [];
  for (const dataset of manifest.datasets) {
    const files: MccManifest['datasets'][number]['files'] = [];
    let total = 0;
    for (const file of [...dataset.files].sort((a, b) => a.path.localeCompare(b.path))) {
      const path = join(root, MCC_DATA_DIR, file.path);
      const hash = await fileSha256(path);
      if (file.sha256 && file.sha256 !== hash)
        throw new Error(`${dataset.id}: ${file.path} has changed (manifest ${file.sha256}, file ${hash})`);
      let count = 0;
      if (dataset.format === 'csv') {
        let header: string[] | null = null;
        let columns: { merchant: number; description: number } | null = null;
        for await (const row of csvRows(path)) {
          if (!header) {
            header = row.map((h) => h.trim());
            const merchant = header.indexOf(dataset.columns.merchant);
            const description = header.indexOf(dataset.columns.description);
            if (merchant < 0 || description < 0)
              throw new Error(
                `${dataset.id}: ${file.path} lacks ${dataset.columns.merchant}/${dataset.columns.description} (header ${header.join(',')})`,
              );
            columns = { merchant, description };
            continue;
          }
          if (row.length === 1 && row[0] === '') continue;
          count += 1;
          feed(dataset.id, row[columns!.merchant] ?? '', row[columns!.description] ?? '');
        }
      } else {
        const all = xlsxRows(await readFile(path));
        const headerAt = all.findIndex(
          (r) => r.includes(dataset.columns.merchant) && r.includes(dataset.columns.description),
        );
        if (headerAt < 0)
          throw new Error(`${dataset.id}: ${file.path} lacks a header row with ${dataset.columns.merchant}`);
        const merchant = all[headerAt].indexOf(dataset.columns.merchant);
        const description = all[headerAt].indexOf(dataset.columns.description);
        for (const row of all.slice(headerAt + 1)) {
          if (!row.some((c) => c)) continue;
          count += 1;
          feed(dataset.id, row[merchant] ?? '', row[description] ?? '');
        }
      }
      if (file.rows !== undefined && file.rows !== count)
        throw new Error(`${dataset.id}: ${file.path} has ${count} rows (manifest ${file.rows})`);
      files.push({ path: file.path, sha256: hash, rows: count });
      total += count;
      log(`mcc: ${dataset.id} ${file.path}: ${count} rows.`);
    }
    const combined = files.length === 1 ? files[0].sha256! : sha256(files.map((f) => f.sha256).join('\n'));
    if (dataset.sha256 && dataset.sha256 !== combined)
      throw new Error(
        `${dataset.id}: the dataset hash changed (manifest ${dataset.sha256}, files ${combined})`,
      );
    datasets.push({ ...dataset, files, sha256: combined });
    rows.set(dataset.id, total);
  }
  return { tallies, rows, manifest: { ...manifest, datasets } };
}

/** Where a record's batch captures are (tier B), from the apply reports. */
async function batchOf(root: string): Promise<Map<string, { batch: string; domain: string }>> {
  const out = new Map<string, { batch: string; domain: string }>();
  for (const batch of (await readdir(join(root, BATCHES_DIR)).catch(() => [] as string[])).sort()) {
    const report = await readJsonOrNull(
      join(root, BATCHES_DIR, batch, 'apply-report.json'),
      applyReportSchema,
    );
    for (const r of report?.records ?? []) out.set(r.id, { batch, domain: r.domain });
  }
  return out;
}

/** The superstore guard (plan section 2: superstores, discount stores and warehouse clubs never get grocery; the
 * same words for drugstores): the record's full store-page captures must not call it a kind of store the category
 * excludes. Only for supermarkets and drugstores; a record without captures (tier A) cannot be vetoed this way. */
export function pageVeto(category: string, storeTexts: Record<string, string>): string | null {
  if (category !== 'supermarkets' && category !== 'drugstores') return null;
  const excluded = CATEGORY_EXCLUDED_TYPES[category];
  for (const [id, text] of Object.entries(storeTexts)) {
    const hit = excluded.exec(text);
    if (hit) return `the store's own page ${id} calls it a ${hit[0].toLowerCase()}`;
  }
  return null;
}

export async function runMcc(env: Env, { version }: { version?: string }): Promise<number> {
  const manifest = await readJson(join(env.root, MCC_MANIFEST), mccManifestSchema);
  const codes = await readJson(join(env.root, MCC_CODES), mccCodesSchema);
  const overrides = (await readJson(join(env.root, MCC_DESCRIPTORS), mccDescriptorsSchema)).stores;
  const config = await readJson(join(env.root, RELEASE_CONFIG), releaseConfigSchema);
  const records: MerchantRecord[] = [];
  for (const name of (await readdir(join(env.root, RECORDS_DIR))).filter((n) => n.endsWith('.json')).sort())
    records.push(
      merchantRecordSchema.parse(JSON.parse(await readFile(join(env.root, RECORDS_DIR, name), 'utf8'))),
    );
  for (const id of Object.keys(overrides))
    if (!records.some((r) => r.id === id)) throw new Error(`descriptors.json names no record: ${id}`);
  const descriptors = records
    .filter((r) => r.kind !== 'processor')
    .map((r) => descriptorFor(r, overrides))
    .filter((d): d is Descriptor => d !== null);
  const { tallies, rows, manifest: verified } = await pool(env.root, manifest, descriptors, env.log);
  const compiled = compileCodes(codes);
  const batches = await batchOf(env.root);
  const today = env.now().toISOString().slice(0, 10);
  const results: MccStoreResult[] = [];
  const sourcesById = new Map(config.sources.map((s) => [s.id, s]));
  const datasetSource = (id: string): MerchantSource => {
    const d = verified.datasets.find((x) => x.id === id)!;
    return { id: d.id, url: d.url, kind: 'mcc-dataset', capturedAt: verified.fetchedOn, sha256: d.sha256! };
  };
  let changed = 0;
  for (const record of records) {
    const tally = tallies.get(record.id);
    if (!tally) continue;
    const decision = decide(tally.byDescription, compiled, codes.fuelCodes);
    const previous = { basis: record.evidence.basis, category: record.category };
    let outcome: MccStoreResult['outcome'] = decision.outcome;
    let reason: string | null = null;
    let issuerSentences: string[] = [];
    const category = decision.dominant?.category ?? null;
    if (outcome === 'granted' && category) {
      const override = overrides[record.id];
      const located = batches.get(record.id);
      const storeTexts: Record<string, string> = {};
      const issuerTexts: Record<string, string> = {};
      let sources: {
        id: string;
        kind: MerchantSource['kind'];
        url: string;
        capturedOn: string;
        sha256: string;
      }[] = [];
      if (located) {
        const dir = join(env.root, BATCHES_DIR, located.batch);
        const batchManifest = await readJsonOrNull(join(dir, 'manifest.json'), manifestFileSchema);
        sources = (batchManifest?.sources ?? []).filter((s) => s.domain === located.domain);
        for (const s of sources) {
          if (s.kind === 'store-page') {
            const text = await readFile(join(dir, 'captures', `${s.id}.txt`), 'utf8').catch(() => null);
            if (text !== null) storeTexts[s.id] = text;
          } else if (s.kind === 'issuer-terms') {
            const text = await readFile(
              join(dir, 'captures', `${s.id}.windows.${located.domain}.txt`),
              'utf8',
            ).catch(() => null);
            if (text !== null) issuerTexts[s.id] = text;
          }
        }
      }
      const veto = override?.veto ?? pageVeto(category, storeTexts);
      if (record.kind === 'processor') outcome = 'processor';
      else if (record.kind === 'marketplace' && category !== 'dining') {
        outcome = 'marketplace';
        reason = 'a marketplace gets a category from the data only for dining';
      } else if (veto) {
        outcome = 'vetoed';
        reason = veto;
      } else if (record.evidence.basis === 'issuer') {
        outcome = 'kept-issuer';
        reason =
          record.category === category
            ? 'issuer evidence is stronger; the data agrees'
            : `issuer evidence is stronger; the data says ${category}`;
      }
      if (outcome === 'granted' && located) {
        issuerSentences = issuerConflicts(
          {
            domain: located.domain,
            id: record.id,
            name: record.name,
            hosts: record.hosts,
            draft: {
              domain: located.domain,
              kind: record.kind,
              physicalGoods: record.physicalGoods,
              brandIds: record.brandIds,
              candidateCategory: null,
              evidence: [],
              notes: null,
            },
            verification: {} as never,
            sources,
            issuerTexts,
          },
          category,
          [],
        );
      }
    }
    const datasetIds = [...tally.byDataset.keys()].sort();
    let next: MerchantRecord;
    if (outcome === 'granted' && category) {
      next = {
        ...record,
        category: category as MerchantRecord['category'],
        evidence: { basis: 'mcc', sourceIds: datasetIds },
      };
    } else if (record.evidence.basis === 'mcc') {
      // A re-run no longer grants: back to the default (the earlier definition or issuer evidence is in history).
      next = { ...record, category: 'general-merchandise', evidence: { basis: 'default', sourceIds: [] } };
    } else next = record;
    const didChange = JSON.stringify(next) !== JSON.stringify(record);
    if (didChange) {
      changed += 1;
      await writeJsonAtomic(
        join(env.root, RECORDS_DIR, `${record.id}.json`),
        merchantRecordSchema.parse(next),
      );
      if (next.evidence.basis === 'mcc') {
        const quotes: EvidenceFile['quotes'] = datasetIds.map((id) => {
          const lead = [...tally.descriptors.entries()]
            .filter(
              ([text]) =>
                codeFor(normalText(text.split(' | ').slice(1).join(' | ')), compiled)?.category === category,
            )
            .sort((a, b) => b[1] - a[1])[0];
          return {
            sourceId: id,
            kind: 'mcc-dataset',
            supports: 'category',
            quote: (lead?.[0] ?? decision.dominant!.description).slice(0, 400),
          };
        });
        await writeJsonAtomic(
          join(env.root, EVIDENCE_DIR, `${record.id}.json`),
          evidenceFileSchema.parse({
            schemaVersion: 1,
            id: record.id,
            batch: MCC_BATCH,
            appliedOn: today,
            basis: 'mcc',
            quotes,
          }),
        );
        for (const id of datasetIds) sourcesById.set(id, datasetSource(id));
      }
    }
    results.push({
      id: record.id,
      name: record.name,
      rows: decision.rows,
      fuelRows: decision.fuelRows,
      usable: decision.usable,
      byDataset: Object.fromEntries([...tally.byDataset.entries()].sort()),
      byDescription: Object.fromEntries([...tally.byDescription.entries()].sort((a, b) => b[1] - a[1])),
      descriptors: [...tally.descriptors.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12)
        .map(([text, n]) => ({ text, rows: n })),
      dominant: decision.dominant,
      conflicts: decision.conflicts,
      issuerConflicts: issuerSentences,
      outcome,
      reason,
      previous,
      changed: didChange,
    });
    env.log(
      `${record.id}: ${decision.rows} rows, ${decision.dominant ? `${decision.dominant.category} ${(decision.dominant.share * 100).toFixed(0)}%` : 'nothing'} → ${outcome}${reason ? ` (${reason})` : ''}${didChange ? ' CHANGED' : ''}`,
    );
  }
  // Sources no record cites any more leave the release.
  const cited = new Set<string>();
  for (const name of (await readdir(join(env.root, RECORDS_DIR))).filter((n) => n.endsWith('.json'))) {
    const record = merchantRecordSchema.parse(
      JSON.parse(await readFile(join(env.root, RECORDS_DIR, name), 'utf8')),
    );
    for (const id of record.evidence.sourceIds) cited.add(id);
  }
  for (const id of [...sourcesById.keys()]) if (!cited.has(id)) sourcesById.delete(id);
  await writeJsonAtomic(join(env.root, RELEASE_CONFIG), {
    ...config,
    version: version ?? config.version,
    sources: [...sourcesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  });
  await writeJsonAtomic(join(env.root, MCC_MANIFEST), mccManifestSchema.parse(verified));
  const output: MccResults = {
    schemaVersion: 1,
    version: version ?? config.version,
    appliedOn: today,
    datasets: verified.datasets.map((d) => ({ id: d.id, rows: rows.get(d.id) ?? 0, files: d.files.length })),
    unmatched: records.filter((r) => r.kind !== 'processor').length - results.length,
    stores: results.sort((a, b) => a.id.localeCompare(b.id)),
  };
  await writeJsonAtomic(join(env.root, MCC_RESULTS), mccResultsSchema.parse(output));
  const granted = results.filter((r) => r.outcome === 'granted');
  env.log(
    `mcc: ${results.length} records matched rows, ${granted.length} granted a category (${changed} records changed), ${output.unmatched} unmatched. Run \`pipeline merchants run build\`.`,
  );
  return 0;
}
