// SHA-256 of each saved capture: the real-terms corpus (evals/curation/real/manifest.json), the
// merchant MCC pages the catalog cites (merchant-manifest.json), the Stage 2 expansion corpus
// (evals/curation/expansion/manifest.json) and every card-expansion pipeline batch
// (evals/curation/batches/<batch>/manifest.json, bundled at build time, so a new batch is known once
// main is deployed), plus the freshness records (evals/curation/freshness/<date>.json, Phase 9): a page
// found unchanged on date D with hash H is a capture of H dated D, so a source re-checked on D accepts exactly
// that hash. URLs, dates and hashes only, no page text. The review app compares captures with them to catch
// a mislabelled or changed file.
import { z } from 'zod';
import manifest from '../../../evals/curation/real/manifest.json';
import merchantManifest from '../../../evals/curation/real/merchant-manifest.json';
import expansionManifest from '../../../evals/curation/expansion/manifest.json';

const manifestSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      sha256: z.string(),
      capturedOn: z.string().optional(),
      checkedOn: z.string().optional(),
    }),
  ),
});
type Manifest = z.infer<typeof manifestSchema>;
const batchManifests = import.meta.glob('../../../evals/curation/batches/*/manifest.json', {
  eager: true,
  import: 'default',
});

const freshnessRecords = import.meta.glob('../../../evals/curation/freshness/*.json', {
  eager: true,
  import: 'default',
});
const freshnessSchema = z.object({
  sources: z.array(
    z.object({
      sourceId: z.string(),
      sha256: z.string().nullable(),
      result: z.enum(['unchanged', 'changed', 'unreachable', 'flagged']),
      checkedOn: z.string(),
    }),
  ),
});

/** The batch manifests that parse, sorted by path; a malformed one is skipped with a console warning. */
export function parseBatchManifests(files: Record<string, unknown>) {
  return Object.keys(files)
    .sort()
    .flatMap((path) => {
      const parsed = manifestSchema.safeParse(files[path]);
      if (parsed.success) return [parsed.data];
      console.warn(`Skipping malformed capture manifest ${path}`);
      return [];
    });
}

/**
 * The freshness records as manifests, sorted by path: each page a record found unchanged becomes a capture of that
 * hash dated the record's day, as the catalog builder dates it (scripts/lib/freshness.mjs `freshDates`). A changed,
 * flagged or failed render is no capture: a changed page is re-captured in a refresh batch. A malformed record is
 * skipped with a console warning.
 */
export function parseFreshnessRecords(files: Record<string, unknown>): Manifest[] {
  return Object.keys(files)
    .sort()
    .flatMap((path) => {
      const parsed = freshnessSchema.safeParse(files[path]);
      if (!parsed.success) {
        console.warn(`Skipping malformed freshness record ${path}`);
        return [];
      }
      return [
        {
          sources: parsed.data.sources.flatMap((entry) =>
            entry.sha256 && entry.result === 'unchanged'
              ? [{ id: entry.sourceId, sha256: entry.sha256, checkedOn: entry.checkedOn }]
              : [],
          ),
        },
      ];
    });
}

interface Capture {
  sha256: string;
  /** The capture date and, when a later re-check found the page unchanged, the checked date. */
  dates: string[];
}
/** Every known capture per source ID: a refreshed source keeps its ID and gets one entry per dated capture. */
export function hashIndex(manifests: Manifest[]) {
  const index = new Map<string, Capture[]>();
  for (const { sources } of manifests)
    for (const source of sources)
      index.set(source.id, [
        ...(index.get(source.id) ?? []),
        {
          sha256: source.sha256,
          dates: [source.capturedOn, source.checkedOn].filter((date): date is string => !!date),
        },
      ]);
  return index;
}

const hashes = hashIndex([
  manifest,
  merchantManifest,
  expansionManifest,
  ...parseBatchManifests(batchManifests),
  ...parseFreshnessRecords(freshnessRecords),
]);

/** Hex SHA-256 of the UTF-8 text, as the database computes content_hash; undefined if unavailable. */
export async function sha256(text: string) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

/** The captures the source's date selects: those dated `checkedOn` when a manifest has one, otherwise the
 * newest-dated capture (a page re-checked unchanged after its capture, or a source dated before its capture was
 * saved). An older capture of a refreshed page never stands in for a newer date. */
function selected(captures: Capture[], checkedOn: string | undefined) {
  const dated = checkedOn ? captures.filter((capture) => capture.dates.includes(checkedOn)) : [];
  if (dated.length) return dated;
  const latest = (capture: Capture) => capture.dates.reduce((a, b) => (b > a ? b : a), '');
  const newest = captures.reduce((a, capture) => (latest(capture) > a ? latest(capture) : a), '');
  return captures.filter((capture) => latest(capture) === newest);
}

/** "matches" when the hash is a capture the source's date selects, "differs" when the source is known but no
 * selected capture has the hash, undefined when no manifest has the source or there is no hash. */
export function compareWithIndex(
  index: Map<string, Capture[]>,
  sourceId: string,
  hash: string | undefined,
  checkedOn?: string,
) {
  const known = index.get(sourceId);
  if (!known || !hash) return undefined;
  return selected(known, checkedOn).some((capture) => capture.sha256 === hash) ? 'matches' : 'differs';
}

/** For a hash that differs: "matches the A capture, not the one dated B" when it is another dated capture. */
export function staleCaptureNote(
  index: Map<string, Capture[]>,
  sourceId: string,
  hash: string | undefined,
  checkedOn: string | undefined,
) {
  const captures = index.get(sourceId) ?? [];
  const other = captures.find((capture) => capture.sha256 === hash && capture.dates.length);
  const wanted = selected(captures, checkedOn).flatMap((capture) => capture.dates);
  if (!other || !wanted.length || compareWithIndex(index, sourceId, hash, checkedOn) !== 'differs')
    return undefined;
  return `matches the ${other.dates[0]} capture, not the one dated ${checkedOn && wanted.includes(checkedOn) ? checkedOn : wanted.sort().at(-1)}`;
}

export const manifestComparison = (sourceId: string, hash: string | undefined, checkedOn?: string) =>
  compareWithIndex(hashes, sourceId, hash, checkedOn);
export const manifestStaleNote = (sourceId: string, hash: string | undefined, checkedOn?: string) =>
  staleCaptureNote(hashes, sourceId, hash, checkedOn);
