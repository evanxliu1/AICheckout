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
import type { CheckoutResponse } from '../src/state/contracts';

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
  it('an install refresh landing while onboarding is open does not turn its first save into a conflict', async () => {
    const service = createStateService(
      memory().api,
      clock,
      undefined,
      vi.fn(async () => renewed()),
      undefined,
      vi.fn(async () => ({ release: null })),
    );
    // The onboarding page reads the state, then the install-time refresh lands with new terms.
    const opened = ok(await service({ type: 'checkout:get-state' }));
    expect(await service.refreshReleases(90_000)).toEqual({ catalog: 'ok', merchants: 'ok' });
    const saved = ok(
      await service({ type: 'checkout:save-wallet', wallet, expectedRevision: opened.state.revision }),
    );
    expect(saved.state.wallet.cards).toEqual(wallet.cards);
    expect(saved.catalog.version).toBe('renewed.test.1');
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
  /* Review (2026-10-20): the fetch runs outside the queues, so everything written meanwhile must be honoured
   * at commit. */
  it('commits against what pages wrote during the fetch: a newer check wins and the late rollback is refused', async () => {
    const replies: { resolve: (value: unknown) => void }[] = [];
    const fetch = vi.fn(() => new Promise<unknown>((resolve) => replies.push({ resolve })));
    const local = memory({ [STATE_KEY]: { ...emptyState(), wallet } });
    const service = createStateService(local.api, clock, undefined, fetch);
    const refresh = service.refreshReleases(90_000);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    // The shopper presses "Check for updated terms" while the install fetch waits; it gets release 2.
    const check = service({ type: 'checkout:refresh-catalog', expectedRevision: 0 });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const newer = renewed();
    newer.release.sequence = 2;
    newer.release.version = newer.release.catalog.version = 'renewed.test.2';
    replies[1].resolve(newer);
    const checked = ok(await check);
    expect(checked.catalog.version).toBe('renewed.test.2');
    // The install fetch answers last, with the older release 1: refused at commit, release 2 stays.
    replies[0].resolve(renewed());
    expect(await refresh).toEqual({ catalog: 'failed', merchants: 'skipped' });
    expect(local.read()).toMatchObject({
      checkoutCatalogV1: { release: { sequence: 2 } },
      [STATE_KEY]: { revision: checked.state.revision },
    });
  });
  it('a vault locked during the fetch fails the commit and writes nothing; a locked refresh never says "checking"', async () => {
    const catalog = pendingFetch(),
      merchants = pendingFetch();
    const local = memory({ [STATE_KEY]: { ...emptyState(), wallet } }),
      session = memory();
    const vault = createVaultService(
      local.api,
      session.api,
      clock,
      undefined,
      catalog.fetch,
      merchants.fetch,
    );
    const phrase = 'test-only purple canyon lantern';
    expect(
      await vault({ type: 'checkout:vault-create', passphrase: phrase, disclosureVersion: 1 }),
    ).toMatchObject({ ok: true });
    const refresh = vault.refreshReleases(90_000);
    await vi.waitFor(() => expect(catalog.fetch).toHaveBeenCalledOnce());
    // The vault's queue is free during the fetch: the lock is answered at once.
    expect(await vault({ type: 'checkout:vault-lock' })).toEqual({ ok: true, status: 'locked' });
    const before = local.read();
    catalog.resolve(renewed());
    await vi.waitFor(() => expect(merchants.fetch).toHaveBeenCalledOnce());
    merchants.resolve({ release: null });
    expect((await refresh).catalog).toBe('failed');
    expect(local.read()[STATE_KEY]).toEqual(before[STATE_KEY]);
    expect(local.read().checkoutCatalogV1).toEqual(before.checkoutCatalogV1);
    // Locked: the catalog step is skipped, so nothing is "checking" even after an unlock while the merchant
    // fetch is still pending.
    const locked = vault.refreshReleases(90_000);
    await vi.waitFor(() => expect(merchants.fetch).toHaveBeenCalledTimes(2));
    expect(await vault({ type: 'checkout:vault-unlock', passphrase: phrase })).toEqual({
      ok: true,
      status: 'unlocked',
    });
    const state = (await vault({ type: 'checkout:get-state' })) as CheckoutResponse;
    expect(ok(state).checkingTerms).toBe(false);
    merchants.resolve({ release: null });
    expect((await locked).catalog).toBe('skipped');
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
