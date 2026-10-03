import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_V2, PILOT_CATALOG, redateCatalog } from '../src/domain';
import { CATALOG_KEY, createStateService, localDate, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { MIGRATION_NOTICE } from '../src/state/migrate';
import { emptyState } from '../src/state/contracts';
import type { AppState, CheckoutResponse } from '../src/state/contracts';

const now = Date.parse('2026-09-30T15:00:00Z');
let data: Record<string, unknown>;
const storage: StateStorage = {
  get: vi.fn(async () => structuredClone(data)),
  set: vi.fn(async (values) => void Object.assign(data, structuredClone(values))),
  remove: vi.fn(async (keys: string[]) => keys.forEach((key) => delete data[key])),
  clear: vi.fn(async () => void (data = {})),
};
const row = (ruleId: string) => ({
  ruleId,
  calendarYear: 2026,
  recordedOn: localDate(now),
  spentCents: 0,
  activation: 'unknown' as const,
});
/** A schema-1 (pilot release) state as it was stored. */
function pilotState(usage: ReturnType<typeof row>[], release: unknown = null) {
  return {
    schemaVersion: 1,
    revision: 4,
    wallet: {
      defaultCardId: 'amex-blue-cash-everyday',
      cards: [
        { cardId: 'capital-one-quicksilver', usage: [] },
        { cardId: 'amex-blue-cash-everyday', usage },
      ],
    },
    purchase: null,
    catalog: { release, lastCheckedAt: null },
    cart: null,
    comparison: {
      inputRevision: 4,
      catalogVersion: '2026-09-25.pilot.2',
      computedAt: now - 1000,
      cartId: null,
    },
  };
}
function ok(result: CheckoutResponse) {
  if (!result.ok) throw new Error(result.error);
  return result;
}
beforeEach(() => {
  data = {};
});

describe('pilot state migration (schema 1 → 3)', () => {
  it('keeps card IDs and existing rules, drops usage for removed rules with a notice, and persists once', async () => {
    data[STATE_KEY] = pilotState([row('bce-online-retail'), row('bce-retired-rule')]);
    const handle = createStateService(storage, () => now);
    const first = ok(await handle({ type: 'checkout:get-state' }));
    expect(first.notice).toBe(MIGRATION_NOTICE);
    expect(first.state).toMatchObject({ schemaVersion: 3, revision: 5, comparison: null });
    expect(first.state.wallet.cards.map((c) => c.cardId)).toEqual([
      'capital-one-quicksilver',
      'amex-blue-cash-everyday',
    ]);
    expect(first.state.wallet.cards[1].usage.map((u) => u.ruleId)).toEqual(['bce-online-retail']);
    expect((data[STATE_KEY] as { schemaVersion: number }).schemaVersion).toBe(3);
    expect(data[CATALOG_KEY]).toEqual({ release: null, lastCheckedAt: null });
    expect(ok(await handle({ type: 'checkout:get-state' })).notice).toBeNull();
  });
  it('migrates silently when every usage row still applies, and the v2 engine accepts the wallet', async () => {
    data[STATE_KEY] = pilotState([row('bce-online-retail')]);
    const handle = createStateService(storage, () => now);
    const read = ok(await handle({ type: 'checkout:get-state' }));
    expect(read.notice).toBeNull();
    const compared = ok(
      await handle({
        type: 'checkout:compare',
        expectedRevision: read.state.revision,
        purchase: {
          merchantId: 'best-buy-us',
          currency: 'USD',
          amountCents: 10_000,
          purchasedOn: localDate(now),
          eligiblePurchase: 'eligible',
          onlineRetail: 'eligible',
        },
      }),
    );
    expect(compared.comparison).toMatchObject({
      status: 'ready',
      preferredCardId: 'amex-blue-cash-everyday',
    });
    if (compared.comparison?.status !== 'ready') throw new Error('not ready');
    expect(compared.comparison.estimates[0]).toMatchObject({ minRewardCents: 300, maxRewardCents: 300 });
  });
  it('checks usage against a cached v1 release when one is saved and newer than the bundle', async () => {
    const release = {
      sequence: 3,
      version: 'published.3',
      catalog: {
        ...structuredClone(PILOT_CATALOG),
        version: 'published.3',
        verifiedAt: '2026-09-30T00:00:00Z',
      },
      catalog_hash: '3'.repeat(64),
      published_at: '2026-09-30T12:00:00Z',
    };
    data[STATE_KEY] = pilotState([row('bce-online-retail'), row('bce-base')], release);
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe('published.3');
    expect((data[CATALOG_KEY] as { release: { version: string } }).release.version).toBe('published.3');
    expect(read.state.wallet.cards[1].usage.map((u) => u.ruleId)).toEqual(['bce-online-retail', 'bce-base']);
  });
});

describe('pending migration notice', () => {
  it('survives a worker restart until a response can show it', async () => {
    data[STATE_KEY] = pilotState([row('bce-retired-rule')]);
    // A lifecycle event migrates first, without any response to the popup.
    await createStateService(storage, () => now).invalidateTab(1);
    expect((data[STATE_KEY] as { pendingNotice: string }).pendingNotice).toBe(MIGRATION_NOTICE);
    const restarted = createStateService(storage, () => now);
    expect(ok(await restarted({ type: 'checkout:get-state' })).notice).toBe(MIGRATION_NOTICE);
    expect((data[STATE_KEY] as { pendingNotice: string | null }).pendingNotice).toBeNull();
    expect(ok(await restarted({ type: 'checkout:get-state' })).notice).toBeNull();
  });
});

describe('catalog v2-era state migration (schema 2 → 3)', () => {
  const cached = (version: string, sequence = 7) => ({
    sequence,
    version,
    catalog: { ...redateCatalog(CATALOG_V2, '2026-09-29'), version },
    catalog_hash: 'c'.repeat(64),
    published_at: '2026-09-29T12:00:00Z',
  });
  /** A schema-2 state as the catalog v2 releases stored it: the catalog cache inside the state. */
  function v2State(release: unknown = null) {
    return {
      ...pilotState([row('bce-online-retail')], release),
      schemaVersion: 2,
      pendingNotice: null,
      savings: [],
    };
  }
  it('moves the cached release to its own key in one write and stamps the wallet', async () => {
    data[STATE_KEY] = v2State(cached('published.7'));
    const writes = vi.mocked(storage.set);
    writes.mockClear();
    const handle = createStateService(storage, () => now);
    const read = ok(await handle({ type: 'checkout:get-state' }));
    expect(read.notice).toBeNull();
    expect(read.catalog.version).toBe('published.7');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(Object.keys(writes.mock.calls[0][0]).sort()).toEqual([CATALOG_KEY, STATE_KEY].sort());
    const saved = data[STATE_KEY] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('catalog');
    expect(saved).toMatchObject({
      schemaVersion: 3,
      revision: 5,
      comparison: null,
      walletCatalogVersion: 'published.7',
    });
    expect(data[CATALOG_KEY]).toMatchObject({ release: { sequence: 7, version: 'published.7' } });
    // Migrated once: the next read writes nothing.
    ok(await handle({ type: 'checkout:get-state' }));
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it('uses the bundled catalog when nothing was cached', async () => {
    data[STATE_KEY] = v2State();
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe(CATALOG_V2.version);
    expect(read.state.walletCatalogVersion).toBe(CATALOG_V2.version);
    expect(read.state.wallet.cards[1].usage).toHaveLength(1);
  });
  it('keeps a cache already under the catalog key over the one inside the state', async () => {
    data[STATE_KEY] = v2State(cached('published.7'));
    data[CATALOG_KEY] = { release: cached('published.8', 8), lastCheckedAt: now - 1 };
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe('published.8');
    expect(data[CATALOG_KEY]).toMatchObject({ release: { sequence: 8 }, lastCheckedAt: now - 1 });
  });
});

describe('reconciling with a new catalog in effect (schema 3)', () => {
  function v3State(walletCatalogVersion: string | null, usage: ReturnType<typeof row>[]) {
    return {
      ...emptyState(),
      revision: 9,
      walletCatalogVersion,
      wallet: {
        defaultCardId: 'amex-blue-cash-everyday',
        cards: [{ cardId: 'amex-blue-cash-everyday', usage }],
        gates: [{ gateId: 'amazon-prime', optionId: 'member' }],
        valueOverrides: [{ programId: 'test-airline-miles', valueHundredthsOfCent: 150 }],
      },
    };
  }
  it('drops what a new bundled catalog lacks after an extension update, with a notice', async () => {
    // Saved under another bundle: its rule, gate and program IDs are not in the bundled catalog v2.
    data[STATE_KEY] = v3State('older-bundle.1', [row('bce-online-retail'), row('bce-retired-rule')]);
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.notice).toBe(MIGRATION_NOTICE);
    expect(read.state).toMatchObject({ revision: 10, walletCatalogVersion: CATALOG_V2.version });
    expect(read.state.wallet).toEqual({
      defaultCardId: 'amex-blue-cash-everyday',
      cards: [{ cardId: 'amex-blue-cash-everyday', usage: [row('bce-online-retail')] }],
      gates: [],
      valueOverrides: [],
    });
  });
  it('only stamps the version when nothing is stale, so open pages keep their revision', async () => {
    data[STATE_KEY] = { ...v3State(null, [row('bce-online-retail')]) };
    const state = data[STATE_KEY] as AppState;
    delete state.wallet.gates;
    delete state.wallet.valueOverrides;
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.notice).toBeNull();
    expect(read.state).toMatchObject({ revision: 9, walletCatalogVersion: CATALOG_V2.version });
    expect((data[STATE_KEY] as AppState).walletCatalogVersion).toBe(CATALOG_V2.version);
  });
  it('ignores an unreadable catalog cache and uses the bundled terms', async () => {
    data[STATE_KEY] = v3State(CATALOG_V2.version, [row('bce-online-retail')]);
    data[CATALOG_KEY] = { release: { sequence: 'broken' }, lastCheckedAt: null };
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe(CATALOG_V2.version);
  });
});
