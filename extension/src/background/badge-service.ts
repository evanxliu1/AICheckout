// The worker side of the automatic badge: per-tab readings and the view the iframe renders. Card and
// wallet data leave the worker only in replies to the badge iframe (an extension page); replies to the
// content script are a single show/hide flag.
import { compareRewards } from '../domain';
import type { Catalog, Purchase, Wallet } from '../domain';
import { merchantOption, storeForTab, storeProfile } from '../checkout/store-match';
import { MERCHANTS_V1 } from '@ai-checkout/rewards-core/merchants-v1';
import type { MerchantRelease } from '../domain';
import type { AppState } from '../state/contracts';
import type { StateStorage } from '../state/service';
import { localDate } from '../state/keys';
import { currentMerchants, readMerchantCache } from '../state/merchants';
import { enginePurchase, engineWallet } from '../state/wallet';
import { catalogSlice } from '../state/catalog-slice';
import type { VaultStatus } from '../state/vault-contracts';
import {
  BADGE_TABS_KEY,
  badgeRequestSchema,
  contentMessageSchema,
  defaultSettings,
  MAX_DISABLED_SITES,
  RATES_REFERENCE_CENTS,
  RATES_VIEW_REASONS,
  SETTINGS_KEY,
  settingsSchema,
  tabStoreSchema,
} from '../badge/contracts';
import type { BadgeReply, BadgeView, ContentReply, Settings, TabEntry } from '../badge/contracts';

export interface BadgeDeps {
  local: Pick<StateStorage, 'get' | 'set'>;
  session: Pick<StateStorage, 'get' | 'set'>;
  vault: {
    snapshot: () => Promise<{
      status: VaultStatus;
      state: AppState | null;
      catalog: Catalog | null;
      /** A refresh is in flight and the catalog has expired (Phase 15.4). */
      checkingTerms: boolean;
    }>;
  };
  clock?: () => number;
  open: (target: 'popup' | 'onboarding') => Promise<void>;
  /** Tells badge iframes (never content scripts) that a tab's view may have changed; null: all tabs. */
  notify: (tabId: number | null) => void;
  /** The bundled merchant release (Phase 14.2); the cached hosted release replaces it when newer (14.6). */
  release?: MerchantRelease;
}

const newEntry = (merchantId: TabEntry['merchantId'], host: string): TabEntry => ({
  merchantId,
  host,
  reading: null,
  unreadable: false,
  dismissed: false,
  amountOverrideCents: null,
  paymentPath: 'card',
  frameNonce: null,
});
/** 32 URL-safe characters (192 random bits). */
function newNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

/** Auto mode's engine inputs: a physical-goods retailer, online retail from the merchant profile. */
export function autoPurchase(
  catalog: Catalog,
  merchantId: string,
  amountCents: number,
  paymentPath: TabEntry['paymentPath'],
  now: number,
  release: MerchantRelease = MERCHANTS_V1,
): Purchase & { paymentPath: TabEntry['paymentPath'] } {
  // Catalog v3: the release record's profile, the catalog's, or the engine's generic profile (Phase 14.2).
  const profile =
    catalog.schemaVersion === 3
      ? storeProfile(catalog, merchantId, release)
      : catalog.schemaVersion === 2
        ? catalog.merchants.find((m) => m.id === merchantId)
        : undefined;
  return enginePurchase(
    {
      merchantId,
      currency: 'USD',
      amountCents,
      purchasedOn: localDate(now),
      eligiblePurchase: 'eligible',
      onlineRetail: profile ? (profile.onlineRetail ? 'eligible' : 'ineligible') : 'unknown',
      paymentPath,
    },
    catalog,
  );
}

/** The part of the catalog the badge iframe needs for one merchant: the owned cards, that merchant,
 * and what those cards refer to (their programs, the brands and gates their rules name, the sources
 * they cite). Never the whole catalog: with 180 cards it would be most of 1 MiB per view. */
export function badgeCatalog(catalog: Catalog, wallet: Pick<Wallet, 'cards'>, merchantId: string): Catalog {
  return catalogSlice(
    catalog,
    wallet.cards.map((c) => c.cardId),
    [merchantId],
  );
}

export function createBadgeService({
  local,
  session,
  vault,
  clock = Date.now,
  open,
  notify,
  release = MERCHANTS_V1,
}: BadgeDeps) {
  let queue = Promise.resolve<unknown>(undefined);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.then(operation);
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  async function tabs() {
    const parsed = tabStoreSchema.safeParse((await session.get(BADGE_TABS_KEY))[BADGE_TABS_KEY]);
    return parsed.success ? parsed.data : {};
  }
  async function saveTab(tabId: number, entry: TabEntry | null) {
    const all = await tabs();
    if (entry) all[String(tabId)] = entry;
    else delete all[String(tabId)];
    await session.set({ [BADGE_TABS_KEY]: all });
  }
  /** The stored settings. A value written before Phase 15.1 may carry `disabledMerchants` (the retired
   * adapters' per-store switch): the schema maps it to hosts, and the mapped value is written back once. */
  async function settings(): Promise<Settings> {
    const stored = (await local.get(SETTINGS_KEY))[SETTINGS_KEY];
    const parsed = settingsSchema.safeParse(stored);
    if (!parsed.success) return defaultSettings();
    if (typeof stored === 'object' && stored !== null && 'disabledMerchants' in stored)
      await local.set({ [SETTINGS_KEY]: parsed.data });
    return parsed.data;
  }
  /** The merchant release in effect (Phase 14.6): the cached hosted release when newer, else the bundled one. */
  const merchants = async () => currentMerchants(await readMerchantCache(local), release);
  /** Not dismissed in this tab, and not switched off: the badge toggle and the tab's host (Phase 13c, 14.2). */
  const visible = (entry: TabEntry, current: Settings) =>
    !entry.dismissed && current.showOnOtherStores && !current.disabledSites.includes(entry.host);
  /** A reading that shows the badge: a found amount, or a cart whose amount was not read (rates view). */
  const shows = (reading: { status: 'found' } | { status: 'unavailable'; reason: string }) =>
    reading.status === 'found' || (RATES_VIEW_REASONS as readonly string[]).includes(reading.reason);
  /** The reply to the content script: show or not, and a fresh frame nonce when it needs a frame. */
  async function reply(
    tabId: number,
    entry: TabEntry,
    show: boolean,
    framed: boolean,
  ): Promise<ContentReply> {
    if (!show) return { show: false };
    if (framed && entry.frameNonce) return { show: true };
    const nonce = newNonce();
    await saveTab(tabId, { ...entry, frameNonce: nonce });
    return { show: true, nonce };
  }

  /** A reading from the content script in this tab's top frame at `url`. Any other message (the retired
   * `order:page` included) is refused by the schema. */
  function content(input: unknown, tabId: number, url: string): Promise<ContentReply> {
    return serial(async () => {
      const message = contentMessageSchema.safeParse(input);
      if (!message.success) return { show: false };
      const current = await settings();
      const entry = (await tabs())[String(tabId)];
      const framed = message.data.framed;
      // One reader for every URL: the generic reader's reading, named `generic-us-online` (the schema
      // accepts no other store or version), and the tab's store is the one the merchant release
      // resolves for the sender URL (Phase 14.2: matched in the worker, so a refreshed release
      // applies). A payment processor's page never shows the badge.
      const store = storeForTab(url, await merchants());
      if (!store || store.kind === 'processor') return { show: false };
      const merchantId = store.id;
      const reading = message.data.reading;
      const base =
        entry && entry.merchantId === merchantId
          ? { ...entry, host: store.host }
          : newEntry(merchantId, store.host);
      let next: TabEntry;
      if (reading.status === 'found') {
        const same =
          base.reading?.amountCents === reading.amountCents &&
          base.reading.kind === reading.kind &&
          base.reading.extractorVersion === reading.extractorVersion;
        next = {
          ...base,
          reading: {
            amountCents: reading.amountCents,
            kind: reading.kind,
            extractorVersion: reading.extractorVersion,
            readAt: clock(),
          },
          unreadable: false,
          // A changed cart replaces an amount the shopper typed for the previous one.
          amountOverrideCents: same ? base.amountOverrideCents : null,
        };
      } else next = { ...base, reading: null, unreadable: true };
      await saveTab(tabId, next);
      notify(tabId);
      return reply(tabId, next, shows(reading) && visible(next, current), framed);
    });
  }

  async function view(tabId: number): Promise<BadgeView> {
    const entry = (await tabs())[String(tabId)];
    if (!entry || !visible(entry, await settings())) return { kind: 'hidden' };
    const snapshot = await vault.snapshot();
    if (snapshot.status === 'locked') return { kind: 'locked' };
    if (snapshot.status === 'damaged' || !snapshot.state || !snapshot.catalog) return { kind: 'damaged' };
    const state = snapshot.state,
      catalog = snapshot.catalog;
    if (!state.wallet.cards.length) return { kind: 'no-cards' };
    const amountCents = entry.amountOverrideCents ?? entry.reading?.amountCents;
    const now = clock();
    const inEffect = await merchants();
    // No amount read or typed: the cards ranked by rate at the reference amount (never a prompt).
    const purchase = autoPurchase(
      catalog,
      entry.merchantId,
      amountCents ?? RATES_REFERENCE_CENTS,
      entry.paymentPath,
      now,
      inEffect,
    );
    const result = compareRewards(
      catalog,
      engineWallet(state.wallet, catalog),
      purchase,
      now,
      merchantOption(catalog, entry.merchantId, inEffect),
    );
    if (result.status === 'unavailable')
      // Expired terms with a refresh in flight (Phase 15.4): "checking", never "expired", until it settles.
      return result.reason === 'catalog-expired' && snapshot.checkingTerms
        ? { kind: 'checking' }
        : { kind: 'unavailable', merchantId: entry.merchantId, result };
    if (!amountCents)
      return {
        kind: 'rates',
        merchantId: entry.merchantId,
        paymentPath: purchase.paymentPath,
        result,
        catalog: badgeCatalog(catalog, state.wallet, entry.merchantId),
        wallet: state.wallet,
      };
    return {
      kind: 'ready',
      merchantId: entry.merchantId,
      cartAmountCents: entry.reading?.amountCents ?? null,
      amountKind: entry.reading?.kind ?? null,
      amountCents,
      amountEdited: entry.amountOverrideCents !== null,
      paymentPath: purchase.paymentPath,
      result,
      catalog: badgeCatalog(catalog, state.wallet, entry.merchantId),
      wallet: state.wallet,
    };
  }

  /** A request from the badge iframe in tab `tabId`. */
  function badge(input: unknown, tabId: number): Promise<BadgeReply> {
    return serial(async () => {
      const request = badgeRequestSchema.safeParse(input);
      if (!request.success) return { ok: false, error: 'This request could not be read.' };
      const value = request.data;
      const entry = (await tabs())[String(tabId)];
      // Only the frame this tab's content script created (its nonce) may act or see card data.
      if (!entry || !entry.frameNonce || entry.frameNonce !== value.nonce)
        return { ok: false, error: 'This badge is out of date. Reload the page.' };
      if (value.type === 'badge:open') await open(value.target);
      else if (value.type === 'badge:set-amount')
        await saveTab(tabId, { ...entry, amountOverrideCents: value.amountCents });
      else if (value.type === 'badge:set-payment')
        await saveTab(tabId, { ...entry, paymentPath: value.paymentPath });
      else if (value.type === 'badge:dismiss') await saveTab(tabId, { ...entry, dismissed: true });
      else if (value.type === 'badge:disable-site') {
        // The tab's host, never its id (the generic id is shared by every unmatched store).
        const current = await settings();
        if (entry.host && !current.disabledSites.includes(entry.host))
          await local.set({
            [SETTINGS_KEY]: {
              ...current,
              disabledSites: [...current.disabledSites, entry.host].slice(-MAX_DISABLED_SITES),
            },
          });
      }
      return { ok: true, view: await view(tabId) };
    });
  }

  return {
    content,
    badge,
    settings: () => serial(settings),
    /** From the popup: replaces the settings (validated). */
    saveSettings: (input: unknown) =>
      serial(async () => {
        const parsed = settingsSchema.safeParse(input);
        if (!parsed.success) return null;
        await local.set({ [SETTINGS_KEY]: parsed.data });
        notify(null);
        return parsed.data;
      }),
    /** Navigation: the old page's reading and typed amount no longer apply; dismissal and the
     * payment choice last for the tab. */
    navigated: (tabId: number) =>
      serial(async () => {
        const entry = (await tabs())[String(tabId)];
        if (entry)
          await saveTab(tabId, { ...entry, reading: null, unreadable: false, amountOverrideCents: null });
      }),
    removed: (tabId: number) => serial(() => saveTab(tabId, null)),
  };
}
