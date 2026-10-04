// Input hashing (wiki/system/card-expansion-pipeline.md, "Input hashing and invalidation"):
// sha256(canonicalJson({ stage, stageVersion, config, inputs })) with `inputs` the sorted { ref, sha256 } list.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalJson } from '../../../apps/api/src/curation/canonical.ts';

export { canonicalJson };

export interface InputRef {
  ref: string;
  sha256: string;
}

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Hash of a JSON value in canonical form. */
export const jsonSha256 = (value: unknown): string => sha256Hex(canonicalJson(value));

/** Stands in for a committed file that does not exist (yet), so its later appearance changes the hash. */
export const ABSENT_SHA256 = sha256Hex('catalog-pipeline:absent');

/** SHA-256 of a file's bytes, or null when it does not exist. */
export async function fileSha256(path: string): Promise<string | null> {
  try {
    return sha256Hex(await readFile(path));
  } catch {
    return null;
  }
}

export function inputHash(stage: string, stageVersion: string, config: unknown, inputs: InputRef[]): string {
  const sorted = [...inputs].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return `sha256:${jsonSha256({ stage, stageVersion, config, inputs: sorted })}`;
}

/**
 * Fields that carry quotes or evidence rather than labels: anchors, quotes, issuer wordings (verbatim spans), a
 * hint's anchor method and the drafting notes about anchors. The labels hash leaves them out, the anchors hash
 * holds only them, so a re-draft that moves anchors without changing a label leaves verification standing.
 */
export const ANCHOR_KEYS = new Set([
  'anchors',
  'anchor',
  'anchorMethod',
  'issuerWording',
  'quote',
  'quotes',
  'evidence',
  'draftNotes',
]);

/** Splits a corpus case (or product-note entry) into its labels and its anchor fields (path → value). */
export function splitAnchors(value: unknown): { labels: unknown; anchors: [string, unknown][] } {
  const anchors: [string, unknown][] = [];
  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((child, i) => walk(child, `${path}.${i}`));
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (ANCHOR_KEYS.has(key)) anchors.push([childPath, child]);
        else out[key] = walk(child, childPath);
      }
      return out;
    }
    return node;
  };
  const labels = walk(value, '');
  anchors.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { labels, anchors };
}

export const labelsHash = (value: unknown): string => `sha256:${jsonSha256(splitAnchors(value).labels)}`;
export const anchorsHash = (value: unknown): string => `sha256:${jsonSha256(splitAnchors(value).anchors)}`;

/** True for a findings path that addresses an anchor field (its `current` moves with a re-draft's anchors). */
export const isAnchorPath = (path: string): boolean => path.split('.').some((part) => ANCHOR_KEYS.has(part));
