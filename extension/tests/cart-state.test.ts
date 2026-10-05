import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateService,
  CART_MAX_AGE_MS,
  CART_READ_TIMEOUT_MS,
  STATE_KEY,
  localDate,
} from '../src/state/service';
import { emptyState } from '../src/state/contracts';
import type { AppState, CheckoutResponse } from '../src/state/contracts';
import type { CartSnapshot } from '../src/checkout/contracts';
import { CATALOG_V3 } from '../src/domain';

let data: Record<string, unknown>;
let now: number;
const read = vi.fn();
const validate = vi.fn();
function success(result: CheckoutResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}
function handle() {
  return createStateService(
    {
      get: async () => structuredClone(data),
      set: async (value) => {
        Object.assign(data, structuredClone(value));
      },
      remove: async () => undefined,
      clear: async () => {
        data = {};
      },
    },
    () => now,
    { read, validate },
  );
}
function purchase() {
  return {
    merchantId: 'best-buy-us',
    currency: 'USD',
    amountCents: 10000,
    purchasedOn: localDate(now),
    eligiblePurchase: 'eligible',
    onlineRetail: 'unknown',
  };
}
beforeEach(() => {
  // 15:00 UTC the day after the bundled catalog was verified, inside its validity window.
  now = Date.parse(CATALOG_V3.verifiedAt) + 39 * 3_600_000;
  data = {
    [STATE_KEY]: {
      ...emptyState(),
      wallet: { cards: [{ cardId: 'capital-one-quicksilver', usage: [] }], defaultCardId: null },
    },
  };
  read.mockReset().mockResolvedValue({
    id: '6b89a362-0be9-4dca-990d-7e110e7f91ea',
    capturedAt: now,
    tabId: 7,
    documentId: 'doc-1',
    pageKey: 'a'.repeat(64),
    merchantId: 'best-buy-us',
    currency: 'USD',
    amountCents: 10000,
    kind: 'total',
    extractorVersion: 'bestbuy-summary-v1',
  } satisfies CartSnapshot);
  validate.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
async function capture() {
  return success(await handle()({ type: 'checkout:read-cart', expectedRevision: 0 }));
}
async function compare() {
  const captured = await capture();
  return success(
    await handle()({
      type: 'checkout:compare',
      expectedRevision: 1,
      purchase: purchase(),
      cartId: captured.state.cart!.id,
    }),
  );
}
describe('durable cart workflow', () => {
  it('binds a Newegg capture to its merchant and restores it without dropping the wallet', async () => {
    read.mockResolvedValue({
      ...(await read()),
      merchantId: 'newegg-us',
      kind: 'subtotal',
      extractorVersion: 'newegg-summary-v1',
    });
    const captured = await capture();
    expect(
      await handle()({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: purchase(),
        cartId: captured.state.cart!.id,
      }),
    ).toMatchObject({ ok: false });
    const compared = success(
      await handle()({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: { ...purchase(), merchantId: 'newegg-us' },
        cartId: captured.state.cart!.id,
      }),
    );
    expect(compared.comparison).toMatchObject({ status: 'ready' });
    const restored = success(await handle()({ type: 'checkout:get-state' }));
    expect(restored.state.purchase?.merchantId).toBe('newegg-us');
    expect(restored.state.cart?.kind).toBe('subtotal');
    expect(restored.state.wallet.cards).toHaveLength(1);
  });
  it('persists an unconfirmed capture for a reopened popup and validates before comparing', async () => {
    const captured = await capture();
    expect(captured.comparison).toBeNull();
    expect(captured.state.purchase).toBeNull();
    const reopened = success(await handle()({ type: 'checkout:get-state' }));
    expect(reopened.state.cart).toEqual(captured.state.cart);
    const result = success(
      await handle()({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: purchase(),
        cartId: captured.state.cart!.id,
      }),
    );
    expect(result.comparison).toMatchObject({ status: 'ready' });
    expect(validate).toHaveBeenCalledOnce();
  });
  it('allows confirmed manual correction while preserving page-change checks', async () => {
    const captured = await capture();
    const result = success(
      await handle()({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: { ...purchase(), amountCents: 9000 },
        cartId: captured.state.cart!.id,
      }),
    );
    expect(result.state.purchase!.amountCents).toBe(9000);
    expect(validate).toHaveBeenCalledOnce();
  });
  it('rejects stale or forged capture IDs', async () => {
    const captured = await capture();
    expect(
      await handle()({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: purchase(),
        cartId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toMatchObject({ ok: false });
    now += CART_MAX_AGE_MS;
    expect(
      await handle()({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: purchase(),
        cartId: captured.state.cart!.id,
      }),
    ).toMatchObject({ ok: false });
  });
  it('removes an expired unconfirmed capture instead of prefilling it on reopen', async () => {
    await capture();
    now += CART_MAX_AGE_MS;
    const reopened = success(await handle()({ type: 'checkout:get-state' }));
    expect(reopened.state.cart).toBeNull();
    expect(reopened.notice).toContain('expired');
  });
  it('rechecks catalog validity after waiting for the page', async () => {
    // One second before the bundled catalog expires.
    now = Date.parse(CATALOG_V3.expiresAt) - 1000;
    read.mockResolvedValue({ ...(await read()), capturedAt: now });
    const captured = await capture();
    const input = purchase();
    validate.mockImplementation(async () => {
      now += 2000;
    });
    const result = await handle()({
      type: 'checkout:compare',
      expectedRevision: 1,
      purchase: input,
      cartId: captured.state.cart!.id,
    });
    // In UTC the catalog expiry also crosses the local day; either gate must stop it.
    if (result.ok) {
      expect(result.comparison).toMatchObject({ status: 'unavailable', reason: 'catalog-expired' });
      expect(result.state.comparison).toBeNull();
    } else expect(result.error).toContain('date changed');
  });
  it('does not cross a local date boundary while waiting for the page', async () => {
    // One second before local midnight, two days after the bundled catalog was verified.
    const lateNight = new Date(Date.parse(CATALOG_V3.verifiedAt) + 2 * 86_400_000);
    lateNight.setHours(23, 59, 59, 0);
    now = lateNight.getTime();
    read.mockResolvedValue({ ...(await read()), capturedAt: now });
    const captured = await capture();
    const input = purchase();
    validate.mockImplementation(async () => {
      now += 2000;
    });
    expect(
      await handle()({
        type: 'checkout:compare',
        expectedRevision: 1,
        purchase: input,
        cartId: captured.state.cart!.id,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('date changed') });
  });
  it('invalidates a restored comparison when its cart has changed', async () => {
    await compare();
    validate.mockRejectedValue(new Error('Cart changed'));
    const result = success(await handle()({ type: 'checkout:get-state' }));
    expect(result.comparison).toBeNull();
    expect(result.state.cart).toBeNull();
    expect((data[STATE_KEY] as AppState).comparison).toBeNull();
  });
  it('invalidates only the captured tab on navigation/removal', async () => {
    await compare();
    const service = handle();
    await service.invalidateTab(8);
    expect((data[STATE_KEY] as AppState).comparison).not.toBeNull();
    await service.invalidateTab(7);
    expect((data[STATE_KEY] as AppState).comparison).toBeNull();
    expect((data[STATE_KEY] as AppState).cart).toBeNull();
  });
  it('can compare manually after a failed extraction without granting additional access', async () => {
    read.mockRejectedValue(new Error('No permission'));
    expect(await handle()({ type: 'checkout:read-cart', expectedRevision: 0 })).toMatchObject({ ok: false });
    const result = success(
      await handle()({ type: 'checkout:compare', expectedRevision: 0, purchase: purchase() }),
    );
    expect(result.comparison).toMatchObject({ status: 'ready' });
    expect(validate).not.toHaveBeenCalled();
  });
  it('bounds a hung read, keeps deletion usable, and ignores a late capture', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    read.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const service = handle();
    const pending = service({ type: 'checkout:read-cart', expectedRevision: 0 });
    await vi.advanceTimersByTimeAsync(CART_READ_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('too long') });
    success(await service({ type: 'checkout:clear' }));
    finish({});
    await Promise.resolve();
    expect(data).toEqual({});
  });
});
