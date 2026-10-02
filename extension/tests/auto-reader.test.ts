import { describe, expect, it, vi } from 'vitest';
import { DEBOUNCE_MS, MAX_READS, startAutoReader } from '../src/badge/auto-reader';
import type { ReaderEnvironment } from '../src/badge/auto-reader';
import { createBadgeFrame, frameMessage } from '../src/badge/frame';
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
  let hidden = false;
  const frame = { show: vi.fn(), hide: vi.fn(), expanded: vi.fn(() => false) };
  const env: ReaderEnvironment = {
    url: () => url,
    read: vi.fn(() => reading),
    isCart: (value) => value.endsWith('/cart'),
    isOrderConfirmation: (value) => value.includes('thank-you'),
    send: vi.fn(async () => ({ show: true })),
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
  };
}

describe('automatic cart reader', () => {
  it('reads on load, sends only the adapter reading, and shows the badge when the worker says so', async () => {
    const t = environment();
    startAutoReader(t.env);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.env.send).toHaveBeenCalledWith({ type: 'cart:reading', reading: found(2723) });
    expect(t.frame.show).toHaveBeenCalledOnce();
  });
  it('debounces DOM changes, re-sends only when the reading changes, and stops after a bound', async () => {
    const t = environment();
    const reader = startAutoReader(t.env);
    await t.flush();
    for (let i = 0; i < 5; i++) t.mutate();
    expect(t.pending()).toBe(1);
    expect(DEBOUNCE_MS).toBe(500);
    await t.flush();
    expect(t.env.send).toHaveBeenCalledTimes(1);
    t.setReading(found(5446));
    t.mutate();
    await t.flush();
    expect(t.env.send).toHaveBeenLastCalledWith({ type: 'cart:reading', reading: found(5446) });
    for (let i = 0; i < MAX_READS + 5; i++) {
      t.mutate();
      await t.flush();
    }
    expect(reader.reads()).toBe(MAX_READS + 1);
    expect(t.observing()).toBe(false);
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
    expect(order.env.send).toHaveBeenCalledWith({ type: 'order:page' });
    expect(order.env.read).not.toHaveBeenCalled();
    expect(order.env.observe).not.toHaveBeenCalled();
    expect(order.frame.show).toHaveBeenCalledOnce();
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
    frame.hide();
    expect(document.documentElement.contains(host)).toBe(false);
  });
});
