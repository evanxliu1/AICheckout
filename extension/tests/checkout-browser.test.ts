import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readActiveCheckout, validateActiveCheckout } from '../src/checkout/browser';

const execute = vi.fn();
const query = vi.fn();
// A former adapter store's cart URL: since Phase 15.1 the generic reader reads it like any other page, naming
// the generic store; the snapshot carries the store the worker resolved (`best-buy-us`).
const url = 'https://www.bestbuy.com/cart?private-session=do-not-store';
const reading = {
  status: 'found',
  merchantId: 'generic-us-online',
  currency: 'USD',
  amountCents: 12345,
  kind: 'total',
  extractorVersion: 'generic-reader-v1',
};
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  query.mockReset().mockResolvedValue([{ id: 7, url }]);
  execute
    .mockReset()
    .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
    .mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url, reading } }]);
  vi.stubGlobal('chrome', { tabs: { query }, scripting: { executeScript: execute } });
});
afterEach(() => vi.unstubAllGlobals());
describe('checkout browser boundary', () => {
  it('names Newegg’s cart from the worker’s release and rejects a changed kind or a retired adapter version', async () => {
    const nextUrl = 'https://secure.newegg.com/shop/cart';
    query.mockResolvedValue([{ id: 7, url: nextUrl }]);
    const next = { ...reading, kind: 'subtotal' };
    execute
      .mockReset()
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
      .mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url: nextUrl, reading: next } }]);
    const captured = await readActiveCheckout();
    expect(captured).toMatchObject({
      merchantId: 'newegg-us',
      kind: 'subtotal',
      extractorVersion: 'generic-reader-v1',
    });
    await expect(validateActiveCheckout(captured)).resolves.toBeUndefined();
    // The page now reads as a total: the snapshot is stale.
    execute.mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url: nextUrl, reading } }]);
    await expect(validateActiveCheckout(captured)).rejects.toThrow('cart or page changed');
    // The retired adapter's version is refused by the probe contract (Phase 15.1).
    execute
      .mockReset()
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
      .mockResolvedValue([
        {
          frameId: 0,
          documentId: 'doc-1',
          result: { url: nextUrl, reading: { ...next, extractorVersion: 'newegg-summary-v1' } },
        },
      ]);
    await expect(readActiveCheckout()).rejects.toThrow('ambiguous');
  });
  it('uses the same top-level document and stores no raw page URL or query values', async () => {
    const snapshot = await readActiveCheckout(1000);
    expect(snapshot).toMatchObject({ amountCents: 12345, tabId: 7, documentId: 'doc-1', capturedAt: 1000 });
    expect(snapshot.pageKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain('private-session');
    expect(execute.mock.calls[0][0]).toMatchObject({
      target: { tabId: 7, frameIds: [0] },
      world: 'ISOLATED',
      files: ['src/checkout/content.js'],
    });
    expect(execute.mock.calls[1][0]).toMatchObject({ target: { tabId: 7, documentIds: ['doc-1'] } });
    await expect(validateActiveCheckout(snapshot)).resolves.toBeUndefined();
  });
  it('does not inject on a payment processor’s page and names it (Phase 14.2)', async () => {
    query.mockResolvedValue([{ id: 7, url: 'https://www.paypal.com/checkoutnow?token=x' }]);
    await expect(readActiveCheckout()).rejects.toThrow('This is a payment page, not the store’s.');
    expect(execute).not.toHaveBeenCalled();
  });
  it('asks for no typed amount when Chrome cannot run the reader (A5)', async () => {
    execute.mockReset().mockRejectedValue(new Error('No tab with id'));
    await expect(readActiveCheckout()).rejects.toThrow(
      'Reopen the extension from the cart’s tab and read it again.',
    );
  });
  it('does not inject on non-web pages or when Chrome has not granted activeTab', async () => {
    query.mockResolvedValue([{ id: 7, url: 'chrome://extensions/' }]);
    await expect(readActiveCheckout()).rejects.toThrow('cart or checkout page in a web tab');
    query.mockResolvedValue([{ id: 7 }]);
    await expect(readActiveCheckout()).rejects.toThrow('toolbar');
    expect(execute).not.toHaveBeenCalled();
  });
  describe('generic reader at any other store (Phase 13b)', () => {
    const storeUrl = 'https://shop.example.com/checkout?session=do-not-store';
    const generic = {
      status: 'found',
      merchantId: 'generic-us-online',
      currency: 'USD',
      amountCents: 10000,
      kind: 'estimated-total',
      extractorVersion: 'generic-reader-v1',
    };
    const probe = (reading: unknown, url = storeUrl) => {
      query.mockResolvedValue([{ id: 7, url }]);
      execute
        .mockReset()
        .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1' }])
        .mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: { url, reading } }]);
    };
    it('stores a generic reading at the generic store and validates it again', async () => {
      probe(generic);
      const snapshot = await readActiveCheckout(1000);
      expect(snapshot).toMatchObject({
        merchantId: 'generic-us-online',
        amountCents: 10000,
        kind: 'estimated-total',
        extractorVersion: 'generic-reader-v1',
      });
      expect(JSON.stringify(snapshot)).not.toContain('do-not-store');
      await expect(validateActiveCheckout(snapshot)).resolves.toBeUndefined();
      execute.mockResolvedValue([
        {
          frameId: 0,
          documentId: 'doc-1',
          result: { url: storeUrl, reading: { ...generic, amountCents: 10001 } },
        },
      ]);
      await expect(validateActiveCheckout(snapshot)).rejects.toThrow('cart or page changed');
    });
    it('resolves the tab’s store in the worker for a generic reading: a release host and its pages (Phase 14.2)', async () => {
      // The content script names the generic store; the snapshot carries the store matched for the tab.
      probe(generic, 'https://www.bestbuy.com/site/some-product');
      const snapshot = await readActiveCheckout();
      expect(snapshot).toMatchObject({ merchantId: 'best-buy-us', extractorVersion: 'generic-reader-v1' });
      await expect(validateActiveCheckout(snapshot)).resolves.toBeUndefined();
      probe(generic, 'https://smile.amazon.com/cart');
      await expect(readActiveCheckout()).resolves.toMatchObject({ merchantId: 'amazon-us' });
      // A reading that names the store itself is refused by the contract: only the worker names stores.
      probe({ ...generic, merchantId: 'best-buy-us' }, 'https://www.bestbuy.com/site/some-product');
      await expect(readActiveCheckout()).rejects.toThrow('ambiguous');
    });
    it('refuses a reading that names a store or carries a retired adapter version, on any URL (Phase 15.1)', async () => {
      // The probe contract accepts only the generic store with the generic version, so both fail validation
      // before the URL is even compared.
      for (const url of [
        'https://www.bestbuy.com/cart',
        'https://www.bestbuy.com/site/some-product',
        storeUrl,
      ]) {
        probe({ ...generic, merchantId: 'best-buy-us' }, url);
        await expect(readActiveCheckout(), url).rejects.toThrow('ambiguous');
        probe({ ...generic, extractorVersion: 'bestbuy-summary-v1' }, url);
        await expect(readActiveCheckout(), url).rejects.toThrow('ambiguous');
      }
    });
    it('reports a withheld read as compared by rate (never asks for an amount), and keeps the USD-only message', async () => {
      probe({ status: 'unavailable', reason: 'withheld' });
      await expect(readActiveCheckout()).rejects.toThrow('compared by rate');
      probe({ status: 'unavailable', reason: 'unsupported-currency' });
      await expect(readActiveCheckout()).rejects.toThrow('supports USD only');
    });
  });
  it('rejects navigation even when a new document has the same URL', async () => {
    execute
      .mockReset()
      .mockResolvedValueOnce([{ documentId: 'doc-1', frameId: 0 }])
      .mockResolvedValueOnce([{ documentId: 'doc-2', frameId: 0, result: { url, reading } }]);
    await expect(readActiveCheckout()).rejects.toThrow('page changed');
  });
  it('rejects switching tabs before capture completes', async () => {
    query
      .mockReset()
      .mockResolvedValueOnce([{ id: 7, url }])
      .mockResolvedValueOnce([{ id: 8, url }]);
    await expect(readActiveCheckout()).rejects.toThrow('page changed');
  });
  it('rejects a changed amount before comparison without reusing old page data', async () => {
    const snapshot = await readActiveCheckout();
    execute.mockResolvedValue([
      { documentId: 'doc-1', frameId: 0, result: { url, reading: { ...reading, amountCents: 99999 } } },
    ]);
    await expect(validateActiveCheckout(snapshot)).rejects.toThrow('cart or page changed');
  });
  it('rejects a same-amount result from another URL', async () => {
    const snapshot = await readActiveCheckout();
    query.mockResolvedValue([{ id: 7, url: 'https://www.bestbuy.com/checkout' }]);
    await expect(validateActiveCheckout(snapshot)).rejects.toThrow('cart or page changed');
  });
  it('rejects malformed or unavailable page data and does not expose the raw Chrome error', async () => {
    execute
      .mockReset()
      .mockResolvedValueOnce([{ documentId: 'doc-1' }])
      .mockResolvedValueOnce([
        { documentId: 'doc-1', frameId: 0, result: { url, reading: { ...reading, amountCents: -1 } } },
      ]);
    await expect(readActiveCheckout()).rejects.toThrow('ambiguous');
    execute.mockReset().mockRejectedValue(new Error('private Chrome internals'));
    await expect(readActiveCheckout()).rejects.toThrow('Chrome could not read');
  });
});
