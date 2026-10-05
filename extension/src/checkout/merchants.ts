import { GENERIC_MERCHANT_ID, GENERIC_MERCHANT_PROFILE } from '@ai-checkout/rewards-core/generic-merchant';
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
  if (id === GENERIC_MERCHANT_ID) return GENERIC_MERCHANT_PROFILE.name;
  return Object.hasOwn(MERCHANTS, id) ? MERCHANTS[id as MerchantId].name : 'Unsupported merchant';
}

/** The last two labels of a host (`secure.newegg.com` → `newegg.com`); every adapter host is a .com. */
const site = (host: string) => host.split('.').slice(-2).join('.');

/** The popup's store for a tab URL: a supported store on any page of its site (product pages too,
 * not only the carts its adapter reads), any other web page the engine's generic store, and null
 * for a non-web page. The URL is never stored. */
export function merchantForTab(rawUrl: string | undefined): string | null {
  try {
    const url = new URL(rawUrl ?? '');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return (
      MERCHANT_IDS.find((id) =>
        SITE_ADAPTERS[id].match.hosts.some((host) => site(host) === site(url.hostname.replace(/\.$/, ''))),
      ) ?? GENERIC_MERCHANT_ID
    );
  } catch {
    return null;
  }
}

/** The merchant whose adapter matches this URL: HTTPS, no credentials or port, an exact host,
 * and an anchored path pattern. */
export function merchantForCheckout(rawUrl: string): MerchantId | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    // Bound the input before any adapter path pattern runs.
    if (url.pathname.length > 200) return null;
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

/** The merchant whose order-confirmation URL pattern matches (URL only; the page is never read). */
export function merchantForOrderConfirmation(rawUrl: string): MerchantId | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.pathname.length > 200) return null;
    return (
      MERCHANT_IDS.find((id) => {
        const adapter = SITE_ADAPTERS[id];
        return (
          adapter.match.hosts.includes(url.hostname) &&
          adapter.orderConfirmation.paths.some((path) => new RegExp(path).test(url.pathname))
        );
      }) ?? null
    );
  } catch {
    return null;
  }
}
