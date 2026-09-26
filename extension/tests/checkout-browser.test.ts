import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
vi.mock('../src/checkout/content.ts?script&iife', () => ({ default: 'src/checkout/content.js' }));
import { readActiveCheckout, validateActiveCheckout } from '../src/checkout/browser';

const execute = vi.fn(); const query = vi.fn();
const url = 'https://www.bestbuy.com/cart?private-session=do-not-store';
const reading = { status: 'found', merchantId: 'best-buy-us', currency: 'USD', amountCents: 12345, kind: 'total', extractorVersion: 'bestbuy-summary-v1' };
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  query.mockReset().mockResolvedValue([{ id: 7, url }]);
  execute.mockReset().mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
    .mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url, reading } }]);
  vi.stubGlobal('chrome', { tabs: { query }, scripting: { executeScript: execute } });
});
afterEach(() => vi.unstubAllGlobals());
describe('checkout browser boundary', () => {
  it('accepts the matching Newegg reader but rejects a different merchant or reader version on that page', async () => {
    const nextUrl = 'https://secure.newegg.com/shop/cart';
    query.mockResolvedValue([{ id: 7, url: nextUrl }]);
    const next = { ...reading, merchantId: 'newegg-us', kind: 'subtotal', extractorVersion: 'newegg-summary-v1' };
    execute.mockReset().mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
      .mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url: nextUrl, reading: next } }]);
    const captured = await readActiveCheckout();
    expect(captured).toMatchObject({ merchantId: 'newegg-us', kind: 'subtotal' });
    await expect(validateActiveCheckout(captured)).resolves.toBeUndefined();
    execute.mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url: nextUrl, reading } }]);
    await expect(validateActiveCheckout(captured)).rejects.toThrow('cart or page changed');
    execute.mockReset().mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
      .mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url: nextUrl, reading } }]);
    await expect(readActiveCheckout()).rejects.toThrow('cart or page changed');
    execute.mockReset().mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
      .mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url: nextUrl, reading: { ...next, extractorVersion: 'bestbuy-summary-v1' } } }]);
    await expect(readActiveCheckout()).rejects.toThrow('ambiguous');
  });
  it('uses the same top-level document and stores no raw page URL or query values', async () => {
    const snapshot = await readActiveCheckout(1000);
    expect(snapshot).toMatchObject({ amountCents: 12345, tabId: 7, documentId: 'doc-1', capturedAt: 1000 });
    expect(snapshot.pageKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain('private-session');
    expect(execute.mock.calls[0][0]).toMatchObject({ target: { tabId: 7, frameIds: [0] }, world: 'ISOLATED', files: ['src/checkout/content.js'] });
    expect(execute.mock.calls[1][0]).toMatchObject({ target: { tabId: 7, documentIds: ['doc-1'] } });
    await expect(validateActiveCheckout(snapshot)).resolves.toBeUndefined();
  });
  it('does not inject on unapproved pages or when Chrome has not granted activeTab', async () => {
    query.mockResolvedValue([{ id: 7, url: 'https://www.bestbuy.ca/cart' }]);
    await expect(readActiveCheckout()).rejects.toThrow('Best Buy US');
    query.mockResolvedValue([{ id: 7 }]);
    await expect(readActiveCheckout()).rejects.toThrow('toolbar');
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects navigation even when a new document has the same URL', async () => {
    execute.mockReset().mockResolvedValueOnce([{ documentId: 'doc-1', frameId: 0 }])
      .mockResolvedValueOnce([{ documentId: 'doc-2', frameId: 0, result: { url, reading } }]);
    await expect(readActiveCheckout()).rejects.toThrow('page changed');
  });
  it('rejects switching tabs before capture completes', async () => {
    query.mockReset().mockResolvedValueOnce([{ id: 7, url }]).mockResolvedValueOnce([{ id: 8, url }]);
    await expect(readActiveCheckout()).rejects.toThrow('page changed');
  });
  it('rejects a changed amount before comparison without reusing old page data', async () => {
    const snapshot = await readActiveCheckout();
    execute.mockResolvedValue([{ documentId: 'doc-1', frameId: 0, result: { url, reading: { ...reading, amountCents: 99999 } } }]);
    await expect(validateActiveCheckout(snapshot)).rejects.toThrow('cart or page changed');
  });
  it('rejects a same-amount result from another URL', async () => {
    const snapshot = await readActiveCheckout();
    query.mockResolvedValue([{ id: 7, url: 'https://www.bestbuy.com/checkout' }]);
    await expect(validateActiveCheckout(snapshot)).rejects.toThrow('cart or page changed');
  });
  it('rejects malformed or unavailable page data and does not expose the raw Chrome error', async () => {
    execute.mockReset().mockResolvedValueOnce([{ documentId: 'doc-1' }]).mockResolvedValueOnce([{ documentId: 'doc-1', frameId: 0, result: { url, reading: { ...reading, amountCents: -1 } } }]);
    await expect(readActiveCheckout()).rejects.toThrow('ambiguous');
    execute.mockReset().mockRejectedValue(new Error('private Chrome internals'));
    await expect(readActiveCheckout()).rejects.toThrow('Chrome could not read');
  });
});
