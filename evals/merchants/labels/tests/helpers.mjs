// Synthetic reader-labels.2 labels for the label tool tests (no capture is read).
export const H = (c) => c.repeat(64);

export function label(id, over = {}) {
  const [, state, transform] = id.split('/');
  return {
    id,
    split: 'development',
    state,
    origin: transform ? 'variant' : 'action',
    snapshotSha256: H('a'),
    domSha256: H('b'),
    readable: 'top-frame',
    displayed: [
      { kind: 'subtotal', amountMinor: 2000, currency: 'GBP' },
      { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
    ],
    expected: { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
    currencyEvidence: 'c-symbol',
    currencyConflict: false,
    observedTags: [],
    confidence: 'high',
    notes: '',
    ...over,
  };
}

export const nullExpected = (reason, over = {}) => ({
  expected: null,
  expectedReason: reason,
  currencyEvidence: undefined,
  currencyConflict: undefined,
  ...over,
});

/** Drop undefined keys, as JSON would. */
export const clean = (o) => JSON.parse(JSON.stringify(o));

export const labellerFile = (id, labels, split = 'development') =>
  clean({
    schema: 'reader-labels.2',
    role: 'labeller',
    split,
    labeller: { id, model: 'claude-opus-5-5' },
    labels: labels.map((l) => ({ ...l, split })),
  });
