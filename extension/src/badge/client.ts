import type { BadgeReply, BadgeRequest } from './contracts';
import { BADGE_MESSAGE_SOURCE } from './pages';

export async function badgeRequest(request: BadgeRequest): Promise<BadgeReply> {
  try {
    const reply = (await chrome.runtime.sendMessage(request)) as BadgeReply | undefined;
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
