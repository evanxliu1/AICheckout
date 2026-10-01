// SHA-256 of each saved capture: the real-terms corpus (evals/curation/real/manifest.json) and the
// merchant MCC pages the catalog cites (merchant-manifest.json). URLs, dates and hashes only, no page
// text. The review app compares captures with them to catch a mislabelled file.
import manifest from '../../../evals/curation/real/manifest.json';
import merchantManifest from '../../../evals/curation/real/merchant-manifest.json';

const hashes = new Map(
  [...manifest.sources, ...merchantManifest.sources].map((source) => [source.id, source.sha256]),
);
export const manifestHash = (sourceId: string) => hashes.get(sourceId);

/** Hex SHA-256 of the UTF-8 text, as the database computes content_hash; undefined if unavailable. */
export async function sha256(text: string) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

/** "matches" / "differs" when the corpus manifest has this source, otherwise undefined. */
export function manifestComparison(sourceId: string, hash: string | undefined) {
  const expected = manifestHash(sourceId);
  if (!expected || !hash) return undefined;
  return expected === hash ? 'matches' : 'differs';
}
