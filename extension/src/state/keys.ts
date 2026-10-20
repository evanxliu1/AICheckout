// Storage keys, freshness limits and the local date, shared by the worker and the pages. Kept apart
// from service.ts so pages do not load the worker's modules (and with them the bundled catalog).

/** The shopper's state (schema 3); encrypted when the optional vault is on. Name kept from schema 1. */
export const STATE_KEY = 'checkoutStateV1';
/** The cached published catalog (`CatalogCache`), always plain: public data, up to 1 MiB. */
export const CATALOG_KEY = 'checkoutCatalogV1';
/** The cached published merchant release (`MerchantCache`, Phase 14.6), always plain: public data, up to 2 MiB. */
export const MERCHANTS_KEY = 'checkoutMerchantsV1';
/** Phase 15.3: consent, the random install id and the event queue (`TelemetryState`), always plain: it holds
 * no wallet data, and the id is reset by Stop sharing and Delete my data. */
export const TELEMETRY_KEY = 'checkoutTelemetryV1';
/** Usage reporting is a build-time switch: `VITE_TELEMETRY=1` on a hosted build (`VITE_CATALOG_API_URL`).
 * Without it there is no consent screen, no queue and no request (decision 2026-10-19). */
export const TELEMETRY_ENABLED =
  import.meta.env?.VITE_TELEMETRY === '1' && !!import.meta.env?.VITE_CATALOG_API_URL;
/** A page of the public site, which the catalog origin serves (`/privacy/`, `/credits/`, `/uninstalled/`);
 * null in a build without a catalog endpoint. */
export function siteUrl(endpoint: string | undefined, path: string): string | null {
  return endpoint ? new URL(path, endpoint).href : null;
}
/** The site's credits page (Phase 15.5): the Oklahoma CC BY attribution and the other data sources. */
export const CREDITS_URL = siteUrl(import.meta.env?.VITE_CATALOG_API_URL, '/credits/');
export const RESULT_MAX_AGE_MS = 15 * 60 * 1000;
export const CART_MAX_AGE_MS = 5 * 60 * 1000;
export const CART_READ_TIMEOUT_MS = 8_000;
/** Cards a wallet can hold (the state schema's limit; the bundled catalog lists 178). */
export const MAX_WALLET_CARDS = 20;
export function localDate(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
