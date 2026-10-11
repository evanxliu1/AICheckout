// Adapter-based URL rules, safe for the content scripts (no Zod, no catalog, no merchant release).
// The merchant release is matched in the worker and the extension pages only: store-match.ts.
import { MERCHANT_IDS, SITE_ADAPTERS, type MerchantId } from './adapters';

/** Installed readers, distinct from the merchant scope of a downloaded catalog. */
export { MERCHANT_IDS, type MerchantId };
export const MERCHANTS = Object.fromEntries(
  MERCHANT_IDS.map((id) => [
    id,
    { name: SITE_ADAPTERS[id].name, extractorVersion: SITE_ADAPTERS[id].extractorVersion },
  ]),
) as Record<MerchantId, { name: string; extractorVersion: string }>;

/** The reader version of a generic (`readCart`) reading; legacy readings carry their adapter's. */
export const GENERIC_READER_VERSION = 'generic-reader-v1';

/** A legacy store: one of the three installed adapters (its own badge switch, savings and order pages). */
export const isLegacyMerchant = (id: string): id is MerchantId =>
  (MERCHANT_IDS as readonly string[]).includes(id);

/** Whether a reader may run on this URL: an http(s) page (a non-web page is `unsupported-page`). */
export function isWebUrl(rawUrl: string | undefined): boolean {
  try {
    const { protocol } = new URL(rawUrl ?? '');
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
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
