import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MERCHANTS_V1 } from '../src/domain';
import type { MerchantRelease, PublishedMerchantRelease } from '../src/domain';
import { MERCHANT_RELEASE_FIXTURE } from '../../packages/rewards-core/test-cases';
import {
  currentMerchants,
  emptyMerchantCache,
  MerchantUpdateError,
  prepareMerchantUpdate,
  readMerchantCache,
} from '../src/state/merchants';
import type { MerchantCache } from '../src/state/merchants';
import { CATALOG_KEY, createStateService, MERCHANTS_KEY, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { createVaultService } from '../src/state/vault-service';
import { createBadgeService } from '../src/background/badge-service';
import { emptyState } from '../src/state/contracts';
import type { AppState, CheckoutResponse } from '../src/state/contracts';
import { localDate } from '../src/state/keys';
import { VAULT_DISCLOSURE_VERSION } from '../src/state/vault-contracts';
import { BADGE_TABS_KEY } from '../src/badge/contracts';
import { GENERIC_READER_VERSION } from '../src/checkout/merchants';
import { CATALOG_V3 } from '../src/domain';
import { redateCatalog } from '../src/domain';

/* Phase 14.6: the hosted merchant release in the extension — fetch, validate, cache, rollback protection,
 * the release in effect, and the background refresh. */

const NOW = Date.parse('2026-10-11T15:00:00Z');
/** The fixture (verified 2026-10-10) is older than the bundled release; `newer` is verified after it. */
const bundled: MerchantRelease = MERCHANTS_V1;
const newer: MerchantRelease = {
  ...MERCHANT_RELEASE_FIXTURE,
  version: '2026-10-11.hosted.1',
  verifiedAt: '2026-10-11T00:00:00Z',
  merchants: [
    ...MERCHANT_RELEASE_FIXTURE.merchants,
    {
      id: 'hosted-only-us',
      name: 'Hosted Only Store',
      hosts: ['hosted-only.example'],
      kind: 'merchant',
      physicalGoods: true,
      category: 'general-merchandise',
      evidence: { basis: 'default', sourceIds: [] },
      brandIds: [],
      disabled: false,
    },
  ],
};
function published(
  release: MerchantRelease,
  sequence = 1,
  published_at = '2026-10-11T12:00:00Z',
): PublishedMerchantRelease {
  return {
    sequence,
    release,
    version: release.version,
    release_hash: String(sequence).padStart(64, '0'),
    published_at,
  };
}
const cacheOf = (
  release: PublishedMerchantRelease | null,
  lastCheckedAt: number | null = null,
): MerchantCache => ({
  release,
  lastCheckedAt,
});

describe('the merchant release in effect', () => {
  it('is the bundled release without a cache or with an unreadable one', async () => {
    expect(currentMerchants(emptyMerchantCache())).toBe(bundled);
    const storage = { get: async () => ({ [MERCHANTS_KEY]: { release: 'garbage' } }) };
    expect(currentMerchants(await readMerchantCache(storage))).toBe(bundled);
    expect(currentMerchants(await readMerchantCache({ get: async () => ({}) }))).toBe(bundled);
  });
  it('is the cached release when verified later, else the bundled one; the cached one on a tie', () => {
    expect(currentMerchants(cacheOf(published(newer)))).toBe(newer);
    expect(currentMerchants(cacheOf(published(MERCHANT_RELEASE_FIXTURE)))).toBe(bundled);
    const tie = { ...MERCHANT_RELEASE_FIXTURE, version: '2026-10-11.tie.1', verifiedAt: bundled.verifiedAt };
    expect(currentMerchants(cacheOf(published(tie)))).toBe(tie);
  });
});

describe('prepareMerchantUpdate', () => {
  it('caches a newer valid release and reports the change', () => {
    const update = prepareMerchantUpdate(emptyMerchantCache(), { release: published(newer) }, NOW);
    expect(update.cache).toEqual(cacheOf(published(newer), NOW));
    expect(update.changed).toBe(true);
    expect(update.notice).toBe('Store data updated.');
  });
  it('caches an older release without putting it in effect', () => {
    const update = prepareMerchantUpdate(
      emptyMerchantCache(),
      { release: published(MERCHANT_RELEASE_FIXTURE) },
      NOW,
    );
    expect(update.cache.release?.version).toBe(MERCHANT_RELEASE_FIXTURE.version);
    expect(update.changed).toBe(false);
    expect(update.notice).toContain('bundled with this extension are newer');
  });
  it('records a check that found no publication, and refuses a vanished one', () => {
    const none = prepareMerchantUpdate(emptyMerchantCache(), { release: null }, NOW);
    expect(none.cache).toEqual(cacheOf(null, NOW));
    expect(none.notice).toContain('No published store data');
    expect(() => prepareMerchantUpdate(cacheOf(published(newer)), { release: null }, NOW)).toThrow(
      MerchantUpdateError,
    );
  });
  it('rejects invalid bodies, future dates, rollback, same-sequence changes and reused versions', () => {
    const cached = cacheOf(published(newer, 2));
    const attempts: [string, unknown][] = [
      ['garbage', { release: { sequence: 2 } }],
      ['a catalog', { release: { ...published(newer, 2), release: CATALOG_V3 } }],
      ['an invalid release', { release: published({ ...newer, merchants: [] }, 3) }],
      [
        'a future verification',
        {
          release: published(
            { ...newer, version: '2026-10-12.x.1', verifiedAt: '2026-10-12T00:00:00Z' },
            3,
            '2026-10-12T01:00:00Z',
          ),
        },
      ],
      [
        'a future publication',
        { release: published({ ...newer, version: '2026-10-11.x.2' }, 3, '2026-10-12T00:00:00Z') },
      ],
      ['a lower sequence (rollback)', { release: published(MERCHANT_RELEASE_FIXTURE, 1) }],
      [
        'the same sequence with other content',
        { release: { ...published(newer, 2), release_hash: 'f'.repeat(64) } },
      ],
      ['a reused version', { release: published(newer, 3) }],
    ];
    for (const [name, input] of attempts) {
      expect(() => prepareMerchantUpdate(cached, input, NOW), name).toThrow(MerchantUpdateError);
    }
    const same = prepareMerchantUpdate(cached, { release: published(newer, 2) }, NOW);
    expect(same.cache).toEqual(cacheOf(published(newer, 2), NOW));
    expect(same.notice).toBe('Your store data is up to date.');
  });
});

/* The worker: the state service, the vault service and the badge service read the cache on every request. */
let data: Record<string, unknown>;
const storage = (): StateStorage => ({
  get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
  set: async (values) => {
    Object.assign(data, structuredClone(values));
  },
  remove: async (keys) => {
    for (const key of keys) delete data[key];
  },
  clear: async () => {
    data = {};
  },
});
const catalog = redateCatalog(CATALOG_V3, '2026-10-10');
const catalogRelease = {
  sequence: 1,
  version: catalog.version,
  catalog_hash: 'a'.repeat(64),
  published_at: '2026-10-10T12:00:00Z',
  catalog,
};
const wallet = { cards: [{ cardId: 'capital-one-quicksilver', usage: [] }], defaultCardId: null };
function ok(result: CheckoutResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}
beforeEach(() => {
  data = {
    [STATE_KEY]: { ...emptyState(), wallet, walletCatalogVersion: catalog.version } satisfies AppState,
    [CATALOG_KEY]: { release: catalogRelease, lastCheckedAt: null },
  };
});

describe('state service on the cached release', () => {
  const rates = (merchantId: string) =>
    ({ type: 'checkout:rates', merchantId, onlineRetail: 'eligible' }) as const;
  it('compares at a store only the cached release knows, and falls back to the bundled release without a cache', async () => {
    const service = createStateService(storage(), () => NOW);
    // Without a cache the id is unknown: the engine answers for an unknown merchant.
    const before = ok(await service(rates('hosted-only-us')));
    expect(before.comparison?.status).toBe('unavailable');
    data[MERCHANTS_KEY] = cacheOf(published(newer));
    const after = ok(await service(rates('hosted-only-us')));
    expect(after.comparison?.status).toBe('ready');
  });
  it('refreshes the merchant release with the catalog on "Check for updated terms" and keeps the notice about terms', async () => {
    const fetchCatalog = vi.fn(async () => ({ release: catalogRelease }));
    const fetchMerchants = vi.fn(async () => ({ release: published(newer) }));
    const service = createStateService(
      storage(),
      () => NOW,
      undefined,
      fetchCatalog,
      undefined,
      fetchMerchants,
    );
    const result = ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    expect(result.notice).toBe('Your card terms are up to date.');
    expect(fetchMerchants).toHaveBeenCalledOnce();
    expect(data[MERCHANTS_KEY]).toEqual(cacheOf(published(newer), NOW));
    // A failing merchant fetch does not fail the check.
    fetchMerchants.mockRejectedValueOnce(new Error('offline'));
    ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    expect(data[MERCHANTS_KEY]).toEqual(cacheOf(published(newer), NOW));
    // A rolled-back release is refused and the cache kept.
    fetchMerchants.mockResolvedValueOnce({ release: published(MERCHANT_RELEASE_FIXTURE, 0) } as never);
    ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    expect((data[MERCHANTS_KEY] as MerchantCache).release?.sequence).toBe(1);
  });
  it('background refresh reports each release and fails without throwing', async () => {
    const fetchCatalog = vi.fn(async () => ({ release: catalogRelease }));
    const fetchMerchants = vi.fn(async () => ({ release: published(newer) }));
    const service = createStateService(
      storage(),
      () => NOW,
      undefined,
      fetchCatalog,
      undefined,
      fetchMerchants,
    );
    expect(await service.refreshReleases(1000)).toEqual({ catalog: 'ok', merchants: 'ok' });
    expect(data[MERCHANTS_KEY]).toEqual(cacheOf(published(newer), NOW));
    fetchCatalog.mockRejectedValueOnce(new Error('asleep'));
    fetchMerchants.mockRejectedValueOnce(new Error('asleep'));
    expect(await service.refreshReleases(1000)).toEqual({ catalog: 'failed', merchants: 'failed' });
    const none = createStateService(storage(), () => NOW);
    expect(await none.refreshReleases(1000)).toEqual({ catalog: 'skipped', merchants: 'skipped' });
  });
  it('background refresh gives up on a fetch that outlasts its limit', async () => {
    vi.useFakeTimers();
    try {
      const fetchMerchants = vi.fn(
        (signal: AbortSignal) =>
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
      const service = createStateService(
        storage(),
        () => NOW,
        undefined,
        undefined,
        undefined,
        fetchMerchants,
      );
      const pending = service.refreshReleases(5_000);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await pending).toEqual({ catalog: 'skipped', merchants: 'failed' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('vault and badge services on the cached release', () => {
  it('refreshes the public merchant cache while the vault is locked, and the catalog once unlocked', async () => {
    const local = storage();
    const session = storage();
    const sessionData: Record<string, unknown> = {};
    const sessionStorage: StateStorage = {
      ...session,
      get: async (key) => (key in sessionData ? { [key]: sessionData[key] } : {}),
      set: async (values) => {
        Object.assign(sessionData, values);
      },
      remove: async (keys) => {
        for (const key of keys) delete sessionData[key];
      },
      clear: async () => undefined,
    };
    const fetchCatalog = vi.fn(async () => ({ release: catalogRelease }));
    const fetchMerchants = vi.fn(async () => ({ release: published(newer) }));
    const vault = createVaultService(
      local,
      sessionStorage,
      () => NOW,
      undefined,
      fetchCatalog,
      fetchMerchants,
    );
    ok(
      (await vault({
        type: 'checkout:vault-create',
        passphrase: 'correct horse battery',
        disclosureVersion: VAULT_DISCLOSURE_VERSION,
      })) as CheckoutResponse,
    );
    ok((await vault({ type: 'checkout:vault-lock' })) as CheckoutResponse);
    expect(await vault.refreshReleases(1000)).toEqual({ catalog: 'failed', merchants: 'ok' });
    expect(data[MERCHANTS_KEY]).toEqual(cacheOf(published(newer), NOW));
    ok(
      (await vault({
        type: 'checkout:vault-unlock',
        passphrase: 'correct horse battery',
      })) as CheckoutResponse,
    );
    expect(await vault.refreshReleases(1000)).toEqual({ catalog: 'ok', merchants: 'ok' });
  });
  it('the badge matches a tab against the cached release when it is newer', async () => {
    const local = storage();
    const sessionData: Record<string, unknown> = {};
    const session: StateStorage = {
      get: async (key) => (key in sessionData ? { [key]: structuredClone(sessionData[key]) } : {}),
      set: async (values) => {
        Object.assign(sessionData, structuredClone(values));
      },
      remove: async () => undefined,
      clear: async () => undefined,
    };
    const vault = createVaultService(local, session, () => NOW);
    const badge = createBadgeService({
      local,
      session,
      vault: { snapshot: vault.snapshot, handle: vault },
      clock: () => NOW,
      open: async () => undefined,
      notify: () => undefined,
    });
    const reading = {
      type: 'cart:reading',
      reading: {
        status: 'found',
        merchantId: 'generic-us-online',
        currency: 'USD',
        amountCents: 10000,
        kind: 'total',
        extractorVersion: GENERIC_READER_VERSION,
      },
      framed: false,
    };
    await badge.content(reading, 7, 'https://www.hosted-only.example/cart');
    expect((sessionData[BADGE_TABS_KEY] as Record<string, { merchantId: string }>)['7'].merchantId).toBe(
      'generic-us-online',
    );
    data[MERCHANTS_KEY] = cacheOf(published(newer));
    await badge.content(reading, 8, 'https://www.hosted-only.example/cart');
    expect((sessionData[BADGE_TABS_KEY] as Record<string, { merchantId: string }>)['8'].merchantId).toBe(
      'hosted-only-us',
    );
    expect(localDate(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
