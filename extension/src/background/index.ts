import { createVaultService } from '../state/vault-service';
import { readActiveCheckout, validateActiveCheckout } from '../checkout/browser';
import { fetchPublishedCatalog } from '../catalog-config';
import { createBadgeService } from './badge-service';
import { BADGE_PAGE, ONBOARDING_PAGE, POPUP_PAGE } from '../badge/contracts';
import { routeMessage } from './routing';

const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
const handle = createVaultService(
  chrome.storage.local,
  chrome.storage.session,
  Date.now,
  { read: readActiveCheckout, validate: validateActiveCheckout },
  fetchPublishedCatalog,
);
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
  vault: { snapshot: handle.snapshot, handle },
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
  // First install: pick cards in a full tab, so the badge has something to compare.
  if (details.reason === 'install')
    void chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PAGE) }).catch(() => undefined);
});
