import { currentCatalog } from './catalog';
import type { AppState, CatalogCache, StoredAppState } from './contracts';
import { reconcileWallet } from './wallet';

export const MIGRATION_NOTICE =
  'Card terms were updated in this version. Some saved reward limits no longer apply; review your cards before comparing.';

/** Brings saved state to schema 3, once, on first read.
 * - Schema 1 (pilot) → 2: card IDs carry over; usage rows for rules the catalog in effect lacks are
 *   dropped (the engine rejects unknown rule IDs).
 * - Schema 2 → 3: the catalog cache moves out of the state to its own storage key (`cache` is what
 *   the caller writes there); a cache already under that key wins over the one inside the state.
 *   The wallet is checked against the catalog in effect and stamped with its version.
 * Any saved comparison is cleared because it was computed for the old state. */
export function migrateState(
  saved: Exclude<StoredAppState, AppState>,
  storedCache: CatalogCache | null,
): { state: AppState; cache: CatalogCache; notice: string | null } {
  const cache = storedCache ?? saved.catalog;
  const catalog = currentCatalog(cache);
  // Schema 1 checked usage against the catalog inside the state; schema 2 rows carry over as they are.
  const pilot =
    saved.schemaVersion === 1 ? reconcileWallet(saved.wallet, currentCatalog(saved.catalog)) : null;
  const reconciled = reconcileWallet(pilot?.wallet ?? saved.wallet, catalog);
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
 * extension update, or a cache that could not be read): drops the inputs the catalog in effect
 * lacks. When nothing is dropped only the stamp changes, so open pages keep their revision. */
export function reconcileState(state: AppState, catalog: ReturnType<typeof currentCatalog>): AppState {
  const reconciled = reconcileWallet(state.wallet, catalog);
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
