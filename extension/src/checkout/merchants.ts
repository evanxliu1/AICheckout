/** Installed readers, distinct from the merchant scope of a downloaded catalog. */
export const MERCHANT_IDS = ['best-buy-us', 'newegg-us'] as const;
export type MerchantId = (typeof MERCHANT_IDS)[number];
export const MERCHANTS = {
  'best-buy-us': { name: 'Best Buy US', extractorVersion: 'bestbuy-summary-v1' },
  'newegg-us': { name: 'Newegg US', extractorVersion: 'newegg-summary-v1' },
} as const;
export function merchantName(id: string): string {
  return Object.hasOwn(MERCHANTS, id) ? MERCHANTS[id as MerchantId].name : 'Unsupported merchant';
}
export function merchantForCheckout(rawUrl: string): MerchantId | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (
      ['bestbuy.com', 'www.bestbuy.com'].includes(url.hostname) &&
      (url.pathname === '/cart' || url.pathname === '/cart/' || /^\/checkout(?:\/|$)/.test(url.pathname))
    )
      return 'best-buy-us';
    if (url.hostname === 'secure.newegg.com' && /^\/shop\/cart\/?$/.test(url.pathname)) return 'newegg-us';
    return null;
  } catch {
    return null;
  }
}
