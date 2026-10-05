import { describe, expect, it } from 'vitest';
import { MERCHANT_IDS, SITE_ADAPTERS } from '../src/checkout/adapters';
import { siteAdapterSchema } from '../src/checkout/adapters/schema';
import {
  MERCHANTS,
  merchantForCheckout,
  merchantForOrderConfirmation,
  merchantForTab,
  merchantName,
} from '../src/checkout/merchants';

describe('bundled site adapters', () => {
  it.each(MERCHANT_IDS)('%s is a valid spec with usable selectors and patterns', (id) => {
    const adapter = SITE_ADAPTERS[id];
    expect(siteAdapterSchema.parse(adapter)).toEqual(adapter);
    const selectors = [
      adapter.summary.selector,
      adapter.loading.busyAncestor,
      ...adapter.loading.indicators,
      ...adapter.label.selectors,
      adapter.amount.selector,
      ...(adapter.rows.selector ? [adapter.rows.selector] : []),
      ...(adapter.emptyCart ? [adapter.emptyCart.selector] : []),
    ];
    for (const selector of selectors) expect(() => document.body.querySelectorAll(selector)).not.toThrow();
    expect(MERCHANTS[id]).toEqual({ name: adapter.name, extractorVersion: adapter.extractorVersion });
  });
  it('rejects unanchored paths, unknown fields, and invalid patterns', () => {
    const base = structuredClone(SITE_ADAPTERS['best-buy-us']);
    expect(siteAdapterSchema.safeParse({ ...base, match: { ...base.match, paths: ['/cart'] } }).success).toBe(
      false,
    );
    expect(siteAdapterSchema.safeParse({ ...base, script: 'x' }).success).toBe(false);
    expect(
      siteAdapterSchema.safeParse({
        ...base,
        labels: [{ pattern: '^(total$', caseInsensitive: true, kind: 'total' }],
      }).success,
    ).toBe(false);
    expect(siteAdapterSchema.safeParse({ ...base, merchantId: 'walmart-us' }).success).toBe(false);
    for (const selector of ['body', 'html, table', ':root', '*'])
      expect(siteAdapterSchema.safeParse({ ...base, summary: { ...base.summary, selector } }).success).toBe(
        false,
      );
    for (const bad of ['^(a+)+$', '^(\\w*)*x$', '^(a)\\1$', '^(?<n>a)\\k<n>$'])
      expect(
        siteAdapterSchema.safeParse({ ...base, match: { ...base.match, paths: [bad] } }).success,
        bad,
      ).toBe(false);
  });
  it('gives every adapter its own hosts, so no URL matches two adapters', () => {
    const hosts = MERCHANT_IDS.flatMap((id) => SITE_ADAPTERS[id].match.hosts);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
  it('picks the popup store from the tab: a supported site, any other web page, or none', () => {
    expect(merchantForTab('https://www.newegg.com/p/N82E1')).toBe('newegg-us');
    expect(merchantForTab('https://secure.newegg.com/shop/cart')).toBe('newegg-us');
    expect(merchantForTab('https://www.bestbuy.com/site/tv')).toBe('best-buy-us');
    expect(merchantForTab('https://www.amazon.com/dp/B0')).toBe('amazon-us');
    expect(merchantForTab('https://www.amazon.co.uk/dp/B0')).toBe('generic-us-online');
    expect(merchantForTab('http://shop.example.com/checkout')).toBe('generic-us-online');
    expect(merchantForTab('https://notamazon.com/')).toBe('generic-us-online');
    for (const url of [
      'chrome://newtab/',
      'chrome-extension://abc/popup.html',
      'file:///a.html',
      '',
      undefined,
    ])
      expect(merchantForTab(url)).toBeNull();
    expect(merchantName('generic-us-online')).toBe('Another U.S. online store');
    expect(merchantName('walmart-us')).toBe('Unsupported merchant');
  });
  it('rejects overlong paths before any pattern runs', () => {
    expect(merchantForCheckout(`https://www.amazon.com/cart${'/'.repeat(300)}`)).toBeNull();
    expect(merchantForCheckout('https://www.amazon.com/cart')).toBe('amazon-us');
  });
  it('keeps the badge content script on the adapter hosts and covers every cart and order page', () => {
    /** Chrome match-pattern semantics for the path part: '*' matches any run of characters. */
    const covered = (url: string) =>
      MERCHANT_IDS.flatMap((id) => SITE_ADAPTERS[id].matchPatterns).some((pattern) => {
        const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        return regex.test(url);
      });
    for (const url of [
      'https://www.amazon.com/gp/cart/view.html',
      'https://www.amazon.com/cart',
      'https://www.bestbuy.com/cart',
      'https://bestbuy.com/cart',
      'https://www.bestbuy.com/checkout/r/fast-track',
      'https://secure.newegg.com/shop/cart',
      'https://www.amazon.com/gp/buy/thankyou/handlers/display.html',
      'https://www.bestbuy.com/checkout/r/thank-you',
      'https://secure.newegg.com/shop/thankyou',
    ])
      expect(covered(url), url).toBe(true);
    for (const url of [
      'https://www.amazon.com/dp/B000TEST',
      'https://www.bestbuy.com/site/tv/123.p',
      'https://www.newegg.com/p/N82E1',
      'https://smile.amazon.com/cart',
      'https://www.walmart.com/cart',
    ])
      expect(covered(url), url).toBe(false);
    const base = structuredClone(SITE_ADAPTERS['newegg-us']);
    expect(
      siteAdapterSchema.safeParse({ ...base, matchPatterns: ['https://www.walmart.com/cart*'] }).success,
    ).toBe(false);
    expect(siteAdapterSchema.safeParse({ ...base, matchPatterns: ['https://*/*'] }).success).toBe(false);
  });
  it('recognizes order pages by URL only, keeps them apart from carts, and marks them unverified', () => {
    for (const id of MERCHANT_IDS) expect(SITE_ADAPTERS[id].orderConfirmation.verified).toBe(false);
    expect(merchantForOrderConfirmation('https://www.bestbuy.com/checkout/r/thank-you')).toBe('best-buy-us');
    expect(merchantForOrderConfirmation('https://www.amazon.com/gp/buy/thankyou/handlers/display.html')).toBe(
      'amazon-us',
    );
    expect(merchantForOrderConfirmation('https://secure.newegg.com/shop/thankyou?n=1')).toBe('newegg-us');
    for (const url of [
      'https://www.bestbuy.com/cart',
      'http://www.bestbuy.com/checkout/r/thank-you',
      'https://www.walmart.com/checkout/r/thank-you',
    ])
      expect(merchantForOrderConfirmation(url), url).toBeNull();
  });
});
