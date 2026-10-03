import {
  catalogResponseSchema,
  // The bundled fallback. Stage 2 M5 swaps this import for CATALOG_V3; nothing else changes, because
  // state written under the old bundle is reconciled with the new one on load (`walletCatalogVersion`).
  CATALOG_V2 as BUNDLED_CATALOG,
  catalogSchema,
  redateCatalog,
  stableJson,
} from '../domain';
import type { Catalog } from '../domain';
import type { AppState, CatalogCache } from './contracts';
import { reconcileWallet } from './wallet';

// Browser-test builds (dist-e2e, never packaged) set VITE_E2E_CATALOG_DATE so the bundled
// catalog's validity window follows the test run instead of expiring with the real terms.
// Worker-only: pages receive the catalog in effect in each response and never import this module.
const e2eCatalogDate = import.meta.env?.VITE_E2E_CATALOG_DATE;
const bundled = catalogSchema.parse(
  e2eCatalogDate ? redateCatalog(BUNDLED_CATALOG, e2eCatalogDate) : BUNDLED_CATALOG,
);
const isValid = (catalog: Catalog, now: number) =>
  Date.parse(catalog.verifiedAt) <= now && now < Date.parse(catalog.expiresAt);
/** The catalog in effect at `now`: of the cached published release (v1, v2 or v3) and the bundled
 * catalog, the one that is valid now; when both are, the one verified later (the cached release on a
 * tie, so a published correction of the same day's terms takes effect); when neither is, the cached
 * release (comparisons then report its expiry). An extension update can
 * so bring newer terms than an old cached release, and an expired release gives way to a valid
 * bundled catalog. Rollback protection is unchanged: `prepareCatalogUpdate` never caches a release
 * with a lower sequence than the cached one, whichever of the two is in effect. */
export function currentCatalog(cache: CatalogCache, now: number): Catalog {
  const cached = cache.release?.catalog;
  if (!cached) return bundled;
  const cachedValid = isValid(cached, now);
  if (cachedValid !== isValid(bundled, now)) return cachedValid ? cached : bundled;
  return cachedValid && Date.parse(bundled.verifiedAt) > Date.parse(cached.verifiedAt) ? bundled : cached;
}
/** The catalog a wallet stamped `version` was last checked against, when it is still at hand (the
 * cached release or the bundled catalog); undefined after an extension update replaced the bundle. */
export function catalogByVersion(cache: CatalogCache, version: string | null): Catalog | undefined {
  if (version === null) return undefined;
  if (cache.release?.catalog.version === version) return cache.release.catalog;
  return bundled.version === version ? bundled : undefined;
}
export class CatalogUpdateError extends Error {}

/** Pure transition; the worker commits the catalog cache and the state in one storage write.
 * `state` is null when only the cache changes (a check that found nothing new). */
export function prepareCatalogUpdate(
  state: AppState,
  cache: CatalogCache,
  input: unknown,
  now: number,
): { state: AppState | null; cache: CatalogCache; notice: string } {
  const parsed = catalogResponseSchema.safeParse(input);
  if (!parsed.success)
    throw new CatalogUpdateError('Updated card terms could not be verified. Your saved terms were kept.');
  const incoming = parsed.data.release,
    previous = cache.release;
  const checked = { ...cache, lastCheckedAt: now };
  if (!incoming) {
    if (previous)
      throw new CatalogUpdateError(
        'The service is missing the published catalog. Your saved terms were kept.',
      );
    return {
      state: null,
      cache: checked,
      notice: 'No published update is available. Using the terms bundled with this extension.',
    };
  }
  if (
    Date.parse(incoming.catalog.verifiedAt) > now ||
    Date.parse(incoming.published_at) > now ||
    Date.parse(incoming.catalog.expiresAt) <= now
  ) {
    throw new CatalogUpdateError(
      'Updated card terms are expired or not yet valid. Your saved terms were kept.',
    );
  }
  if (previous && incoming.sequence < previous.sequence)
    throw new CatalogUpdateError('The service returned an older release. Your newer card terms were kept.');
  if (previous && incoming.sequence === previous.sequence) {
    if (stableJson(incoming) !== stableJson(previous))
      throw new CatalogUpdateError('A published release changed unexpectedly. Your saved terms were kept.');
    return { state: null, cache: checked, notice: 'Your card terms are up to date.' };
  }
  if (previous && incoming.version === previous.version)
    throw new CatalogUpdateError('The update reused a published version. Your saved terms were kept.');
  // The release is cached even when the bundled catalog is newer and stays in effect: it is the
  // reference for the sequence check and takes over if the bundled catalog expires first.
  const nextCache = { release: incoming, lastCheckedAt: now };
  const before = currentCatalog(cache, now),
    after = currentCatalog(nextCache, now);
  if (after === before)
    return {
      state: null,
      cache: nextCache,
      notice: 'Your card terms are up to date. The terms bundled with this extension are newer.',
    };
  // Missing cards stay in the wallet and block comparisons. Changed rule definitions invalidate
  // their reported limits, even when the publisher reuses the rule ID; choices, gate answers and
  // point values the new catalog lacks are dropped (the engine rejects unknown IDs).
  const reconciled = reconcileWallet(state.wallet, after, before);
  const missing = state.wallet.cards.some((owned) => !after.cards.some((card) => card.id === owned.cardId));
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      wallet: reconciled.wallet,
      walletCatalogVersion: after.version,
      comparison: null,
    },
    cache: nextCache,
    notice: missing
      ? 'Card terms updated. A saved card is unavailable; review your cards before comparing.'
      : reconciled.usageDropped || reconciled.optionsDropped
        ? 'Card terms updated. Some reward limits or card options need confirmation; edit your cards before comparing.'
        : 'Card terms updated. Confirm the purchase amount and compare again.',
  };
}
