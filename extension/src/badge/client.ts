import type { BadgeAction, BadgeReply } from './contracts';
import { BADGE_MESSAGE_SOURCE } from './pages';

/** Given by the content script that created this frame (URL fragment); copies made by a page
 * have none, and the worker rejects them. */
const frameNonce = location.hash.slice(1);

export async function badgeRequest(action: BadgeAction): Promise<BadgeReply> {
  try {
    const reply = (await chrome.runtime.sendMessage({ ...action, nonce: frameNonce })) as
      BadgeReply | undefined;
    if (!reply || typeof reply !== 'object' || !('ok' in reply))
      return { ok: false, error: 'AI Checkout did not respond. Reload the page.' };
    return reply;
  } catch {
    return { ok: false, error: 'AI Checkout could not connect. Reload the page.' };
  }
}

/** Size and visibility only, to the embedding page's origin (never card data). */
export function postToHost(
  message: { type: 'size'; width: number; height: number; expanded: boolean } | { type: 'hide' },
) {
  const target = location.ancestorOrigins?.[0];
  if (!target || window.parent === window) return;
  window.parent.postMessage({ source: BADGE_MESSAGE_SOURCE, ...message }, target);
}
