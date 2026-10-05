import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_V2, CATALOG_V3, PILOT_CATALOG, redateCatalog } from '../src/domain';
import { CATALOG_KEY, createStateService, localDate, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { MIGRATION_NOTICE } from '../src/state/migrate';
import { emptyState } from '../src/state/contracts';
import type { AppState, CheckoutResponse } from '../src/state/contracts';

const DAY_MS = 86_400_000;
/** The UTC date `offset` days after the bundled catalog v3 was verified. */
const dayAfterBundle = (offset: number) =>
  new Date(Date.parse(CATALOG_V3.verifiedAt) + offset * DAY_MS).toISOString().slice(0, 10);
// 15:00 UTC the day after the bundled catalog v3 was verified, before release 1 expires (2026-10-29).
const now = Date.parse(`${dayAfterBundle(1)}T15:00:00Z`);
/** Release-1 rule IDs the 2026-10-05 renewal reissued because their terms changed (build report,
 * "Rule-ID continuity"): recorded spend on them does not carry over. */
const REISSUED_RELEASE_1_RULES = [
  'double-cash-base',
  'double-cash-travel-portal',
  'quicksilver-entertainment-portal',
  'savor-supermarkets',
  'savor-dining',
  'savor-entertainment',
  'savor-streaming',
  'freedom-unlimited-base',
  'freedom-unlimited-travel-portal',
  'freedom-unlimited-dining',
  'freedom-unlimited-drugstores',
  'bce-base',
  'bce-supermarkets',
  'bce-online-retail',
  'bce-gas',
  'bcp-base',
  'bcp-supermarkets',
  'bcp-streaming',
  'bcp-transit',
  'bcp-gas',
];
/** Blue Cash Everyday's online-retail rule in the bundled catalog v3 (reissued from `bce-online-retail`). */
const BCE_ONLINE_RETAIL_V3 = 'bce-online-retail-v2';
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
/** A schema-1 (pilot release) state as it was stored; `usage` is Blue Cash Everyday's. */
function pilotState(
  usage: ReturnType<typeof row>[],
  release: unknown = null,
  quicksilverUsage: ReturnType<typeof row>[] = [],
) {
  return {
    schemaVersion: 1,
    revision: 4,
    wallet: {
      defaultCardId: 'amex-blue-cash-everyday',
      cards: [
        { cardId: 'capital-one-quicksilver', usage: quicksilverUsage },
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
    // `quicksilver-base` is in the pilot, release 1 and the bundled v3; the renewal reissued `bce-online-retail`.
    data[STATE_KEY] = pilotState([row('bce-online-retail'), row('bce-retired-rule')], null, [
      row('quicksilver-base'),
    ]);
    const handle = createStateService(storage, () => now);
    const first = ok(await handle({ type: 'checkout:get-state' }));
    expect(first.notice).toBe(MIGRATION_NOTICE);
    expect(first.state).toMatchObject({ schemaVersion: 3, revision: 5, comparison: null });
    expect(first.state.wallet.cards.map((c) => c.cardId)).toEqual([
      'capital-one-quicksilver',
      'amex-blue-cash-everyday',
    ]);
    expect(first.state.wallet.cards[0].usage.map((u) => u.ruleId)).toEqual(['quicksilver-base']);
    expect(first.state.wallet.cards[1].usage).toEqual([]);
    expect((data[STATE_KEY] as { schemaVersion: number }).schemaVersion).toBe(3);
    expect(data[CATALOG_KEY]).toEqual({ release: null, lastCheckedAt: null });
    expect(ok(await handle({ type: 'checkout:get-state' })).notice).toBeNull();
  });
  it('migrates silently when every usage row still applies, and the v3 engine accepts the wallet', async () => {
    data[STATE_KEY] = pilotState([], null, [row('quicksilver-base')]);
    const handle = createStateService(storage, () => now);
    const read = ok(await handle({ type: 'checkout:get-state' }));
    expect(read.notice).toBeNull();
    expect(read.state.wallet.cards[0].usage.map((u) => u.ruleId)).toEqual(['quicksilver-base']);
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
    // Blue Cash Everyday has no usage row, so its online-retail cap use is unknown (1%-3%).
    expect(compared.comparison).toMatchObject({
      status: 'ready',
      preferredCardId: 'capital-one-quicksilver',
    });
    if (compared.comparison?.status !== 'ready') throw new Error('not ready');
    expect(compared.comparison.estimates[0]).toMatchObject({
      cardId: 'capital-one-quicksilver',
      appliedRuleId: 'quicksilver-base',
      minRewardCents: 150,
      maxRewardCents: 150,
    });
  });
  it('checks usage against a cached v1 release when one is saved and newer than the bundle', async () => {
    const release = {
      sequence: 3,
      version: 'published.3',
      catalog: {
        ...structuredClone(PILOT_CATALOG),
        version: 'published.3',
        verifiedAt: `${dayAfterBundle(1)}T00:00:00Z`,
      },
      catalog_hash: '3'.repeat(64),
      published_at: `${dayAfterBundle(1)}T12:00:00Z`,
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

/** The wallet with usage rows on reissued release-1 rules removed; every other row unchanged. */
function withoutReissued<T extends { usage: { ruleId: string }[] }>(cards: T[]): T[] {
  return cards.map((card) => ({
    ...card,
    usage: card.usage.filter((u) => !REISSUED_RELEASE_1_RULES.includes(u.ruleId)),
  }));
}

describe('catalog v2-era state migration (schema 2 → 3)', () => {
  const cached = (version: string, sequence = 7) => ({
    sequence,
    version,
    // Verified after the bundled catalog, so it stays in effect.
    catalog: { ...redateCatalog(CATALOG_V2, dayAfterBundle(1)), version },
    catalog_hash: 'c'.repeat(64),
    published_at: `${dayAfterBundle(1)}T12:00:00Z`,
  });
  /** A schema-2 state as the catalog v2 releases stored it: the catalog cache inside the state. */
  function v2State(release: unknown = null) {
    return {
      ...pilotState([], release, [row('quicksilver-base')]),
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
    expect(read.catalog.version).toBe(CATALOG_V3.version);
    expect(read.state.walletCatalogVersion).toBe(CATALOG_V3.version);
    expect(read.state.wallet.cards[0].usage).toHaveLength(1);
  });
  it('moves a wallet of the seven real cards from cached hosted release 1 onto the bundled v3, keeping every usage row the renewal did not reissue', async () => {
    // Hosted release 1 exactly as published: CATALOG_V2, verified 2026-09-29, sequence 1.
    const release1 = {
      sequence: 1,
      version: CATALOG_V2.version,
      catalog: structuredClone(CATALOG_V2),
      catalog_hash: '1'.repeat(64),
      published_at: '2026-10-02T02:29:00Z',
    };
    const cards = CATALOG_V2.cards.map((card) => ({
      cardId: card.id,
      usage: card.rules.map((rule) => ({
        ...row(rule.id),
        spentCents: 12_345,
        activation: 'active' as const,
      })),
    }));
    data[STATE_KEY] = {
      ...v2State(release1),
      wallet: { defaultCardId: 'citi-double-cash', cards },
    };
    const handle = createStateService(storage, () => now);
    const read = ok(await handle({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe(CATALOG_V3.version);
    expect(read.notice).toBe(MIGRATION_NOTICE);
    // Shown once in this response, so no longer pending.
    expect(read.state).toMatchObject({ walletCatalogVersion: CATALOG_V3.version, pendingNotice: null });
    expect(read.state.wallet).toEqual({ defaultCardId: 'citi-double-cash', cards: withoutReissued(cards) });
    // Release 1 stays cached as the reference for the sequence check.
    expect(data[CATALOG_KEY]).toMatchObject({ release: { sequence: 1, version: CATALOG_V2.version } });
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
    expect(compared.comparison).toMatchObject({ status: 'ready', catalogVersion: CATALOG_V3.version });
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
        gates: [{ gateId: 'retired-gate', optionId: 'member' }],
        valueOverrides: [{ programId: 'test-airline-miles', valueHundredthsOfCent: 150 }],
      },
    };
  }
  it('drops what a new bundled catalog lacks after an extension update, with a notice', async () => {
    // Saved under another bundle: its rule, gate and program IDs are not in the bundled catalog v3.
    data[STATE_KEY] = v3State('older-bundle.1', [row(BCE_ONLINE_RETAIL_V3), row('bce-retired-rule')]);
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.notice).toBe(MIGRATION_NOTICE);
    expect(read.state).toMatchObject({ revision: 10, walletCatalogVersion: CATALOG_V3.version });
    expect(read.state.wallet).toEqual({
      defaultCardId: 'amex-blue-cash-everyday',
      cards: [{ cardId: 'amex-blue-cash-everyday', usage: [row(BCE_ONLINE_RETAIL_V3)] }],
      gates: [],
      valueOverrides: [],
    });
  });
  it('only stamps the version when nothing is stale, so open pages keep their revision', async () => {
    data[STATE_KEY] = { ...v3State(null, [row(BCE_ONLINE_RETAIL_V3)]) };
    const state = data[STATE_KEY] as AppState;
    delete state.wallet.gates;
    delete state.wallet.valueOverrides;
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.notice).toBeNull();
    expect(read.state).toMatchObject({ revision: 9, walletCatalogVersion: CATALOG_V3.version });
    expect((data[STATE_KEY] as AppState).walletCatalogVersion).toBe(CATALOG_V3.version);
  });
  it('ignores an unreadable catalog cache and uses the bundled terms', async () => {
    data[STATE_KEY] = v3State(CATALOG_V3.version, [row('bce-online-retail')]);
    data[CATALOG_KEY] = { release: { sequence: 'broken' }, lastCheckedAt: null };
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe(CATALOG_V3.version);
  });
  it.each([
    ['with cached release 1 (rules compared in v3 form)', true],
    ['without a cache (rules matched by ID)', false],
  ])(
    'moves a schema 3 wallet stamped with release 1 onto the bundled v3 %s, keeping every usage row the renewal did not reissue',
    async (_, withCache) => {
      const cards = CATALOG_V2.cards.map((card) => ({
        cardId: card.id,
        usage: card.rules.map((rule) => ({
          ...row(rule.id),
          spentCents: 500,
          activation: 'inactive' as const,
        })),
      }));
      data[STATE_KEY] = {
        ...emptyState(),
        revision: 9,
        walletCatalogVersion: CATALOG_V2.version,
        wallet: { defaultCardId: 'amex-blue-cash-everyday', cards },
      };
      if (withCache)
        data[CATALOG_KEY] = {
          release: {
            sequence: 1,
            version: CATALOG_V2.version,
            catalog: structuredClone(CATALOG_V2),
            catalog_hash: '1'.repeat(64),
            published_at: '2026-10-02T02:29:00Z',
          },
          lastCheckedAt: null,
        };
      const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
      expect(read.catalog.version).toBe(CATALOG_V3.version);
      // Rows on reissued rules are dropped with the notice, so the revision advances.
      expect(read.notice).toBe(MIGRATION_NOTICE);
      expect(read.state).toMatchObject({ revision: 10, walletCatalogVersion: CATALOG_V3.version });
      expect(read.state.wallet).toEqual({
        defaultCardId: 'amex-blue-cash-everyday',
        cards: withoutReissued(cards),
      });
    },
  );
});
