import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/content/index.ts?script&iife', () => ({ default: 'assets/content.js' }));
import { extractActiveCart } from '../src/utils/extraction';
import { SephoraExtractor } from '../src/extractors/sites/SephoraExtractor';

const execute = vi.fn();
const query = vi.fn();
const get = vi.fn();
beforeEach(() => {
  query.mockReset().mockResolvedValue([{ id: 1, url: 'https://shop.example/cart' }]);
  get.mockReset().mockResolvedValue({ id: 1, url: 'https://shop.example/cart' });
  execute.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ result: {
    url: 'https://shop.example/cart', items: [{ name: 'Test item', quantity: 2 }],
  } }]);
  vi.stubGlobal('chrome', { tabs: { query, get }, scripting: { executeScript: execute } });
});
afterEach(() => vi.unstubAllGlobals());

describe('on-demand extraction', () => {
  it('injects packaged code and returns validated cart data', async () => {
    expect(await extractActiveCart()).toEqual({ site: 'shop.example', items: [{ name: 'Test item', quantity: 2 }] });
    expect(execute.mock.calls[0][0]).toEqual({ target: { tabId: 1 }, files: ['assets/content.js'] });
  });
  it('rejects restricted browser pages before injection', async () => {
    query.mockResolvedValue([{ id: 1, url: 'chrome://settings/' }]);
    await expect(extractActiveCart()).rejects.toThrow('does not allow');
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not reload checkout when injection fails', async () => {
    execute.mockReset().mockRejectedValue(new Error('Cannot access contents'));
    await expect(extractActiveCart()).rejects.toThrow('site access');
    expect(execute).toHaveBeenCalledTimes(1);
    // No tabs.reload API is provided: calling it would fail this recovery path.
  });
  it('rejects results after navigation', async () => {
    get.mockResolvedValue({ id: 1, url: 'https://shop.example/other-cart' });
    await expect(extractActiveCart()).rejects.toThrow('page changed');
  });
  it('does not trust a domain containing a supported merchant name', () => {
    const extractor = new SephoraExtractor();
    expect(extractor.canHandle('www.sephora.com')).toBe(true);
    expect(extractor.canHandle('sephora.com.attacker.example')).toBe(false);
    expect(extractor.canHandle('notsephora.com')).toBe(false);
  });
});
