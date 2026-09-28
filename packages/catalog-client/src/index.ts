import { catalogResponseSchema, MAX_CATALOG_BYTES } from '@ai-checkout/rewards-core';

export const CATALOG_TIMEOUT_MS = 8000;
export const MAX_RESPONSE_BYTES = MAX_CATALOG_BYTES + 2048;

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
export function createCatalogFetcher(url: string, fetcher: typeof fetch = fetch) {
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
    return catalogResponseSchema.parse(await readBoundedJson(response));
  };
}
