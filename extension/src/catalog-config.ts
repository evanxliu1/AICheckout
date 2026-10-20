import { createCatalogFetcher, createMerchantFetcher } from '@ai-checkout/catalog-client';

const endpoint = import.meta.env.VITE_CATALOG_API_URL;
export const fetchPublishedCatalog = endpoint ? createCatalogFetcher(endpoint) : undefined;
/** The merchant release (Phase 14.6) is served by the same API at `/v1/merchants`; the build checks that
 * the configured URL is `/v1/catalog` on an HTTPS origin, so the origin's host permission covers both. */
export const fetchPublishedMerchants = endpoint
  ? createMerchantFetcher(new URL('/v1/merchants', endpoint).href)
  : undefined;
/** The public site is served by the same origin: the static page Chrome opens after an uninstall (Phase
 * 15.4), with no parameters, so hosting logs never see an install id. Hosted builds only. */
export const uninstalledUrl = endpoint ? new URL('/uninstalled/', endpoint).href : undefined;
