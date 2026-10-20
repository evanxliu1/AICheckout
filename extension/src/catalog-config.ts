import { createCatalogFetcher, createEventSender, createMerchantFetcher } from '@ai-checkout/catalog-client';
import { TELEMETRY_ENABLED } from './state/keys';

const endpoint = import.meta.env.VITE_CATALOG_API_URL;
export const fetchPublishedCatalog = endpoint ? createCatalogFetcher(endpoint) : undefined;
/** The merchant release (Phase 14.6) is served by the same API at `/v1/merchants`; the build checks that
 * the configured URL is `/v1/catalog` on an HTTPS origin, so the origin's host permission covers both. */
export const fetchPublishedMerchants = endpoint
  ? createMerchantFetcher(new URL('/v1/merchants', endpoint).href)
  : undefined;
/** Consented usage reporting (Phase 15.3): `POST /v1/events` and `/v1/events/delete` on the same origin,
 * only in a build with `VITE_TELEMETRY=1`. Worker only; the content scripts never import this module. */
export const telemetryClient =
  endpoint && TELEMETRY_ENABLED ? createEventSender(new URL('/v1/events', endpoint).href) : undefined;
