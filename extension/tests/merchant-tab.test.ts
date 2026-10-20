import { describe, expect, it } from 'vitest';
import {
  merchantForTab,
  merchantName,
  merchantOption,
  storeEvidence,
  storeForTab,
  storeProfile,
} from '../src/checkout/store-match';
import { CATALOG_V3, MERCHANTS_V1, redateCatalog } from '../src/domain';
import type { MerchantRelease } from '../src/domain';
import { MERCHANT_RELEASE_FIXTURE } from '../../packages/rewards-core/test-cases';

/* Phase 14.2: the extension's view of a tab against the merchant release. The fixture release has a
 * corroborated supermarket (Kroger), an issuer-named one (Whole Foods), default records with brands
 * (Amazon, Target, Delta), a processor (PayPal) and a disabled store. */

const fixture: MerchantRelease = MERCHANT_RELEASE_FIXTURE;
const v3 = redateCatalog(CATALOG_V3, '2026-10-01');

describe('storeForTab', () => {
  it('matches a record on its host and any subdomain, naming the store', () => {
    expect(storeForTab('https://www.kroger.com/cart', fixture)).toEqual({
      kind: 'store',
      id: 'kroger-us',
      host: 'www.kroger.com',
      name: 'Kroger',
    });
    expect(storeForTab('https://Secure.Target.COM./checkout', fixture)).toMatchObject({
      kind: 'store',
      id: 'target-us',
      host: 'secure.target.com',
    });
    expect(merchantForTab('https://www.kroger.com/cart', fixture)).toBe('kroger-us');
  });
  it('gives an unmatched site, a look-alike and a disabled record the generic store, by host', () => {
    expect(storeForTab('https://shop.example.com/cart', fixture)).toEqual({
      kind: 'generic',
      id: 'generic-us-online',
      host: 'shop.example.com',
      name: 'Another U.S. online store',
    });
    expect(storeForTab('https://notkroger.com/cart', fixture)?.id).toBe('generic-us-online');
    expect(storeForTab('https://amazon.ca/cart', fixture)?.id).toBe('generic-us-online');
    expect(storeForTab('https://closed-store.example/cart', fixture)).toMatchObject({
      kind: 'generic',
      id: 'generic-us-online',
      host: 'closed-store.example',
    });
  });
  it('recognises a payment processor, where nothing is read', () => {
    expect(storeForTab('https://www.paypal.com/checkoutnow?token=x', fixture)).toEqual({
      kind: 'processor',
      id: 'paypal',
      host: 'www.paypal.com',
      name: 'PayPal',
    });
    expect(merchantForTab('https://www.paypal.com/checkoutnow', fixture)).toBeNull();
    // The bundled seed: 15 processors, Amazon Pay's hosts before amazon.com.
    expect(storeForTab('https://pay.amazon.com/checkout/x')?.kind).toBe('processor');
    // Since Phase 15.1 the release names every store (the adapters' "Amazon US" is gone).
    expect(storeForTab('https://www.amazon.com/gp/cart/view.html')).toMatchObject({
      kind: 'store',
      id: 'amazon-us',
      name: 'Amazon',
    });
    expect(storeForTab('https://shop.app/checkout/1')?.kind).toBe('processor');
  });
  it('returns null for non-web pages and nothing for IP addresses but the generic store', () => {
    for (const url of [
      'chrome://extensions',
      'chrome-extension://abc/popup.html',
      'about:blank',
      undefined,
      '',
    ])
      expect(storeForTab(url, fixture), String(url)).toBeNull();
    expect(storeForTab('http://192.168.0.1/cart', fixture)?.id).toBe('generic-us-online');
  });
});

describe('merchantName', () => {
  it('names release records (the three former adapter stores included) and the generic store', () => {
    expect(merchantName('best-buy-us')).toBe('Best Buy');
    expect(merchantName('amazon-us')).toBe('Amazon');
    expect(merchantName('newegg-us')).toBe('Newegg');
    expect(merchantName('generic-us-online')).toBe('Another U.S. online store');
    expect(merchantName('paypal')).toBe('PayPal');
    expect(merchantName('not-a-store-us')).toBe('Unsupported merchant');
    expect(MERCHANTS_V1.merchants.filter((m) => m.kind === 'processor')).toHaveLength(15);
  });
});

describe('storeProfile and merchantOption', () => {
  it('converts a record with evidence, and a record the catalog does not know, into the engine profile', () => {
    const kroger = storeProfile(v3, 'kroger-us', fixture)!;
    expect(kroger).toMatchObject({
      id: 'kroger-us',
      expectedCategory: 'supermarkets',
      onlineRetail: true,
      physicalGoods: true,
      brandIds: [],
    });
    expect(storeProfile(v3, 'delta-us', fixture)).toMatchObject({
      physicalGoods: false,
      brandIds: ['delta'],
    });
    expect(merchantOption(v3, 'kroger-us', fixture)).toEqual({ merchant: kroger });
  });
  it('a release record at a legacy store is its own profile: brands kept; Best Buy and Newegg are electronics on the mcc basis (2026-10-11)', () => {
    expect(storeProfile(v3, 'best-buy-us')?.expectedCategory).toBe('electronics');
    expect(storeProfile(v3, 'newegg-us')?.expectedCategory).toBe('electronics');
    expect(storeProfile(v3, 'amazon-us')?.expectedCategory).toBe('general-merchandise');
    expect(storeProfile(v3, 'best-buy-us')?.brandIds).toEqual(['best-buy']);
    expect(storeProfile(v3, 'amazon-us')?.brandIds).toEqual(['amazon']);
  });
  it('gives the generic store its profile and nothing to processors, disabled records, unknown ids or older catalogs', () => {
    expect(storeProfile(v3, 'generic-us-online', fixture)?.id).toBe('generic-us-online');
    expect(storeProfile(v3, 'paypal', fixture)).toBeUndefined();
    expect(storeProfile(v3, 'closed-store-us', fixture)).toBeUndefined();
    expect(storeProfile(v3, 'walmart-us', fixture)).toBeUndefined();
    expect(storeProfile({ ...v3, schemaVersion: 2 } as never, 'kroger-us', fixture)).toBeUndefined();
    expect(merchantOption(v3, 'paypal', fixture)).toEqual({ merchant: undefined });
  });
});

describe('storeEvidence', () => {
  it('says why a category applies, by its evidence basis', () => {
    expect(storeEvidence('kroger-us', fixture)).toBe(
      'Codes as a supermarket (its own store pages and a public merchant-code lookup agree).',
    );
    expect(storeEvidence('whole-foods-us', fixture)).toBe('Codes as a supermarket (named in card terms).');
    expect(storeEvidence('coffee-us', fixture)).toBe(
      'Codes as a restaurant in public purchase-card data (mostly in-store).',
    );
  });
  it('names the issuer whose definition a definition record fits, without implying a partnership', () => {
    // The fixture's issuer source is synthetic (no catalog card cites it), so the wording falls back.
    expect(storeEvidence('cvs-us', fixture)).toBe(
      "Treated as a drugstore (its own pages; fits an issuer's drugstore definition).",
    );
    const catalog = {
      ...v3,
      cards: [
        {
          ...v3.cards[0],
          issuer: 'American Express',
          rules: [{ ...v3.cards[0].rules[0], sourceIds: ['issuer-category-definitions'] }],
        },
      ],
    } as typeof v3;
    expect(storeEvidence('cvs-us', fixture, catalog)).toBe(
      "Treated as a drugstore (its own pages; fits American Express's drugstore definition).",
    );
    const dining: MerchantRelease = {
      ...fixture,
      merchants: fixture.merchants.map((m) =>
        m.id === 'cvs-us' ? { ...m, kind: 'marketplace', category: 'dining' } : m,
      ),
    };
    expect(storeEvidence('cvs-us', dining, catalog)).toBe(
      "Treated as a restaurant (its own pages; fits American Express's restaurant definition).",
    );
  });
  it('says nothing for default records, the generic store, processors and unknown ids', () => {
    for (const id of [
      'amazon-us',
      'target-us',
      'delta-us',
      'generic-us-online',
      'paypal',
      'closed-store-us',
      'x',
    ])
      expect(storeEvidence(id, fixture), id).toBeNull();
    for (const record of MERCHANTS_V1.merchants)
      if (record.evidence.basis === 'default') expect(storeEvidence(record.id), record.id).toBeNull();
      else expect(storeEvidence(record.id), record.id).toMatch(/^(Codes|Treated) as /);
    // The bundled release (2026-10-11.mcc.1): CVS, Lowe's, Wegmans, Kroger and Whole Foods code as their category in
    // the public purchase-card datasets (the mcc basis outranks their earlier definitions), Audible is named in
    // Amex's card terms, Acme Markets still rests on a definition, and Costco stays on the default category (its
    // wholesale-club rows are 76% of its usable rows, under the 80% bar).
    expect(storeEvidence('cvs-us')).toBe(
      'Codes as a drugstore in public purchase-card data (mostly in-store).',
    );
    expect(storeEvidence('lowes-us')).toBe(
      'Codes as a home-improvement store in public purchase-card data (mostly in-store).',
    );
    expect(storeEvidence('wegmans-us')).toBe(
      'Codes as a supermarket in public purchase-card data (mostly in-store).',
    );
    expect(storeEvidence('kroger-us')).toBe(
      'Codes as a supermarket in public purchase-card data (mostly in-store).',
    );
    expect(storeEvidence('wholefoodsmarket-us')).toBe(
      'Codes as a supermarket in public purchase-card data (mostly in-store).',
    );
    expect(storeEvidence('acmemarkets-us')).toMatch(
      /^Treated as a supermarket \(its own pages; fits .*supermarket definition\)\.$/,
    );
    expect(storeEvidence('audible-us')).toMatch(/^Codes as .* \(named in card terms\)\.$/);
    expect(storeEvidence('costco-us')).toBeNull();
  });
});
