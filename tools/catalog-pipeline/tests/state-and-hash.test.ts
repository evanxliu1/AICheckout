import { describe, expect, it } from 'vitest';
import { anchorsHash, inputHash, isAnchorPath, labelsHash } from '../src/hash.ts';
import { verifierFindings } from '../src/inputs.ts';
import { initialState, stateSchema } from '../src/state.ts';

const HASH = `sha256:${'b'.repeat(64)}`;
const example = {
  schemaVersion: 1,
  batch: 'wells-fargo-2026-10',
  updatedAt: '2026-10-05T10:00:09Z',
  cards: {
    'wells-fargo-autograph': {
      stages: {
        capture: {
          status: 'done',
          stageVersion: 'capture.1',
          inputHash: HASH,
          outputs: [{ ref: 'manifest:wells-fargo-autograph-product', sha256: 'c'.repeat(64) }],
          finishedAt: '2026-10-05T10:00:09Z',
          attempts: 1,
          metrics: { sources: 3, flags: 0 },
        },
        extract: {
          status: 'paused',
          stageVersion: 'extract.1',
          inputHash: HASH,
          pausedUntil: '2026-10-05T11:15:00Z',
          reason: 'usage-limit',
        },
        freshness: { status: 'pending' },
      },
      dropped: null,
      heldOut: null,
    },
  },
  issuers: {
    'wells-fargo': {
      stages: {
        verify: {
          status: 'done',
          packetId: 'p-3f9a',
          agentRun: 'run-71b2',
          model: 'claude-opus-5-5',
          acceptedAt: '2026-10-05T12:00:00Z',
        },
      },
    },
  },
  batchStages: { build: { status: 'pending' }, eval: { status: 'pending' } },
};

describe('state schema', () => {
  it("accepts the design page's record", () => {
    expect(stateSchema.parse(example)).toEqual(example);
  });

  it('accepts a fresh state', () => {
    expect(() => initialState('wells-fargo-2026-10', ['wells-fargo'], new Date())).not.toThrow();
  });

  const withCapture = (patch: Record<string, unknown>) => {
    const copy = structuredClone(example) as typeof example;
    Object.assign(copy.cards['wells-fargo-autograph'].stages.capture, patch);
    return copy;
  };

  it.each([
    ['a sentence as a reason', { reason: 'The page says earn 3X points on dining' }],
    [
      'a quote in an output ref',
      { outputs: [{ ref: 'manifest:earn 3X on dining', sha256: 'c'.repeat(64) }] },
    ],
    ['a non-hash input hash', { inputHash: 'earn 3X points' }],
    ['a free-text field', { note: 'issuer text' }],
    ['model text in metrics', { metrics: { sources: 'three' } }],
    ['a running status', { status: 'running' }],
  ])('rejects %s', (_, patch) => {
    expect(stateSchema.safeParse(withCapture(patch)).success).toBe(false);
  });

  it('rejects text in a model id, an issuer key or a card key', () => {
    const model = structuredClone(example);
    model.issuers['wells-fargo'].stages.verify.model = 'claude says the rate is 3%';
    expect(stateSchema.safeParse(model).success).toBe(false);
    const issuer = structuredClone(example) as Record<string, unknown> & typeof example;
    issuer.issuers = { 'Wells Fargo Bank': { stages: {} } } as never;
    expect(stateSchema.safeParse(issuer).success).toBe(false);
    const card = structuredClone(example);
    (card.cards as Record<string, unknown>)['Autograph card'] = card.cards['wells-fargo-autograph'];
    expect(stateSchema.safeParse(card).success).toBe(false);
  });
});

describe('input hash', () => {
  it('is independent of input order and changes with any part', () => {
    const a = { ref: 'manifest:a', sha256: '1'.repeat(64) };
    const b = { ref: 'manifest:b', sha256: '2'.repeat(64) };
    const base = inputHash('extract', 'extract.1', { model: 'm' }, [a, b]);
    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(inputHash('extract', 'extract.1', { model: 'm' }, [b, a])).toBe(base);
    expect(inputHash('extract', 'extract.2', { model: 'm' }, [a, b])).not.toBe(base);
    expect(inputHash('extract', 'extract.1', { model: 'n' }, [a, b])).not.toBe(base);
    expect(inputHash('draft', 'extract.1', { model: 'm' }, [a, b])).not.toBe(base);
    expect(inputHash('extract', 'extract.1', { model: 'm' }, [a, { ...b, sha256: '3'.repeat(64) }])).not.toBe(
      base,
    );
  });
});

describe('labels and anchors hashes', () => {
  const draft = {
    id: 'x',
    cardId: 'x',
    reference: {
      rewardCurrency: { value: 'points', anchors: ['fake words one'] },
      rules: [
        { category: 'dining', issuerWording: 'fake words one', rateBps: 300, anchors: ['fake words one'] },
      ],
    },
  };
  it('splits a case: anchors move only the anchors hash, labels only the labels hash', () => {
    const moved = structuredClone(draft);
    moved.reference.rules[0].anchors = ['fake words two'];
    expect(labelsHash(moved)).toBe(labelsHash(draft));
    expect(anchorsHash(moved)).not.toBe(anchorsHash(draft));
    // The issuer wording is a label: the verifier judges it and the catalog ships it.
    const reworded = structuredClone(draft);
    reworded.reference.rules[0].issuerWording = 'fake words two';
    expect(labelsHash(reworded)).not.toBe(labelsHash(draft));
    expect(anchorsHash(reworded)).toBe(anchorsHash(draft));
    const relabelled = structuredClone(draft);
    relabelled.reference.rules[0].rateBps = 400;
    expect(labelsHash(relabelled)).not.toBe(labelsHash(draft));
    expect(anchorsHash(relabelled)).toBe(anchorsHash(draft));
  });

  it('verifier findings ignore adjudication and anchor-path current values', () => {
    expect(isAnchorPath('reference.rules.0.anchors.1')).toBe(true);
    expect(isAnchorPath('reference.rules.0.issuerWording')).toBe(false);
    expect(isAnchorPath('reference.rules.0.rateBps')).toBe(false);
    const card = {
      cardId: 'x',
      verdict: 'fixed',
      fixes: [
        { path: 'reference.rules.0.anchors.0', current: 'old', corrected: 'new' },
        {
          path: 'reference.rules.0.rateBps',
          current: 300,
          corrected: 400,
          adjudication: { decision: 'accepted' },
        },
      ],
    };
    expect(verifierFindings(card)).toEqual({
      cardId: 'x',
      verdict: 'fixed',
      fixes: [
        { path: 'reference.rules.0.anchors.0', corrected: 'new' },
        { path: 'reference.rules.0.rateBps', current: 300, corrected: 400 },
      ],
    });
  });
});
