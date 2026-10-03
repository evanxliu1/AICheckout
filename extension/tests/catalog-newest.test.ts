// @vitest-environment node
// Which catalog is in effect (coordinator decision, 2026-10-02): of the cached published release and
// the bundled catalog, the one valid now, and the newer one when both are. Here the bundle is the small
// v3 fixture verified 2026-10-02, standing in for the M5 bundle (`CATALOG_V3`, also verified
// 2026-10-02; state-migration.test.ts runs the real one), and the cached release is the v2
// catalog of hosted release 1 (verified 2026-09-29) or a newer v3 release.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedRelease } from '../src/domain';
import { CATALOG_V3_FIXTURE } from '../../packages/rewards-core/test-cases';
import { emptyState } from '../src/state/contracts';
import type { AppState, CatalogCache, CheckoutResponse } from '../src/state/contracts';
import { CATALOG_KEY, createStateService, localDate, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { currentCatalog } from '../src/state/catalog';
import { redateCatalog } from '../../packages/rewards-core/src/catalog-helpers';

vi.mock('../src/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain')>();
  const { CATALOG_V3_FIXTURE: fixture } = await import('../../packages/rewards-core/test-cases');
  // Only the bundled fallback in state/catalog.ts reads this export as `BUNDLED_CATALOG`.
  return { ...actual, CATALOG_V3: { ...structuredClone(fixture), version: 'bundled-v3.1' } };
});

const realV2 = (await vi.importActual<typeof import('../src/domain')>('../src/domain')).CATALOG_V2;
let now = Date.parse('2026-10-02T15:00:00Z');
const clock = () => now;

function memory(initial: Record<string, unknown> = {}) {
  let data = structuredClone(initial);
  const writes: string[][] = [];
  const api: StateStorage = {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => {
      writes.push(Object.keys(items).sort());
      data = { ...data, ...structuredClone(items) };
    },
    remove: async (keys) => {
      for (const key of keys) delete data[key];
    },
    clear: async () => {
      data = {};
    },
  };
  return { api, writes, read: () => structuredClone(data) };
}
function ok(result: unknown) {
  const response = result as CheckoutResponse;
  if (!response.ok) throw new Error(response.error);
  return response;
}
function release(catalog: PublishedRelease['catalog'], sequence: number): PublishedRelease {
  return {
    sequence,
    version: catalog.version,
    catalog,
    catalog_hash: String(sequence).padStart(64, '0'),
    published_at: catalog.verifiedAt,
  };
}
const usage = (ruleId: string) => ({
  ruleId,
  calendarYear: 2026,
  recordedOn: localDate(now),
  spentCents: 50_000,
  activation: 'active' as const,
});
/** A newer hosted v3 release: the fixture verified later the same day, with one rule changed. */
function hostedV3(version = 'hosted-v3.2') {
  const catalog = { ...structuredClone(CATALOG_V3_FIXTURE), version, verifiedAt: '2026-10-02T06:00:00Z' };
  const rule = catalog.cards.find((c) => c.id === 'test-cash-plus')!.rules[1];
  rule.rateBps = 400;
  return catalog;
}
const cacheOf = (r: PublishedRelease | null): CatalogCache => ({ release: r, lastCheckedAt: now - 1000 });

beforeEach(() => {
  now = Date.parse('2026-10-02T15:00:00Z');
});

describe('newest valid catalog wins', () => {
  it('uses a newer bundled v3 catalog over cached v2 hosted release, keeping the release for rollback checks', async () => {
    const hosted1 = release(realV2, 2);
    expect(currentCatalog(cacheOf(hosted1), now).version).toBe('bundled-v3.1');
    // An extension update over schema 2 state that cached hosted release 1.
    const local = memory({
      [STATE_KEY]: {
        schemaVersion: 2,
        revision: 3,
        wallet: { defaultCardId: null, cards: [{ cardId: 'citi-double-cash', usage: [] }] },
        purchase: null,
        catalog: cacheOf(hosted1),
        cart: null,
        savings: [],
        pendingNotice: null,
        comparison: null,
      },
    });
    const fetchCatalog = vi.fn().mockResolvedValue({ release: release(realV2, 2) });
    const service = createStateService(local.api, clock, undefined, fetchCatalog);
    const read = ok(await service({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe('bundled-v3.1');
    expect(read.state.walletCatalogVersion).toBe('bundled-v3.1');
    // The v2 card stays in the wallet (comparisons name it unavailable); nothing is silently lost.
    expect(read.state.wallet.cards.map((c) => c.cardId)).toEqual(['citi-double-cash']);
    expect((local.read()[CATALOG_KEY] as CatalogCache).release?.sequence).toBe(2);
    // The same release again changes nothing; an older sequence is still refused.
    const again = ok(
      await service({ type: 'checkout:refresh-catalog', expectedRevision: read.state.revision }),
    );
    expect(again.catalog.version).toBe('bundled-v3.1');
    fetchCatalog.mockResolvedValue({ release: release({ ...realV2, version: '2026-09-28.real.1' }, 1) });
    expect(
      await service({ type: 'checkout:refresh-catalog', expectedRevision: read.state.revision }),
    ).toEqual({ ok: false, error: expect.stringContaining('older release') });
  });

  it('keeps a cached hosted v3 release that is newer than the bundled catalog', async () => {
    const cache = cacheOf(release(hostedV3(), 2));
    expect(currentCatalog(cache, now).version).toBe('hosted-v3.2');
    // Verified at the same time as the bundle: the published release stays in effect.
    const sameDay = { ...hostedV3('hosted-v3.3'), verifiedAt: CATALOG_V3_FIXTURE.verifiedAt };
    expect(currentCatalog(cacheOf(release(sameDay, 3)), now).version).toBe('hosted-v3.3');
    const local = memory({
      [STATE_KEY]: { ...emptyState(), walletCatalogVersion: 'hosted-v3.2' },
      [CATALOG_KEY]: cache,
    });
    const read = ok(await createStateService(local.api, clock)({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe('hosted-v3.2');
    expect(local.writes).toEqual([]);
  });

  it('uses a valid bundled catalog over an expired cached release, even a newer one', async () => {
    const expired = { ...hostedV3(), expiresAt: '2026-10-02T14:00:00Z' };
    expect(currentCatalog(cacheOf(release(expired, 2)), now).version).toBe('bundled-v3.1');
    // Neither valid: the cached release stays (comparisons report its expiry).
    expect(currentCatalog(cacheOf(release(expired, 2)), Date.parse('2026-11-02T00:00:00Z')).version).toBe(
      'hosted-v3.2',
    );
  });

  it('switches to the bundled catalog when the cached release expires, pruning changed limits', async () => {
    const hosted = { ...hostedV3(), expiresAt: '2026-10-03T00:00:00Z' };
    const wallet: AppState['wallet'] = {
      defaultCardId: 'test-cash-plus',
      cards: [
        {
          cardId: 'test-cash-plus',
          usage: [usage('cash-plus-electronics'), usage('cash-plus-department-stores')],
          choices: [{ choiceId: 'five-percent', optionIds: ['electronics'] }],
        },
      ],
    };
    const local = memory({
      [STATE_KEY]: { ...emptyState(), revision: 7, wallet, walletCatalogVersion: 'hosted-v3.2' },
      [CATALOG_KEY]: cacheOf(release(hosted, 2)),
    });
    const service = createStateService(local.api, clock);
    expect(ok(await service({ type: 'checkout:get-state' })).catalog.version).toBe('hosted-v3.2');
    expect(local.writes).toEqual([]);
    now = Date.parse('2026-10-03T00:00:00Z');
    const read = ok(await service({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe('bundled-v3.1');
    // One state write; the cache is untouched. The rule whose rate differs loses its reported spend;
    // the unchanged rule and the chosen category stay.
    expect(local.writes).toEqual([[STATE_KEY], [STATE_KEY]]);
    expect(read.state).toMatchObject({ revision: 8, walletCatalogVersion: 'bundled-v3.1' });
    expect(read.state.wallet.cards[0].usage.map((u) => u.ruleId)).toEqual(['cash-plus-department-stores']);
    expect(read.state.wallet.cards[0].choices).toEqual(wallet.cards[0].choices);
    expect(read.notice).toMatch(/review your cards/);
  });

  it('caches an older release without switching to it or writing the state', async () => {
    const local = memory({ [STATE_KEY]: { ...emptyState(), walletCatalogVersion: 'bundled-v3.1' } });
    const fetchCatalog = vi.fn().mockResolvedValue({ release: release(realV2, 1) });
    const service = createStateService(local.api, clock, undefined, fetchCatalog);
    const result = ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    expect(result.catalog.version).toBe('bundled-v3.1');
    expect(result.state.revision).toBe(0);
    expect(result.notice).toMatch(/bundled with this extension are newer/);
    expect(local.writes).toEqual([[CATALOG_KEY]]);
    // A newer release later takes over and the wallet is pruned against it in the same write.
    fetchCatalog.mockResolvedValue({ release: release(hostedV3(), 2) });
    const newer = ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    expect(newer.catalog.version).toBe('hosted-v3.2');
    expect(newer.state).toMatchObject({ revision: 1, walletCatalogVersion: 'hosted-v3.2' });
    expect(local.writes.at(-1)).toEqual([CATALOG_KEY, STATE_KEY]);
  });
});

describe('when both catalogs have expired (coordinator decision, 2026-10-03)', () => {
  const later = Date.parse('2026-11-05T15:00:00Z');
  it('uses the one verified later, and the cached release while the other is not yet valid', () => {
    const olderHosted = {
      ...hostedV3(),
      verifiedAt: '2026-10-01T00:00:00Z',
      expiresAt: '2026-10-20T00:00:00Z',
    };
    expect(currentCatalog(cacheOf(release(olderHosted, 2)), later).version).toBe('bundled-v3.1');
    const newerHosted = { ...hostedV3(), expiresAt: '2026-10-20T00:00:00Z' };
    expect(currentCatalog(cacheOf(release(newerHosted, 2)), later).version).toBe('hosted-v3.2');
    // A bundled catalog that is not yet valid (device clock before its verification) and an expired
    // cached release: the cached release, as before.
    const early = Date.parse('2026-10-01T12:00:00Z');
    const expiredEarlier = {
      ...hostedV3(),
      verifiedAt: '2026-09-20T00:00:00Z',
      expiresAt: '2026-09-30T00:00:00Z',
    };
    expect(currentCatalog(cacheOf(release(expiredEarlier, 2)), early).version).toBe('hosted-v3.2');
  });

  it('keeps choices, gate answers and point values when the catalog in effect has expired', async () => {
    // A v2 release verified after the bundle and expired with it: it is in effect, and it lacks
    // every v3 input; nothing the shopper answered is dropped.
    const v2 = {
      ...realV2,
      version: 'hosted-v2.9',
      verifiedAt: '2026-10-02T06:00:00Z',
      expiresAt: '2026-10-20T00:00:00Z',
    };
    const wallet: AppState['wallet'] = {
      defaultCardId: 'test-cash-plus',
      cards: [
        {
          cardId: 'test-cash-plus',
          usage: [usage('cash-plus-electronics')],
          choices: [{ choiceId: 'five-percent', optionIds: ['electronics'] }],
        },
      ],
      gates: [{ gateId: 'amazon-prime', optionId: 'member' }],
      valueOverrides: [{ programId: 'test-airline-miles', valueHundredthsOfCent: 150 }],
    };
    now = later;
    const local = memory({
      [STATE_KEY]: { ...emptyState(), revision: 4, wallet, walletCatalogVersion: 'bundled-v3.1' },
      [CATALOG_KEY]: cacheOf(release(v2, 2)),
    });
    const service = createStateService(local.api, clock);
    const read = ok(await service({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe('hosted-v2.9');
    expect(read.state.walletCatalogVersion).toBe('hosted-v2.9');
    // The usage row's rule is not in the v2 catalog: dropped as before. The answers stay.
    expect(read.state.wallet.cards[0].choices).toEqual(wallet.cards[0].choices);
    expect(read.state.wallet.gates).toEqual(wallet.gates);
    expect(read.state.wallet.valueOverrides).toEqual(wallet.valueOverrides);
    // Saving and comparing still work: the comparison reports the expiry.
    const saved = ok(
      await service({
        type: 'checkout:save-wallet',
        expectedRevision: read.state.revision,
        wallet: { ...read.state.wallet, cards: [], defaultCardId: null },
      }),
    );
    expect(saved.state.wallet.gates).toEqual(wallet.gates);
    // Once a valid catalog is in effect again, its own IDs decide what stays.
    const fresh = { ...redateCatalog(CATALOG_V3_FIXTURE, '2026-11-05'), version: 'hosted-v3.9' };
    fresh.gates = fresh.gates.filter((g) => g.id !== 'amazon-prime');
    for (const card of fresh.cards)
      for (const rule of card.rules) rule.requires = rule.requires.filter((r) => r.gateId !== 'amazon-prime');
    await local.api.set({ [CATALOG_KEY]: cacheOf(release(fresh, 3)) });
    const after = ok(await service({ type: 'checkout:get-state' }));
    expect(after.catalog.version).toBe('hosted-v3.9');
    expect(after.state.wallet.gates).toEqual([]);
    expect(after.state.wallet.valueOverrides).toEqual(wallet.valueOverrides);
  });
});
