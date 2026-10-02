import { describe, expect, it, vi } from 'vitest';
import { DEBOUNCE_MS, MAX_SENDS, startAutoReader } from '../src/badge/auto-reader';
import type { ReaderEnvironment } from '../src/badge/auto-reader';
import { createBadgeFrame, frameMessage } from '../src/badge/frame';
import { observeCart } from '../src/badge/observe';
import type { PageRead } from '../src/checkout/page-reader';

const found = (amountCents: number): PageRead => ({
  status: 'found',
  merchantId: 'best-buy-us',
  currency: 'USD',
  amountCents,
  kind: 'total',
  extractorVersion: 'bestbuy-summary-v1',
});

function environment(overrides: Partial<ReaderEnvironment> = {}) {
  let reading: PageRead = found(2723);
  let url = 'https://www.bestbuy.com/cart';
  let onChange: (() => void) | null = null;
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const visibility: (() => void)[] = [];
  let pageHide: (() => void) | null = null;
  let pageShow: ((persisted: boolean) => void) | null = null;
  let hidden = false;
  let mounted = false;
  const frame = {
    show: vi.fn((nonce?: string) => {
      if (nonce) mounted = true;
    }),
    hide: vi.fn(() => {
      mounted = false;
    }),
    shown: vi.fn(() => mounted),
    expanded: vi.fn(() => false),
  };
  let initial: string | null = null;
  const env: ReaderEnvironment = {
    url: () => url,
    initialUrl: () => initial ?? url,
    read: vi.fn(() => reading),
    isCart: (value) => value.endsWith('/cart'),
    isOrderConfirmation: (value) => value.includes('thank-you'),
    send: vi.fn(async (message) => (message.framed ? { show: true } : { show: true, nonce: 'n'.repeat(32) })),
    observe: vi.fn((callback) => {
      onChange = callback;
      return () => {
        onChange = null;
      };
    }),
    frame,
    hidden: () => hidden,
    onVisibilityChange: (listener) => visibility.push(listener),
    onPageHide: (listener) => {
      pageHide = listener;
    },
    onPageShow: (listener) => {
      pageShow = listener;
    },
    setTimeout: (callback) => {
      timers.set(nextTimer, callback);
      return nextTimer++;
    },
    clearTimeout: (id) => void timers.delete(id),
    ...overrides,
  };
  return {
    env,
    frame,
    setReading: (value: PageRead) => (reading = value),
    setUrl: (value: string) => (url = value),
    setInitialUrl: (value: string) => (initial = value),
    removeFrame: () => (mounted = false),
    mutate: () => onChange?.(),
    observing: () => onChange !== null,
    flush: async () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    pending: () => timers.size,
    setHidden: (value: boolean) => {
      hidden = value;
      visibility.forEach((listener) => listener());
    },
    pageHide: () => pageHide?.(),
    pageShow: (persisted: boolean) => pageShow?.(persisted),
  };
}

describe('automatic cart reader', () => {
  it('reads on load, sends only the adapter reading, and shows the badge when the worker says so', async () => {
    const t = environment();
    startAutoReader(t.env);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.env.send).toHaveBeenCalledWith({ type: 'cart:reading', reading: found(2723), framed: false });
    // A new frame is created with the worker's nonce.
    expect(t.frame.show).toHaveBeenCalledExactlyOnceWith('n'.repeat(32));
  });
  it('throttles DOM changes and re-sends only changed readings', async () => {
    const t = environment();
    startAutoReader(t.env);
    await t.flush();
    for (let i = 0; i < 5; i++) t.mutate();
    expect(t.pending()).toBe(1);
    expect(DEBOUNCE_MS).toBe(500);
    await t.flush();
    expect(t.env.send).toHaveBeenCalledTimes(1);
    t.setReading(found(5446));
    t.mutate();
    await t.flush();
    expect(t.env.send).toHaveBeenLastCalledWith({ type: 'cart:reading', reading: found(5446), framed: true });
  });
  it('keeps observing a page that mutates for minutes, and still follows a quantity change', async () => {
    vi.useFakeTimers();
    try {
      const t = environment({
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (id) => window.clearTimeout(id),
      });
      startAutoReader(t.env);
      // A carousel or timer mutates the page every 100 ms for 90 seconds; the amount never changes.
      for (let ms = 0; ms < 90_000; ms += 100) {
        t.mutate();
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(t.env.send).toHaveBeenCalledTimes(1);
      expect(t.observing()).toBe(true);
      t.setReading(found(5446));
      t.mutate();
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(t.env.send).toHaveBeenLastCalledWith({
        type: 'cart:reading',
        reading: found(5446),
        framed: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops after a bound of changed readings', async () => {
    const t = environment();
    const reader = startAutoReader(t.env);
    await t.flush();
    for (let i = 0; i < MAX_SENDS + 5; i++) {
      t.setReading(found(1000 + i));
      t.mutate();
      await t.flush();
    }
    expect(reader.sends()).toBe(MAX_SENDS + 1);
    expect(t.observing()).toBe(false);
  });
  it('asks for a new frame when the page removed the badge', async () => {
    const t = environment();
    startAutoReader(t.env);
    await t.flush();
    t.removeFrame();
    t.mutate();
    await t.flush();
    expect(t.env.send).toHaveBeenLastCalledWith({
      type: 'cart:reading',
      reading: found(2723),
      framed: false,
    });
    expect(t.frame.show).toHaveBeenCalledTimes(2);
  });
  it('hides the badge on an unreadable cart unless the shopper has the panel open', async () => {
    const t = environment();
    t.env.send = vi.fn(async () => ({ show: false }));
    startAutoReader(t.env);
    await t.flush();
    expect(t.frame.hide).toHaveBeenCalledTimes(1);
    t.frame.expanded.mockReturnValue(true);
    t.setReading({ status: 'unavailable', reason: 'page-loading' });
    t.mutate();
    await t.flush();
    expect(t.frame.hide).toHaveBeenCalledTimes(1);
  });
  it('does nothing on other pages, and on an order page only asks the worker (the page is never read)', async () => {
    const other = environment();
    other.setUrl('https://www.bestbuy.com/site/some-product');
    startAutoReader(other.env);
    expect(other.env.read).not.toHaveBeenCalled();
    expect(other.env.observe).not.toHaveBeenCalled();
    expect(other.env.send).not.toHaveBeenCalled();
    const order = environment();
    order.setUrl('https://www.bestbuy.com/checkout/r/thank-you');
    startAutoReader(order.env);
    await order.flush();
    expect(order.env.send).toHaveBeenCalledWith({ type: 'order:page', framed: false });
    expect(order.env.read).not.toHaveBeenCalled();
    expect(order.env.observe).not.toHaveBeenCalled();
    expect(order.frame.show).toHaveBeenCalledOnce();
    // An in-page navigation to an order URL (not the document's own URL) does not count.
    const pushed = environment();
    pushed.setInitialUrl('https://www.bestbuy.com/checkout/r/payment');
    pushed.setUrl('https://www.bestbuy.com/checkout/r/thank-you');
    startAutoReader(pushed.env);
    await pushed.flush();
    expect(pushed.env.send).not.toHaveBeenCalled();
  });
  it('stops observing while hidden or after page hide, and leaves a cart reached by in-page navigation', async () => {
    const t = environment();
    startAutoReader(t.env);
    await t.flush();
    t.setHidden(true);
    expect(t.observing()).toBe(false);
    t.setHidden(false);
    expect(t.observing()).toBe(true);
    t.setUrl('https://www.bestbuy.com/site/other');
    t.mutate();
    await t.flush();
    expect(t.frame.hide).toHaveBeenCalled();
    expect(t.observing()).toBe(false);
    const u = environment();
    startAutoReader(u.env);
    u.pageHide();
    expect(u.observing()).toBe(false);
  });
});

describe('back/forward cache', () => {
  it('pauses on pagehide and resumes on a restore, re-sending the reading', async () => {
    const t = environment();
    startAutoReader(t.env);
    await t.flush();
    expect(t.env.send).toHaveBeenCalledTimes(1);
    t.pageHide();
    expect(t.observing()).toBe(false);
    t.mutate();
    await t.flush();
    expect(t.env.send).toHaveBeenCalledTimes(1);
    t.pageShow(false); // an ordinary pageshow (not from the cache) changes nothing
    expect(t.observing()).toBe(false);
    t.pageShow(true);
    await t.flush();
    expect(t.observing()).toBe(true);
    expect(t.env.send).toHaveBeenCalledTimes(2);
    t.setReading(found(5446));
    t.mutate();
    await t.flush();
    expect(t.env.send).toHaveBeenLastCalledWith({ type: 'cart:reading', reading: found(5446), framed: true });
  });
});

describe('badge frame host', () => {
  it('accepts only size and hide messages of the exact shape', () => {
    expect(frameMessage({ source: 'ai-checkout-badge', type: 'hide' })).toEqual({
      source: 'ai-checkout-badge',
      type: 'hide',
    });
    expect(
      frameMessage({ source: 'ai-checkout-badge', type: 'size', width: 300, height: 48, expanded: false }),
    ).toBeTruthy();
    for (const bad of [
      null,
      'hide',
      { source: 'other', type: 'hide' },
      { source: 'ai-checkout-badge', type: 'hide', card: 'Double Cash' },
      { source: 'ai-checkout-badge', type: 'size', width: -1, height: 48, expanded: false },
      { source: 'ai-checkout-badge', type: 'size', width: 300, height: Infinity, expanded: false },
      { source: 'ai-checkout-badge', type: 'size', width: 300, height: 48 },
      { source: 'ai-checkout-badge', type: 'navigate', url: 'https://example.com' },
    ])
      expect(frameMessage(bad)).toBeNull();
  });
  it('puts the extension iframe inside a closed shadow root outside <body>, and ignores page messages', () => {
    const frame = createBadgeFrame(document, (path) => `chrome-extension://ext/${path}`);
    frame.show();
    expect(document.querySelector('ai-checkout-badge')).toBeNull(); // no nonce, no frame
    frame.show('n'.repeat(32));
    expect(frame.shown()).toBe(true);
    const host = document.documentElement.lastElementChild as HTMLElement;
    expect(host.tagName.toLowerCase()).toBe('ai-checkout-badge');
    expect(host.shadowRoot).toBeNull();
    expect(document.body.contains(host)).toBe(false);
    expect(document.querySelector('iframe')).toBeNull();
    // A page script posting a size message is ignored (wrong source window and origin).
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'ai-checkout-badge', type: 'size', width: 300, height: 48, expanded: true },
        origin: location.origin,
      }),
    );
    expect(frame.expanded()).toBe(false);
    // A page that removes the host gets a new one on the next show.
    host.remove();
    expect(frame.shown()).toBe(false);
    frame.show('m'.repeat(32));
    expect(frame.shown()).toBe(true);
    frame.hide();
    expect(document.querySelector('ai-checkout-badge')).toBeNull();
  });
});

describe('cart observer', () => {
  it('notices the page removing the badge host from <html>, not only <body> changes', async () => {
    const frame = createBadgeFrame(document, (path) => `chrome-extension://ext/${path}`);
    frame.show('n'.repeat(32));
    const onChange = vi.fn();
    const stop = observeCart(document, onChange);
    document.querySelector('ai-checkout-badge')!.remove();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalled();
    expect(frame.shown()).toBe(false);
    onChange.mockClear();
    document.body.append(document.createElement('p'));
    await Promise.resolve();
    expect(onChange).toHaveBeenCalled();
    stop();
    onChange.mockClear();
    document.body.append(document.createElement('p'));
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });
});
