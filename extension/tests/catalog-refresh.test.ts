import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_TIMEOUT_MS } from '@ai-checkout/catalog-client';
import { PILOT_CATALOG } from '../src/domain';
import type { PublishedRelease } from '../src/domain';
import { createStateService, localDate, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { emptyState } from '../src/state/contracts';
import type { AppState, CheckoutResponse } from '../src/state/contracts';

let data: Record<string, unknown>, now: number, storage: StateStorage;
const fetchCatalog = vi.fn();
function release(sequence = 1): PublishedRelease {
  return {
    sequence,
    catalog: { ...structuredClone(PILOT_CATALOG), version: `published.${sequence}` },
    version: `published.${sequence}`,
    published_at: '2026-09-25T12:00:00Z',
    catalog_hash: String(sequence).padStart(64, '0'),
  };
}
function ok(result: CheckoutResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}
function service() {
  return createStateService(storage, () => now, undefined, fetchCatalog);
}
function state() {
  return data[STATE_KEY] as AppState;
}
function purchase() {
  return {
    merchantId: 'best-buy-us',
    amountCents: 10000,
    currency: 'USD',
    purchasedOn: localDate(now),
    eligiblePurchase: 'eligible',
    onlineRetail: 'eligible',
  };
}
async function refresh() {
  return service()({ type: 'checkout:refresh-catalog', expectedRevision: state().revision });
}
beforeEach(() => {
  now = Date.parse('2026-09-25T15:00:00Z');
  data = {
    [STATE_KEY]: {
      ...emptyState(),
      wallet: {
        cards: [
          {
            cardId: 'amex-blue-cash-everyday',
            usage: [
              {
                ruleId: 'bce-online-retail',
                calendarYear: 2026,
                recordedOn: localDate(now),
                spentCents: 0,
                activation: 'unknown',
              },
            ],
          },
        ],
        defaultCardId: null,
      },
    },
  };
  storage = {
    get: async () => structuredClone(data),
    set: vi.fn(async (values) => {
      Object.assign(data, structuredClone(values));
    }),
    remove: async () => undefined,
    clear: async () => {
      data = {};
    },
  };
  fetchCatalog.mockReset().mockResolvedValue({ release: release() });
});
afterEach(() => vi.useRealTimers());

describe('published catalog lifecycle', () => {
  it('migrates stored pilot state without dropping its wallet', async () => {
    delete (state() as Partial<AppState>).catalog;
    const read = ok(await service()({ type: 'checkout:get-state' }));
    expect(read.state.catalog.release).toBeNull();
    expect(read.state.wallet.cards).toHaveLength(1);
  });
  it('atomically applies changed rates and invalidates saved comparisons', async () => {
    ok(await service()({ type: 'checkout:compare', expectedRevision: 0, purchase: purchase() }));
    const next = release();
    next.catalog.cards[1].rules[1].rateBps = 400;
    fetchCatalog.mockResolvedValue({ release: next });
    const updated = ok(await refresh());
    expect(updated.state.comparison).toBeNull();
    expect(updated.state.wallet.cards[0].usage).toEqual([]);
    expect(updated.notice).toContain('reward limits');
    const compared = ok(
      await service()({
        type: 'checkout:compare',
        expectedRevision: updated.state.revision,
        purchase: purchase(),
      }),
    );
    expect(compared.comparison).toMatchObject({
      catalogVersion: 'published.1',
      estimates: [{ minRewardCents: 100, maxRewardCents: 400 }],
    });
  });
  it('keeps unchanged limits and recovers the published catalog in a new offline worker', async () => {
    // The bundled catalog is v2, so moving to this v1 release drops the changed rule's usage first.
    const usage = structuredClone(state().wallet.cards[0].usage);
    ok(await refresh());
    expect(state().wallet.cards[0].usage).toEqual([]);
    state().wallet.cards[0].usage = usage;
    fetchCatalog.mockResolvedValue({ release: release(2) });
    ok(await refresh());
    fetchCatalog.mockRejectedValue(new Error('offline'));
    expect(state().wallet.cards[0].usage).toHaveLength(1);
    const result = ok(
      await service()({ type: 'checkout:compare', expectedRevision: state().revision, purchase: purchase() }),
    );
    expect(result.comparison).toMatchObject({ estimates: [{ minRewardCents: 300, maxRewardCents: 300 }] });
    expect(ok(await service()({ type: 'checkout:get-state' })).comparison).toEqual(result.comparison);
  });
  it('does not fall back to the bundle when a published catalog expires', async () => {
    const next = release();
    next.catalog.expiresAt = '2026-09-25T15:01:00Z';
    fetchCatalog.mockResolvedValue({ release: next });
    ok(await refresh());
    now += 61000;
    const result = ok(
      await service()({ type: 'checkout:compare', expectedRevision: state().revision, purchase: purchase() }),
    );
    expect(result.comparison).toEqual({ status: 'unavailable', reason: 'catalog-expired' });
    expect(state().catalog.release?.version).toBe('published.1');
  });
  it('preserves removed cards and their usage, then explicitly blocks the incomplete wallet', async () => {
    const next = release();
    next.catalog.cards = [next.catalog.cards[0]] as typeof next.catalog.cards;
    fetchCatalog.mockResolvedValue({ release: next });
    const updated = ok(await refresh());
    expect(updated.state.wallet.cards[0].usage).toHaveLength(1);
    expect(updated.notice).toContain('unavailable');
    expect(
      ok(
        await service()({
          type: 'checkout:compare',
          expectedRevision: state().revision,
          purchase: purchase(),
        }),
      ).comparison,
    ).toEqual({ status: 'unavailable', reason: 'unknown-owned-card' });
  });
  it.each([
    'rollback',
    'same sequence changed',
    'reused version',
    'missing release',
    'invalid schema',
    'expired',
    'future',
  ])('keeps the last snapshot on %s', async (failure) => {
    fetchCatalog.mockResolvedValue({ release: release(2) });
    ok(await refresh());
    const before = structuredClone(data);
    const next = release(3);
    let response: unknown = { release: next };
    if (failure === 'rollback') response = { release: release(1) };
    if (failure === 'same sequence changed') {
      next.sequence = 2;
    }
    if (failure === 'reused version') {
      next.version = next.catalog.version = 'published.2';
    }
    if (failure === 'missing release') response = { release: null };
    if (failure === 'invalid schema') next.catalog.cards[0].rules[0].rateBps = -1;
    if (failure === 'expired') {
      now = Date.parse(next.catalog.expiresAt);
    }
    if (failure === 'future') next.published_at = '2026-09-26T00:00:00Z';
    fetchCatalog.mockResolvedValue(response);
    expect(await refresh()).toMatchObject({ ok: false });
    expect(data).toEqual(before);
  });
  it('rechecks expiry after a slow response', async () => {
    const next = release();
    next.catalog.expiresAt = '2026-09-25T15:00:01Z';
    fetchCatalog.mockImplementation(async () => {
      now += 2000;
      return { release: next };
    });
    expect(await refresh()).toMatchObject({ ok: false });
    expect(state().catalog.release).toBeNull();
  });
  it('keeps all state unchanged if the atomic storage write fails', async () => {
    const before = structuredClone(data);
    vi.mocked(storage.set).mockRejectedValue(new Error('quota'));
    expect(await refresh()).toMatchObject({ ok: false });
    expect(data).toEqual(before);
  });
  it('does not advance the revision on an unchanged release', async () => {
    const initial = ok(await refresh());
    const repeated = ok(await refresh());
    expect(repeated.state.revision).toBe(initial.state.revision);
    expect(repeated.notice).toContain('up to date');
  });
  it('times out, aborts, keeps deletion usable, and ignores a late response', async () => {
    vi.useFakeTimers();
    let complete!: (value: unknown) => void;
    let signal!: AbortSignal;
    fetchCatalog.mockImplementation((s) => {
      signal = s;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const handle = service(),
      pending = handle({ type: 'checkout:refresh-catalog', expectedRevision: 0 });
    await vi.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('too long') });
    expect(signal.aborted).toBe(true);
    ok(await handle({ type: 'checkout:clear' }));
    complete({ release: release() });
    await Promise.resolve();
    expect(data).toEqual({});
  });
  it('rejects a stale popup after another update', async () => {
    ok(await refresh());
    expect(
      await service()({ type: 'checkout:save-wallet', expectedRevision: 0, wallet: state().wallet }),
    ).toMatchObject({ ok: false });
  });
});
