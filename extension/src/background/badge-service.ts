// The worker side of the automatic badge: per-tab readings, the view the iframe renders, and
// one-tap order answers. Card and wallet data leave the worker only in replies to the badge
// iframe (an extension page); replies to the content script are a single show/hide flag.
import { compareRewards } from '../domain';
import type { Catalog, Purchase, Wallet } from '../domain';
import { merchantForCheckout, merchantForOrderConfirmation, type MerchantId } from '../checkout/merchants';
import { currentCatalog } from '../state/catalog';
import type { AppState, CheckoutResponse } from '../state/contracts';
import type { StateStorage } from '../state/service';
import { localDate } from '../state/service';
import type { VaultStatus } from '../state/vault-contracts';
import { savingsEntry } from '../state/savings';
import {
  BADGE_TABS_KEY,
  badgeRequestSchema,
  contentMessageSchema,
  defaultSettings,
  ORDER_WINDOW_MS,
  SETTINGS_KEY,
  settingsSchema,
  tabStoreSchema,
} from '../badge/contracts';
import type { BadgeReply, BadgeView, ContentReply, Settings, TabEntry } from '../badge/contracts';

export interface BadgeDeps {
  local: Pick<StateStorage, 'get' | 'set'>;
  session: Pick<StateStorage, 'get' | 'set'>;
  vault: {
    snapshot: () => Promise<{ status: VaultStatus; state: AppState | null }>;
    handle: (request: unknown) => Promise<unknown>;
  };
  clock?: () => number;
  open: (target: 'popup' | 'onboarding') => Promise<void>;
  /** Tells badge iframes (never content scripts) that a tab's view may have changed; null: all tabs. */
  notify: (tabId: number | null) => void;
}

const newEntry = (merchantId: MerchantId): TabEntry => ({
  merchantId,
  reading: null,
  unreadable: false,
  dismissed: false,
  amountOverrideCents: null,
  paymentPath: 'card',
  recommendation: null,
  orderPrompt: null,
});
const cardName = (catalog: Catalog, id: string | null) =>
  id ? (catalog.cards.find((card) => card.id === id)?.shortName ?? null) : null;

/** Auto mode's engine inputs: a physical-goods retailer, online retail from the merchant profile. */
export function autoPurchase(
  catalog: Catalog,
  merchantId: string,
  amountCents: number,
  paymentPath: TabEntry['paymentPath'],
  now: number,
): Purchase {
  const profile =
    catalog.schemaVersion === 2 ? catalog.merchants.find((m) => m.id === merchantId) : undefined;
  return {
    merchantId,
    currency: 'USD',
    amountCents,
    purchasedOn: localDate(now),
    eligiblePurchase: 'eligible',
    onlineRetail: profile ? (profile.onlineRetail ? 'eligible' : 'ineligible') : 'unknown',
    paymentPath,
  };
}

export function createBadgeService({ local, session, vault, clock = Date.now, open, notify }: BadgeDeps) {
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
  async function settings(): Promise<Settings> {
    const parsed = settingsSchema.safeParse((await local.get(SETTINGS_KEY))[SETTINGS_KEY]);
    return parsed.success ? parsed.data : defaultSettings();
  }
  const visible = (entry: TabEntry, current: Settings) =>
    !entry.dismissed && !current.disabledMerchants.includes(entry.merchantId);

  /** A reading or order page from the content script in this tab's top frame at `url`. */
  function content(input: unknown, tabId: number, url: string): Promise<ContentReply> {
    return serial(async () => {
      const message = contentMessageSchema.safeParse(input);
      if (!message.success) return { show: false };
      const current = await settings();
      const entry = (await tabs())[String(tabId)];
      if (message.data.type === 'order:page') {
        const merchantId = merchantForOrderConfirmation(url);
        if (!merchantId) return { show: false };
        const recent = entry?.recommendation;
        if (
          entry &&
          recent &&
          recent.purchase.merchantId === merchantId &&
          clock() - recent.at >= 0 &&
          clock() - recent.at < ORDER_WINDOW_MS
        ) {
          // One question per recommendation: it moves from "shown" to "ask".
          await saveTab(tabId, { ...entry, recommendation: null, orderPrompt: { ...recent, at: clock() } });
          notify(tabId);
          return { show: !current.disabledMerchants.includes(merchantId) };
        }
        return { show: !!entry?.orderPrompt && !current.disabledMerchants.includes(merchantId) };
      }
      const merchantId = merchantForCheckout(url);
      const reading = message.data.reading;
      if (!merchantId || (reading.status === 'found' && reading.merchantId !== merchantId))
        return { show: false };
      const base = entry && entry.merchantId === merchantId ? entry : newEntry(merchantId);
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
      return { show: reading.status === 'found' && visible(next, current) };
    });
  }

  async function view(tabId: number): Promise<BadgeView> {
    const entry = (await tabs())[String(tabId)];
    if (!entry || !visible(entry, await settings())) return { kind: 'hidden' };
    const snapshot = await vault.snapshot();
    if (snapshot.status === 'locked') return { kind: 'locked', order: !!entry.orderPrompt };
    if (snapshot.status === 'damaged' || !snapshot.state) return { kind: 'damaged' };
    const state = snapshot.state,
      catalog = currentCatalog(state);
    if (entry.orderPrompt) {
      const cards = state.wallet.cards.map((owned) => ({
        id: owned.cardId,
        name: cardName(catalog, owned.cardId) ?? owned.cardId,
      }));
      return {
        kind: 'order',
        merchantId: entry.merchantId,
        recommendedCardId: entry.orderPrompt.recommendedCardId,
        cards,
      };
    }
    if (!state.wallet.cards.length) return { kind: 'no-cards' };
    const amountCents = entry.amountOverrideCents ?? entry.reading?.amountCents;
    if (!amountCents) return { kind: 'unreadable', merchantId: entry.merchantId };
    const now = clock();
    const purchase = autoPurchase(catalog, entry.merchantId, amountCents, entry.paymentPath, now);
    const result = compareRewards(catalog, state.wallet, purchase, now);
    if (result.status === 'unavailable') return { kind: 'unavailable', merchantId: entry.merchantId, result };
    const recommendation = entry.recommendation;
    if (
      !recommendation ||
      recommendation.recommendedCardId !== result.preferredCardId ||
      recommendation.purchase.amountCents !== purchase.amountCents ||
      recommendation.purchase.paymentPath !== purchase.paymentPath
    )
      await saveTab(tabId, {
        ...entry,
        recommendation: { purchase, recommendedCardId: result.preferredCardId, at: now },
      });
    return {
      kind: 'ready',
      merchantId: entry.merchantId,
      cartAmountCents: entry.reading?.amountCents ?? null,
      amountKind: entry.reading?.kind ?? null,
      amountCents,
      amountEdited: entry.amountOverrideCents !== null,
      paymentPath: entry.paymentPath,
      result,
      catalog,
      wallet: state.wallet,
    };
  }

  async function answer(
    tabId: number,
    entry: TabEntry,
    choice: 'yes' | 'other' | 'unsure',
    cardId: string | null,
  ): Promise<BadgeReply> {
    const prompt = entry.orderPrompt;
    if (!prompt) return { ok: false, error: 'There is no order to record.' };
    const snapshot = await vault.snapshot();
    if (!snapshot.state)
      return { ok: false, error: 'Unlock AI Checkout to record this order, then answer again.' };
    const state = snapshot.state,
      catalog = currentCatalog(state);
    const used = choice === 'yes' ? prompt.recommendedCardId : choice === 'other' ? cardId : null;
    if (used && !state.wallet.cards.some((owned) => owned.cardId === used))
      return { ok: false, error: 'Choose one of your cards.' };
    const entryRecord = savingsEntry({
      catalog,
      wallet: state.wallet as Wallet,
      purchase: prompt.purchase,
      recommendedCardId: prompt.recommendedCardId,
      usedCardId: used,
      now: clock(),
    });
    const saved = (await vault.handle({ type: 'checkout:record-savings', entry: entryRecord })) as
      CheckoutResponse | undefined;
    if (!saved || !saved.ok) return { ok: false, error: 'The order could not be saved. Try again.' };
    await saveTab(tabId, { ...entry, orderPrompt: null });
    return {
      ok: true,
      view: {
        kind: 'recorded',
        extraCents: entryRecord.extraCents,
        usedCardName: cardName(catalog, used),
        baselineCardName: cardName(catalog, state.wallet.defaultCardId),
      },
    };
  }

  /** A request from the badge iframe in tab `tabId`. */
  function badge(input: unknown, tabId: number): Promise<BadgeReply> {
    return serial(async () => {
      const request = badgeRequestSchema.safeParse(input);
      if (!request.success) return { ok: false, error: 'This request could not be read.' };
      const value = request.data;
      if (value.type === 'badge:open') {
        await open(value.target);
        return { ok: true, view: await view(tabId) };
      }
      const entry = (await tabs())[String(tabId)];
      if (!entry) return { ok: true, view: { kind: 'hidden' } };
      if (value.type === 'badge:set-amount')
        await saveTab(tabId, { ...entry, amountOverrideCents: value.amountCents });
      else if (value.type === 'badge:set-payment')
        await saveTab(tabId, { ...entry, paymentPath: value.paymentPath });
      else if (value.type === 'badge:dismiss') await saveTab(tabId, { ...entry, dismissed: true });
      else if (value.type === 'badge:disable-site') {
        const current = await settings();
        if (!current.disabledMerchants.includes(entry.merchantId))
          await local.set({
            [SETTINGS_KEY]: {
              ...current,
              disabledMerchants: [...current.disabledMerchants, entry.merchantId],
            },
          });
      } else if (value.type === 'badge:answer-order') return answer(tabId, entry, value.answer, value.cardId);
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
    /** Navigation: the old page's reading and typed amount no longer apply; dismissal,
     * payment choice and order tracking last for the tab. */
    navigated: (tabId: number) =>
      serial(async () => {
        const entry = (await tabs())[String(tabId)];
        if (entry)
          await saveTab(tabId, { ...entry, reading: null, unreadable: false, amountOverrideCents: null });
      }),
    removed: (tabId: number) => serial(() => saveTab(tabId, null)),
  };
}
