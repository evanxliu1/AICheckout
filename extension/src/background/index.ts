import { createVaultService } from '../state/vault-service';
import { readActiveCheckout, validateActiveCheckout } from '../checkout/browser';
import { fetchPublishedCatalog } from '../catalog-config';

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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request.type !== 'string' || !request.type.startsWith('checkout:')) return;
  // Content-script/page messages cannot access the wallet API.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('src/popup/index.html')) {
    sendResponse({ ok: false, error: 'This page cannot access your wallet.' });
    return;
  }
  void ready
    .then(() => handle(request))
    .then(sendResponse)
    .catch(() => {
      sendResponse({
        ok: false,
        error: 'Local storage could not be initialized. Reopen the extension and try again.',
      });
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
  if (change.status === 'loading' || change.url !== undefined) invalidate(tabId);
});
chrome.tabs.onRemoved.addListener(invalidate);
