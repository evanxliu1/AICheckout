// The automatic cart reader, kept free of DOM globals so it can be tested: the content script
// passes in the page, the messaging and the frame. It reads the order summary through the bundled
// adapter (never anything else), sends only the reading, and learns only whether to show the badge.
import type { PageRead } from '../checkout/page-reader';

export const DEBOUNCE_MS = 500;
/** Readings per page load; a page that keeps changing stops being observed after this many. */
export const MAX_READS = 120;

export interface BadgeFrameControl {
  show(): void;
  hide(): void;
  /** The shopper has the panel open: keep it while the cart is briefly unreadable. */
  expanded(): boolean;
}
export interface ReaderEnvironment {
  url(): string;
  read(): PageRead;
  isCart(url: string): boolean;
  isOrderConfirmation(url: string): boolean;
  send(
    message: { type: 'cart:reading'; reading: PageRead } | { type: 'order:page' },
  ): Promise<{ show?: unknown } | undefined>;
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

export function startAutoReader(env: ReaderEnvironment) {
  const startUrl = env.url();
  let stopped = false;
  if (env.isOrderConfirmation(startUrl)) {
    // URL-only order detection: the page is never read. The worker decides whether to ask.
    void env
      .send({ type: 'order:page' })
      .then((reply) => {
        if (!stopped && reply?.show === true) env.frame.show();
      })
      .catch(() => undefined);
    return { stop: () => void (stopped = true), reads: () => 0 };
  }
  if (!env.isCart(startUrl)) return { stop: () => void (stopped = true), reads: () => 0 };

  let reads = 0,
    lastKey = '',
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
    if (++reads > MAX_READS) {
      stop();
      return;
    }
    const reading = env.read();
    const next = key(reading);
    if (next === lastKey) return;
    lastKey = next;
    void env
      .send({ type: 'cart:reading', reading })
      .then((reply) => {
        if (stopped || lastKey !== next) return;
        if (reply?.show === true) env.frame.show();
        else if (!(reading.status === 'unavailable' && env.frame.expanded())) env.frame.hide();
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
  return { stop, reads: () => reads };
}
