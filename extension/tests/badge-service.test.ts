// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBadgeService } from '../src/background/badge-service';
import { BADGE_TABS_KEY, SETTINGS_KEY } from '../src/badge/contracts';
import type { BadgeView } from '../src/badge/contracts';
import { createVaultService } from '../src/state/vault-service';
import type { StateStorage } from '../src/state/service';
import { emptyState } from '../src/state/contracts';
import type { AppState } from '../src/state/contracts';
import { CATALOG_KEY, STATE_KEY } from '../src/state/service';
import { CATALOG_V2, CATALOG_V3, redateCatalog } from '../src/domain';
import type { Catalog, MerchantRelease } from '../src/domain';
import { MERCHANT_RELEASE_FIXTURE } from '../../packages/rewards-core/test-cases';

const now = Date.parse('2026-10-02T15:00:00Z');
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
function setupWith(
  state: Partial<AppState> | null = { wallet },
  cat: Catalog = catalog,
  merchants?: MerchantRelease,
  settings?: unknown,
) {
  const local = memory({
    ...(state
      ? {
          [STATE_KEY]: { ...emptyState(), ...state },
          [CATALOG_KEY]: { release: release(cat), lastCheckedAt: null },
        }
      : {}),
    ...(settings !== undefined ? { [SETTINGS_KEY]: settings } : {}),
  });
  const session = memory();
  const vault = createVaultService(local.api, session.api, clock);
  const open = vi.fn(async () => undefined);
  const notify = vi.fn();
  const badge = createBadgeService({
    local: local.api,
    session: session.api,
    vault: { snapshot: vault.snapshot },
    clock,
    open,
    notify,
    release: merchants,
  });
  return { badge, vault, local, session, open, notify };
}
/** The re-dated catalog as a published release, so it is valid on the test date. */
function release(cat: Catalog = catalog) {
  return {
    sequence: 1,
    version: cat.version,
    catalog_hash: 'a'.repeat(64),
    published_at: '2026-10-01T00:00:00Z',
    catalog: cat,
  };
}
/** A generic reading (the only reader since Phase 15.1): the content script names the generic store and the
 * worker resolves the tab's store from the sender URL. */
const reading = (amountCents: number, kind = 'total') => ({
  type: 'cart:reading',
  reading: {
    status: 'found',
    merchantId: 'generic-us-online',
    currency: 'USD',
    amountCents,
    kind,
    extractorVersion: 'generic-reader-v1',
  },
  framed: false,
});
/** A former adapter store's cart URL: `best-buy-us` in the bundled release. */
const cart = 'https://www.bestbuy.com/cart';
type Setup = ReturnType<typeof setupWith>;
const setup = (state: Partial<AppState> | null = { wallet }) => setupWith(state);
/** The latest frame nonce the worker gave each tab's content script. */
const nonces = new WeakMap<Setup, Map<number, string>>();
async function send(t: Setup, message: object, tab: number, url: string) {
  const reply = await t.badge.content(message, tab, url);
  if (reply.nonce) {
    if (!nonces.has(t)) nonces.set(t, new Map());
    nonces.get(t)!.set(tab, reply.nonce);
  }
  return reply;
}
/** A badge:* request from the frame the content script created in that tab. */
function act(t: Setup, request: object, tab: number) {
  return t.badge.badge({ ...request, nonce: nonces.get(t)?.get(tab) ?? 'x'.repeat(32) }, tab);
}
const view = async (t: Setup, tab = 4) => {
  const reply = await act(t, { type: 'badge:get' }, tab);
  if (!reply.ok) throw new Error(reply.error);
  return reply.view;
};

const GENERIC = 'https://shop.example.com/cart';
const genericReading = (amountCents: number) => reading(amountCents, 'estimated-total');
const withheld = {
  type: 'cart:reading',
  reading: { status: 'unavailable', reason: 'withheld' },
  framed: false,
};

describe('badge service at any store (Phase 13c)', () => {
  // The generic store exists only in catalog v3 (the engine supplies its profile).
  const v3 = redateCatalog(CATALOG_V3, '2026-10-01');
  const walletV3 = {
    ...wallet,
    cards: wallet.cards.map((c) => ({
      ...c,
      usage: c.usage.map((u) => ({ ...u, ruleId: 'bce-online-retail-v2' })),
    })),
  };
  const setup = () => setupWith({ wallet: walletV3 }, v3);
  it('accepts a generic reading at an unmatched store and ranks at the generic profile', async () => {
    const t = setup();
    expect(await send(t, genericReading(10000), 4, GENERIC)).toMatchObject({ show: true });
    const v = (await view(t)) as Extract<BadgeView, { kind: 'ready' }>;
    expect(v.kind).toBe('ready');
    expect(v.merchantId).toBe('generic-us-online');
    // The generic profile is online retail: Blue Cash Everyday's 3% beats Double Cash's 2%.
    expect(v.result.preferredCardId).toBe('amex-blue-cash-everyday');
    // The generic profile is the engine's, not the catalog's: the slice carries no merchant.
    expect((v.catalog as Extract<Catalog, { schemaVersion: 3 }>).merchants).toEqual([]);
    expect((t.session.read()[BADGE_TABS_KEY] as Record<string, { host: string }>)['4'].host).toBe(
      'shop.example.com',
    );
  });
  it('refuses a reading that names a store or carries a retired adapter version (Phase 15.1)', async () => {
    const t = setup();
    const named = {
      ...genericReading(10000),
      reading: { ...genericReading(10000).reading, merchantId: 'best-buy-us' },
    };
    expect(await send(t, named, 4, GENERIC)).toEqual({ show: false });
    expect(await send(t, named, 4, cart)).toEqual({ show: false });
    expect(await send(t, named, 6, 'https://www.bestbuy.com/site/basket')).toEqual({ show: false });
    for (const extractorVersion of ['bestbuy-summary-v1', 'amazon-summary-v1', 'newegg-summary-v1'])
      expect(
        await send(
          t,
          { ...genericReading(10000), reading: { ...genericReading(10000).reading, extractorVersion } },
          4,
          cart,
        ),
        extractorVersion,
      ).toEqual({ show: false });
    expect(t.session.read()[BADGE_TABS_KEY]).toBeUndefined();
    // A former adapter store's cart URL is any other page now: the generic reading is accepted and the
    // worker names the store from the release (Phase 14.2).
    expect(await send(t, genericReading(10000), 5, cart)).toMatchObject({ show: true });
    expect(((await view(t, 5)) as Extract<BadgeView, { kind: 'ready' }>).merchantId).toBe('best-buy-us');
    expect(await send(t, genericReading(10000), 6, 'https://www.bestbuy.com/site/basket')).toMatchObject({
      show: true,
    });
    expect(((await view(t, 6)) as Extract<BadgeView, { kind: 'ready' }>).merchantId).toBe('best-buy-us');
  });
  it('refuses the retired order:page message and records nothing for the tab (Phase 15.1)', async () => {
    const t = setup();
    await send(t, genericReading(10000), 4, cart);
    await t.badge.navigated(4);
    const order = 'https://www.bestbuy.com/checkout/r/thank-you';
    expect(await send(t, { type: 'order:page', framed: false }, 4, order)).toEqual({ show: false });
    expect(await send(t, { type: 'order:page', framed: false }, 5, order)).toEqual({ show: false });
    expect(Object.keys(t.session.read()[BADGE_TABS_KEY] as object)).toEqual(['4']);
    expect(t.notify).toHaveBeenCalledTimes(1);
    // The badge iframe has no order answer to send either.
    expect(await act(t, { type: 'badge:answer-order', answer: 'yes', cardId: null }, 4)).toMatchObject({
      ok: false,
    });
  });
  it('shows the rates view when the amount was not read: ranked at $100, with rates, never a prompt', async () => {
    const t = setup();
    expect(await send(t, withheld, 4, GENERIC)).toMatchObject({ show: true });
    const v = (await view(t)) as Extract<BadgeView, { kind: 'rates' }>;
    expect(v.kind).toBe('rates');
    expect(v.result.preferredCardId).toBe('amex-blue-cash-everyday');
    const best = v.result.estimates.find((e) => e.cardId === 'amex-blue-cash-everyday')!;
    // At $100 the cents are the rate in basis points: a sure 3%.
    expect([best.minRewardCents, best.maxRewardCents]).toEqual([300, 300]);
    expect(JSON.stringify(v)).not.toContain('enter the amount');
    // Loading, empty and non-USD carts hide the badge.
    for (const reason of ['page-loading', 'empty-cart', 'unsupported-currency', 'unsupported-page'])
      expect(await send(t, { ...withheld, reading: { status: 'unavailable', reason } }, 5, GENERIC)).toEqual({
        show: false,
      });
    // A typed amount in the panel turns the rates view into an estimate.
    await act(t, { type: 'badge:set-amount', amountCents: 5000 }, 4);
    expect((await view(t)).kind).toBe('ready');
  });
  it('"Not on this site" records the host, not the shared generic id', async () => {
    const t = setup();
    await send(t, genericReading(10000), 4, GENERIC);
    await act(t, { type: 'badge:disable-site' }, 4);
    expect(t.local.read()[SETTINGS_KEY]).toEqual({
      schemaVersion: 1,
      showOnOtherStores: true,
      disabledSites: ['shop.example.com'],
    });
    expect(await send(t, genericReading(10000), 5, GENERIC)).toEqual({ show: false });
    expect(await send(t, genericReading(10000), 6, 'https://other.example.com/cart')).toMatchObject({
      show: true,
    });
    expect((await view(t, 4)).kind).toBe('hidden');
  });
  it('the badge toggle hides every store, a former adapter store included', async () => {
    const t = setup();
    await t.badge.saveSettings({ schemaVersion: 1, showOnOtherStores: false, disabledSites: [] });
    expect(await send(t, genericReading(10000), 4, GENERIC)).toEqual({ show: false });
    expect(await send(t, reading(10000), 5, cart)).toEqual({ show: false });
    // Settings stored before Phase 13c (no toggle, no sites) still parse, with the defaults.
    await t.local.api.set({ [SETTINGS_KEY]: { schemaVersion: 1, disabledMerchants: [] } });
    expect(await t.badge.settings()).toEqual({
      schemaVersion: 1,
      showOnOtherStores: true,
      disabledSites: [],
    });
    expect(await send(t, genericReading(10000), 6, GENERIC)).toMatchObject({ show: true });
  });
});

describe('settings written before Phase 15.1 (disabledMerchants)', () => {
  const v3 = redateCatalog(CATALOG_V3, '2026-10-01');
  const stored = {
    schemaVersion: 1,
    disabledMerchants: ['best-buy-us', 'newegg-us'],
    showOnOtherStores: true,
    disabledSites: ['shop.example.com', 'www.bestbuy.com'],
  };
  it('maps the retired per-store switch to its hosts once, and rewrites the stored value', async () => {
    const t = setupWith({ wallet }, v3, undefined, stored);
    const mapped = {
      schemaVersion: 1,
      showOnOtherStores: true,
      disabledSites: ['shop.example.com', 'www.bestbuy.com', 'bestbuy.com', 'secure.newegg.com'],
    };
    expect(await t.badge.settings()).toEqual(mapped);
    expect(t.local.read()[SETTINGS_KEY]).toEqual(mapped);
    // Mapped settings are not rewritten again on the next read.
    await t.local.api.set({ [SETTINGS_KEY]: { ...mapped, disabledSites: ['secure.newegg.com'] } });
    expect(await t.badge.settings()).toEqual({ ...mapped, disabledSites: ['secure.newegg.com'] });
    expect(t.local.read()[SETTINGS_KEY]).toEqual({ ...mapped, disabledSites: ['secure.newegg.com'] });
  });
  it('keeps the badge off at the mapped hosts and on elsewhere; an unknown id maps to nothing', async () => {
    const t = setupWith({ wallet }, v3, undefined, stored);
    expect(await send(t, reading(10000), 4, cart)).toEqual({ show: false });
    expect(await send(t, reading(10000), 5, 'https://bestbuy.com/cart')).toEqual({ show: false });
    expect(await send(t, reading(10000), 6, 'https://secure.newegg.com/shop/cart')).toEqual({ show: false });
    expect(await send(t, reading(10000), 7, 'https://www.newegg.com/p/N82E1')).toMatchObject({ show: true });
    expect(await send(t, reading(10000), 8, 'https://www.amazon.com/cart')).toMatchObject({ show: true });
    const odd = setupWith({ wallet }, v3, undefined, {
      schemaVersion: 1,
      disabledMerchants: ['amazon-us', 'not-a-store'],
    });
    expect(await odd.badge.settings()).toEqual({
      schemaVersion: 1,
      showOnOtherStores: true,
      disabledSites: ['www.amazon.com'],
    });
  });
});

describe('badge service on the merchant release (Phase 14.2)', () => {
  const v3 = redateCatalog(CATALOG_V3, '2026-10-01');
  // Blue Cash Preferred: a sure 6% at supermarkets (nothing spent toward its cap), 1% elsewhere.
  const walletBcp = {
    defaultCardId: 'citi-double-cash',
    cards: [
      { cardId: 'citi-double-cash', usage: [] },
      {
        cardId: 'amex-blue-cash-preferred',
        usage: [
          {
            ruleId: 'bcp-supermarkets-v2',
            calendarYear: 2026,
            recordedOn: '2026-10-02',
            spentCents: 0,
            activation: 'unknown' as const,
          },
        ],
      },
    ],
  };
  const at = (merchantId: string, amountCents = 10000) => ({
    ...genericReading(amountCents),
    reading: { ...genericReading(amountCents).reading, merchantId },
  });
  const ready = async (t: Setup, tab: number) =>
    (await view(t, tab)) as Extract<BadgeView, { kind: 'ready' }>;
  it('names a store known only to the worker’s release, keeps its id and host on the tab, and ranks with its profile', async () => {
    // The content script carries no release: it sends `generic-us-online`; the worker resolves kroger-us.
    const t = setupWith({ wallet: walletBcp }, v3, MERCHANT_RELEASE_FIXTURE);
    expect(await send(t, genericReading(10000), 4, 'https://www.kroger.com/cart')).toMatchObject({
      show: true,
    });
    const v = await ready(t, 4);
    expect(v.merchantId).toBe('kroger-us');
    // A corroborated supermarket: Blue Cash Preferred's 6% applies (never at the generic profile).
    expect(v.result.preferredCardId).toBe('amex-blue-cash-preferred');
    const best = v.result.estimates.find((e) => e.cardId === 'amex-blue-cash-preferred')!;
    expect([best.minRewardCents, best.maxRewardCents]).toEqual([600, 600]);
    expect(t.session.read()[BADGE_TABS_KEY]).toMatchObject({
      '4': { merchantId: 'kroger-us', host: 'www.kroger.com' },
    });
    // The same reading at an unmatched store is the generic profile: Double Cash wins.
    expect(await send(t, genericReading(10000), 5, GENERIC)).toMatchObject({ show: true });
    expect((await ready(t, 5)).result.preferredCardId).toBe('citi-double-cash');
    // A reading that names a store itself is refused, at that store's host or any other.
    expect(await send(t, at('kroger-us'), 6, GENERIC)).toEqual({ show: false });
    expect(await send(t, at('kroger-us'), 6, 'https://www.kroger.com/cart')).toEqual({ show: false });
  });
  it('shows no badge on a payment processor’s page and records nothing for the tab', async () => {
    const t = setupWith({ wallet: walletBcp }, v3, MERCHANT_RELEASE_FIXTURE);
    for (const message of [genericReading(10000), at('paypal'), withheld])
      expect(await send(t, message, 4, 'https://www.paypal.com/checkoutnow?token=x')).toEqual({
        show: false,
      });
    expect(t.session.read()[BADGE_TABS_KEY]).toBeUndefined();
    // The bundled seed: Amazon Pay's hosts are processors while amazon.com is the store.
    const seed = setupWith({ wallet: walletBcp }, v3);
    expect(await send(seed, genericReading(10000), 4, 'https://pay.amazon.com/checkout/x')).toEqual({
      show: false,
    });
    expect(await send(seed, genericReading(10000), 5, 'https://www.amazon.com/some/cart')).toMatchObject({
      show: true,
    });
    expect((await ready(seed, 5)).merchantId).toBe('amazon-us');
  });
  it('a disabled record is the generic store, switched off by its host', async () => {
    const t = setupWith({ wallet: walletBcp }, v3, MERCHANT_RELEASE_FIXTURE);
    const closed = 'https://closed-store.example/cart';
    expect(await send(t, at('closed-store-us'), 4, closed)).toEqual({ show: false });
    expect(await send(t, genericReading(10000), 4, closed)).toMatchObject({ show: true });
    expect((await ready(t, 4)).merchantId).toBe('generic-us-online');
    await act(t, { type: 'badge:disable-site' }, 4);
    expect(t.local.read()[SETTINGS_KEY]).toMatchObject({ disabledSites: ['closed-store.example'] });
  });
  it('"Not on this site" at a matched store records its host; the badge toggle covers it too', async () => {
    const t = setupWith({ wallet: walletBcp }, v3, MERCHANT_RELEASE_FIXTURE);
    await send(t, genericReading(10000), 4, 'https://www.kroger.com/cart');
    await act(t, { type: 'badge:disable-site' }, 4);
    expect(t.local.read()[SETTINGS_KEY]).toEqual({
      schemaVersion: 1,
      showOnOtherStores: true,
      disabledSites: ['www.kroger.com'],
    });
    expect(await send(t, genericReading(10000), 5, 'https://www.kroger.com/checkout')).toEqual({
      show: false,
    });
    expect(await send(t, genericReading(10000), 6, 'https://www.target.com/cart')).toMatchObject({
      show: true,
    });
    expect((await ready(t, 6)).merchantId).toBe('target-us');
    await t.badge.saveSettings({
      schemaVersion: 1,
      showOnOtherStores: false,
      disabledSites: ['www.kroger.com'],
    });
    expect(await send(t, genericReading(10000), 7, 'https://www.target.com/cart')).toEqual({ show: false });
  });
  it('the bundled Best Buy record is electronics on the mcc basis (2026-10-11); a record is always used as authored', async () => {
    const cashPlus = {
      defaultCardId: 'us-bank-cash-plus',
      cards: [
        {
          cardId: 'us-bank-cash-plus',
          usage: [],
          choices: [
            { choiceId: 'five-percent-categories', optionIds: ['electronic-stores', 'department-stores'] },
          ],
        },
      ],
    };
    const seed = setupWith({ wallet: cashPlus }, v3);
    await send(seed, genericReading(10000), 4, 'https://www.bestbuy.com/site/basket');
    expect((await ready(seed, 4)).result.estimates[0].maxRewardCents).toBeGreaterThanOrEqual(500);
    // A record with other evidence is used as authored too (a supermarket record at bestbuy.com pays no electronics).
    const evidenced: MerchantRelease = {
      ...MERCHANT_RELEASE_FIXTURE,
      merchants: MERCHANT_RELEASE_FIXTURE.merchants.map((m) =>
        m.id === 'kroger-us' ? { ...m, id: 'best-buy-us', name: 'Best Buy', hosts: ['bestbuy.com'] } : m,
      ),
    };
    const t = setupWith({ wallet: cashPlus }, v3, evidenced);
    await send(t, genericReading(10000), 4, 'https://www.bestbuy.com/site/basket');
    expect((await ready(t, 4)).result.estimates[0].maxRewardCents).toBeLessThan(500);
  });
});

describe('badge service', () => {
  it('answers the content script with only a show flag and the iframe with the ranked comparison', async () => {
    const t = setup();
    const reply = await send(t, reading(10000), 4, cart);
    expect(Object.keys(reply).sort()).toEqual(['nonce', 'show']);
    expect(reply.show).toBe(true);
    expect(JSON.stringify(reply)).not.toMatch(/citi|amex|Double Cash/i);
    const v = (await view(t)) as Extract<BadgeView, { kind: 'ready' }>;
    expect(v.kind).toBe('ready');
    // Best Buy is online retail: Blue Cash Everyday's 3% beats Double Cash's 2% on $100.
    expect(v.result.preferredCardId).toBe('amex-blue-cash-everyday');
    expect(v.result.estimates[0]).toMatchObject({ cardId: 'amex-blue-cash-everyday', minRewardCents: 300 });
    expect(v).toMatchObject({
      merchantId: 'best-buy-us',
      cartAmountCents: 10000,
      amountCents: 10000,
      amountKind: 'total',
      paymentPath: 'card',
    });
    expect(t.notify).toHaveBeenCalledWith(4);
  });
  it('rejects malformed readings, and names the store of the page a reading came from', async () => {
    const t = setup();
    expect(
      await send(t, { type: 'cart:reading', reading: { status: 'found' }, framed: false }, 4, cart),
    ).toEqual({
      show: false,
    });
    expect(await act(t, { type: 'badge:get' }, 4)).toMatchObject({ ok: false });
    // The same generic reading at another store's page is that store's (the release decides, not the reading).
    await send(t, reading(10000), 5, 'https://www.amazon.com/cart');
    expect((await view(t, 5)).kind).toBe('ready');
    expect(((await view(t, 5)) as Extract<BadgeView, { kind: 'ready' }>).merchantId).toBe('amazon-us');
  });
  it('updates with the cart, keeps a typed amount for the same cart only, and applies the payment path', async () => {
    const t = setup();
    await send(t, reading(10000), 4, cart);
    let reply = await act(t, { type: 'badge:set-amount', amountCents: 5000 }, 4);
    expect(reply).toMatchObject({ ok: true, view: { amountCents: 5000, amountEdited: true } });
    await send(t, reading(10000), 4, cart);
    expect(await view(t)).toMatchObject({ amountCents: 5000 });
    await send(t, reading(20000), 4, cart);
    expect(await view(t)).toMatchObject({ amountCents: 20000, amountEdited: false });
    reply = await act(t, { type: 'badge:set-payment', paymentPath: 'bnpl' }, 4);
    // Buy now, pay later excludes Amex online retail, so Double Cash leads.
    expect(reply).toMatchObject({
      ok: true,
      view: { paymentPath: 'bnpl', result: { preferredCardId: 'citi-double-cash' } },
    });
  });
  it('asks to pick cards, or to unlock, before showing any card', async () => {
    const empty = setup(null);
    expect(await send(empty, reading(10000), 4, cart)).toMatchObject({ show: true });
    expect(await view(empty)).toEqual({ kind: 'no-cards' });
    await act(empty, { type: 'badge:open', target: 'onboarding' }, 4);
    expect(empty.open).toHaveBeenCalledWith('onboarding');

    const locked = setup();
    await locked.vault({
      type: 'checkout:vault-create',
      passphrase: 'test-only quiet amber river',
      disclosureVersion: 1,
    });
    await locked.vault({ type: 'checkout:vault-lock' });
    await send(locked, reading(10000), 4, cart);
    expect(await view(locked)).toEqual({ kind: 'locked' });
  });
  it('dismisses for the tab and turns a site off in settings by its host', async () => {
    const t = setup();
    await send(t, reading(10000), 4, cart);
    await act(t, { type: 'badge:dismiss' }, 4);
    expect(await send(t, reading(10000), 4, cart)).toEqual({ show: false });
    expect(await send(t, reading(10000), 5, cart)).toMatchObject({ show: true });
    await act(t, { type: 'badge:disable-site' }, 5);
    expect(t.local.read()[SETTINGS_KEY]).toEqual({
      schemaVersion: 1,
      showOnOtherStores: true,
      disabledSites: ['www.bestbuy.com'],
    });
    expect(await send(t, reading(10000), 6, cart)).toEqual({ show: false });
    // The host, not the store: another host of the same store still shows the badge.
    expect(await send(t, reading(10000), 7, 'https://bestbuy.com/cart')).toMatchObject({ show: true });
    await t.badge.removed(4);
    expect(Object.keys(t.session.read()[BADGE_TABS_KEY] as object)).not.toContain('4');
  });
  it('a navigation clears the reading and typed amount but keeps the dismissal and payment choice', async () => {
    const t = setup();
    await send(t, reading(10000), 4, cart);
    await act(t, { type: 'badge:set-amount', amountCents: 5000 }, 4);
    await act(t, { type: 'badge:set-payment', paymentPath: 'bnpl' }, 4);
    await t.badge.navigated(4);
    expect(t.session.read()[BADGE_TABS_KEY]).toMatchObject({
      '4': { reading: null, amountOverrideCents: null, paymentPath: 'bnpl', dismissed: false },
    });
    expect((await view(t)).kind).toBe('rates');
  });
});

describe('badge review fixes', () => {
  it('answers only the frame its content script created; a new frame replaces the old nonce', async () => {
    const t = setup();
    const first = await send(t, reading(10000), 4, cart);
    expect(first.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // A copy of the badge page made by the store page has no (or a guessed) nonce.
    expect(await t.badge.badge({ type: 'badge:get', nonce: 'a'.repeat(32) }, 4)).toMatchObject({ ok: false });
    expect(await t.badge.badge({ type: 'badge:get' }, 4)).toMatchObject({ ok: false });
    // Same frame on later readings keeps its nonce.
    expect(await send(t, { ...reading(10000), framed: true }, 4, cart)).toEqual({ show: true });
    const second = await send(t, reading(10000), 4, cart);
    expect(second.nonce).not.toBe(first.nonce);
    expect(await t.badge.badge({ type: 'badge:get', nonce: first.nonce }, 4)).toMatchObject({ ok: false });
    expect(await t.badge.badge({ type: 'badge:get', nonce: second.nonce }, 4)).toMatchObject({ ok: true });
  });
  it('keeps the badge tab state when the vault locks', async () => {
    const t = setup();
    await t.vault({
      type: 'checkout:vault-create',
      passphrase: 'test-only quiet amber river',
      disclosureVersion: 1,
    });
    await send(t, reading(10000), 4, cart);
    await t.vault({ type: 'checkout:vault-lock' });
    expect(t.session.read()[BADGE_TABS_KEY]).toHaveProperty('4');
    expect(t.session.read()).not.toHaveProperty('checkoutVaultSessionV1');
    expect(await view(t)).toEqual({ kind: 'locked' });
  });
});
