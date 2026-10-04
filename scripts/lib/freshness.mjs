// Freshness records (Phase 9, wiki/system/card-expansion-pipeline.md "Freshness"): `pipeline freshness` re-renders
// every source the catalog cites, as capture does, compares SHA-256 with the source's manifest and writes one
// committed, text-free record per day, `evals/curation/freshness/<YYYY-MM-DD>.json`. The catalog builder dates a
// manifest source by the newest record date that saw the page with the manifest's hash (`freshDates`), the review app
// accepts that hash for that date, and refresh batches are seeded from the sources a record found changed.
//
// Text-free by construction: strict objects, and every string is an ID, hash, date, version or code.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** A catalog version label, as `CATALOG_VERSION` in catalog-batches.mjs (which imports this module). */
const CATALOG_VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+\.[0-9]+$/;

export const FRESHNESS_DIR = 'evals/curation/freshness';
/** The merchant MCC pages' capture manifest (not a layer of the build config; `merchants.json` cites them). */
export const MERCHANT_MANIFEST = 'evals/curation/real/merchant-manifest.json';
/** The layer name a record gives the merchant MCC sources. */
export const MERCHANT_LAYER = 'merchants';

export const FRESHNESS_RESULTS = ['unchanged', 'changed', 'unreachable', 'flagged'];
/** Codes for the capture run's flags (scripts/capture-issuer-pages.mjs report). */
export const FRESHNESS_FLAGS = ['http-error', 'short', 'bot-wall', 'pdf-download', 'fetch-failed', 'other'];
/** Flags that make a page with another hash `flagged` rather than `changed`: it may not be the page at all. */
export const PROBLEM_FLAGS = new Set(['http-error', 'short', 'bot-wall', 'fetch-failed']);

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const sourceId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const version = z.string().regex(/^[0-9][0-9A-Za-z.+-]{0,39}$/);

export const freshnessEntrySchema = z.strictObject({
  sourceId,
  /** The build-config layer whose manifest supplies the source's hash (`merchants` for the MCC pages). */
  layer: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
  manifestSha256: sha256,
  /** SHA-256 of the re-rendered, normalized text; null when nothing was rendered. */
  sha256: sha256.nullable(),
  result: z.enum(FRESHNESS_RESULTS),
  flags: z.array(z.enum(FRESHNESS_FLAGS)),
  checkedOn: z.iso.date(),
});

const counts = z.strictObject(
  Object.fromEntries(FRESHNESS_RESULTS.map((result) => [result, z.int().nonnegative()])),
);

export const freshnessRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    checkedOn: z.iso.date(),
    /** The build config's catalog version whose sources were checked. */
    catalogVersion: z.string().regex(CATALOG_VERSION),
    renderer: z.strictObject({
      /** SHA-256 of scripts/capture-issuer-pages.mjs (the renderer and normalizer). */
      captureScriptSha256: sha256,
      playwright: version.nullable(),
      chromium: version.nullable(),
    }),
    /** Sources per result: the false-change measurement. */
    counts,
    sources: z.array(freshnessEntrySchema),
  })
  .superRefine((record, ctx) => {
    const issue = (message, path = []) => ctx.addIssue({ code: 'custom', message, path });
    const ids = record.sources.map((entry) => entry.sourceId);
    if (new Set(ids).size !== ids.length) issue('source IDs are unique', ['sources']);
    for (const result of FRESHNESS_RESULTS) {
      const n = record.sources.filter((entry) => entry.result === result).length;
      if (record.counts[result] !== n) issue(`counts.${result} is ${n}`, ['counts', result]);
    }
    record.sources.forEach((entry, i) => {
      const at = ['sources', i];
      if (entry.checkedOn !== record.checkedOn) issue('checkedOn is the record date', [...at, 'checkedOn']);
      const same = entry.sha256 === entry.manifestSha256;
      const ok = {
        unchanged: same,
        changed: entry.sha256 !== null && !same,
        unreachable: entry.sha256 === null,
        flagged: entry.sha256 !== null && !same,
      }[entry.result];
      if (!ok) issue(`result ${entry.result} does not fit the hashes`, [...at, 'result']);
    });
  });

/** Counts per result of record entries. */
export const freshnessCounts = (sources) =>
  Object.fromEntries(
    FRESHNESS_RESULTS.map((result) => [result, sources.filter((entry) => entry.result === result).length]),
  );

/** Every committed freshness record, oldest first; a malformed record or a misnamed file throws. */
export async function loadFreshnessRecords(root) {
  const dir = join(root, FRESHNESS_DIR);
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json')).sort();
  const records = [];
  for (const name of names) {
    const parsed = freshnessRecordSchema.safeParse(JSON.parse(await readFile(join(dir, name), 'utf8')));
    if (!parsed.success) throw new Error(`${FRESHNESS_DIR}/${name}: ${z.prettifyError(parsed.error)}`);
    if (`${parsed.data.checkedOn}.json` !== name)
      throw new Error(`${FRESHNESS_DIR}/${name}: the file is named after its checkedOn`);
    records.push(parsed.data);
  }
  return records;
}

/**
 * Newest date per `<sourceId> <sha256>` on which a record found the page unchanged (its hash the manifest's). Only
 * `unchanged` dates a capture: a `changed` render's hash may equal an older layer's capture of the same source, which
 * would then out-date the newer batch's capture; a flagged or failed render never dates a page.
 */
export function freshDates(records) {
  const dates = new Map();
  for (const record of records)
    for (const entry of record.sources) {
      if (entry.result !== 'unchanged') continue;
      const key = `${entry.sourceId} ${entry.sha256}`;
      if (!dates.has(key) || dates.get(key) < entry.checkedOn) dates.set(key, entry.checkedOn);
    }
  return dates;
}
