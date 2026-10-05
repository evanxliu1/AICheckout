// @vitest-environment node
// State schema 3 and catalog v3 in the extension (Stage 2 M6): the catalog cache under its own key,
// migration from schema 2 with and without the vault, the vault's size with a 1 MiB catalog cached,
// refresh rules for v3 releases, pruning stale wallet inputs, and the badge's trimmed catalog.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalogFetcher, MAX_RESPONSE_BYTES } from '@ai-checkout/catalog-client';
import { CATALOG_V2, CATALOG_V3, CATALOG_V3_LIMITS, redateCatalog } from '../src/domain';
import type { CatalogV3, PublishedRelease } from '../src/domain';
import { CATALOG_V3_FIXTURE } from '../../packages/rewards-core/test-cases';
import { largeCatalogV3 } from '../../packages/rewards-core/large-catalog-fixture';
import { appStateSchema, emptyState } from '../src/state/contracts';
import type { AppState, CatalogCache, CheckoutResponse, WalletState } from '../src/state/contracts';
import { CATALOG_KEY, createStateService, localDate, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { createVaultService } from '../src/state/vault-service';
import { VAULT_SESSION_KEY } from '../src/state/vault-contracts';
import {
  decryptVault,
  deriveVaultKey,
  encryptVault,
  MAX_VAULT_BYTES,
  newVaultIdentity,
} from '../src/state/vault-crypto';
import { reconcileWallet } from '../src/state/wallet';
import { badgeCatalog, createBadgeService } from '../src/background/badge-service';
import type { BadgeView } from '../src/badge/contracts';

const DAY = '2026-10-02';
let now = Date.parse(`${DAY}T15:00:00Z`);
const clock = () => now;
const phrase = 'test-only silver harbor compass';

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
function release(catalog: PublishedRelease['catalog'], sequence = 1): PublishedRelease {
  return {
    sequence,
    version: catalog.version,
    catalog,
    catalog_hash: String(sequence).padStart(64, '0'),
    published_at: `${catalog.verifiedAt.slice(0, 10)}T12:00:00Z`,
  };
}
const v3 = (version = 'test-v3.1') => ({ ...structuredClone(CATALOG_V3_FIXTURE), version });
// Verified on DAY, before the bundled catalog v3 takes effect, so a cached release of it stays in effect.
const v2Catalog = redateCatalog(CATALOG_V2, DAY);
const purchase = (merchantId = 'best-buy-us') => ({
  merchantId,
  currency: 'USD' as const,
  amountCents: 10_000,
  purchasedOn: localDate(now),
  eligiblePurchase: 'eligible' as const,
  onlineRetail: 'eligible' as const,
});
const usage = (ruleId: string) => ({
  ruleId,
  calendarYear: 2026,
  recordedOn: localDate(now),
  spentCents: 0,
  activation: 'active' as const,
});
/** A schema 2 state as catalog v2 releases stored it: the catalog cache inside the state. */
function schema2State(cached: PublishedRelease | null) {
  return {
    schemaVersion: 2,
    revision: 3,
    wallet: {
      defaultCardId: 'citi-double-cash',
      cards: [
        { cardId: 'citi-double-cash', usage: [] },
        { cardId: 'amex-blue-cash-everyday', usage: [usage('bce-online-retail')] },
      ],
    },
    purchase: null,
    catalog: { release: cached, lastCheckedAt: now - 1000 },
    cart: null,
    savings: [],
    pendingNotice: null,
    comparison: null,
  };
}

beforeEach(() => {
  now = Date.parse(`${DAY}T15:00:00Z`);
});

describe('state schema 2 → 3 migration', () => {
  it('without the vault: moves the catalog to its own plain key in one write', async () => {
    const local = memory({ [STATE_KEY]: schema2State(release(v2Catalog, 4)) });
    const service = createVaultService(local.api, memory().api, clock);
    const read = ok(await service({ type: 'checkout:get-state' }));
    expect(read.catalog.version).toBe(v2Catalog.version);
    expect(local.writes).toEqual([[CATALOG_KEY, STATE_KEY]]);
    const saved = local.read();
    expect(saved[STATE_KEY]).toMatchObject({ schemaVersion: 3, revision: 4 });
    expect(saved[STATE_KEY]).not.toHaveProperty('catalog');
    expect(saved[CATALOG_KEY]).toEqual({ release: release(v2Catalog, 4), lastCheckedAt: now - 1000 });
    // The wallet still compares under the same terms.
    const compared = ok(
      await service({ type: 'checkout:compare', expectedRevision: 4, purchase: purchase() }),
    );
    expect(compared.comparison).toMatchObject({
      status: 'ready',
      preferredCardId: 'amex-blue-cash-everyday',
    });
  });
  it('with the vault: re-encrypts schema 3 without the catalog and writes the catalog in plain beside it', async () => {
    const identity = newVaultIdentity(),
      key = await deriveVaultKey(phrase, identity);
    const before = await encryptVault(
      schema2State(release(v2Catalog, 4)) as unknown as AppState,
      identity,
      key,
    );
    const local = memory({ [STATE_KEY]: before }),
      session = memory();
    const service = createVaultService(local.api, session.api, clock);
    // Locked: nothing migrates, nothing is readable.
    expect(await service({ type: 'checkout:get-state' })).toMatchObject({ ok: false });
    expect(local.writes).toEqual([]);
    expect(await service({ type: 'checkout:vault-unlock', passphrase: phrase })).toEqual({
      ok: true,
      status: 'unlocked',
    });
    const read = ok(await service({ type: 'checkout:get-state' }));
    expect(read.state.schemaVersion).toBe(3);
    expect(local.writes).toEqual([[CATALOG_KEY, STATE_KEY]]);
    const saved = local.read();
    expect(saved[STATE_KEY]).toMatchObject({ kind: 'encrypted-vault' });
    expect(JSON.stringify(saved[STATE_KEY])).not.toContain('citi-double-cash');
    expect((saved[STATE_KEY] as { ciphertext: string }).ciphertext.length).toBeLessThan(
      before.ciphertext.length / 4,
    );
    const stored = await decryptVault(saved[STATE_KEY], session.read()[VAULT_SESSION_KEY] as never);
    expect(stored).toMatchObject({ schemaVersion: 3, revision: 4, walletCatalogVersion: v2Catalog.version });
    expect(stored).not.toHaveProperty('catalog');
    expect((saved[CATALOG_KEY] as CatalogCache).release?.sequence).toBe(4);
    // Locking keeps the public catalog readable and the wallet closed.
    await service({ type: 'checkout:vault-lock' });
    expect(await service.snapshot()).toEqual({ status: 'locked', state: null, catalog: null });
    expect(local.read()[CATALOG_KEY]).toEqual(saved[CATALOG_KEY]);
  });
});

describe('vault size with a large catalog', () => {
  const large = largeCatalogV3({ cards: 240, day: DAY });
  const largeWallet = (catalog: CatalogV3): WalletState => ({
    defaultCardId: catalog.cards[0].id,
    cards: catalog.cards
      .filter((c) => c.acceptance.kind === 'open-loop')
      .slice(0, 20)
      .map((c) => ({
        cardId: c.id,
        usage: [usage(c.rules.find((r) => r.id.endsWith('choice-a'))!.id)],
        choices: [{ choiceId: 'pick', optionIds: ['electronics'] }],
      })),
    gates: catalog.gates.map((g) => ({ gateId: g.id, optionId: 'yes' })),
    valueOverrides: catalog.programs
      .filter((p) => p.currency === 'points')
      .map((p) => ({ programId: p.id, valueHundredthsOfCent: 150 })),
  });
  it('keeps a 1 MiB catalog out of the envelope', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(large)).byteLength;
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(bytes).toBeLessThanOrEqual(CATALOG_V3_LIMITS.bytes);
    const local = memory(),
      fetchCatalog = vi.fn(async () => ({ release: release(large) }));
    const service = createVaultService(local.api, memory().api, clock, undefined, fetchCatalog);
    ok(await service({ type: 'checkout:vault-create', passphrase: phrase, disclosureVersion: 1 }));
    const refreshed = ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    expect(refreshed.catalog.version).toBe(large.version);
    const saved = ok(
      await service({
        type: 'checkout:save-wallet',
        expectedRevision: refreshed.state.revision,
        wallet: largeWallet(large),
      }),
    );
    const compared = ok(
      await service({
        type: 'checkout:compare',
        expectedRevision: saved.state.revision,
        purchase: purchase(),
      }),
    );
    expect(compared.comparison).toMatchObject({ status: 'ready' });
    if (compared.comparison?.status !== 'ready') throw new Error('not ready');
    expect(compared.comparison.estimates).toHaveLength(20);
    expect(compared.comparison.estimates[0].programId).toBeDefined();
    const stored = local.read();
    expect(JSON.stringify(stored[STATE_KEY]).length).toBeLessThan(64 * 1024);
    expect(JSON.stringify(stored[CATALOG_KEY]).length).toBeGreaterThan(1_000_000);
  });
  it('fits the largest valid state in the vault', async () => {
    const long = (prefix: string, n: number) => `${prefix}-${n}-`.padEnd(100, 'x');
    const state = appStateSchema.parse({
      ...emptyState(),
      revision: 123_456,
      walletCatalogVersion: long('version', 0),
      pendingNotice: 'n'.repeat(300),
      purchase: { ...purchase(), merchantId: long('merchant', 0), paymentPath: 'card' },
      cart: {
        id: crypto.randomUUID(),
        merchantId: 'newegg-us',
        currency: 'USD',
        amountCents: 9_999_999,
        kind: 'subtotal',
        extractorVersion: 'newegg-summary-v1',
        tabId: 2_147_483_647,
        documentId: 'd'.repeat(100),
        pageKey: 'a'.repeat(64),
        capturedAt: now,
      },
      comparison: {
        inputRevision: 123_456,
        catalogVersion: long('version', 0),
        computedAt: now,
        cartId: crypto.randomUUID(),
      },
      wallet: {
        defaultCardId: long('card', 0),
        cards: Array.from({ length: 20 }, (_, c) => ({
          cardId: long('card', c),
          usage: Array.from({ length: 30 }, (_, r) => ({
            ruleId: long(`rule-${c}`, r),
            calendarYear: 2026,
            recordedOn: DAY,
            spentCents: 10_000_000,
            activation: 'inactive',
          })),
          choices: Array.from({ length: 5 }, (_, h) => ({
            choiceId: long(`choice-${c}`, h),
            optionIds: Array.from({ length: 5 }, (_, o) => long(`option-${c}-${h}`, o)),
          })),
        })),
        gates: Array.from({ length: 100 }, (_, g) => ({ gateId: long('gate', g), optionId: long('opt', g) })),
        valueOverrides: Array.from({ length: 100 }, (_, p) => ({
          programId: long('program', p),
          valueHundredthsOfCent: 10_000,
        })),
      },
      savings: Array.from({ length: 500 }, (_, i) => ({
        id: crypto.randomUUID(),
        date: DAY,
        recordedAt: now,
        merchantId: long('merchant', i),
        cartAmountCents: 10_000_000,
        recommendedCardId: long('card', i),
        usedCardId: long('used', i),
        estimatedRewardCents: 10_000_000,
        baselineRewardCents: 10_000_000,
        extraCents: -10_000_000,
      })),
    });
    const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_VAULT_BYTES);
    const identity = newVaultIdentity(),
      key = await deriveVaultKey(phrase, identity);
    expect(await decryptVault(await encryptVault(state, identity, key), key)).toEqual(state);
  });
});

describe('catalog v3 refresh rules', () => {
  let local: ReturnType<typeof memory>;
  const fetchCatalog = vi.fn();
  const service = () => createStateService(local.api, clock, undefined, fetchCatalog);
  const refresh = async () =>
    service()({
      type: 'checkout:refresh-catalog',
      expectedRevision: (local.read()[STATE_KEY] as AppState | undefined)?.revision ?? 0,
    });
  beforeEach(() => {
    local = memory();
    fetchCatalog.mockReset();
  });
  it('accepts a v3 release, after a v2 one, and compares with the v3 engine', async () => {
    fetchCatalog.mockResolvedValue({ release: release(v2Catalog, 1) });
    ok(await refresh());
    fetchCatalog.mockResolvedValue({ release: release(v3('test-v3.2'), 2) });
    const updated = ok(await refresh());
    expect(updated.catalog).toMatchObject({ schemaVersion: 3, version: 'test-v3.2' });
    expect(updated.state.walletCatalogVersion).toBe('test-v3.2');
    const saved = ok(
      await service()({
        type: 'checkout:save-wallet',
        expectedRevision: updated.state.revision,
        wallet: {
          defaultCardId: 'test-prime-visa',
          cards: [
            { cardId: 'test-prime-visa', usage: [] },
            { cardId: 'test-amazon-store', usage: [] },
          ],
          gates: [{ gateId: 'amazon-prime', optionId: 'member' }],
        },
      }),
    );
    const compared = ok(
      await service()({
        type: 'checkout:compare',
        expectedRevision: saved.state.revision,
        purchase: purchase('best-buy-us'),
      }),
    );
    expect(compared.comparison).toMatchObject({
      status: 'ready',
      catalogVersion: 'test-v3.2',
      preferredCardId: 'test-prime-visa',
      notAccepted: [{ cardId: 'test-amazon-store' }],
    });
    // An older (v2) release after the v3 one is a rollback.
    fetchCatalog.mockResolvedValue({ release: release(v2Catalog, 1) });
    expect(await refresh()).toMatchObject({ ok: false, error: expect.stringContaining('older release') });
  });
  it.each(['rollback', 'same sequence changed', 'reused version', 'expired', 'future', 'invalid'])(
    'keeps the saved v3 terms on %s',
    async (failure) => {
      fetchCatalog.mockResolvedValue({ release: release(v3('test-v3.2'), 2) });
      ok(await refresh());
      const next = release(v3('test-v3.3'), 3);
      if (failure === 'expired') {
        // Loading at that time may switch to the valid bundled catalog; that write is not the refresh's.
        now = Date.parse(next.catalog.expiresAt);
        ok(await service()({ type: 'checkout:get-state' }));
      }
      const before = local.read();
      let response: unknown = { release: next };
      if (failure === 'rollback') response = { release: release(v3('test-v3.1'), 1) };
      if (failure === 'same sequence changed') next.sequence = 2;
      if (failure === 'reused version') next.version = next.catalog.version = 'test-v3.2';
      if (failure === 'future') next.published_at = `${DAY}T16:00:00Z`;
      if (failure === 'invalid')
        (next.catalog as CatalogV3).programs[1].valuation = { basis: 'cash' } as never;
      fetchCatalog.mockResolvedValue(response);
      expect(await refresh()).toMatchObject({ ok: false });
      expect(local.read()).toEqual(before);
    },
  );
  it('fetches a 1 MiB v3 release within the response cap', async () => {
    const large = largeCatalogV3({ cards: 240, day: DAY });
    const body = JSON.stringify({ release: release(large) });
    expect(body.length).toBeGreaterThan(1_000_000);
    expect(body.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const respond = (text: string) => new Response(text, { headers: { 'content-type': 'application/json' } });
    const fetcher = vi.fn(async () => respond(body));
    const fetchLarge = createCatalogFetcher('https://catalog.example/v1/catalog', fetcher);
    expect((await fetchLarge(new AbortController().signal)).release?.version).toBe(large.version);
    fetcher.mockImplementation(async () => respond(body.padEnd(MAX_RESPONSE_BYTES + 1, ' ')));
    await expect(fetchLarge(new AbortController().signal)).rejects.toThrow('too large');
  });
});

describe('pruning on catalog update', () => {
  it('drops choices, gates, point values and usage rows the new catalog no longer has', async () => {
    const local = memory(),
      fetchCatalog = vi.fn();
    const service = createStateService(local.api, clock, undefined, fetchCatalog);
    fetchCatalog.mockResolvedValue({ release: release(v3('test-v3.1'), 1) });
    const first = ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    const wallet: WalletState = {
      defaultCardId: 'test-cash-plus',
      cards: [
        {
          cardId: 'test-cash-plus',
          usage: [usage('cash-plus-department-stores'), usage('cash-plus-electronics')],
          choices: [{ choiceId: 'five-percent', optionIds: ['electronics', 'fast-food'] }],
        },
        { cardId: 'test-store-mastercard', usage: [] },
        { cardId: 'test-auto-top', usage: [] },
        { cardId: 'test-points-card', usage: [] },
      ],
      gates: [
        { gateId: 'amazon-prime', optionId: 'member' },
        { gateId: 'test-store-tier', optionId: 'gold' },
      ],
      valueOverrides: [
        { programId: 'test-membership-points', valueHundredthsOfCent: 150 },
        { programId: 'test-airline-miles', valueHundredthsOfCent: 120 },
      ],
    };
    const saved = ok(
      await service({ type: 'checkout:save-wallet', expectedRevision: first.state.revision, wallet }),
    );
    // Release 2: no store tier question, no fast-food option, no airline miles program, and a changed
    // electronics rule (its reported limits no longer apply).
    const next = v3('test-v3.2');
    next.gates = next.gates.filter((g) => g.id !== 'test-store-tier');
    next.programs = next.programs.filter((p) => p.id !== 'test-airline-miles');
    for (const card of next.cards) {
      if (card.programId === 'test-airline-miles') card.programId = 'test-membership-points';
      for (const rule of card.rules)
        rule.requires = rule.requires.filter((r) => r.gateId !== 'test-store-tier');
      if (card.id !== 'test-cash-plus') continue;
      card.choices[0].options = card.choices[0].options.filter((o) => o.id !== 'fast-food');
      card.choices[0].picks = 1;
      card.rules = card.rules.filter((r) => r.id !== 'cash-plus-fast-food');
      card.rules.find((r) => r.id === 'cash-plus-electronics')!.rateBps = 400;
    }
    fetchCatalog.mockResolvedValue({ release: release(next, 2) });
    const updated = ok(
      await service({ type: 'checkout:refresh-catalog', expectedRevision: saved.state.revision }),
    );
    expect(updated.notice).toContain('card options');
    expect(updated.state.wallet).toEqual({
      defaultCardId: 'test-cash-plus',
      cards: [
        { cardId: 'test-cash-plus', usage: [usage('cash-plus-department-stores')], choices: [] },
        { cardId: 'test-store-mastercard', usage: [] },
        { cardId: 'test-auto-top', usage: [] },
        { cardId: 'test-points-card', usage: [] },
      ],
      gates: [{ gateId: 'amazon-prime', optionId: 'member' }],
      valueOverrides: [{ programId: 'test-membership-points', valueHundredthsOfCent: 150 }],
    });
    // The engine accepts what is left.
    const compared = ok(
      await service({
        type: 'checkout:compare',
        expectedRevision: updated.state.revision,
        purchase: purchase(),
      }),
    );
    expect(compared.comparison).toMatchObject({ status: 'ready', catalogVersion: 'test-v3.2' });
  });
  it('refuses to save wallet inputs the catalog in effect does not have', async () => {
    const local = memory(),
      fetchCatalog = vi.fn(async () => ({ release: release(v3(), 1) }));
    const service = createStateService(local.api, clock, undefined, fetchCatalog);
    const first = ok(await service({ type: 'checkout:refresh-catalog', expectedRevision: 0 }));
    const base = { defaultCardId: 'test-cash-plus', cards: [{ cardId: 'test-cash-plus', usage: [] }] };
    for (const wallet of [
      { ...base, gates: [{ gateId: 'amazon-prime', optionId: 'maybe' }] },
      { ...base, valueOverrides: [{ programId: 'cash-back', valueHundredthsOfCent: 120 }] },
      {
        ...base,
        cards: [
          {
            cardId: 'test-cash-plus',
            usage: [],
            choices: [{ choiceId: 'five-percent', optionIds: ['gas'] }],
          },
        ],
      },
      {
        ...base,
        cards: [
          {
            cardId: 'test-cash-plus',
            usage: [],
            choices: [
              { choiceId: 'five-percent', optionIds: ['electronics', 'fast-food', 'department-stores'] },
            ],
          },
        ],
      },
    ])
      expect(
        await service({ type: 'checkout:save-wallet', expectedRevision: first.state.revision, wallet }),
      ).toMatchObject({ ok: false });
  });
});

describe('release 1 (v2) to the bundled catalog v3', () => {
  const realCards = (): WalletState => ({
    defaultCardId: null,
    cards: CATALOG_V2.cards.map((card) => ({ cardId: card.id, usage: card.rules.map((r) => usage(r.id)) })),
  });
  /** Release-1 rule IDs the 2026-10-05 renewal kept (same terms); it reissued the others with new IDs
   * because their terms changed (build report, "Rule-ID continuity"). */
  const KEPT_RELEASE_1_RULES = [
    'active-cash-base',
    'quicksilver-base',
    'quicksilver-travel-portal',
    'savor-base',
    'savor-entertainment-portal',
    'savor-travel-portal',
  ];
  it('keeps every usage row whose rule the renewal kept: same rule ID and terms in v3', () => {
    const result = reconcileWallet(realCards(), CATALOG_V3, CATALOG_V2);
    expect(result).toMatchObject({ usageDropped: true, optionsDropped: false });
    const expected = realCards();
    for (const card of expected.cards)
      card.usage = card.usage.filter((u) => KEPT_RELEASE_1_RULES.includes(u.ruleId));
    expect(result.wallet).toEqual(expected);
  });
  it('still drops a row whose rule changed under the same ID, or gained v3 structure', () => {
    const changed = structuredClone(CATALOG_V3);
    const savor = changed.cards.find((c) => c.id === 'capital-one-savor')!;
    savor.rules.find((r) => r.id === 'savor-travel-portal')!.rateBps += 100;
    savor.rules.find((r) => r.id === 'savor-entertainment-portal')!.requiredPaymentPaths = ['card'];
    const result = reconcileWallet(realCards(), changed, CATALOG_V2);
    expect(result.usageDropped).toBe(true);
    const kept = result.wallet.cards.find((c) => c.cardId === 'capital-one-savor')!.usage;
    expect(kept.map((u) => u.ruleId)).toEqual(['savor-base']);
  });
});

describe('badge payload', () => {
  const large = largeCatalogV3({ cards: 240, day: DAY });
  const owned = (count: number) => ({
    defaultCardId: null,
    cards: large.cards
      .filter((c) => c.acceptance.kind === 'open-loop')
      .slice(0, count)
      .map((c) => ({ cardId: c.id, usage: [] })),
  });
  it('sends only the owned cards, the merchant and what they refer to', () => {
    const trimmed = badgeCatalog(large, owned(3), 'best-buy-us') as CatalogV3;
    expect(trimmed.cards.map((c) => c.id)).toEqual(owned(3).cards.map((c) => c.cardId));
    expect(trimmed.merchants.map((m) => m.id)).toEqual(['best-buy-us']);
    expect(trimmed.programs.map((p) => p.id).sort()).toEqual(
      [...new Set(trimmed.cards.map((c) => c.programId))].sort(),
    );
    const cited = new Set(trimmed.cards.flatMap((c) => c.rules.flatMap((r) => r.sourceIds)));
    expect(trimmed.sources.every((s) => cited.has(s.id) || s.id.startsWith('large-source'))).toBe(true);
    expect(trimmed.sources.length).toBeLessThan(20);
    for (const rule of trimmed.cards.flatMap((c) => c.rules)) {
      for (const id of [...rule.brandIds, ...rule.excludedBrandIds])
        expect(trimmed.brands.some((b) => b.id === id)).toBe(true);
      for (const { gateId } of rule.requires) expect(trimmed.gates.some((g) => g.id === gateId)).toBe(true);
    }
  });
  it('stays bounded by the wallet, not the catalog', async () => {
    const catalogBytes = JSON.stringify(large).length;
    const one = JSON.stringify(badgeCatalog(large, owned(1), 'best-buy-us')).length;
    const twenty = JSON.stringify(badgeCatalog(large, owned(20), 'best-buy-us')).length;
    expect(one).toBeLessThan(16 * 1024);
    expect(twenty).toBeLessThan(160 * 1024);
    expect(twenty).toBeLessThan(catalogBytes / 6);
    // End to end: the iframe's ready view for a 20-card wallet with this catalog cached.
    const local = memory({
      [STATE_KEY]: { ...emptyState(), wallet: owned(20), walletCatalogVersion: large.version },
      [CATALOG_KEY]: { release: release(large), lastCheckedAt: null },
    });
    const session = memory();
    const vault = createVaultService(local.api, session.api, clock);
    const badge = createBadgeService({
      local: local.api,
      session: session.api,
      vault: { snapshot: vault.snapshot, handle: vault },
      clock,
      open: async () => undefined,
      notify: () => undefined,
    });
    const reply = await badge.content(
      {
        type: 'cart:reading',
        reading: {
          status: 'found',
          merchantId: 'best-buy-us',
          currency: 'USD',
          amountCents: 10_000,
          kind: 'total',
          extractorVersion: 'bestbuy-summary-v1',
        },
        framed: false,
      },
      4,
      'https://www.bestbuy.com/cart',
    );
    const got = await badge.badge({ type: 'badge:get', nonce: reply.nonce }, 4);
    if (!got.ok) throw new Error(got.error);
    const view = got.view as Extract<BadgeView, { kind: 'ready' }>;
    expect(view.kind).toBe('ready');
    expect(view.catalog.cards).toHaveLength(20);
    expect(JSON.stringify(view).length).toBeLessThan(256 * 1024);
  });
});
