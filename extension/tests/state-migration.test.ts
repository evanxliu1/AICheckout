import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PILOT_CATALOG } from '../src/domain';
import { createStateService, localDate, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { MIGRATION_NOTICE } from '../src/state/migrate';
import type { CheckoutResponse } from '../src/state/contracts';

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

describe('pilot state migration (schema 1 → 2)', () => {
  it('keeps card IDs and existing rules, drops usage for removed rules with a notice, and persists once', async () => {
    data[STATE_KEY] = pilotState([row('bce-online-retail'), row('bce-retired-rule')]);
    const handle = createStateService(storage, () => now);
    const first = ok(await handle({ type: 'checkout:get-state' }));
    expect(first.notice).toBe(MIGRATION_NOTICE);
    expect(first.state).toMatchObject({ schemaVersion: 2, revision: 5, comparison: null });
    expect(first.state.wallet.cards.map((c) => c.cardId)).toEqual([
      'capital-one-quicksilver',
      'amex-blue-cash-everyday',
    ]);
    expect(first.state.wallet.cards[1].usage.map((u) => u.ruleId)).toEqual(['bce-online-retail']);
    expect((data[STATE_KEY] as { schemaVersion: number }).schemaVersion).toBe(2);
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
  it('checks usage against a cached v1 release when one is saved', async () => {
    const release = {
      sequence: 3,
      version: 'published.3',
      catalog: { ...structuredClone(PILOT_CATALOG), version: 'published.3' },
      catalog_hash: '3'.repeat(64),
      published_at: '2026-09-25T12:00:00Z',
    };
    data[STATE_KEY] = pilotState([row('bce-online-retail'), row('bce-base')], release);
    const read = ok(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(read.state.catalog.release?.version).toBe('published.3');
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
