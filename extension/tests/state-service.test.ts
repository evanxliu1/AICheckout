import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStateService, localDate, RESULT_MAX_AGE_MS, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { emptyState } from '../src/state/contracts';
import type { CheckoutResponse } from '../src/state/contracts';

let data: Record<string, unknown>;
let now: number;
let storage: StateStorage;
const wallet = { defaultCardId: 'capital-one-quicksilver', cards: [{ cardId: 'capital-one-quicksilver', usage: [] }] };
beforeEach(() => {
  now = Date.parse('2026-09-25T15:00:00Z'); data = {};
  storage = {
    get: vi.fn(async () => structuredClone(data)),
    set: vi.fn(async values => { Object.assign(data, structuredClone(values)); }),
    remove: vi.fn(async (keys: string[]) => { keys.forEach(key => delete data[key]); }),
    clear: vi.fn(async () => { data = {}; }),
  };
});
function success(result: CheckoutResponse) {
  expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error); return result;
}
function purchase() {
  return { merchantId: 'best-buy-us', amountCents: 10_000, currency: 'USD', purchasedOn: localDate(now),
    eligiblePurchase: 'eligible', onlineRetail: 'unknown' };
}
async function compare() {
  const handle = createStateService(storage, () => now);
  success(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }));
  return success(await handle({ type: 'checkout:compare', expectedRevision: 1, purchase: purchase() }));
}
describe('durable worker state', () => {
  it('starts empty without manufacturing a wallet', async () => {
    expect(success(await createStateService(storage, () => now)({ type: 'checkout:get-state' })).state).toEqual(emptyState());
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
    expect(reopened.comparison).toMatchObject({ status: 'ready', preferredCardId: 'capital-one-quicksilver' });
  });
  it.each(['age', 'future', 'catalog', 'revision'])('hides a stale result because of %s', async reason => {
    await compare();
    const state = data[STATE_KEY] as ReturnType<typeof emptyState>;
    if (reason === 'age') now += RESULT_MAX_AGE_MS;
    if (reason === 'future') state.comparison!.computedAt = now + 1;
    if (reason === 'catalog') state.comparison!.catalogVersion = 'old';
    if (reason === 'revision') state.comparison!.inputRevision = 0;
    const reopened = success(await createStateService(storage, () => now)({ type: 'checkout:get-state' }));
    expect(reopened.comparison).toBeNull(); expect(reopened.notice).toContain('refresh');
  });
  it('invalidates estimates after changing the wallet', async () => {
    await compare();
    const response = success(await createStateService(storage, () => now)({
      type: 'checkout:save-wallet', expectedRevision: 2, wallet: { cards: [], defaultCardId: null },
    }));
    expect(response.comparison).toBeNull(); expect(response.state.comparison).toBeNull();
  });
  it('serializes overlapping writes and rejects a stale window', async () => {
    const handle = createStateService(storage, () => now);
    const [first, second] = await Promise.all([
      handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }),
      handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet: { cards: [], defaultCardId: null } }),
    ]);
    success(first); expect(second).toMatchObject({ ok: false, error: expect.stringContaining('another window') });
    expect(success(await handle({ type: 'checkout:get-state' })).state.wallet).toEqual(wallet);
  });
  it('does not show success when persistence fails', async () => {
    vi.mocked(storage.set).mockRejectedValue(new Error('quota'));
    const handle = createStateService(storage, () => now);
    expect(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet })).toMatchObject({ ok: false });
    expect(data).toEqual({});
    vi.mocked(storage.set).mockImplementation(async value => { Object.assign(data, value); });
    success(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }));
  });
  it('can delete corrupt state without requiring a successful read first', async () => {
    data[STATE_KEY] = { schemaVersion: 999 };
    const handle = createStateService(storage, () => now);
    expect(await handle({ type: 'checkout:get-state' })).toMatchObject({ ok: false, error: expect.stringContaining('Delete local data') });
    success(await handle({ type: 'checkout:clear' })); expect(data).toEqual({});
  });
  it('rejects injected fields, malformed money and arbitrary catalog IDs', async () => {
    const handle = createStateService(storage, () => now);
    expect(await handle({ type: 'checkout:clear', execute: 'anything' })).toMatchObject({ ok: false });
    expect(await handle({ type: 'checkout:compare', expectedRevision: 0, purchase: { ...purchase(), amountCents: -1 } })).toMatchObject({ ok: false });
    expect(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet: { cards: [{ cardId: 'arbitrary', usage: [] }], defaultCardId: null } })).toMatchObject({ ok: false });
    expect(data).toEqual({});
  });
  it('requires a current purchase date and does not persist unsupported comparisons', async () => {
    const handle = createStateService(storage, () => now);
    success(await handle({ type: 'checkout:save-wallet', expectedRevision: 0, wallet }));
    expect(await handle({ type: 'checkout:compare', expectedRevision: 1, purchase: { ...purchase(), purchasedOn: '2026-09-24' } })).toMatchObject({ ok: false });
    expect(success(await handle({ type: 'checkout:compare', expectedRevision: 1, purchase: { ...purchase(), eligiblePurchase: 'unknown' } })).comparison).toMatchObject({ reason: 'purchase-not-confirmed' });
    expect((data[STATE_KEY] as ReturnType<typeof emptyState>).comparison).toBeNull();
  });
});
