import contentScriptFile from '../content/index.ts?script&iife';
import { cartItemsSchema } from '../types/schemas';

export async function extractActiveCart() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error('Open a shopping cart in a regular browser tab, then try again.');
  }
  const url = new URL(tab.url);
  if (!['https:', 'http:'].includes(url.protocol) ||
      url.hostname === 'chromewebstore.google.com') {
    throw new Error('Chrome does not allow extraction on this page. Open a retailer’s cart, then try again.');
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [contentScriptFile],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        url: window.location.href,
        items: window.__CC_extractCartItems?.() ?? [],
      }),
    });
    const result = results[0]?.result;
    const currentTab = await chrome.tabs.get(tab.id);
    if (!result || result.url !== tab.url || currentTab.url !== tab.url) {
      throw new Error('The page changed during extraction. Try again on the current cart.');
    }
    const parsed = cartItemsSchema.safeParse(result.items);
    if (!parsed.success) {
      throw new Error('The cart could not be read reliably. Check the cart and try again.');
    }
    return { site: url.hostname, items: parsed.data };
  } catch (error) {
    if (error instanceof Error && /^(The page|The cart)/.test(error.message)) throw error;
    throw new Error('Chrome could not read this cart. Check the extension’s site access and try again.');
  }
}
