// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBadgeService } from '../src/background/badge-service';
import { BADGE_TABS_KEY, ORDER_WINDOW_MS, SETTINGS_KEY } from '../src/badge/contracts';
import type { BadgeView } from '../src/badge/contracts';
import { createVaultService } from '../src/state/vault-service';
import type { StateStorage } from '../src/state/service';
import { emptyState } from '../src/state/contracts';
import type { AppState } from '../src/state/contracts';
import { STATE_KEY } from '../src/state/service';
import { savingsEntry, totalExtraCents } from '../src/state/savings';
import { CATALOG_V2, redateCatalog } from '../src/domain';

let now = Date.parse('2026-10-02T15:00:00Z');
const clock = () => now;
const catalog = redateCatalog(CATALOG_V2, '2026-10-01');
function memory(initial: Record<string, unknown> = {}) {
  let data = structuredClone(initial);
  const api: StateStorage = {
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (items) => {
      data = { ...data, ...structuredClone(items) };
    },
    remove: async (keys) => {
      for (const key of keys) delete data[key];
    },
    clear: async () => {
      data = {};
    },
  };
  return { api, read: () => structuredClone(data) };
}
const wallet = {
  defaultCardId: 'citi-double-cash',
  cards: [
    { cardId: 'citi-double-cash', usage: [] },
    {
      cardId: 'amex-blue-cash-everyday',
      // Nothing spent toward the $6,000 online-retail cap this year: a sure 3%.
      usage: [
        {
          ruleId: 'bce-online-retail',
          calendarYear: 2026,
          recordedOn: '2026-10-02',
          spentCents: 0,
          activation: 'unknown' as const,
        },
      ],
    },
  ],
};
function setup(state: Partial<AppState> | null = { wallet }) {
  const local = memory(
    state
      ? { [STATE_KEY]: { ...emptyState(), catalog: { release: release(), lastCheckedAt: null }, ...state } }
      : {},
  );
  const session = memory();
  const vault = createVaultService(local.api, session.api, clock);
  const open = vi.fn(async () => undefined);
  const notify = vi.fn();
  const badge = createBadgeService({
    local: local.api,
    session: session.api,
    vault: { snapshot: vault.snapshot, handle: vault },
    clock,
    open,
    notify,
  });
  return { badge, vault, local, session, open, notify };
}
/** The re-dated catalog as a published release, so it is valid on the test date. */
function release() {
  return {
    sequence: 1,
    version: catalog.version,
    catalog_hash: 'a'.repeat(64),
    published_at: '2026-10-01T00:00:00Z',
    catalog,
  };
}
const reading = (amountCents: number) => ({
  type: 'cart:reading',
  reading: {
    status: 'found',
    merchantId: 'best-buy-us',
    currency: 'USD',
    amountCents,
    kind: 'total',
    extractorVersion: 'bestbuy-summary-v1',
  },
});
const cart = 'https://www.bestbuy.com/cart';
const view = async (badge: ReturnType<typeof setup>['badge'], tab = 4) => {
  const reply = await badge.badge({ type: 'badge:get' }, tab);
  if (!reply.ok) throw new Error(reply.error);
  return reply.view;
};

describe('badge service', () => {
  it('answers the content script with only a show flag and the iframe with the ranked comparison', async () => {
    const t = setup();
    const reply = await t.badge.content(reading(10000), 4, cart);
    expect(reply).toEqual({ show: true });
    expect(JSON.stringify(reply)).not.toMatch(/citi|amex|Double Cash/i);
    const v = (await view(t.badge)) as Extract<BadgeView, { kind: 'ready' }>;
    expect(v.kind).toBe('ready');
    // Best Buy is online retail: Blue Cash Everyday's 3% beats Double Cash's 2% on $100.
    expect(v.result.preferredCardId).toBe('amex-blue-cash-everyday');
    expect(v.result.estimates[0]).toMatchObject({ cardId: 'amex-blue-cash-everyday', minRewardCents: 300 });
    expect(v).toMatchObject({
      cartAmountCents: 10000,
      amountCents: 10000,
      amountKind: 'total',
      paymentPath: 'card',
    });
    expect(t.notify).toHaveBeenCalledWith(4);
  });
  it('rejects a reading whose merchant does not match the page, and readings from other pages', async () => {
    const t = setup();
    expect(await t.badge.content(reading(10000), 4, 'https://www.amazon.com/cart')).toEqual({ show: false });
    expect(await t.badge.content(reading(10000), 4, 'https://www.bestbuy.com/site/tv')).toEqual({
      show: false,
    });
    expect(await t.badge.content({ type: 'cart:reading', reading: { status: 'found' } }, 4, cart)).toEqual({
      show: false,
    });
    expect(await view(t.badge)).toEqual({ kind: 'hidden' });
  });
  it('updates with the cart, keeps a typed amount for the same cart only, and applies the payment path', async () => {
    const t = setup();
    await t.badge.content(reading(10000), 4, cart);
    let reply = await t.badge.badge({ type: 'badge:set-amount', amountCents: 5000 }, 4);
    expect(reply).toMatchObject({ ok: true, view: { amountCents: 5000, amountEdited: true } });
    await t.badge.content(reading(10000), 4, cart);
    expect(await view(t.badge)).toMatchObject({ amountCents: 5000 });
    await t.badge.content(reading(20000), 4, cart);
    expect(await view(t.badge)).toMatchObject({ amountCents: 20000, amountEdited: false });
    reply = await t.badge.badge({ type: 'badge:set-payment', paymentPath: 'bnpl' }, 4);
    // Buy now, pay later excludes Amex online retail, so Double Cash leads.
    expect(reply).toMatchObject({
      ok: true,
      view: { paymentPath: 'bnpl', result: { preferredCardId: 'citi-double-cash' } },
    });
  });
  it('asks to pick cards, or to unlock, before showing any card', async () => {
    const empty = setup(null);
    expect(await empty.badge.content(reading(10000), 4, cart)).toEqual({ show: true });
    expect(await view(empty.badge)).toEqual({ kind: 'no-cards' });
    await empty.badge.badge({ type: 'badge:open', target: 'onboarding' }, 4);
    expect(empty.open).toHaveBeenCalledWith('onboarding');

    const locked = setup();
    await locked.vault({
      type: 'checkout:vault-create',
      passphrase: 'test-only quiet amber river',
      disclosureVersion: 1,
    });
    await locked.vault({ type: 'checkout:vault-lock' });
    await locked.badge.content(reading(10000), 4, cart);
    expect(await view(locked.badge)).toEqual({ kind: 'locked', order: false });
  });
  it('dismisses for the tab and turns a site off in settings', async () => {
    const t = setup();
    await t.badge.content(reading(10000), 4, cart);
    await t.badge.badge({ type: 'badge:dismiss' }, 4);
    expect(await t.badge.content(reading(10000), 4, cart)).toEqual({ show: false });
    expect(await t.badge.content(reading(10000), 5, cart)).toEqual({ show: true });
    await t.badge.badge({ type: 'badge:disable-site' }, 5);
    expect(t.local.read()[SETTINGS_KEY]).toEqual({ schemaVersion: 1, disabledMerchants: ['best-buy-us'] });
    expect(await t.badge.content(reading(10000), 6, cart)).toEqual({ show: false });
    await t.badge.removed(4);
    expect(Object.keys(t.session.read()[BADGE_TABS_KEY] as object)).not.toContain('4');
  });
  it('asks once after an order URL in the same tab, records the answer, and counts it in savings', async () => {
    const t = setup();
    await t.badge.content(reading(10000), 4, cart);
    await view(t.badge);
    await t.badge.navigated(4);
    const order = 'https://www.bestbuy.com/checkout/r/thank-you';
    expect(await t.badge.content({ type: 'order:page' }, 5, order)).toEqual({ show: false });
    expect(await t.badge.content({ type: 'order:page' }, 4, order)).toEqual({ show: true });
    const asked = await view(t.badge);
    expect(asked).toMatchObject({ kind: 'order', recommendedCardId: 'amex-blue-cash-everyday' });
    const answered = await t.badge.badge({ type: 'badge:answer-order', answer: 'yes', cardId: null }, 4);
    // Used Blue Cash Everyday ($3.00) instead of the default Double Cash ($2.00).
    expect(answered).toEqual({
      ok: true,
      view: {
        kind: 'recorded',
        extraCents: 100,
        usedCardName: 'Blue Cash Everyday',
        baselineCardName: 'Double Cash',
      },
    });
    const state = (await t.vault({ type: 'checkout:get-state' })) as { ok: true; state: AppState };
    expect(state.state.savings).toHaveLength(1);
    expect(state.state.savings[0]).toMatchObject({
      merchantId: 'best-buy-us',
      cartAmountCents: 10000,
      recommendedCardId: 'amex-blue-cash-everyday',
      usedCardId: 'amex-blue-cash-everyday',
      estimatedRewardCents: 300,
      baselineRewardCents: 200,
      extraCents: 100,
    });
    // Asked once: the same order page again shows nothing.
    expect(await t.badge.content({ type: 'order:page' }, 4, order)).toEqual({ show: false });
  });
  it('ignores order pages long after the recommendation, and requires one of your cards for "another card"', async () => {
    const t = setup();
    await t.badge.content(reading(10000), 4, cart);
    await view(t.badge);
    now += ORDER_WINDOW_MS;
    expect(
      await t.badge.content({ type: 'order:page' }, 4, 'https://www.bestbuy.com/checkout/r/thank-you'),
    ).toEqual({
      show: false,
    });
    now -= ORDER_WINDOW_MS;
    const u = setup();
    await u.badge.content(reading(10000), 4, cart);
    await view(u.badge);
    await u.badge.content({ type: 'order:page' }, 4, 'https://www.bestbuy.com/checkout/r/thank-you');
    expect(
      await u.badge.badge(
        { type: 'badge:answer-order', answer: 'other', cardId: 'chase-freedom-unlimited' },
        4,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await u.badge.badge({ type: 'badge:answer-order', answer: 'other', cardId: 'citi-double-cash' }, 4),
    ).toMatchObject({ ok: true, view: { kind: 'recorded', extraCents: 0 } });
  });
});

describe('savings math', () => {
  const purchase = {
    merchantId: 'best-buy-us',
    currency: 'USD' as const,
    amountCents: 10000,
    purchasedOn: '2026-10-02',
    eligiblePurchase: 'eligible' as const,
    onlineRetail: 'eligible' as const,
    paymentPath: 'card' as const,
  };
  it('compares the used card with the default card and keeps unknowns out of the total', () => {
    const base = {
      catalog,
      wallet,
      purchase,
      recommendedCardId: 'amex-blue-cash-everyday',
      now,
      id: crypto.randomUUID(),
    };
    const used = savingsEntry({ ...base, usedCardId: 'amex-blue-cash-everyday' });
    const worse = savingsEntry({ ...base, usedCardId: 'citi-double-cash', id: crypto.randomUUID() });
    const unsure = savingsEntry({ ...base, usedCardId: null, id: crypto.randomUUID() });
    const noDefault = savingsEntry({
      ...base,
      wallet: { ...wallet, defaultCardId: null },
      usedCardId: 'amex-blue-cash-everyday',
      id: crypto.randomUUID(),
    });
    expect([used.extraCents, worse.extraCents, unsure.extraCents, noDefault.extraCents]).toEqual([
      100,
      0,
      null,
      null,
    ]);
    expect(unsure).toMatchObject({ usedCardId: null, estimatedRewardCents: null, baselineRewardCents: 200 });
    expect(totalExtraCents([used, worse, unsure, noDefault])).toBe(100);
  });
  it('keeps the newest 500 entries and deletes the history only with the current revision', async () => {
    const t = setup();
    const entry = savingsEntry({
      catalog,
      wallet,
      purchase,
      recommendedCardId: 'citi-double-cash',
      usedCardId: 'citi-double-cash',
      now,
    });
    const recorded = (await t.vault({ type: 'checkout:record-savings', entry })) as {
      ok: true;
      state: AppState;
    };
    expect(recorded.state.savings).toEqual([entry]);
    expect(await t.vault({ type: 'checkout:delete-savings', expectedRevision: 0 })).toMatchObject({
      ok: false,
    });
    const deleted = (await t.vault({
      type: 'checkout:delete-savings',
      expectedRevision: recorded.state.revision,
    })) as {
      ok: true;
      state: AppState;
    };
    expect(deleted.state.savings).toEqual([]);
  });
});
