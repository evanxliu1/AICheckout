import { probeSchema } from './contracts';
import type { CartSnapshot } from './contracts';
import { GENERIC_MERCHANT_ID } from '@ai-checkout/rewards-core/generic-merchant';
import { GENERIC_READER_VERSION } from './merchants';
import { storeForTab } from './store-match';
import { READ_COPY } from './read-copy';

/** Built from content.ts by the content-script plugin in vite.config.ts (an IIFE, no imports). */
const contentFile = 'src/checkout/content.js';

const copy = READ_COPY;
const changed = 'The cart or page changed. Read the cart again and confirm the current amount.';

async function hash(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url)
    throw new Error('Open the extension from the store tab using its toolbar button, then try again.');
  const store = storeForTab(tab.url);
  if (!store) throw new Error(copy['unsupported-page']);
  if (store.kind === 'processor') throw new Error(copy['payment-page']);
  return { id: tab.id, url: tab.url, merchantId: store.id };
}
async function readDocument(tabId: number, documentId: string) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    world: 'ISOLATED',
    func: () => window.__AI_CHECKOUT_readSummary?.(),
  });
  const result = results[0];
  if (results.length !== 1 || result.documentId !== documentId || result.frameId !== 0)
    throw new Error(changed);
  const parsed = probeSchema.safeParse(result.result);
  // A reply the contract refuses is an amount not read with certainty: the rates view, as for `withheld`.
  if (!parsed.success) throw new Error(copy.withheld);
  if (parsed.data.reading.status === 'unavailable') throw new Error(copy[parsed.data.reading.reason]);
  return { url: parsed.data.url, reading: parsed.data.reading };
}

export async function readActiveCheckout(now = Date.now()): Promise<CartSnapshot> {
  const tab = await activeTab();
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      files: [contentFile],
    });
    const documentId = injected[0]?.documentId;
    if (injected.length !== 1 || !documentId) throw new Error(changed);
    const result = await readDocument(tab.id, documentId);
    const current = await activeTab();
    if (
      result.url !== tab.url ||
      current.id !== tab.id ||
      current.url !== tab.url ||
      // The content script names only the generic store (probeSchema); the snapshot carries the tab's store.
      result.reading.merchantId !== GENERIC_MERCHANT_ID ||
      result.reading.extractorVersion !== GENERIC_READER_VERSION
    )
      throw new Error(changed);
    const { currency, amountCents, kind, extractorVersion } = result.reading;
    return {
      // The store the worker resolved for the tab (a release record or the generic one).
      merchantId: tab.merchantId,
      currency,
      amountCents,
      kind,
      extractorVersion,
      id: crypto.randomUUID(),
      tabId: tab.id,
      documentId,
      pageKey: await hash(tab.url),
      capturedAt: now,
    };
  } catch (error) {
    if (error instanceof Error && [changed, ...Object.values(copy)].includes(error.message)) throw error;
    throw new Error(
      'Chrome could not read this page. Reopen the extension from the cart’s tab and read it again.',
    );
  }
}

export async function validateActiveCheckout(snapshot: CartSnapshot): Promise<void> {
  try {
    const tab = await activeTab();
    if (tab.id !== snapshot.tabId || (await hash(tab.url)) !== snapshot.pageKey) throw new Error(changed);
    const result = await readDocument(tab.id, snapshot.documentId);
    const current = await activeTab();
    if (
      current.id !== tab.id ||
      current.url !== tab.url ||
      result.url !== tab.url ||
      tab.merchantId !== snapshot.merchantId ||
      result.reading.merchantId !== GENERIC_MERCHANT_ID ||
      result.reading.amountCents !== snapshot.amountCents ||
      result.reading.kind !== snapshot.kind ||
      result.reading.extractorVersion !== snapshot.extractorVersion
    )
      throw new Error(changed);
  } catch {
    throw new Error(changed);
  }
}
