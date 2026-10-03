// Storage keys, freshness limits and the local date, shared by the worker and the pages. Kept apart
// from service.ts so pages do not load the worker's modules (and with them the bundled catalog).

/** The shopper's state (schema 3); encrypted when the optional vault is on. Name kept from schema 1. */
export const STATE_KEY = 'checkoutStateV1';
/** The cached published catalog (`CatalogCache`), always plain: public data, up to 1 MiB. */
export const CATALOG_KEY = 'checkoutCatalogV1';
export const RESULT_MAX_AGE_MS = 15 * 60 * 1000;
export const CART_MAX_AGE_MS = 5 * 60 * 1000;
export const CART_READ_TIMEOUT_MS = 8_000;
export function localDate(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
