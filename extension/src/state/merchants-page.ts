// Extension pages (popup, onboarding, badge iframe) read the cached merchant release once before rendering, so
// store names, the tab's store and the evidence line follow the release the worker matches with (Phase 14.6).
// The cache is public data in chrome.storage.local, readable by trusted contexts only; an unreadable or
// missing cache leaves the bundled release in effect.
import { setMerchantsInEffect } from '../checkout/store-match';
import { currentMerchants, readMerchantCache } from './merchants';

export async function loadMerchantsInEffect(): Promise<void> {
  try {
    setMerchantsInEffect(currentMerchants(await readMerchantCache(chrome.storage.local)));
  } catch {
    // The bundled release stays in effect.
  }
}
