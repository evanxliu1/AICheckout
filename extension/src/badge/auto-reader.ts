// The automatic cart reader, kept free of DOM globals so it can be tested: the content script
// passes in the page, the messaging and the frame. It reads the order summary through the generic
// detector and reader on every hinted page (Phase 13c; the only reader since Phase 15.1), sends only
// the reading, and learns only whether to show the badge.
import type { PageKind } from '@ai-checkout/cart-reader';
import type { ManualRead } from '../checkout/manual-reader';

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
export type ReaderMessage = { type: 'cart:reading'; reading: ManualRead; framed: boolean };
/** Which reader a URL gets: the generic detector (the URL or title carries a cart or checkout word), or
 * none (no DOM is read and nothing is observed). */
export type PageMode = 'generic' | 'none';
export interface ReaderEnvironment {
  url(): string;
  mode(url: string): PageMode;
  /** One pass: the detector's verdict and the reading. */
  read(): { page: PageKind; reading: ManualRead };
  send(message: ReaderMessage): Promise<{ show?: unknown; nonce?: unknown } | undefined>;
  /** Calls back on summary-relevant DOM changes; returns a disconnect function. */
  observe(onChange: () => void): () => void;
  frame: BadgeFrameControl;
  hidden(): boolean;
  onVisibilityChange(listener: () => void): void;
  onPageHide(listener: () => void): void;
  /** `persisted`: the page came back from the back/forward cache. */
  onPageShow(listener: (persisted: boolean) => void): void;
  /** Same-document navigations (history push or replace, hash change, traversal). */
  onNavigate(listener: () => void): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const key = (reading: ManualRead) =>
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
  let stopped = false;
  let sends = 0,
    lastKey = '',
    /** The worker's last answer: the badge should be showing. */
    wanted = false,
    /** Between pagehide and a back/forward-cache restore. */
    paused = false,
    timer: number | null = null,
    disconnect: (() => void) | null = null;
  function stop() {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    disconnect?.();
    disconnect = null;
  }
  /** The reader is on a page that gets a reader (a hinted page). */
  const active = () => env.mode(env.url()) === 'generic';
  function connect() {
    if (!stopped && !paused && !disconnect && active()) disconnect = env.observe(schedule);
  }
  /** Not a cart: hide the badge, forget the reading and stop observing until the next navigation. */
  function leave() {
    env.frame.hide();
    lastKey = '';
    wanted = false;
    disconnect?.();
    disconnect = null;
  }
  function check() {
    timer = null;
    if (stopped || paused || env.hidden()) return;
    if (!active()) {
      // A single-page navigation left the cart (or never reached one): no DOM is read.
      leave();
      return;
    }
    connect();
    const { page, reading } = env.read();
    if (page === 'none') {
      // A hinted page the detector does not recognise (a drawer, an empty cart): nothing is sent.
      leave();
      connect();
      return;
    }
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
    if (stopped || paused || timer !== null) return;
    timer = env.setTimeout(check, DEBOUNCE_MS);
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
  // Leaving the page pauses the reader; a back/forward-cache restore resumes it and re-sends the
  // reading (navigation cleared it in the worker).
  env.onPageHide(() => {
    if (stopped) return;
    paused = true;
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    disconnect?.();
    disconnect = null;
  });
  env.onPageShow((persisted) => {
    if (!persisted || !paused || stopped) return;
    paused = false;
    lastKey = '';
    connect();
    check();
  });
  // Moving into or out of a cart without a reload: the page renders after the URL changes, so the
  // check waits one debounce (a hinted page then keeps its observer; an unhinted one has none).
  env.onNavigate(schedule);
  if (active()) {
    check();
    connect();
  }
  return { stop, sends: () => sends };
}
