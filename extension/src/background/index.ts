import { createVaultService } from '../state/vault-service';
import { readActiveCheckout, validateActiveCheckout } from '../checkout/browser';
import {
  fetchPublishedCatalog,
  fetchPublishedMerchants,
  telemetryClient,
  uninstalledUrl,
} from '../catalog-config';
import { createBadgeService, storeFacts } from './badge-service';
import { BADGE_PAGE, ONBOARDING_PAGE, POPUP_PAGE } from '../badge/contracts';
import { routeMessage } from './routing';
import { createTelemetry } from '../state/telemetry';
import {
  pageForUrl,
  registrableDomain,
  REPORTS_NOT_DELETED_MESSAGE,
  telemetryRequestSchema,
} from '../state/telemetry-contracts';
import type { TelemetryResponse } from '../state/telemetry-contracts';
import { catalogCacheSchema, emptyCatalogCache } from '../state/contracts';
import { currentCatalog } from '../state/catalog';
import { currentMerchants, readMerchantCache } from '../state/merchants';
import { CATALOG_KEY } from '../state/keys';
import { storeForTab, storeProfile } from '../checkout/store-match';

/** Content scripts and pages must never read wallet storage. Applied every time the worker starts
 * (top level), and again on install and browser startup, before any message is handled. */
const restrictStorage = () =>
  Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
const ready = restrictStorage();
chrome.runtime.onStartup?.addListener(() => void restrictStorage().catch(() => undefined));
const handle = createVaultService(
  chrome.storage.local,
  chrome.storage.session,
  Date.now,
  { read: readActiveCheckout, validate: validateActiveCheckout },
  fetchPublishedCatalog,
  fetchPublishedMerchants,
);
/** The merchant release in effect (the cached hosted release when newer, else the bundled one). */
const merchantsInEffect = async () => currentMerchants(await readMerchantCache(chrome.storage.local));
/** The catalog and merchant release versions in effect, for the usage report envelope (Phase 15.3); read from
 * the public caches, so they are known while the vault is locked. */
async function versionsInEffect() {
  const cache = catalogCacheSchema.safeParse((await chrome.storage.local.get(CATALOG_KEY))[CATALOG_KEY]);
  return {
    catalog: currentCatalog(cache.success ? cache.data : emptyCatalogCache(), Date.now()).version,
    merchants: (await merchantsInEffect()).version,
  };
}
/** Consented usage reporting (Phase 15.3): events built here from what the worker holds, queued in local
 * storage and flushed by the `telemetry-flush` alarm. `telemetryClient` is undefined without `VITE_TELEMETRY`,
 * and then nothing is queued or sent. */
const telemetry = createTelemetry({
  local: chrome.storage.local,
  client: telemetryClient,
  alarms: chrome.alarms,
  versions: versionsInEffect,
  extensionVersion: chrome.runtime.getManifest?.().version ?? '0.0.0',
});
/** The weekly refresh of the catalog and the merchant release (Phase 14.6, plan §4 "Freshness"): one
 * `chrome.alarms` alarm in hosted builds. A fetch may wait out a Render cold start (about a minute); when
 * either fetch still fails, one retry alarm follows a few minutes later, never more until the next week. */
export const REFRESH_ALARM = 'refresh-releases';
export const REFRESH_RETRY_ALARM = 'refresh-releases-retry';
export const REFRESH_PERIOD_MINUTES = 7 * 24 * 60;
/** A new install refreshes soon after the first start, then weekly. */
export const REFRESH_FIRST_MINUTES = 2;
export const REFRESH_RETRY_MINUTES = 5;
export const REFRESH_TIMEOUT_MS = 90_000;
/** Creates the weekly alarm once: an existing alarm is kept, so browser restarts never reset its period. */
async function scheduleRefresh() {
  if ((!fetchPublishedCatalog && !fetchPublishedMerchants) || !chrome.alarms) return;
  try {
    if (await chrome.alarms.get(REFRESH_ALARM)) return;
    await chrome.alarms.create(REFRESH_ALARM, {
      delayInMinutes: REFRESH_FIRST_MINUTES,
      periodInMinutes: REFRESH_PERIOD_MINUTES,
    });
  } catch {
    // Without the alarm, "Check for updated terms" still refreshes both releases.
  }
}
/** Refreshes both releases and reports one `release_refresh` per release with the versions before and after
 * (Phase 15.3). The reports are started, never awaited. At install the shopper has not answered the consent
 * question yet, so an `install` report is sent only if Share comes first (normally it is dropped). */
async function refreshAndReport(trigger: 'install' | 'weekly') {
  const before = await versionsInEffect().catch(() => null);
  const outcome = await handle.refreshReleases(REFRESH_TIMEOUT_MS);
  if (before)
    void versionsInEffect()
      .then(async (after) => {
        for (const kind of ['catalog', 'merchants'] as const)
          await telemetry.record({
            type: 'release_refresh',
            kind,
            outcome: outcome[kind],
            from_version: before[kind],
            to_version: after[kind] !== before[kind] ? after[kind] : null,
            trigger,
          });
      })
      .catch(() => undefined);
  return outcome;
}
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFRESH_ALARM && alarm.name !== REFRESH_RETRY_ALARM) {
    void telemetry.onAlarm(alarm.name).catch(() => undefined);
    return;
  }
  void ready
    .then(() => refreshAndReport('weekly'))
    .then((outcome) => {
      refreshed();
      if (alarm.name === REFRESH_ALARM && (outcome.catalog === 'failed' || outcome.merchants === 'failed'))
        return chrome.alarms.create(REFRESH_RETRY_ALARM, { delayInMinutes: REFRESH_RETRY_MINUTES });
    })
    .catch(() => undefined);
});
/** A new install refreshes both releases at once (Phase 15.4): the bundled catalog of a store build may
 * have expired, and the pages say "Checking for updated terms…" until this settles. A failure needs no
 * retry of its own: the weekly alarm's first run follows REFRESH_FIRST_MINUTES later. */
function refreshAtInstall() {
  void ready
    .then(() => refreshAndReport('install'))
    .then(refreshed)
    .catch(() => undefined);
}
/** A background refresh settled, with or without new terms: badges and pages re-read the releases in effect
 * on their next request; open badges reload now, and a popup showing "Checking…" reloads too. */
function refreshed() {
  notify(null);
  void chrome.runtime.sendMessage({ type: 'terms:checked' }).catch(() => undefined);
}
chrome.runtime.onStartup?.addListener(() => void scheduleRefresh());
/** Badge iframes refresh their view on this broadcast. Runtime messages never reach content scripts. */
function notify(tabId: number | null) {
  void chrome.runtime.sendMessage({ type: 'badge:changed', tabId }).catch(() => undefined);
}
// Hosted builds: Chrome opens the site's static page after an uninstall (no parameters; needs no permission).
if (uninstalledUrl) void chrome.runtime.setUninstallURL(uninstalledUrl).catch(() => undefined);
async function open(target: 'popup' | 'onboarding') {
  if (target === 'popup') {
    try {
      await chrome.action.openPopup();
      return;
    } catch {
      // openPopup needs a focused normal window; fall back to the same page in a tab.
    }
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(target === 'popup' ? POPUP_PAGE : ONBOARDING_PAGE) });
}
const badge = createBadgeService({
  local: chrome.storage.local,
  session: chrome.storage.session,
  vault: { snapshot: handle.snapshot },
  open,
  notify,
  telemetry,
});

type PageRequest = {
  type: string;
  purchase?: { merchantId: string; amountCents: number };
  cartId?: string | null;
  merchantId?: string;
  keepReports?: true;
};
/** Delete all local data (Phase 15.5b): `chrome.storage.local.clear()` would take the usage identifier with it,
 * so while sharing is on the reports stored under it are deleted first, exactly as Delete my data does (a batch
 * in flight lands, no new one starts, the id goes to `/v1/events/delete`). Only a 2xx lets the clear proceed;
 * otherwise nothing is cleared and the page offers Try again or Clear this device anyway (`keepReports`). */
const CLEAR_REQUESTS = new Set(['checkout:vault-delete', 'checkout:clear']);
async function reportsDeletedFirst(request: PageRequest): Promise<boolean> {
  if (!CLEAR_REQUESTS.has(request.type) || request.keepReports) return true;
  return (await telemetry.deleteData()) !== 'unavailable';
}
/** The usage events of one handled page request (Phase 15.3). */
async function reportPage(
  request: PageRequest,
  response: Awaited<ReturnType<typeof handle>>,
  before: Awaited<ReturnType<typeof versionsInEffect>> | null,
): Promise<void> {
  if (before) {
    const after = await versionsInEffect();
    await telemetry.record({
      type: 'release_refresh',
      kind: 'catalog',
      outcome: response.ok ? 'ok' : 'failed',
      from_version: before.catalog,
      to_version: after.catalog !== before.catalog ? after.catalog : null,
      trigger: 'manual',
    });
  }
  // Vault requests answer with a status only; the wallet API answers with the state.
  if (!response.ok || !('state' in response)) return;
  if (request.type === 'checkout:save-wallet')
    await telemetry.record({
      type: 'wallet_changed',
      card_ids: response.state.wallet.cards.map((card) => card.cardId),
    });
  const comparison = response.comparison;
  if (
    (request.type === 'checkout:compare' || request.type === 'checkout:rates') &&
    comparison?.status === 'ready'
  ) {
    const merchantId = request.purchase?.merchantId ?? request.merchantId ?? '';
    // A typed amount is not a reading: the contract's `amount_kind` names what was read, so a popup
    // comparison is reported only from a read cart (the rates view always).
    const cart = request.cartId && response.state.cart?.id === request.cartId ? response.state.cart : null;
    const rates = request.type === 'checkout:rates';
    if (rates || cart) {
      const release = await merchantsInEffect();
      await telemetry.record({
        type: 'recommendation_shown',
        surface: 'popup',
        view: rates ? 'rates' : 'amount',
        withheld_reason: rates ? 'withheld' : null,
        page: 'popup-read',
        ...storeFacts(merchantId, release),
        category:
          storeProfile(response.catalog, merchantId, release)?.expectedCategory ?? 'general-merchandise',
        amount_cents: cart ? cart.amountCents : null,
        amount_kind: cart ? cart.kind : null,
        top_card_id: comparison.preferredCardId,
        cards_count: Math.max(1, response.state.wallet.cards.length),
        ranking_may_change: comparison.rankingMayChange,
      });
    }
  }
}
/** A page request, with the usage events the worker derives from what it handled (Phase 15.3): the popup's
 * comparison and rates view (`recommendation_shown`), a saved wallet (`wallet_changed`) and a manual terms
 * check (`release_refresh`). Nothing here reads the page or the tab. */
async function handlePage(request: PageRequest): Promise<Awaited<ReturnType<typeof handle>>> {
  if (!(await reportsDeletedFirst(request))) return { ok: false, error: REPORTS_NOT_DELETED_MESSAGE };
  const before =
    request.type === 'checkout:refresh-catalog' ? await versionsInEffect().catch(() => null) : null;
  const response: Awaited<ReturnType<typeof handle>> = await handle(request);
  // The usage events are derived after the answer, never awaited: the popup never waits for a report.
  void reportPage(request, response, before).catch(() => undefined);
  return response;
}
/** The tab a popup request names, resolved against the merchant release in effect; the URL is read here
 * (host permission) and never stored. */
async function tabStore(tabId: number) {
  let url: string | undefined;
  try {
    url = (await chrome.tabs.get(tabId)).url;
  } catch {
    url = undefined;
  }
  const store = url?.startsWith('https://') ? storeForTab(url, await merchantsInEffect()) : null;
  return { url, store };
}
/** The usage-report requests of the popup and onboarding page (Phase 15.3). */
async function handleTelemetry(input: unknown): Promise<TelemetryResponse> {
  const parsed = telemetryRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'This request could not be read.' };
  const request = parsed.data;
  const status = async (): Promise<TelemetryResponse> => ({ ok: true, status: await telemetry.status() });
  if (request.type === 'telemetry:get') return status();
  if (request.type === 'telemetry:consent') {
    const snapshot = request.granted ? await handle.snapshot() : null;
    const context = snapshot?.state
      ? {
          cardIds: snapshot.state.wallet.cards.map((card) => card.cardId),
          onboarding: request.source === 'onboarding',
        }
      : undefined;
    return { ok: true, status: await telemetry.consent(request.granted, context) };
  }
  if (request.type === 'telemetry:delete') {
    const outcome = await telemetry.deleteData();
    if (outcome === 'unavailable')
      return {
        ok: false,
        error: 'The service could not be reached, so nothing was deleted yet. Try again later.',
      };
    return status();
  }
  if (request.type === 'telemetry:popup-opened') {
    const store = request.tabId === null ? null : (await tabStore(request.tabId)).store;
    const release = await merchantsInEffect();
    await telemetry.record({
      type: 'popup_opened',
      read_outcome: request.readOutcome,
      store_kind: store && store.kind === 'store' ? storeFacts(store.id, release).store_kind : 'generic',
    });
    return status();
  }
  // The two taps: the registrable domain of the tab's host travels, the id only while sharing is on.
  const { url, store } = await tabStore(request.tabId);
  if (!store || store.kind === 'processor' || !url)
    return { ok: false, error: 'Open this from a store’s page to send its address.' };
  const domain = registrableDomain(store.host);
  if (!domain) return { ok: false, error: 'This address can’t be sent.' };
  let sent: boolean;
  if (request.type === 'telemetry:suggest-store') {
    if (store.kind !== 'generic') return { ok: false, error: 'This store is already recognised.' };
    sent = await telemetry.recordTap({ type: 'store_suggested', domain, page: pageForUrl(url) });
  } else {
    const shown = await badge.shownIn(request.tabId);
    sent = await telemetry.recordTap({
      type: 'problem_reported',
      domain,
      reason: request.reason,
      view: shown.view,
      withheld_reason: shown.withheld_reason,
    });
  }
  return sent ? status() : { ok: false, error: 'This report could not be sent.' };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const route = routeMessage(request, sender, {
    runtimeId: chrome.runtime.id,
    pageUrls: [chrome.runtime.getURL(POPUP_PAGE), chrome.runtime.getURL(ONBOARDING_PAGE)],
    badgeUrl: chrome.runtime.getURL(BADGE_PAGE),
  });
  if (route.kind === 'ignore') return;
  if (route.kind === 'deny') {
    sendResponse({ ok: false, error: 'This page cannot access your wallet.' });
    return;
  }
  const work = (): Promise<unknown> =>
    route.kind === 'page'
      ? request.type === 'settings:get'
        ? badge.settings().then((settings) => ({ ok: true, settings }))
        : request.type === 'settings:set'
          ? badge
              .saveSettings(request.settings)
              .then((settings) =>
                settings ? { ok: true, settings } : { ok: false, error: 'Invalid settings.' },
              )
          : typeof request.type === 'string' && request.type.startsWith('telemetry:')
            ? handleTelemetry(request)
            : handlePage(request).then((response) => {
                // Cards, protection or terms may have changed: badges re-read their view.
                notify(null);
                return response;
              })
      : route.kind === 'badge'
        ? badge.badge(request, route.tabId)
        : badge.content(request, route.tabId, route.url);
  void ready
    .then(work)
    .then(sendResponse)
    .catch(() => {
      void telemetry
        .record({ type: 'error', code: 'request-failed', surface: route.kind })
        .catch(() => undefined);
      sendResponse(
        route.kind === 'content'
          ? { show: false }
          : {
              ok: false,
              error: 'Local storage could not be initialized. Reopen the extension and try again.',
            },
      );
    });
  return true;
});
void ready.catch(() => console.error('Unable to restrict extension storage access.'));

function invalidate(tabId: number) {
  void ready
    .then(() => handle.invalidateTab(tabId))
    .catch(() => console.error('Unable to invalidate a saved cart.'));
}
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url !== undefined) {
    invalidate(tabId);
    void badge.navigated(tabId).catch(() => undefined);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  invalidate(tabId);
  void badge.removed(tabId).catch(() => undefined);
});
chrome.runtime.onInstalled.addListener((details) => {
  void restrictStorage().catch(() => undefined);
  void scheduleRefresh();
  // First install: fetch current terms now, and pick cards in a full tab so the badge has something to compare.
  if (details.reason === 'install') {
    refreshAtInstall();
    void chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PAGE) }).catch(() => undefined);
  }
});
