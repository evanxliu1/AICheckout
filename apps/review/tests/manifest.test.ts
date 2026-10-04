import { describe, expect, it, vi } from 'vitest';
import batch from '../../../evals/curation/batches/wells-fargo-2026-10/manifest.json';
import expansion from '../../../evals/curation/expansion/manifest.json';
import {
  compareWithIndex,
  hashIndex,
  manifestComparison,
  manifestStaleNote,
  parseBatchManifests,
  parseFreshnessRecords,
  staleCaptureNote,
} from '../src/manifest';

const SHA = (n: number) => String(n).repeat(64);
const index = hashIndex([
  { sources: [{ id: 'page', sha256: SHA(1), capturedOn: '2026-10-02' }] },
  {
    sources: [
      { id: 'page', sha256: SHA(2), capturedOn: '2026-10-04' },
      { id: 'other', sha256: SHA(3), capturedOn: '2026-10-01' },
    ],
  },
]);

describe('manifest comparison', () => {
  it('requires the capture dated checkedOn when a manifest has one', () => {
    expect(compareWithIndex(index, 'page', SHA(2), '2026-10-04')).toBe('matches');
    expect(compareWithIndex(index, 'page', SHA(1), '2026-10-04')).toBe('differs');
    expect(staleCaptureNote(index, 'page', SHA(1), '2026-10-04')).toBe(
      'matches the 2026-10-02 capture, not the one dated 2026-10-04',
    );
    expect(staleCaptureNote(index, 'page', SHA(2), '2026-10-04')).toBeUndefined();
    expect(compareWithIndex(index, 'page', SHA(1), '2026-10-02')).toBe('matches');
  });

  it('falls back to any known capture when none is dated checkedOn', () => {
    // A merchant page dated before its capture was saved, or a page re-checked unchanged later.
    expect(compareWithIndex(index, 'other', SHA(3), '2026-09-28')).toBe('matches');
    expect(compareWithIndex(index, 'page', SHA(2), '2026-11-01')).toBe('matches');
    expect(compareWithIndex(index, 'page', SHA(2))).toBe('matches');
    expect(compareWithIndex(index, 'page', SHA(3), '2026-11-01')).toBe('differs');
    expect(compareWithIndex(index, 'unknown', SHA(1))).toBeUndefined();
    expect(compareWithIndex(index, 'page', undefined)).toBeUndefined();
  });

  it('accepts only the newest capture when checkedOn is later than every capture', () => {
    expect(compareWithIndex(index, 'page', SHA(2), '2026-11-01')).toBe('matches');
    expect(compareWithIndex(index, 'page', SHA(1), '2026-11-01')).toBe('differs');
    expect(staleCaptureNote(index, 'page', SHA(1), '2026-11-01')).toBe(
      'matches the 2026-10-02 capture, not the one dated 2026-10-04',
    );
  });

  it('skips a malformed batch manifest with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parsed = parseBatchManifests({
      'b/manifest.json': { sources: [{ id: 'x', sha256: SHA(4) }] },
      'a/manifest.json': { schemaVersion: 1 },
    });
    expect(parsed).toEqual([{ sources: [{ id: 'x', sha256: SHA(4) }] }]);
    expect(warn).toHaveBeenCalledWith('Skipping malformed capture manifest a/manifest.json');
  });

  it('bundles the pipeline batch manifests alongside the fixed corpora', () => {
    expect(batch.sources.length).toBeGreaterThan(0);
    for (const source of batch.sources)
      expect(manifestComparison(source.id, source.sha256, source.capturedOn)).toBe('matches');
    expect(manifestComparison(batch.sources[0].id, SHA(9))).toBe('differs');
    expect(manifestComparison('citi-double-cash-product', SHA(9))).toBe('differs');
  });

  it('refuses the older capture of a refreshed source for the newer date', () => {
    const id = 'wells-fargo-autograph-pricing';
    const old = expansion.sources.find((source) => source.id === id)!;
    const fresh = batch.sources.find((source) => source.id === id)!;
    expect(old.sha256).not.toBe(fresh.sha256);
    expect(manifestComparison(id, old.sha256, fresh.capturedOn)).toBe('differs');
    expect(manifestStaleNote(id, old.sha256, fresh.capturedOn)).toBe(
      `matches the ${old.capturedOn} capture, not the one dated ${fresh.capturedOn}`,
    );
    expect(manifestComparison(id, old.sha256, old.capturedOn)).toBe('matches');
  });

  it('a source re-checked on date D accepts exactly the hash freshness rendered on D', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = (sourceId: string, sha256: string | null, result: string) => ({
      sourceId,
      layer: 'expansion.v1',
      manifestSha256: SHA(1),
      sha256,
      result,
      flags: [],
      checkedOn: '2026-10-20',
    });
    const records = parseFreshnessRecords({
      'freshness/2026-10-20.json': {
        checkedOn: '2026-10-20',
        sources: [
          entry('page', SHA(1), 'unchanged'),
          entry('moved', SHA(5), 'changed'),
          entry('walled', SHA(6), 'flagged'),
          entry('down', null, 'unreachable'),
        ],
      },
      'freshness/2026-10-19.json': { sources: 'no' },
    });
    expect(warn).toHaveBeenCalledWith('Skipping malformed freshness record freshness/2026-10-19.json');
    expect(records).toEqual([
      {
        sources: [
          { id: 'page', sha256: SHA(1), checkedOn: '2026-10-20' },
          { id: 'moved', sha256: SHA(5), checkedOn: '2026-10-20' },
        ],
      },
    ]);
    const fresh = hashIndex([
      { sources: [{ id: 'page', sha256: SHA(1), capturedOn: '2026-10-02' }] },
      { sources: [{ id: 'page', sha256: SHA(2), capturedOn: '2026-10-04' }] },
      ...records,
    ]);
    // Re-checked on 2026-10-20: the 2026-10-02 capture's hash, not the newer 2026-10-04 one.
    expect(compareWithIndex(fresh, 'page', SHA(1), '2026-10-20')).toBe('matches');
    expect(compareWithIndex(fresh, 'page', SHA(2), '2026-10-20')).toBe('differs');
    expect(compareWithIndex(fresh, 'walled', SHA(6), '2026-10-20')).toBeUndefined();
  });
});
