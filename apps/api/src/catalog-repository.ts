import { z } from 'zod';
import { publishedReleaseSchema } from '@ai-checkout/rewards-core';
import { readBoundedJson } from '@ai-checkout/catalog-client';

const headSchema = z
  .array(
    z.strictObject({
      release_sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
      release: publishedReleaseSchema.nullable(),
    }),
  )
  .length(1)
  .refine((rows) => rows[0].release_sequence === (rows[0].release?.sequence ?? null));

/** One joined query keeps the selected head and snapshot in the same DB statement. */
export function createCatalogRepository(
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
    throw new Error('Invalid catalog database configuration.');
  }
  const url = new URL('/rest/v1/catalog_head', base);
  url.searchParams.set(
    'select',
    'release_sequence,release:catalog_releases!catalog_head_release_sequence_fkey(sequence,catalog,version,catalog_hash,published_at)',
  );
  url.searchParams.set('singleton', 'eq.true');
  return async () => {
    const response = await fetcher(url.href, {
      signal: AbortSignal.timeout(7000),
      redirect: 'error',
      credentials: 'omit',
      headers: { apikey: publishableKey, Accept: 'application/json' },
    });
    return headSchema.parse(await readBoundedJson(response))[0].release;
  };
}
