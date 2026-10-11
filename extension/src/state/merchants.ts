// The hosted merchant release in the extension (Phase 14.6, plan §4 "Freshness"): fetched from
// `GET /v1/merchants` by the weekly alarm and by "Check for updated terms", validated with the Zod schema,
// cached plain in chrome.storage.local (public data, up to 2 MiB), protected against rollback like the
// catalog. Of the cached and the bundled release the one verified later is in effect; a comparison is never
// blocked by a missing or stale release.
import { z } from 'zod';
import { MERCHANTS_V1 } from '@ai-checkout/rewards-core/merchants-v1';
import { merchantsResponseSchema, publishedMerchantReleaseSchema, stableJson } from '../domain';
import type { MerchantRelease } from '../domain';
import { MERCHANTS_KEY } from './keys';

export const merchantCacheSchema = z.strictObject({
  release: publishedMerchantReleaseSchema.nullable(),
  lastCheckedAt: z.number().int().nonnegative().nullable(),
});
export type MerchantCache = z.infer<typeof merchantCacheSchema>;
export const emptyMerchantCache = (): MerchantCache => ({ release: null, lastCheckedAt: null });

/** The release in effect: of the cached hosted release and the bundled one, the one verified later (the
 * cached release on a tie, so a published correction of the same day takes effect). A cached release is
 * only ever written after it passed the schema, so the bundled release is the fallback for no cache or an
 * unreadable one; the matcher's generic store is the fallback for a site neither release knows. */
export function currentMerchants(
  cache: MerchantCache,
  bundled: MerchantRelease = MERCHANTS_V1,
): MerchantRelease {
  const cached = cache.release?.release;
  if (!cached) return bundled;
  return Date.parse(cached.verifiedAt) >= Date.parse(bundled.verifiedAt) ? cached : bundled;
}

/** The cache as stored; an unreadable one counts as empty (public data that can be fetched again). */
export async function readMerchantCache(storage: {
  get: (key: string) => Promise<Record<string, unknown>>;
}): Promise<MerchantCache> {
  const parsed = merchantCacheSchema.safeParse((await storage.get(MERCHANTS_KEY))[MERCHANTS_KEY]);
  return parsed.success ? parsed.data : emptyMerchantCache();
}

export class MerchantUpdateError extends Error {}

/** Pure transition from a `GET /v1/merchants` body. Rejects: an invalid body, a null release after one was
 * cached, a release verified or published in the future, a lower sequence (rollback), the same sequence
 * with different content, a reused version. `changed` says whether the release in effect changed. */
export function prepareMerchantUpdate(
  cache: MerchantCache,
  input: unknown,
  now: number,
  bundled: MerchantRelease = MERCHANTS_V1,
): { cache: MerchantCache; changed: boolean; notice: string } {
  const parsed = merchantsResponseSchema.safeParse(input);
  if (!parsed.success)
    throw new MerchantUpdateError(
      'Updated store data could not be verified. Your saved store data was kept.',
    );
  const incoming = parsed.data.release,
    previous = cache.release;
  if (!incoming) {
    if (previous)
      throw new MerchantUpdateError(
        'The service is missing the published store data. Your saved data was kept.',
      );
    return {
      cache: { ...cache, lastCheckedAt: now },
      changed: false,
      notice: 'No published store data is available. Using the stores bundled with this extension.',
    };
  }
  if (Date.parse(incoming.release.verifiedAt) > now || Date.parse(incoming.published_at) > now)
    throw new MerchantUpdateError('Updated store data is dated in the future. Your saved data was kept.');
  if (previous && incoming.sequence < previous.sequence)
    throw new MerchantUpdateError('The service returned older store data. Your newer data was kept.');
  if (previous && incoming.sequence === previous.sequence) {
    if (stableJson(incoming) !== stableJson(previous))
      throw new MerchantUpdateError('Published store data changed unexpectedly. Your saved data was kept.');
    return {
      cache: { ...cache, lastCheckedAt: now },
      changed: false,
      notice: 'Your store data is up to date.',
    };
  }
  if (previous && incoming.version === previous.version)
    throw new MerchantUpdateError('The update reused a published version. Your saved data was kept.');
  // Cached even when the bundled release is newer and stays in effect: it is the reference for the next
  // sequence check and takes over when an extension update brings an older bundle.
  const next = { release: incoming, lastCheckedAt: now };
  const changed = currentMerchants(next, bundled) !== currentMerchants(cache, bundled);
  return {
    cache: next,
    changed,
    notice: changed
      ? 'Store data updated.'
      : 'Your store data is up to date. The stores bundled with this extension are newer.',
  };
}
