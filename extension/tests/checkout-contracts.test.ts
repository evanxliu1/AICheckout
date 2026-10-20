import { describe, expect, it } from 'vitest';
import { cartSnapshotSchema, probeSchema, storedCartSnapshotSchema } from '../src/checkout/contracts';

const url = 'https://shop.example.com/checkout';
const generic = {
  status: 'found',
  merchantId: 'generic-us-online',
  currency: 'USD',
  amountCents: 2723,
  kind: 'total',
  extractorVersion: 'generic-reader-v1',
};
const snapshotFields = {
  id: '6b89a362-0be9-4dca-990d-7e110e7f91ea',
  tabId: 7,
  documentId: 'doc-1',
  pageKey: 'a'.repeat(64),
  capturedAt: 1000,
};
const probe = (reading: unknown) => probeSchema.safeParse({ url, reading }).success;
const snapshot = (reading: Record<string, unknown>) => {
  const fields = Object.fromEntries(Object.entries(reading).filter(([key]) => key !== 'status'));
  return cartSnapshotSchema.safeParse({ ...fields, ...snapshotFields }).success;
};

describe('checkout contracts (generic readings only, Phase 15.1)', () => {
  it('accepts a generic reading that names the generic store with the generic version', () => {
    expect(probe(generic)).toBe(true);
    expect(snapshot(generic)).toBe(true);
    expect(probe({ ...generic, currency: 'EUR' })).toBe(false);
    expect(probe({ ...generic, amountCents: 0 })).toBe(false);
    expect(probe({ ...generic, extractorVersion: 'generic-reader-v2' })).toBe(false);
    expect(probe({ ...generic, extractorVersion: 'generic-summary-v1' })).toBe(false);
  });
  it('refuses the retired adapters’ versions and stores in a probe', () => {
    for (const extractorVersion of ['bestbuy-summary-v1', 'newegg-summary-v1', 'amazon-summary-v1'])
      expect(probe({ ...generic, extractorVersion }), extractorVersion).toBe(false);
    expect(probe({ ...generic, merchantId: 'best-buy-us', extractorVersion: 'bestbuy-summary-v1' })).toBe(
      false,
    );
    // A content script never names a store: the worker resolves the tab's store (Phase 14.2).
    expect(probe({ ...generic, merchantId: 'best-buy-us' })).toBe(false);
    expect(probe({ ...generic, merchantId: 'kroger-us' })).toBe(false);
  });
  it('a snapshot carries the store the worker resolved, with the generic version only', () => {
    expect(snapshot({ ...generic, merchantId: 'best-buy-us' })).toBe(true);
    expect(snapshot({ ...generic, merchantId: 'kroger-us' })).toBe(true);
    expect(snapshot({ ...generic, merchantId: 'best-buy-us', extractorVersion: 'bestbuy-summary-v1' })).toBe(
      false,
    );
  });
  it('accepts the unavailable reasons and nothing else', () => {
    expect(probe({ status: 'unavailable', reason: 'withheld' })).toBe(true);
    expect(probe({ status: 'unavailable', reason: 'not-a-cart' })).toBe(true);
    expect(probe({ status: 'unavailable', reason: 'unsupported-currency' })).toBe(true);
    expect(probe({ status: 'unavailable', reason: 'no-summary' })).toBe(false);
    // The retired adapters' own reasons (Phase 15.1): nothing produces them any more.
    for (const reason of ['summary-missing', 'ambiguous-amount', 'page-loading'])
      expect(probe({ status: 'unavailable', reason }), reason).toBe(false);
    expect(probe({ status: 'unavailable', reason: 'withheld', text: 'page text' })).toBe(false);
  });
  it('a stored state’s adapter-read cart (before Phase 15.1) reads as no saved cart', () => {
    const fields = {
      ...Object.fromEntries(Object.entries(generic).filter(([key]) => key !== 'status')),
      ...snapshotFields,
    };
    expect(storedCartSnapshotSchema.parse(fields)).toEqual(fields);
    expect(storedCartSnapshotSchema.parse({ ...fields, extractorVersion: 'bestbuy-summary-v1' })).toBeNull();
    expect(storedCartSnapshotSchema.parse(null)).toBeNull();
    expect(
      storedCartSnapshotSchema.safeParse({ ...fields, extractorVersion: 'generic-reader-v2' }).success,
    ).toBe(false);
  });
});
