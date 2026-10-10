import { readManualCart } from './manual-reader';
import type { ManualRead } from './manual-reader';

declare global {
  interface Window {
    __AI_CHECKOUT_readSummary?: () => { url: string; reading: ManualRead };
  }
}
// A function in Chrome's isolated world, replaced on explicit reinjection. No observers,
// event listeners, persistent page access, or data sent from the merchant page.
window.__AI_CHECKOUT_readSummary = () => ({
  url: location.href,
  reading: readManualCart(document, location.href),
});
