// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createStateService, STATE_KEY } from '../src/state/service';
import { createVaultService } from '../src/state/vault-service';
import { createBadgeService } from '../src/background/badge-service';
import { emptyState } from '../src/state/contracts';
import { localDate } from '../src/state/keys';
import { CATALOG_V3, redateCatalog } from '../src/domain';
import { CHECKING_TERMS_TITLE, unavailableCopy } from '../src/components/estimates';
import type { StateStorage } from '../src/state/service';

/* Phase 15.4: a store build is installed long after its bundled catalog expired. The install-time refresh
 * runs; until it settles, pages and the badge say "Checking for updated terms…" instead of "expired". */

// Six days after the bundled catalog v3 expired, with no cached release: the bundled catalog is in effect.
const NOW = Date.parse(CATALOG_V3.expiresAt) + 6 * 24 * 60 * 60 * 1000;
const clock = () => NOW;
const wallet = {
  defaultCardId: 'capital-one-quicksilver',
  cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
};
function memory(initial: Record<string, unknown> = {}) {
  let data = structuredClone(initial);
  const api: StateStorage = {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => {
      data = { ...data, ...structuredClone(items) };
    },
    remove: async (keys) => {
      for (const key of keys) delete data[key];
    },
    clear: async () => {
      data = {};
    },
  };
  return { api, read: () => structuredClone(data) };
}
/** A fetch the test settles by hand, as the API answering after a cold start would. */
function pendingFetch() {
  let settle!: { resolve: (value: unknown) => void; reject: (error: Error) => void };
  const fetch = vi.fn(
    () =>
      new Promise<unknown>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return {
    fetch,
    resolve: (value: unknown) => settle.resolve(value),
    reject: () => settle.reject(new Error('503')),
  };
}
/** The renewed catalog, verified the day before NOW, as the API publishes it. */
const renewed = () => {
  const catalog = redateCatalog(CATALOG_V3, new Date(NOW - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  catalog.version = 'renewed.test.1';
  return {
    release: {
      sequence: 1,
      version: catalog.version,
      catalog,
      catalog_hash: '1'.repeat(64),
      published_at: catalog.verifiedAt,
    },
  };
};
const compare = (revision: number) => ({
  type: 'checkout:compare',
  expectedRevision: revision,
  purchase: {
    merchantId: 'generic-us-online',
    currency: 'USD',
    amountCents: 10_000,
    purchasedOn: localDate(NOW),
    eligiblePurchase: 'eligible',
    onlineRetail: 'eligible',
    paymentPath: 'card',
  },
});
const ok = (response: Awaited<ReturnType<ReturnType<typeof createStateService>>>) => {
  if (!response.ok) throw new Error(response.error);
  return response;
};

describe('first run with an expired bundled catalog (Phase 15.4)', () => {
  it('answers pages while the install refresh is pending, saying "checking" rather than "expired"', async () => {
    const catalog = pendingFetch(),
      merchants = pendingFetch();
    const service = createStateService(
      memory({ [STATE_KEY]: { ...emptyState(), wallet } }).api,
      clock,
      undefined,
      catalog.fetch,
      undefined,
      merchants.fetch,
    );
    const refresh = service.refreshReleases(90_000);
    // The fetch is outside the queue: this request is answered at once (it used to wait for the fetch).
    const state = ok(await service({ type: 'checkout:get-state' }));
    expect(state.checkingTerms).toBe(true);
    expect(state.catalog.version).toBe(CATALOG_V3.version);
    // A comparison is still "unavailable: expired" to the engine; the pages' copy comes from the flag.
    const compared = ok(await service(compare(0)));
    expect(compared.comparison).toEqual({ status: 'unavailable', reason: 'catalog-expired' });
    expect(compared.checkingTerms).toBe(true);

    catalog.resolve(renewed());
    // The merchant fetch follows the catalog's.
    await vi.waitFor(() => expect(merchants.fetch).toHaveBeenCalledOnce());
    merchants.resolve({ release: null });
    expect(await refresh).toEqual({ catalog: 'ok', merchants: 'ok' });
    const after = ok(await service({ type: 'checkout:get-state' }));
    expect(after.checkingTerms).toBe(false);
    expect(after.catalog.version).toBe('renewed.test.1');
    expect(ok(await service(compare(after.state.revision))).comparison).toMatchObject({ status: 'ready' });
  });
  it('falls back to the expired copy, with "Check for updated terms", when the refresh fails', async () => {
    const catalog = pendingFetch(),
      merchants = pendingFetch();
    const service = createStateService(
      memory({ [STATE_KEY]: { ...emptyState(), wallet } }).api,
      clock,
      undefined,
      catalog.fetch,
      undefined,
      merchants.fetch,
    );
    const refresh = service.refreshReleases(90_000);
    expect(ok(await service({ type: 'checkout:get-state' })).checkingTerms).toBe(true);
    catalog.reject();
    await vi.waitFor(() => expect(merchants.fetch).toHaveBeenCalledOnce());
    merchants.reject();
    expect(await refresh).toEqual({ catalog: 'failed', merchants: 'failed' });
    const after = ok(await service({ type: 'checkout:get-state' }));
    expect(after.checkingTerms).toBe(false);
    expect(after.catalog.version).toBe(CATALOG_V3.version);
    expect(ok(await service(compare(0))).comparison).toEqual({
      status: 'unavailable',
      reason: 'catalog-expired',
    });
    expect(unavailableCopy['catalog-expired']).toContain('Check for updated terms');
    expect(CHECKING_TERMS_TITLE).toBe('Checking for updated terms…');
  });
  it('never says "checking" for a valid catalog, even with a refresh pending', async () => {
    const catalog = pendingFetch();
    const valid = Date.parse(CATALOG_V3.verifiedAt) + 60 * 60 * 1000;
    const service = createStateService(memory().api, () => valid, undefined, catalog.fetch);
    const refresh = service.refreshReleases(90_000);
    expect(ok(await service({ type: 'checkout:get-state' })).checkingTerms).toBe(false);
    catalog.reject();
    await refresh;
  });
  it('shows the badge its "checking" view at a generic store, then the expired view after a failed refresh', async () => {
    const catalog = pendingFetch();
    const local = memory({ [STATE_KEY]: { ...emptyState(), wallet } }),
      session = memory();
    const vault = createVaultService(local.api, session.api, clock, undefined, catalog.fetch);
    const badge = createBadgeService({
      local: local.api,
      session: session.api,
      vault: { snapshot: vault.snapshot },
      clock,
      open: vi.fn(async () => undefined),
      notify: vi.fn(),
    });
    const refresh = vault.refreshReleases(90_000);
    const reply = await badge.content(
      {
        type: 'cart:reading',
        reading: {
          status: 'found',
          merchantId: 'generic-us-online',
          currency: 'USD',
          amountCents: 4_999,
          kind: 'estimated-total',
          extractorVersion: 'generic-reader-v1',
        },
        framed: false,
      },
      7,
      'https://shop.example.com/cart',
    );
    expect(reply.show).toBe(true);
    const get = { type: 'badge:get', nonce: reply.nonce };
    expect(await badge.badge(get, 7)).toEqual({ ok: true, view: { kind: 'checking' } });
    catalog.reject();
    expect(await refresh).toEqual({ catalog: 'failed', merchants: 'skipped' });
    expect(await badge.badge(get, 7)).toEqual({
      ok: true,
      view: {
        kind: 'unavailable',
        merchantId: 'generic-us-online',
        result: { status: 'unavailable', reason: 'catalog-expired' },
      },
    });
  });
});
