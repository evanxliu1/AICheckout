import { z } from 'zod';
import { MERCHANT_RELEASE_LIMITS, publishedMerchantReleaseSchema } from '@ai-checkout/rewards-core';
import { readBoundedJson } from '@ai-checkout/catalog-client';

const headSchema = z
  .array(
    z.strictObject({
      release_sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
      release: publishedMerchantReleaseSchema.nullable(),
    }),
  )
  .length(1)
  .refine((rows) => rows[0].release_sequence === (rows[0].release?.sequence ?? null));

/** Largest Data API response accepted for the merchant head row: the release is limited to
 * `MERCHANT_RELEASE_LIMITS.bytes` of `JSON.stringify` output, and PostgreSQL renders JSONB with a space
 * after every `:` and `,`, so the wire form is larger. */
export const MAX_MERCHANTS_READ_BYTES = 2 * MERCHANT_RELEASE_LIMITS.bytes;

/** One joined query keeps the selected head and its release in the same DB statement (Phase 14.6). */
export function createMerchantRepository(
  supabaseUrl: string,
  publishableKey: string,
  fetcher: typeof fetch = fetch,
) {
  const base = new URL(supabaseUrl);
  const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
  if (
    (!local && base.protocol !== 'https:') ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !publishableKey
  ) {
    throw new Error('Invalid merchant database configuration.');
  }
  const url = new URL('/rest/v1/merchant_head', base);
  url.searchParams.set(
    'select',
    'release_sequence,release:merchant_releases!merchant_head_release_sequence_fkey(sequence,release,version,release_hash,published_at)',
  );
  url.searchParams.set('singleton', 'eq.true');
  return async () => {
    const response = await fetcher(url.href, {
      signal: AbortSignal.timeout(7000),
      redirect: 'error',
      credentials: 'omit',
      headers: { apikey: publishableKey, Accept: 'application/json' },
    });
    return headSchema.parse(await readBoundedJson(response, MAX_MERCHANTS_READ_BYTES))[0].release;
  };
}
