// SHA-256 of each saved capture: the real-terms corpus (evals/curation/real/manifest.json), the
// merchant MCC pages the catalog cites (merchant-manifest.json), the Stage 2 expansion corpus
// (evals/curation/expansion/manifest.json) and every card-expansion pipeline batch
// (evals/curation/batches/<batch>/manifest.json, bundled at build time, so a new batch is known once
// main is deployed). URLs, dates and hashes only, no page text. The review app compares captures with
// them to catch a mislabelled or changed file.
import manifest from '../../../evals/curation/real/manifest.json';
import merchantManifest from '../../../evals/curation/real/merchant-manifest.json';
import expansionManifest from '../../../evals/curation/expansion/manifest.json';

interface Manifest {
  sources: { id: string; sha256: string }[];
}
const batchManifests = import.meta.glob<Manifest>('../../../evals/curation/batches/*/manifest.json', {
  eager: true,
  import: 'default',
});

/** Every known SHA-256 per source ID: a refreshed source keeps its ID and gets one hash per dated capture. */
export function hashIndex(manifests: Manifest[]) {
  const index = new Map<string, Set<string>>();
  for (const { sources } of manifests)
    for (const source of sources)
      index.set(source.id, (index.get(source.id) ?? new Set()).add(source.sha256));
  return index;
}

const hashes = hashIndex([
  manifest,
  merchantManifest,
  expansionManifest,
  ...Object.keys(batchManifests)
    .sort()
    .map((path) => batchManifests[path]),
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

/** "matches" when the hash is any known capture of the source, "differs" when the source is known but
 * no hash matches, undefined when no manifest has the source or there is no hash. */
export function compareWithIndex(
  index: Map<string, Set<string>>,
  sourceId: string,
  hash: string | undefined,
) {
  const known = index.get(sourceId);
  if (!known || !hash) return undefined;
  return known.has(hash) ? 'matches' : 'differs';
}

export const manifestComparison = (sourceId: string, hash: string | undefined) =>
  compareWithIndex(hashes, sourceId, hash);
