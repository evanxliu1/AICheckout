import { compareRewards } from '../domain';
import { CATALOG_TIMEOUT_MS } from '@ai-checkout/catalog-client';
import type { Catalog } from '../domain';
import {
  catalogCacheSchema,
  emptyCatalogCache,
  emptyState,
  MAX_SAVINGS_ENTRIES,
  requestSchema,
  storedAppStateSchema,
} from './contracts';
import { migrateState, reconcileState } from './migrate';
import type { AppState, CatalogCache, CheckoutResponse } from './contracts';
import type { CartSnapshot } from '../checkout/contracts';
import { catalogByVersion, CatalogUpdateError, currentCatalog, prepareCatalogUpdate } from './catalog';
import { engineWallet, validateWallet } from './wallet';
import { cardIndex, catalogSlice } from './catalog-slice';
import {
  CART_MAX_AGE_MS,
  CART_READ_TIMEOUT_MS,
  CATALOG_KEY,
  localDate,
  RESULT_MAX_AGE_MS,
  STATE_KEY,
} from './keys';

export { CART_MAX_AGE_MS, CART_READ_TIMEOUT_MS, CATALOG_KEY, localDate, RESULT_MAX_AGE_MS, STATE_KEY };
export interface CartReader {
  read: () => Promise<CartSnapshot>;
  validate: (snapshot: CartSnapshot) => Promise<void>;
}
const LEGACY_KEYS = [
  'openaiKey',
  'cachedCards',
  'lastCardsFetch',
  'latestRecommendation',
  'recommendationLogs',
  'debugMode',
];
export interface StateStorage {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

/** A successful page response: the catalog in effect cut to the owned cards (and `extraCardIds`), with
 * the index of every card for search, instead of the whole catalog (about 800 KB with catalog v3). */
export function pageResponse(
  state: AppState,
  catalog: Catalog,
  comparison: Extract<CheckoutResponse, { ok: true }>['comparison'],
  notice: string | null,
  catalogUpdatesAvailable: boolean,
  extraCardIds: string[] = [],
): CheckoutResponse {
  return {
    ok: true,
    state,
    catalog: catalogSlice(catalog, [...state.wallet.cards.map((c) => c.cardId), ...extraCardIds]),
    cardIndex: cardIndex(catalog),
    comparison,
    notice,
    catalogUpdatesAvailable,
  };
}

/** Storage is authoritative. Reconnecting popups do not rely on worker memory. */
export function createStateService(
  storage: StateStorage,
  clock = Date.now,
  cartReader?: CartReader,
  fetchCatalog?: (signal: AbortSignal) => Promise<unknown>,
) {
  let queue = Promise.resolve<unknown>(undefined);
  const success = (
    state: AppState,
    catalog: Catalog,
    comparison: Extract<CheckoutResponse, { ok: true }>['comparison'] = null,
    notice: string | null = null,
    extraCardIds: string[] = [],
  ): CheckoutResponse => pageResponse(state, catalog, comparison, notice, !!fetchCatalog, extraCardIds);
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Reading the cart took too long. Retry or enter the amount manually.')),
            CART_READ_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
  /** The saved state (migrated and reconciled with the catalog in effect at `now`), the catalog
   * cache and the catalog in effect. */
  async function load(now: number): Promise<{ state: AppState; cache: CatalogCache; catalog: Catalog }> {
    await storage.remove(LEGACY_KEYS);
    // The cache is public and can be fetched again: an unreadable one is ignored (bundled terms).
    const storedCache = catalogCacheSchema.safeParse((await storage.get(CATALOG_KEY))[CATALOG_KEY]);
    const saved = (await storage.get(STATE_KEY))[STATE_KEY];
    if (saved === undefined) {
      const cache = storedCache.success ? storedCache.data : emptyCatalogCache();
      return { state: emptyState(), cache, catalog: currentCatalog(cache, now) };
    }
    const parsed = storedAppStateSchema.safeParse(saved);
    if (!parsed.success) throw new Error('Saved data could not be read. Delete local data to start again.');
    if (parsed.data.schemaVersion !== 3) {
      // Earlier state: migrate once and persist in one write; a notice waits in pendingNotice.
      const migrated = migrateState(parsed.data, storedCache.success ? storedCache.data : null, now);
      await storage.set({ [STATE_KEY]: migrated.state, [CATALOG_KEY]: migrated.cache });
      return { ...migrated, catalog: currentCatalog(migrated.cache, now) };
    }
    const cache = storedCache.success ? storedCache.data : emptyCatalogCache();
    const catalog = currentCatalog(cache, now);
    if (parsed.data.walletCatalogVersion === catalog.version) return { state: parsed.data, cache, catalog };
    const state = reconcileState(
      parsed.data,
      catalog,
      now,
      catalogByVersion(cache, parsed.data.walletCatalogVersion),
    );
    await storage.set({ [STATE_KEY]: state });
    return { state, cache, catalog };
  }
  async function validateCart(cart: CartSnapshot | null, now: number) {
    if (!cart || !cartReader || cart.capturedAt > now || now - cart.capturedAt >= CART_MAX_AGE_MS) {
      throw new Error('Read the cart again and confirm the current amount, or enter the amount manually.');
    }
    await bounded(cartReader.validate(cart));
    if (clock() - cart.capturedAt >= CART_MAX_AGE_MS)
      throw new Error('The saved cart expired. Read it again.');
  }
  async function response(state: AppState, catalog: Catalog, now: number): Promise<CheckoutResponse> {
    if (state.cart && (state.cart.capturedAt > now || now - state.cart.capturedAt >= CART_MAX_AGE_MS)) {
      const next = { ...state, revision: state.revision + 1, cart: null, comparison: null };
      await storage.set({ [STATE_KEY]: next });
      return success(
        next,
        catalog,
        null,
        'The saved cart expired. Read it again and confirm the current amount.',
      );
    }
    const saved = state.comparison;
    let notice: string | null = null;
    if (saved && state.purchase) {
      if (
        saved.inputRevision !== state.revision ||
        saved.catalogVersion !== catalog.version ||
        saved.computedAt > now ||
        now - saved.computedAt >= RESULT_MAX_AGE_MS ||
        state.purchase.purchasedOn !== localDate(now)
      ) {
        notice = 'Your saved comparison needs a refresh. Confirm the current amount and compare again.';
      } else {
        if (saved.cartId) {
          try {
            if (state.cart?.id !== saved.cartId) throw new Error('Saved cart changed');
            await validateCart(state.cart, now);
          } catch {
            const next = { ...state, revision: state.revision + 1, comparison: null, cart: null };
            await storage.set({ [STATE_KEY]: next });
            return success(
              next,
              catalog,
              null,
              'The saved cart changed or expired. Read it again and confirm the amount.',
            );
          }
        }
        const checkedAt = clock();
        if (
          state.purchase.purchasedOn !== localDate(checkedAt) ||
          checkedAt - saved.computedAt >= RESULT_MAX_AGE_MS
        ) {
          return success(
            state,
            catalog,
            null,
            'Your saved comparison needs a refresh. Confirm the current amount and compare again.',
          );
        }
        return success(
          state,
          catalog,
          compareRewards(catalog, engineWallet(state.wallet, catalog), state.purchase, checkedAt),
          notice,
        );
      }
    }
    return success(state, catalog, null, notice);
  }
  async function handle(input: unknown): Promise<CheckoutResponse> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: 'This request could not be read. Reopen the extension and try again.' };
    const request = parsed.data;
    try {
      if (request.type === 'checkout:clear') {
        await storage.clear();
        return success(
          emptyState(),
          currentCatalog(emptyCatalogCache(), clock()),
          null,
          'Local data deleted.',
        );
      }
      const now = clock();
      const { state, cache, catalog } = await load(now);
      if (request.type === 'checkout:get-state') {
        const result = await response(state, catalog, now);
        // Show a pending notice only when nothing else is shown; clear it once it has been shown.
        if (!result.ok || result.notice || !result.state.pendingNotice) return result;
        const shown = { ...result.state, pendingNotice: null };
        await storage.set({ [STATE_KEY]: shown });
        return { ...result, state: shown, notice: result.state.pendingNotice };
      }
      if (request.type === 'checkout:catalog-cards')
        return success(state, catalog, null, null, request.cardIds);
      if (request.type === 'checkout:record-savings') {
        // Written by the worker from a one-tap answer; it does not race the shopper's form inputs,
        // so it needs no expected revision. Newest first, bounded.
        const next: AppState = {
          ...state,
          revision: state.revision + 1,
          savings: [request.entry, ...state.savings.filter((e) => e.id !== request.entry.id)].slice(
            0,
            MAX_SAVINGS_ENTRIES,
          ),
        };
        await storage.set({ [STATE_KEY]: next });
        return success(next, catalog);
      }
      if (request.expectedRevision !== state.revision) {
        return {
          ok: false,
          error: 'Your saved inputs changed in another window. Reopen the extension before saving.',
        };
      }
      if (request.type === 'checkout:delete-savings') {
        const next: AppState = { ...state, revision: state.revision + 1, savings: [] };
        await storage.set({ [STATE_KEY]: next });
        return await response(next, catalog, now);
      }
      if (request.type === 'checkout:refresh-catalog') {
        if (!fetchCatalog)
          return {
            ok: false,
            error: 'This development build receives card terms through extension updates.',
          };
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        let input: unknown;
        try {
          input = await Promise.race([
            fetchCatalog(controller.signal),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(
                  new CatalogUpdateError('Checking card terms took too long. Your saved terms were kept.'),
                );
              }, CATALOG_TIMEOUT_MS);
            }),
          ]);
        } catch (error) {
          if (error instanceof CatalogUpdateError) throw error;
          throw new CatalogUpdateError(
            'Card terms could not be checked. Try again when connected; your saved terms were kept.',
          );
        } finally {
          clearTimeout(timer!);
          controller.abort();
        }
        const checkedAt = clock();
        const update = prepareCatalogUpdate(state, cache, input, checkedAt);
        // One write: the new cache and the wallet pruned for it land together or not at all.
        await storage.set(
          update.state
            ? { [STATE_KEY]: update.state, [CATALOG_KEY]: update.cache }
            : { [CATALOG_KEY]: update.cache },
        );
        return success(update.state ?? state, currentCatalog(update.cache, checkedAt), null, update.notice);
      }
      if (request.type === 'checkout:save-wallet') {
        if (!validateWallet(request.wallet, catalog, clock()))
          return {
            ok: false,
            error:
              'Choose cards and reward limits from the current catalog. Remove unavailable cards before saving.',
          };
        const next: AppState = {
          ...state,
          revision: state.revision + 1,
          wallet: request.wallet,
          walletCatalogVersion: catalog.version,
          comparison: null,
        };
        await storage.set({ [STATE_KEY]: next });
        return await response(next, catalog, now);
      }
      if (request.type === 'checkout:read-cart') {
        if (!cartReader)
          return { ok: false, error: 'Cart reading is unavailable. Enter the amount manually.' };
        let cart: CartSnapshot;
        try {
          cart = await bounded(cartReader.read());
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'The cart could not be read. Enter the amount manually.',
          };
        }
        const next: AppState = { ...state, revision: state.revision + 1, cart, comparison: null };
        await storage.set({ [STATE_KEY]: next });
        return success(next, catalog);
      }
      if (request.purchase.purchasedOn !== localDate(now)) {
        return {
          ok: false,
          error: 'The purchase date changed. Reopen the extension and confirm today’s amount.',
        };
      }
      if (request.cartId) {
        try {
          if (request.cartId !== state.cart?.id || request.purchase.merchantId !== state.cart.merchantId)
            throw new Error('The saved cart changed. Read it again.');
          await validateCart(state.cart, now);
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'The cart changed. Read it again.',
          };
        }
      }
      const comparedAt = clock();
      if (request.purchase.purchasedOn !== localDate(comparedAt))
        return { ok: false, error: 'The date changed while reading the cart. Confirm today’s amount again.' };
      const comparison = compareRewards(
        catalog,
        engineWallet(state.wallet, catalog),
        request.purchase,
        comparedAt,
      );
      if (comparison.status === 'unavailable') return success(state, catalog, comparison);
      const next: AppState = {
        ...state,
        revision: state.revision + 1,
        purchase: request.purchase,
        cart: request.cartId ? state.cart : null,
        comparison: {
          inputRevision: state.revision + 1,
          catalogVersion: catalog.version,
          computedAt: comparedAt,
          cartId: request.cartId ?? null,
        },
      };
      await storage.set({ [STATE_KEY]: next });
      return success(next, catalog, comparison);
    } catch (error) {
      if (error instanceof CatalogUpdateError) return { ok: false, error: error.message };
      if (error instanceof Error && error.message.startsWith('Saved data'))
        return { ok: false, error: error.message };
      return {
        ok: false,
        error: 'Your data could not be saved or loaded. Reopen the extension and try again.',
      };
    }
  }
  const service = (request: unknown): Promise<CheckoutResponse> => {
    const task = queue.then(() => handle(request));
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
  /** The saved state (migrated if needed) and the catalog in effect, read in the same queue as writes. */
  service.read = (): Promise<{ state: AppState; catalog: Catalog }> => {
    const task = queue.then(async () => {
      const { state, catalog } = await load(clock());
      return { state, catalog };
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
  // Browser lifecycle events enter the same queue as user writes.
  service.invalidateTab = (tabId: number): Promise<void> => {
    const task = queue.then(async () => {
      const { state } = await load(clock());
      if (state.cart?.tabId !== tabId) return;
      await storage.set({
        [STATE_KEY]: { ...state, revision: state.revision + 1, cart: null, comparison: null },
      });
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
  return service;
}
