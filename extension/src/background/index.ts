import { createVaultService } from '../state/vault-service';
import { readActiveCheckout, validateActiveCheckout } from '../checkout/browser';
import { fetchPublishedCatalog, fetchPublishedMerchants } from '../catalog-config';
import { createBadgeService } from './badge-service';
import { BADGE_PAGE, ONBOARDING_PAGE, POPUP_PAGE } from '../badge/contracts';
import { routeMessage } from './routing';

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
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFRESH_ALARM && alarm.name !== REFRESH_RETRY_ALARM) return;
  void ready
    .then(() => handle.refreshReleases(REFRESH_TIMEOUT_MS))
    .then((outcome) => {
      if (alarm.name === REFRESH_ALARM && (outcome.catalog === 'failed' || outcome.merchants === 'failed'))
        return chrome.alarms.create(REFRESH_RETRY_ALARM, { delayInMinutes: REFRESH_RETRY_MINUTES });
      // Badges and pages re-read the releases in effect on their next request; tell open badges now.
      notify(null);
    })
    .catch(() => undefined);
});
chrome.runtime.onStartup?.addListener(() => void scheduleRefresh());
/** Badge iframes refresh their view on this broadcast. Runtime messages never reach content scripts. */
function notify(tabId: number | null) {
  void chrome.runtime.sendMessage({ type: 'badge:changed', tabId }).catch(() => undefined);
}
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
});

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
          : handle(request).then((response) => {
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
  // First install: pick cards in a full tab, so the badge has something to compare.
  if (details.reason === 'install')
    void chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PAGE) }).catch(() => undefined);
});
