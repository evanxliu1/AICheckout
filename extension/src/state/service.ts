import { compareRewards } from '../domain';
import { CATALOG_TIMEOUT_MS } from '@ai-checkout/catalog-client';
import { appStateSchema, emptyState, requestSchema, validateWallet } from './contracts';
import type { AppState, CheckoutResponse } from './contracts';
import type { CartSnapshot } from '../checkout/contracts';
import { CatalogUpdateError, currentCatalog, prepareCatalogUpdate } from './catalog';

export const STATE_KEY = 'checkoutStateV1';
export const RESULT_MAX_AGE_MS = 15 * 60 * 1000;
export const CART_MAX_AGE_MS = 5 * 60 * 1000;
export const CART_READ_TIMEOUT_MS = 8_000;
export interface CartReader {
  read: () => Promise<CartSnapshot>;
  validate: (snapshot: CartSnapshot) => Promise<void>;
}
const LEGACY_KEYS = ['openaiKey', 'cachedCards', 'lastCardsFetch', 'latestRecommendation', 'recommendationLogs', 'debugMode'];
export interface StateStorage {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}
export function localDate(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Storage is authoritative. Reconnecting popups do not rely on worker memory. */
export function createStateService(storage: StateStorage, clock = Date.now, cartReader?: CartReader,
  fetchCatalog?: (signal: AbortSignal) => Promise<unknown>) {
  let queue = Promise.resolve<unknown>(undefined);
  const success = (state: AppState, comparison: Extract<CheckoutResponse, { ok: true }>['comparison'] = null, notice: string | null = null): CheckoutResponse =>
    ({ ok: true, state, comparison, notice, catalogUpdatesAvailable: !!fetchCatalog });
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Reading the cart took too long. Retry or enter the amount manually.')), CART_READ_TIMEOUT_MS);
      })]);
    } finally { clearTimeout(timer!); }
  }
  async function load(): Promise<AppState> {
    await storage.remove(LEGACY_KEYS);
    const saved = (await storage.get(STATE_KEY))[STATE_KEY];
    if (saved === undefined) return emptyState();
    const parsed = appStateSchema.safeParse(saved);
    if (!parsed.success) throw new Error('Saved data could not be read. Delete local data to start again.');
    return parsed.data;
  }
  async function validateCart(cart: CartSnapshot | null, now: number) {
    if (!cart || !cartReader || cart.capturedAt > now || now - cart.capturedAt >= CART_MAX_AGE_MS) {
      throw new Error('Read the cart again and confirm the current amount, or enter the amount manually.');
    }
    await bounded(cartReader.validate(cart));
    if (clock() - cart.capturedAt >= CART_MAX_AGE_MS) throw new Error('The saved cart expired. Read it again.');
  }
  async function response(state: AppState, now: number): Promise<CheckoutResponse> {
    const catalog = currentCatalog(state);
    if (state.cart && (state.cart.capturedAt > now || now - state.cart.capturedAt >= CART_MAX_AGE_MS)) {
      const next = { ...state, revision: state.revision + 1, cart: null, comparison: null };
      await storage.set({ [STATE_KEY]: next });
      return success(next, null, 'The saved cart expired. Read it again and confirm the current amount.');
    }
    const saved = state.comparison;
    let notice: string | null = null;
    if (saved && state.purchase) {
      if (saved.inputRevision !== state.revision || saved.catalogVersion !== catalog.version ||
          saved.computedAt > now || now - saved.computedAt >= RESULT_MAX_AGE_MS ||
          state.purchase.purchasedOn !== localDate(now)) {
        notice = 'Your saved comparison needs a refresh. Confirm the current amount and compare again.';
      } else {
        if (saved.cartId) {
          try {
            if (state.cart?.id !== saved.cartId) throw new Error('Saved cart changed');
            await validateCart(state.cart, now);
          } catch {
            const next = { ...state, revision: state.revision + 1, comparison: null, cart: null };
            await storage.set({ [STATE_KEY]: next });
            return success(next, null, 'The saved cart changed or expired. Read it again and confirm the amount.');
          }
        }
        const checkedAt = clock();
        if (state.purchase.purchasedOn !== localDate(checkedAt) || checkedAt - saved.computedAt >= RESULT_MAX_AGE_MS) {
          return success(state, null, 'Your saved comparison needs a refresh. Confirm the current amount and compare again.');
        }
        return success(state, compareRewards(catalog, state.wallet, state.purchase, checkedAt), notice);
      }
    }
    return success(state, null, notice);
  }
  async function handle(input: unknown): Promise<CheckoutResponse> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'This request could not be read. Reopen the extension and try again.' };
    const request = parsed.data;
    try {
      if (request.type === 'checkout:clear') {
        await storage.clear();
        return success(emptyState(), null, 'Local data deleted.');
      }
      const state = await load();
      const now = clock();
      if (request.type === 'checkout:get-state') return await response(state, now);
      if (request.expectedRevision !== state.revision) {
        return { ok: false, error: 'Your saved inputs changed in another window. Reopen the extension before saving.' };
      }
      if (request.type === 'checkout:refresh-catalog') {
        if (!fetchCatalog) return { ok: false, error: 'This development build receives card terms through extension updates.' };
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        let input: unknown;
        try {
          input = await Promise.race([fetchCatalog(controller.signal), new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new CatalogUpdateError('Checking card terms took too long. Your saved terms were kept.')); }, CATALOG_TIMEOUT_MS);
          })]);
        } catch (error) {
          if (error instanceof CatalogUpdateError) throw error;
          throw new CatalogUpdateError('Card terms could not be checked. Try again when connected; your saved terms were kept.');
        } finally { clearTimeout(timer!); controller.abort(); }
        const update = prepareCatalogUpdate(state, input, clock());
        await storage.set({ [STATE_KEY]: update.state });
        return success(update.state, null, update.notice);
      }
      if (request.type === 'checkout:save-wallet') {
        if (!validateWallet(request.wallet, currentCatalog(state))) return { ok: false, error: 'Choose cards and reward limits from the current catalog. Remove unavailable cards before saving.' };
        const next: AppState = { ...state, revision: state.revision + 1, wallet: request.wallet, comparison: null };
        await storage.set({ [STATE_KEY]: next });
        return await response(next, now);
      }
      if (request.type === 'checkout:read-cart') {
        if (!cartReader) return { ok: false, error: 'Cart reading is unavailable. Enter the amount manually.' };
        let cart: CartSnapshot;
        try {
          cart = await bounded(cartReader.read());
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'The cart could not be read. Enter the amount manually.' };
        }
        const next: AppState = { ...state, revision: state.revision + 1, cart, comparison: null };
        await storage.set({ [STATE_KEY]: next });
        return success(next);
      }
      if (request.purchase.purchasedOn !== localDate(now)) {
        return { ok: false, error: 'The purchase date changed. Reopen the extension and confirm today’s amount.' };
      }
      if (request.cartId) {
        try {
          if (request.cartId !== state.cart?.id || request.purchase.merchantId !== state.cart.merchantId) throw new Error('The saved cart changed. Read it again.');
          await validateCart(state.cart, now);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'The cart changed. Read it again.' };
        }
      }
      const comparedAt = clock();
      if (request.purchase.purchasedOn !== localDate(comparedAt)) return { ok: false, error: 'The date changed while reading the cart. Confirm today’s amount again.' };
      const catalog = currentCatalog(state);
      const comparison = compareRewards(catalog, state.wallet, request.purchase, comparedAt);
      if (comparison.status === 'unavailable') return success(state, comparison);
      const next: AppState = {
        ...state, revision: state.revision + 1, purchase: request.purchase,
        cart: request.cartId ? state.cart : null,
        comparison: { inputRevision: state.revision + 1, catalogVersion: catalog.version, computedAt: comparedAt, cartId: request.cartId ?? null },
      };
      await storage.set({ [STATE_KEY]: next });
      return success(next, comparison);
    } catch (error) {
      if (error instanceof CatalogUpdateError) return { ok: false, error: error.message };
      if (error instanceof Error && error.message.startsWith('Saved data')) return { ok: false, error: error.message };
      return { ok: false, error: 'Your data could not be saved or loaded. Reopen the extension and try again.' };
    }
  }
  const service = (request: unknown): Promise<CheckoutResponse> => {
    const task = queue.then(() => handle(request));
    queue = task.then(() => undefined, () => undefined);
    return task;
  };
  // Browser lifecycle events enter the same queue as user writes.
  service.invalidateTab = (tabId: number): Promise<void> => {
    const task = queue.then(async () => {
      const state = await load();
      if (state.cart?.tabId !== tabId) return;
      await storage.set({ [STATE_KEY]: { ...state, revision: state.revision + 1, cart: null, comparison: null } });
    });
    queue = task.then(() => undefined, () => undefined);
    return task;
  };
  return service;
}
