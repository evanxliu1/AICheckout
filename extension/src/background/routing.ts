// Who may send what to the worker. Chrome sets `sender`; nothing in the message decides the route.
export type Route =
  | { kind: 'ignore' }
  | { kind: 'deny' }
  /** The popup or onboarding page: the full wallet API. */
  | { kind: 'page' }
  /** The badge iframe (an extension page inside a supported cart tab): badge:* only. */
  | { kind: 'badge'; tabId: number }
  /** The content script in a supported cart tab's top frame: readings and order pages only. */
  | { kind: 'content'; tabId: number; url: string };

/** The parts of chrome.runtime.MessageSender that decide the route. */
type Sender = { id?: string; url?: string; tab?: { id?: number }; frameId?: number };
/** The page's URL without query or fragment ("chrome-extension:" URLs have an opaque origin). */
const exact = (url: string | undefined, expected: string) => !!url && url.split(/[?#]/)[0] === expected;

export function routeMessage(
  request: unknown,
  sender: Sender,
  { runtimeId, pageUrls, badgeUrl }: { runtimeId: string; pageUrls: string[]; badgeUrl: string },
): Route {
  const type = (request as { type?: unknown } | null)?.type;
  if (typeof type !== 'string') return { kind: 'ignore' };
  if (/^(checkout|settings):/.test(type)) {
    // Savings are recorded only by the worker itself, from a one-tap answer in the badge.
    if (type === 'checkout:record-savings') return { kind: 'deny' };
    // Only the extension's own popup and onboarding pages; never a page or content script.
    return sender.id === runtimeId && pageUrls.some((page) => exact(sender.url, page))
      ? { kind: 'page' }
      : { kind: 'deny' };
  }
  if (type.startsWith('badge:')) {
    if (type === 'badge:changed') return { kind: 'ignore' };
    return sender.id === runtimeId &&
      exact(sender.url, badgeUrl) &&
      sender.tab?.id !== undefined &&
      sender.tab.id >= 0 &&
      (sender.frameId ?? 0) > 0
      ? { kind: 'badge', tabId: sender.tab.id }
      : { kind: 'deny' };
  }
  if (type === 'cart:reading' || type === 'order:page') {
    const url = sender.url ?? '';
    return sender.id === runtimeId &&
      url.startsWith('https://') &&
      sender.frameId === 0 &&
      sender.tab?.id !== undefined &&
      sender.tab.id >= 0
      ? { kind: 'content', tabId: sender.tab.id, url }
      : { kind: 'deny' };
  }
  return { kind: 'ignore' };
}
