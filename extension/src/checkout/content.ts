import { readCheckoutPage } from './page-reader';
import type { PageRead } from './page-reader';

declare global {
  interface Window {
    __AI_CHECKOUT_readSummary?: () => { url: string; reading: PageRead };
  }
}
// A function in Chrome's isolated world, replaced on explicit reinjection. No observers,
// event listeners, persistent page access, or data sent from the merchant page.
window.__AI_CHECKOUT_readSummary = () => ({
  url: location.href,
  reading: readCheckoutPage(document, location.href),
});
