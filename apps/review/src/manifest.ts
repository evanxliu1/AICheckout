// SHA-256 of each capture in the real-terms corpus (evals/curation/real/manifest.json: URLs, dates and
// hashes only, no issuer text). The review app compares captures with it to catch a mislabelled file.
import manifest from '../../../evals/curation/real/manifest.json';

const hashes = new Map(manifest.sources.map((source) => [source.id, source.sha256]));
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
