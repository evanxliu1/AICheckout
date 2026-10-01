import { MERCHANT_IDS, SITE_ADAPTERS, type MerchantId } from './adapters';

/** Installed readers, distinct from the merchant scope of a downloaded catalog. */
export { MERCHANT_IDS, type MerchantId };
export const MERCHANTS = Object.fromEntries(
  MERCHANT_IDS.map((id) => [
    id,
    { name: SITE_ADAPTERS[id].name, extractorVersion: SITE_ADAPTERS[id].extractorVersion },
  ]),
) as Record<MerchantId, { name: string; extractorVersion: string }>;

export function merchantName(id: string): string {
  return Object.hasOwn(MERCHANTS, id) ? MERCHANTS[id as MerchantId].name : 'Unsupported merchant';
}

/** The merchant whose adapter matches this URL: HTTPS, no credentials or port, an exact host,
 * and an anchored path pattern. */
export function merchantForCheckout(rawUrl: string): MerchantId | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return (
      MERCHANT_IDS.find((id) => {
        const { hosts, paths } = SITE_ADAPTERS[id].match;
        return hosts.includes(url.hostname) && paths.some((path) => new RegExp(path).test(url.pathname));
      }) ?? null
    );
  } catch {
    return null;
  }
}
