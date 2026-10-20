import { describe, expect, it } from 'vitest';
import { MERCHANTS_V1, buildMerchantIndex, matchMerchant, merchantHost } from '../src/domain';
import type { MerchantRecord } from '../src/domain';
import { MERCHANT_RELEASE_FIXTURE } from '../../packages/rewards-core/test-cases';

/* The on-device store matcher (Phase 14.1): label-boundary suffix on authored hosts, longest host
 * wins, look-alike traps never match. */

const record = (id: string, hosts: string[], extra: Partial<MerchantRecord> = {}): MerchantRecord => ({
  id,
  name: id,
  hosts,
  kind: 'merchant',
  physicalGoods: true,
  category: 'general-merchandise',
  evidence: { basis: 'default', sourceIds: [] },
  brandIds: [],
  disabled: false,
  ...extra,
});
const index = buildMerchantIndex([
  ...MERCHANT_RELEASE_FIXTURE.merchants,
  record('newegg-us', ['newegg.com']),
  record('walmart-us', ['walmart.com']),
  record('amazon-ca', ['amazon.ca']),
  record('amazon-pay', ['pay.amazon.com'], { kind: 'processor', physicalGoods: false }),
  record('unicode-store', ['xn--trget-gra.example']),
]);
const idAt = (url: string) => matchMerchant(index, url)?.record.id ?? null;

describe('merchantHost', () => {
  it('lowercases, strips the trailing dot and keeps punycode', () => {
    expect(merchantHost('https://WWW.Amazon.COM./gp/cart')).toBe('www.amazon.com');
    expect(merchantHost('https://tärget.example/')).toBe('xn--trget-gra.example');
    expect(merchantHost(new URL('http://secure.newegg.com:8443/x'))).toBe('secure.newegg.com');
  });
  it('never matches IP addresses, localhost, single labels or non-http(s) URLs', () => {
    for (const url of [
      'https://127.0.0.1/cart',
      'https://192.168.0.1:3000/',
      'https://[::1]/',
      'https://[2001:db8::1]/cart',
      'http://localhost:5173/cart',
      'https://intranet/cart',
      'chrome://extensions',
      'chrome-extension://abcdef/popup.html',
      'file:///Users/me/cart.html',
      'ftp://amazon.com/',
      'about:blank',
      'not a url',
      '',
    ])
      expect(merchantHost(url), url).toBeNull();
  });
});

describe('matchMerchant', () => {
  it('matches a store on its host and on any subdomain', () => {
    expect(idAt('https://amazon.com/gp/cart/view.html')).toBe('amazon-us');
    expect(idAt('https://www.amazon.com/')).toBe('amazon-us');
    expect(idAt('https://smile.amazon.com/')).toBe('amazon-us');
    expect(idAt('https://secure.newegg.com/shop/cart')).toBe('newegg-us');
    expect(idAt('https://a.b.c.d.e.secure.newegg.com/')).toBe('newegg-us');
    expect(idAt('http://www.target.com/cart')).toBe('target-us');
  });
  it('reports the authored host that matched', () => {
    expect(matchMerchant(index, 'https://secure.newegg.com/shop/cart')).toMatchObject({
      host: 'newegg.com',
      record: { id: 'newegg-us' },
    });
  });
  it('matches only at a label boundary', () => {
    expect(idAt('https://notnewegg.com/')).toBeNull();
    expect(idAt('https://www.notnewegg.com/')).toBeNull();
    expect(idAt('https://newegg.com.evil.example/')).toBeNull();
    expect(idAt('https://newegg.co/')).toBeNull();
    expect(idAt('https://walmartmoney.com/')).toBeNull();
    expect(idAt('https://wal-mart.com/')).toBeNull();
  });
  it('needs country domains authored explicitly', () => {
    expect(idAt('https://www.amazon.ca/')).toBe('amazon-ca');
    expect(idAt('https://www.amazon.co.uk/')).toBeNull();
    expect(idAt('https://www.target.com.au/')).toBeNull();
    expect(idAt('https://kroger.com.mx/')).toBeNull();
  });
  it('prefers the longest authored host', () => {
    expect(idAt('https://pay.amazon.com/checkout')).toBe('amazon-pay');
    expect(idAt('https://www.pay.amazon.com/')).toBe('amazon-pay');
    expect(idAt('https://music.amazon.com/')).toBe('amazon-us');
  });
  it('matches punycode and Unicode hosts alike and keeps look-alikes apart', () => {
    expect(idAt('https://tärget.example/')).toBe('unicode-store');
    expect(idAt('https://xn--trget-gra.example/cart')).toBe('unicode-store');
    expect(idAt('https://tärget.com/')).toBeNull();
    expect(idAt('https://аmazon.com/')).toBeNull(); // Cyrillic a
  });
  it('returns processors and disabled records for the caller to decide', () => {
    expect(matchMerchant(index, 'https://www.paypal.com/checkoutnow')!.record.kind).toBe('processor');
    expect(matchMerchant(index, 'https://closed-store.example/cart')!.record.disabled).toBe(true);
  });
  it('matches nothing that never has a store', () => {
    expect(idAt('https://127.0.0.1/')).toBeNull();
    expect(idAt('http://localhost/')).toBeNull();
    expect(idAt('chrome://newtab')).toBeNull();
    expect(idAt('https://example.org/')).toBeNull();
  });
  it('gives a duplicated host to the processor record', () => {
    const dup = buildMerchantIndex([
      record('store', ['shared.example']),
      record('pay', ['shared.example'], { kind: 'processor', physicalGoods: false }),
    ]);
    expect(matchMerchant(dup, 'https://shared.example/')!.record.id).toBe('pay');
    const reversed = buildMerchantIndex([
      record('pay', ['shared.example'], { kind: 'processor', physicalGoods: false }),
      record('store', ['shared.example']),
    ]);
    expect(matchMerchant(reversed, 'https://shared.example/')!.record.id).toBe('pay');
  });
  it('normalises authored hosts defensively', () => {
    const odd = buildMerchantIndex([record('odd', ['Odd.Example.'])]);
    expect(matchMerchant(odd, 'https://shop.odd.example/')!.record.id).toBe('odd');
  });
});

describe('the bundled release on the device', () => {
  const bundled = buildMerchantIndex(MERCHANTS_V1.merchants);
  const at = (url: string) => matchMerchant(bundled, url)?.record;
  it('names the three stores that had adapters until Phase 15.1', () => {
    expect(at('https://www.amazon.com/gp/cart/view.html')!.id).toBe('amazon-us');
    expect(at('https://www.bestbuy.com/cart')!.id).toBe('best-buy-us');
    expect(at('https://secure.newegg.com/shop/cart')!.id).toBe('newegg-us');
  });
  it('recognises payment pages', () => {
    expect(at('https://www.paypal.com/checkoutnow')!.kind).toBe('processor');
    expect(at('https://shop.app/checkout/123')!.kind).toBe('processor');
    expect(at('https://pay.amazon.com/')!.id).toBe('amazon-pay');
    expect(at('https://payments.amazon.com/checkout')!.id).toBe('amazon-pay');
    expect(at('https://apx-security.amazon.com/')!.id).toBe('amazon-pay');
    expect(at('https://checkout.stripe.com/c/pay/cs_123')!.kind).toBe('processor');
  });
  it('leaves other stores to the generic profile', () => {
    // Since the 14.4 seed walmart.com is a bundled store (default category, brand walmart).
    expect(at('https://www.walmart.com/cart')).toMatchObject({ id: 'walmart-us', brandIds: ['walmart'] });
    expect(at('https://www.example-unknown-store.com/cart')).toBeUndefined();
    expect(at('https://www.amazon.ca/')).toBeUndefined();
    expect(at('https://www.stripe.com/')).toBeUndefined();
  });
  it('matches in well under a millisecond', () => {
    const urls = [
      'https://a.b.c.secure.newegg.com/x',
      'https://www.walmart.com/cart',
      'https://pay.amazon.com/',
    ];
    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) matchMerchant(bundled, urls[i % urls.length]);
    expect((performance.now() - start) / 1000).toBeLessThan(1);
  });
});
