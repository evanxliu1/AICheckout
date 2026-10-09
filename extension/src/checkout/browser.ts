import { probeSchema } from './contracts';
import type { CartSnapshot } from './contracts';
import { merchantForCheckout, merchantForTab } from './merchants';

/** Built from content.ts by the content-script plugin in vite.config.ts (an IIFE, no imports). */
const contentFile = 'src/checkout/content.js';

const copy = {
  'unsupported-page':
    'Open a store’s cart or checkout page in a web tab, then read it again. You can also enter the amount manually.',
  'empty-cart': 'The cart has no amount to compare. Add an item or enter a purchase amount manually.',
  'summary-missing':
    'No readable order summary was found. Wait for the cart to load, retry, or enter the amount manually.',
  'ambiguous-amount':
    'The page shows an ambiguous amount. Enter and confirm the amount you will charge manually.',
  'unsupported-currency': 'This comparison supports USD only. The cart showed another currency.',
  'page-loading': 'The order summary is still loading. Wait for it to finish, then read it again.',
  withheld: 'The cart total could not be read with certainty on this page. Enter the amount you will pay.',
};
const changed = 'The cart or page changed. Read the cart again and confirm the current amount.';

async function hash(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url)
    throw new Error('Open the extension from a supported cart using its toolbar button, then try again.');
  if (!merchantForTab(tab.url)) throw new Error(copy['unsupported-page']);
  return { id: tab.id, url: tab.url };
}
/** The merchant a reading of this URL must name: the legacy adapter's store on its cart pages, else
 * the store the popup resolves for the tab (readManualCart does the same split). */
const expectedMerchant = (url: string) => merchantForCheckout(url) ?? merchantForTab(url);
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
  if (!parsed.success) throw new Error(copy['ambiguous-amount']);
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
      result.reading.merchantId !== expectedMerchant(tab.url)
    )
      throw new Error(changed);
    const { merchantId, currency, amountCents, kind, extractorVersion } = result.reading;
    return {
      merchantId,
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
      'Chrome could not read this page. Reopen the extension from the cart’s toolbar button, or enter the amount manually.',
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
      result.reading.merchantId !== snapshot.merchantId ||
      result.reading.merchantId !== expectedMerchant(tab.url) ||
      result.reading.amountCents !== snapshot.amountCents ||
      result.reading.kind !== snapshot.kind ||
      result.reading.extractorVersion !== snapshot.extractorVersion
    )
      throw new Error(changed);
  } catch {
    throw new Error(changed);
  }
}
