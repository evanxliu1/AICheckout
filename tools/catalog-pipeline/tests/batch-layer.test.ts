import { describe, expect, it } from 'vitest';
import { withBatchLayer } from '../src/run.ts';

describe('withBatchLayer', () => {
  const batch = {
    id: 'example-bank-2026-10',
    corpus: new Map([['example-bank-alpha', {}]]),
    state: { cards: { 'example-bank-alpha': { dropped: null, heldOut: null } } },
  } as unknown as Parameters<typeof withBatchLayer>[1];
  const config = {
    version: '2026-10-05.renewal.1',
    layers: [
      {
        kind: 'batch',
        id: 'example-bank-2026-10',
        dropped: {},
        exclusionOmissions: { 'example-bank-alpha': ['Cash advances'] },
      },
    ],
  } as unknown as Parameters<typeof withBatchLayer>[0];

  it('keeps the exclusion omissions of a batch already in the build config', () => {
    const next = withBatchLayer(config, batch);
    expect(next.layers).toEqual([
      {
        kind: 'batch',
        id: 'example-bank-2026-10',
        dropped: {},
        exclusionOmissions: { 'example-bank-alpha': ['Cash advances'] },
      },
    ]);
  });

  it('adds a new batch without omissions', () => {
    const next = withBatchLayer({ ...config, layers: [] }, batch);
    expect(next.layers).toEqual([{ kind: 'batch', id: 'example-bank-2026-10', dropped: {} }]);
  });
});
