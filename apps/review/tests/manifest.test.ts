import { describe, expect, it } from 'vitest';
import batch from '../../../evals/curation/batches/wells-fargo-2026-10/manifest.json';
import { compareWithIndex, hashIndex, manifestComparison } from '../src/manifest';

const SHA = (n: number) => String(n).repeat(64);

describe('manifest comparison', () => {
  it('keeps every dated capture of a source: any known hash matches', () => {
    const index = hashIndex([
      { sources: [{ id: 'page', sha256: SHA(1) }] },
      {
        sources: [
          { id: 'page', sha256: SHA(2) },
          { id: 'other', sha256: SHA(3) },
        ],
      },
    ]);
    expect(compareWithIndex(index, 'page', SHA(1))).toBe('matches');
    expect(compareWithIndex(index, 'page', SHA(2))).toBe('matches');
    expect(compareWithIndex(index, 'page', SHA(3))).toBe('differs');
    expect(compareWithIndex(index, 'unknown', SHA(1))).toBeUndefined();
    expect(compareWithIndex(index, 'page', undefined)).toBeUndefined();
  });

  it('bundles the pipeline batch manifests alongside the fixed corpora', () => {
    expect(batch.sources.length).toBeGreaterThan(0);
    for (const source of batch.sources) expect(manifestComparison(source.id, source.sha256)).toBe('matches');
    expect(manifestComparison(batch.sources[0].id, SHA(9))).toBe('differs');
    // A fixed-corpus source is still known.
    expect(manifestComparison('citi-double-cash-product', SHA(9))).toBe('differs');
  });
});
