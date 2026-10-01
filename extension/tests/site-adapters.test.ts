import { describe, expect, it } from 'vitest';
import { MERCHANT_IDS, SITE_ADAPTERS, siteAdapterSchema } from '../src/checkout/adapters';
import { MERCHANTS } from '../src/checkout/merchants';

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
  });
});
