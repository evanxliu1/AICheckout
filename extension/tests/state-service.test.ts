import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStateService, localDate, RESULT_MAX_AGE_MS, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { emptyState } from '../src/state/contracts';
import type { CheckoutResponse } from '../src/state/contracts';
import { CATALOG_V3 } from '../src/domain';
import { MERCHANT_RELEASE_FIXTURE } from '../../packages/rewards-core/test-cases';

let data: Record<string, unknown>;
let now: number;
let storage: StateStorage;
const wallet = {
  defaultCardId: 'capital-one-quicksilver',
  cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
};
beforeEach(() => {
  // 15:00 UTC the day after the bundled catalog was verified, inside its validity window.
  now = Date.parse(CATALOG_V3.verifiedAt) + 39 * 3_600_000;
  data = {};
  storage = {
    get: vi.fn(async () => structuredClone(data)),
    set: vi.fn(async (values) => {
      Object.assign(data, structuredClone(values));
    }),
    remove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => delete data[key]);
    }),
    clear: vi.fn(async () => {
      data = {};
    }),
  };
});
function success(result: CheckoutResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}
function purchase() {
  return {
    merchantId: 'best-buy-us',
    amountCents: 10_000,
    currency: 'USD',
    purchasedOn: localDate(now),
    eligiblePurchase: 'eligible',
    onlineRetail: 'unknown',
  };
}
async function compare() {
  const handle = createStateService(storage, () => now);
  success(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }));
  return success(await handle({ type: 'checkout:compare', expectedRevision: 1, purchase: purchase() }));
}
describe('comparisons at a merchant release store (Phase 14.2)', () => {
  const bcp = {
    defaultCardId: 'amex-blue-cash-preferred',
    cards: [
      {
        cardId: 'amex-blue-cash-preferred',
        usage: [
          {
            ruleId: 'bcp-supermarkets-v2',
            calendarYear: 2026,
            recordedOn: localDate(Date.parse(CATALOG_V3.verifiedAt) + 39 * 3_600_000),
            spentCents: 0,
            activation: 'unknown',
          },
        ],
      },
    ],
  };
  it('passes the record’s profile to the engine for compare and rates; without the record the id is unsupported', async () => {
    const handle = createStateService(storage, () => now, undefined, undefined, MERCHANT_RELEASE_FIXTURE);
    success(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet: bcp }));
    const kroger = { ...purchase(), merchantId: 'kroger-us', onlineRetail: 'eligible' };
    const compared = success(
      await handle({ type: 'checkout:compare', expectedRevision: 1, purchase: kroger }),
    );
    expect(compared.comparison).toMatchObject({
      status: 'ready',
      preferredCardId: 'amex-blue-cash-preferred',
    });
    expect(
      (compared.comparison as { estimates: { minRewardCents: number }[] }).estimates[0].minRewardCents,
    ).toBe(600);
    // The saved comparison is recomputed with the same profile on the next read.
    const again = success(await handle({ type: 'checkout:get-state' }));
    expect(again.comparison).toMatchObject({ status: 'ready', preferredCardId: 'amex-blue-cash-preferred' });
    const rates = success(
      await handle({
        type: 'checkout:rates',
        merchantId: 'kroger-us',
        onlineRetail: 'eligible',
        paymentPath: 'card',
      }),
    );
    expect(
      (rates.comparison as { estimates: { minRewardCents: number }[] }).estimates[0].minRewardCents,
    ).toBe(600);
    const bundled = createStateService(storage, () => now);
    expect(
      success(await bundled({ type: 'checkout:compare', expectedRevision: 2, purchase: kroger })).comparison,
    ).toMatchObject({ status: 'unavailable', reason: 'unsupported-merchant' });
  });
  it('asks for no typed amount when reading is unavailable (A5)', async () => {
    const handle = createStateService(storage, () => now);
    const result = await handle({ type: 'checkout:read-cart', expectedRevision: 0 });
    expect(result).toEqual({ ok: false, error: 'Cart reading is unavailable in this build.' });
  });
});
describe('durable worker state', () => {
  it('starts empty without manufacturing a wallet', async () => {
    expect(
      success(await createStateService(storage, () => now)({ type: 'checkout:get-state' })).state,
    ).toEqual(emptyState());
    expect(data).toEqual({});
  });
  it('retires old provider keys and shopping logs on the first read', async () => {
    data = { openaiKey: 'old-secret', recommendationLogs: [{ prompt: 'private' }], unrelated: true };
    await createStateService(storage, () => now)({ type: 'checkout:get-state' });
    expect(data).toEqual({ unrelated: true });
  });
  it('recovers the same estimate after a new worker instance starts, with no network dependency', async () => {
    const first = await compare();
    const reopened = success(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(reopened).toEqual(first);
    expect(reopened.comparison).toMatchObject({
      status: 'ready',
      preferredCardId: 'capital-one-quicksilver',
    });
  });
  it.each(['age', 'future', 'catalog', 'revision'])('hides a stale result because of %s', async (reason) => {
    await compare();
    const state = data[STATE_KEY] as ReturnType<typeof emptyState>;
    if (reason === 'age') now += RESULT_MAX_AGE_MS;
    if (reason === 'future') state.comparison!.computedAt = now + 1;
    if (reason === 'catalog') state.comparison!.catalogVersion = 'old';
    if (reason === 'revision') state.comparison!.inputRevision = 0;
    const reopened = success(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(reopened.comparison).toBeNull();
    expect(reopened.notice).toContain('refresh');
  });
  it('invalidates estimates after changing the wallet', async () => {
    await compare();
    const response = success(
      await createStateService(
        storage,
        () => now,
      )({
        type: 'checkout:save-wallet',
        expectedRevision: 2,
        wallet: { cards: [], defaultCardId: null },
      }),
    );
    expect(response.comparison).toBeNull();
    expect(response.state.comparison).toBeNull();
  });
  it('serializes overlapping writes and rejects a stale window', async () => {
    const handle = createStateService(storage, () => now);
    const [first, second] = await Promise.all([
      handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }),
      handle({
        type: 'checkout:save-wallet',
        expectedRevision: 0,
        wallet: { cards: [], defaultCardId: null },
      }),
    ]);
    success(first);
    expect(second).toMatchObject({ ok: false, error: expect.stringContaining('another window') });
    expect(success(await handle({ type: 'checkout:get-state' })).state.wallet).toEqual(wallet);
  });
  it('does not show success when persistence fails', async () => {
    vi.mocked(storage.set).mockRejectedValue(new Error('quota'));
    const handle = createStateService(storage, () => now);
    expect(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet })).toMatchObject({
      ok: false,
    });
    expect(data).toEqual({});
    vi.mocked(storage.set).mockImplementation(async (value) => {
      Object.assign(data, value);
    });
    success(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }));
  });
  it('can delete corrupt state without requiring a successful read first', async () => {
    data[STATE_KEY] = { schemaVersion: 999 };
    const handle = createStateService(storage, () => now);
    expect(await handle({ type: 'checkout:get-state' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Delete local data'),
    });
    success(await handle({ type: 'checkout:clear' }));
    expect(data).toEqual({});
  });
  it('rejects injected fields, malformed money and arbitrary catalog IDs', async () => {
    const handle = createStateService(storage, () => now);
    expect(await handle({ type: 'checkout:clear', execute: 'anything' })).toMatchObject({ ok: false });
    expect(
      await handle({
        type: 'checkout:compare',
        expectedRevision: 0,
        purchase: { ...purchase(), amountCents: -1 },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await handle({
        type: 'checkout:save-wallet',
        expectedRevision: 0,
        wallet: { cards: [{ cardId: 'arbitrary', usage: [] }], defaultCardId: null },
      }),
    ).toMatchObject({ ok: false });
    expect(data).toEqual({});
  });
  it('requires a current purchase date and does not persist unsupported comparisons', async () => {
    const handle = createStateService(storage, () => now);
    success(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }));
    expect(
      await handle({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: { ...purchase(), purchasedOn: '2026-10-02' },
      }),
    ).toMatchObject({ ok: false });
    expect(
      success(
        await handle({
          type: 'checkout:compare',
          expectedRevision: 1,
          purchase: { ...purchase(), eligiblePurchase: 'unknown' },
        }),
      ).comparison,
    ).toMatchObject({ reason: 'purchase-not-confirmed' });
    expect((data[STATE_KEY] as ReturnType<typeof emptyState>).comparison).toBeNull();
  });
});
