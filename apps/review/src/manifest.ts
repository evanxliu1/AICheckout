// SHA-256 of each saved capture: the real-terms corpus (evals/curation/real/manifest.json), the
// merchant MCC pages the catalog cites (merchant-manifest.json), the Stage 2 expansion corpus
// (evals/curation/expansion/manifest.json) and every card-expansion pipeline batch
// (evals/curation/batches/<batch>/manifest.json, bundled at build time, so a new batch is known once
// main is deployed). URLs, dates and hashes only, no page text. The review app compares captures with
// them to catch a mislabelled or changed file.
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

/** The captures the source's date selects: those dated `checkedOn` when a manifest has one (an older or newer
 * capture of a refreshed page must not stand in for it), otherwise every known capture (a page re-checked
 * unchanged after its capture, or a source dated before its capture was saved). */
function selected(captures: Capture[], checkedOn: string | undefined) {
  const dated = checkedOn ? captures.filter((capture) => capture.dates.includes(checkedOn)) : [];
  return dated.length ? dated : captures;
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
  const other = index.get(sourceId)?.find((capture) => capture.sha256 === hash && capture.dates.length);
  if (!other || !checkedOn || compareWithIndex(index, sourceId, hash, checkedOn) !== 'differs')
    return undefined;
  return `matches the ${other.dates[0]} capture, not the one dated ${checkedOn}`;
}

export const manifestComparison = (sourceId: string, hash: string | undefined, checkedOn?: string) =>
  compareWithIndex(hashes, sourceId, hash, checkedOn);
export const manifestStaleNote = (sourceId: string, hash: string | undefined, checkedOn?: string) =>
  staleCaptureNote(hashes, sourceId, hash, checkedOn);
