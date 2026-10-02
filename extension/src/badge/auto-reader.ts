// The automatic cart reader, kept free of DOM globals so it can be tested: the content script
// passes in the page, the messaging and the frame. It reads the order summary through the bundled
// adapter (never anything else), sends only the reading, and learns only whether to show the badge.
import type { PageRead } from '../checkout/page-reader';

/** At most one summary read per interval, however often the page changes (a throttle). */
export const DEBOUNCE_MS = 500;
/** Changed readings sent per page load. Unchanged reads are free, so a page that mutates
 * constantly keeps being observed; one whose amount keeps changing stops after this many. */
export const MAX_SENDS = 120;

export interface BadgeFrameControl {
  /** Creates the frame with the worker's nonce (or keeps an existing one). */
  show(nonce?: string): void;
  hide(): void;
  /** The frame exists and is still in the page. */
  shown(): boolean;
  /** The shopper has the panel open: keep it while the cart is briefly unreadable. */
  expanded(): boolean;
}
export type ReaderMessage =
  { type: 'cart:reading'; reading: PageRead; framed: boolean } | { type: 'order:page'; framed: boolean };
export interface ReaderEnvironment {
  url(): string;
  /** The document's own URL when it loaded (in-page navigation changes url() but not this). */
  initialUrl(): string;
  read(): PageRead;
  isCart(url: string): boolean;
  isOrderConfirmation(url: string): boolean;
  send(message: ReaderMessage): Promise<{ show?: unknown; nonce?: unknown } | undefined>;
  /** Calls back on summary-relevant DOM changes; returns a disconnect function. */
  observe(onChange: () => void): () => void;
  frame: BadgeFrameControl;
  hidden(): boolean;
  onVisibilityChange(listener: () => void): void;
  onPageHide(listener: () => void): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const key = (reading: PageRead) =>
  reading.status === 'found'
    ? `found:${reading.merchantId}:${reading.amountCents}:${reading.kind}:${reading.extractorVersion}`
    : `unavailable:${reading.reason}`;
/** Show with the worker's nonce for a new frame; an existing frame keeps its own. */
function apply(frame: BadgeFrameControl, reply: { show?: unknown; nonce?: unknown } | undefined) {
  if (reply?.show !== true) return false;
  if (typeof reply.nonce === 'string') frame.show(reply.nonce);
  return true;
}

export function startAutoReader(env: ReaderEnvironment) {
  const startUrl = env.url();
  let stopped = false;
  if (env.isOrderConfirmation(startUrl)) {
    // URL-only order detection: the page is never read. Only a document that loaded at the order
    // URL counts, not an in-page navigation to it; the worker decides whether to ask.
    if (env.initialUrl() !== startUrl) return { stop: () => void (stopped = true), sends: () => 0 };
    void env
      .send({ type: 'order:page', framed: env.frame.shown() })
      .then((reply) => {
        if (!stopped) apply(env.frame, reply);
      })
      .catch(() => undefined);
    return { stop: () => void (stopped = true), sends: () => 0 };
  }
  if (!env.isCart(startUrl)) return { stop: () => void (stopped = true), sends: () => 0 };

  let sends = 0,
    lastKey = '',
    /** The worker's last answer: the badge should be showing. */
    wanted = false,
    timer: number | null = null,
    disconnect: (() => void) | null = null;
  function stop() {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    disconnect?.();
    disconnect = null;
  }
  function check() {
    timer = null;
    if (stopped || env.hidden()) return;
    if (!env.isCart(env.url())) {
      // A single-page navigation left the cart.
      env.frame.hide();
      stop();
      return;
    }
    const reading = env.read();
    const next = key(reading);
    // An unchanged reading is not re-sent, unless the page removed a frame that should show.
    if (next === lastKey && !(wanted && !env.frame.shown())) return;
    if (++sends > MAX_SENDS) {
      stop();
      return;
    }
    lastKey = next;
    void env
      .send({ type: 'cart:reading', reading, framed: env.frame.shown() })
      .then((reply) => {
        if (stopped || lastKey !== next) return;
        wanted = apply(env.frame, reply);
        if (wanted) return;
        if (!(reading.status === 'unavailable' && env.frame.expanded())) env.frame.hide();
      })
      .catch(() => undefined);
  }
  function schedule() {
    if (stopped || timer !== null) return;
    timer = env.setTimeout(check, DEBOUNCE_MS);
  }
  function connect() {
    if (!stopped && !disconnect) disconnect = env.observe(schedule);
  }
  env.onVisibilityChange(() => {
    if (stopped) return;
    if (env.hidden()) {
      disconnect?.();
      disconnect = null;
    } else {
      connect();
      schedule();
    }
  });
  env.onPageHide(stop);
  check();
  connect();
  return { stop, sends: () => sends };
}
