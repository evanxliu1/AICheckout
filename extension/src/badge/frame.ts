// The badge's place in the merchant page: a host element with a closed shadow root that holds
// the extension's own iframe. Page scripts can see the host but not inside it, and the iframe is
// cross-origin, so card names never enter the page. The only messages accepted from the iframe
// are its size and a request to hide, checked by source window, origin and shape.
import { BADGE_MESSAGE_SOURCE, BADGE_PAGE } from './pages';

const MARGIN = 16;
type FrameMessage =
  | { source: typeof BADGE_MESSAGE_SOURCE; type: 'size'; width: number; height: number; expanded: boolean }
  | { source: typeof BADGE_MESSAGE_SOURCE; type: 'hide' };

function frameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (value.source !== BADGE_MESSAGE_SOURCE) return null;
  if (value.type === 'hide' && Object.keys(value).length === 2) return value as FrameMessage;
  if (
    value.type === 'size' &&
    Object.keys(value).length === 5 &&
    typeof value.expanded === 'boolean' &&
    [value.width, value.height].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 4000,
    )
  )
    return value as FrameMessage;
  return null;
}

export function createBadgeFrame(doc: Document, getUrl: (path: string) => string) {
  const win = doc.defaultView!;
  const src = getUrl(BADGE_PAGE);
  const origin = new URL(src).origin;
  let host: HTMLElement | null = null,
    frame: HTMLIFrameElement | null = null,
    expanded = false;

  const important = (element: HTMLElement, styles: Record<string, string>) => {
    for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value, 'important');
  };
  function resize(width: number, height: number) {
    if (!frame) return;
    important(frame, {
      width: `${Math.min(Math.ceil(width), win.innerWidth - 2 * MARGIN)}px`,
      height: `${Math.min(Math.ceil(height), win.innerHeight - 2 * MARGIN)}px`,
      visibility: 'visible',
    });
  }
  function onMessage(event: MessageEvent) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
    const message = frameMessage(event.data);
    if (!message) return;
    if (message.type === 'hide') hide();
    else {
      expanded = message.expanded;
      resize(message.width, message.height);
    }
  }
  function show() {
    if (host) return;
    // A custom element name: generic page selectors such as `div { … }` do not match it, and the
    // styles below are inline !important, so page CSS cannot hide or move the badge.
    host = doc.createElement('ai-checkout-badge');
    important(host, {
      all: 'initial',
      position: 'fixed',
      right: `${MARGIN}px`,
      bottom: `${MARGIN}px`,
      'z-index': '2147483647',
      display: 'block',
    });
    const root = host.attachShadow({ mode: 'closed' });
    frame = doc.createElement('iframe');
    frame.src = src;
    frame.title = 'AI Checkout';
    important(frame, {
      border: '0',
      display: 'block',
      width: '1px',
      height: '1px',
      visibility: 'hidden',
      'color-scheme': 'light',
      background: 'transparent',
    });
    root.append(frame);
    win.addEventListener('message', onMessage);
    // Outside <body>, so the cart observer never sees the badge's own changes.
    doc.documentElement.append(host);
  }
  function hide() {
    win.removeEventListener('message', onMessage);
    host?.remove();
    host = null;
    frame = null;
    expanded = false;
  }
  return { show, hide, expanded: () => expanded, frameMessage };
}
export { frameMessage };
