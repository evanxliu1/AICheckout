import { describe, expect, it } from 'vitest';
import { cartSnapshotSchema, probeSchema } from '../src/checkout/contracts';

const url = 'https://shop.example.com/checkout';
const legacy = {
  status: 'found',
  merchantId: 'best-buy-us',
  currency: 'USD',
  amountCents: 2723,
  kind: 'total',
  extractorVersion: 'bestbuy-summary-v1',
};
const generic = { ...legacy, merchantId: 'generic-us-online', extractorVersion: 'generic-reader-v1' };
const snapshotFields = {
  id: '6b89a362-0be9-4dca-990d-7e110e7f91ea',
  tabId: 7,
  documentId: 'doc-1',
  pageKey: 'a'.repeat(64),
  capturedAt: 1000,
};
const probe = (reading: unknown) => probeSchema.safeParse({ url, reading }).success;
const snapshot = (reading: Record<string, unknown>) => {
  const { status: _status, ...fields } = reading;
  return cartSnapshotSchema.safeParse({ ...fields, ...snapshotFields }).success;
};

describe('checkout contracts (legacy and generic readings)', () => {
  it('accepts legacy readings exactly as before', () => {
    expect(probe(legacy)).toBe(true);
    expect(snapshot(legacy)).toBe(true);
    expect(probe({ ...legacy, merchantId: 'newegg-us' })).toBe(false);
    expect(probe({ ...legacy, extractorVersion: 'bestbuy-summary-v2' })).toBe(false);
    expect(probe({ ...legacy, merchantId: 'best-buy-ca' })).toBe(false);
    expect(probe({ ...legacy, currency: 'EUR' })).toBe(false);
    expect(probe({ ...legacy, amountCents: 0 })).toBe(false);
  });
  it('accepts generic readings only with the generic version', () => {
    expect(probe(generic)).toBe(true);
    expect(snapshot(generic)).toBe(true);
    expect(probe({ ...generic, extractorVersion: 'bestbuy-summary-v1' })).toBe(false);
    expect(probe({ ...generic, extractorVersion: 'generic-reader-v2' })).toBe(false);
    expect(probe({ ...generic, extractorVersion: 'generic-summary-v1' })).toBe(false);
    // A generic reading on a legacy site's other pages names that store.
    expect(probe({ ...generic, merchantId: 'best-buy-us' })).toBe(true);
    expect(snapshot({ ...generic, merchantId: 'best-buy-us' })).toBe(true);
  });
  it('accepts the withheld reason beside the legacy ones', () => {
    expect(probe({ status: 'unavailable', reason: 'withheld' })).toBe(true);
    expect(probe({ status: 'unavailable', reason: 'unsupported-currency' })).toBe(true);
    expect(probe({ status: 'unavailable', reason: 'no-summary' })).toBe(false);
    expect(probe({ status: 'unavailable', reason: 'withheld', text: 'page text' })).toBe(false);
  });
});
