import {
  CATALOG_V3_LIMITS,
  MERCHANT_RELEASE_LIMITS,
  catalogResponseSchema,
  merchantsResponseSchema,
} from '@ai-checkout/rewards-core';

export const CATALOG_TIMEOUT_MS = 8000;
/** The largest catalog (schema 3: 1 MiB of `JSON.stringify` bytes) plus the release envelope. */
export const MAX_RESPONSE_BYTES = CATALOG_V3_LIMITS.bytes + 2048;

/** The largest merchant release (2 MiB of `JSON.stringify` bytes) plus the release envelope (Phase 14.6). */
export const MAX_MERCHANTS_RESPONSE_BYTES = MERCHANT_RELEASE_LIMITS.bytes + 2048;

export async function readBoundedJson(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('The catalog service returned an unexpected response.');
  }
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await response.body?.cancel();
    throw new Error('The catalog response is too large.');
  }
  if (!response.body) throw new Error('The catalog response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('The catalog response is too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Fixed URL and bounded request: no cookies, referrer, wallet, amount, or page URL. */
function createFetcher<T>(url: string, fetcher: typeof fetch, parse: (body: unknown) => T, maxBytes: number) {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('Catalog endpoint must be a fixed HTTPS URL without credentials or a query.');
  }
  return async (signal: AbortSignal) => {
    const response = await fetcher(endpoint.href, {
      signal,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    return parse(await readBoundedJson(response, maxBytes));
  };
}
export function createCatalogFetcher(url: string, fetcher: typeof fetch = fetch) {
  return createFetcher(url, fetcher, (body) => catalogResponseSchema.parse(body), MAX_RESPONSE_BYTES);
}
/** `GET /v1/merchants` (Phase 14.6): the same fixed-URL, bounded request as the catalog's. */
export function createMerchantFetcher(url: string, fetcher: typeof fetch = fetch) {
  return createFetcher(
    url,
    fetcher,
    (body) => merchantsResponseSchema.parse(body),
    MAX_MERCHANTS_RESPONSE_BYTES,
  );
}

/** `POST /v1/events` and `POST /v1/events/delete` (Phase 15.3). The response is reduced to its status
 * and `Retry-After`; the body is never read (nothing in it is needed and nothing in it is trusted). */
export interface EventSendResult {
  status: number;
  /** From `Retry-After` in seconds, when the server sent one. */
  retryAfterMs: number | null;
}
export interface EventSender {
  /** Sends one `{ events }` batch (already validated and bounded by the caller). Throws on a network failure. */
  send: (batch: { events: unknown[] }, signal: AbortSignal) => Promise<EventSendResult>;
  /** Delete my data: asks the service to delete every row of this install id. */
  deleteInstall: (installId: string, signal: AbortSignal) => Promise<EventSendResult>;
}
function fixedUrl(url: string, what: string): URL {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(`${what} endpoint must be a fixed HTTPS URL without credentials or a query.`);
  }
  return endpoint;
}
/** The same fixed-URL, bounded request rules as the catalog fetchers: no cookies, referrer or redirects.
 * `url` is the events endpoint (`/v1/events`); the delete route is `/v1/events/delete` beside it. */
export function createEventSender(url: string, fetcher: typeof fetch = fetch): EventSender {
  const events = fixedUrl(url, 'Events');
  const remove = fixedUrl(`${events.href.replace(/\/$/, '')}/delete`, 'Events');
  const post = async (endpoint: URL, body: unknown, signal: AbortSignal): Promise<EventSendResult> => {
    const response = await fetcher(endpoint.href, {
      method: 'POST',
      signal,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    await response.body?.cancel().catch(() => undefined);
    const retryAfter = response.headers.get('retry-after');
    return {
      status: response.status,
      retryAfterMs: retryAfter && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) * 1000 : null,
    };
  };
  return {
    send: (batch, signal) => post(events, batch, signal),
    deleteInstall: (installId, signal) => post(remove, { install_id: installId }, signal),
  };
}
