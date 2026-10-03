import { currentCatalog } from './catalog';
import type { Catalog } from '../domain';
import type { AppState, CatalogCache, StoredAppState } from './contracts';
import { reconcileWallet } from './wallet';

export const MIGRATION_NOTICE =
  'Card terms were updated in this version. Some saved reward limits no longer apply; review your cards before comparing.';

/** Brings saved state to schema 3, once, on first read.
 * - Schema 1 (pilot) → 2: card IDs carry over; usage rows for rules the catalog in effect lacks are
 *   dropped (the engine rejects unknown rule IDs).
 * - Schema 2 → 3: the catalog cache moves out of the state to its own storage key (`cache` is what
 *   the caller writes there); a cache already under that key wins over the one inside the state
 *   unless its release has a lower sequence. The wallet is checked against the catalog in effect at
 *   `now` and stamped with its version.
 * Any saved comparison is cleared because it was computed for the old state. */
export function migrateState(
  saved: Exclude<StoredAppState, AppState>,
  storedCache: CatalogCache | null,
  now: number,
): { state: AppState; cache: CatalogCache; notice: string | null } {
  // Only a newer worker writes the cache key, so its release is at least as new; the sequence check
  // keeps the newer release even if that ever fails to hold.
  const cache =
    storedCache && (storedCache.release?.sequence ?? -1) >= (saved.catalog.release?.sequence ?? -1)
      ? storedCache
      : saved.catalog;
  const catalog = currentCatalog(cache, now);
  // Schema 1 checked usage against the catalog inside the state; schema 2 rows carry over as they are.
  const pilot =
    saved.schemaVersion === 1 ? reconcileWallet(saved.wallet, currentCatalog(saved.catalog, now)) : null;
  // Schema 2 always used its cached release when it had one, so the wallet was checked against it;
  // usage rows for rules that changed between it and the catalog in effect are dropped too.
  const reconciled = reconcileWallet(pilot?.wallet ?? saved.wallet, catalog, cache.release?.catalog);
  const dropped = !!pilot?.usageDropped || reconciled.usageDropped;
  return {
    state: {
      schemaVersion: 3,
      revision: saved.revision + 1,
      purchase: saved.purchase,
      cart: saved.cart,
      savings: saved.savings,
      wallet: reconciled.wallet,
      walletCatalogVersion: catalog.version,
      comparison: null,
      pendingNotice: dropped ? MIGRATION_NOTICE : saved.pendingNotice,
    },
    cache,
    notice: dropped ? MIGRATION_NOTICE : null,
  };
}

/** Schema 3 state whose wallet was checked against another catalog (a new bundled catalog after an
 * extension update, a switch between the cached and the bundled catalog as one expires or the other
 * is newer, or a cache that could not be read): drops the inputs the catalog in effect lacks and,
 * when the old catalog is still at hand (`before`), usage rows whose rule changed. When nothing is dropped only the stamp changes, so open pages keep their revision. */
export function reconcileState(state: AppState, catalog: Catalog, before?: Catalog): AppState {
  const reconciled = reconcileWallet(state.wallet, catalog, before);
  if (!reconciled.usageDropped && !reconciled.optionsDropped)
    return { ...state, walletCatalogVersion: catalog.version };
  return {
    ...state,
    revision: state.revision + 1,
    wallet: reconciled.wallet,
    walletCatalogVersion: catalog.version,
    comparison: null,
    pendingNotice: MIGRATION_NOTICE,
  };
}
