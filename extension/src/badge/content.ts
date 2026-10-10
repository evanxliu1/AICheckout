// Content script for the automatic badge, declared for every https page (Phase 13c). Built as one
// small IIFE (no zod, no wallet code). It never makes network requests. On a page whose URL and title
// carry no cart or checkout word it reads nothing and observes nothing.
import { cartUrlHint } from '@ai-checkout/cart-reader';
import { merchantForCheckout, merchantForOrderConfirmation } from '../checkout/merchants';
import { readAnyCart } from '../checkout/manual-reader';
import { startAutoReader } from './auto-reader';
import type { PageMode } from './auto-reader';
import { createBadgeFrame } from './frame';
import { observeCart } from './observe';

const frame = createBadgeFrame(document, (path) => chrome.runtime.getURL(path));
const mode = (url: string): PageMode =>
  merchantForOrderConfirmation(url)
    ? 'order'
    : merchantForCheckout(url)
      ? 'legacy'
      : cartUrlHint(url, document.title)
        ? 'generic'
        : 'none';
startAutoReader({
  url: () => location.href,
  initialUrl: () =>
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.name ??
    location.href,
  mode,
  read: () => readAnyCart(document, location.href),
  send: (message) => chrome.runtime.sendMessage(message),
  observe: (onChange) => observeCart(document, onChange),
  frame,
  hidden: () => document.visibilityState === 'hidden',
  onVisibilityChange: (listener) => document.addEventListener('visibilitychange', listener),
  onPageHide: (listener) => window.addEventListener('pagehide', listener),
  onPageShow: (listener) => window.addEventListener('pageshow', (event) => listener(event.persisted)),
  onNavigate: (listener) => {
    // The Navigation API (Chrome 102+) reports every same-document navigation, history.pushState
    // and replaceState included; popstate and hashchange are the fallback.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    if (navigation) navigation.addEventListener('currententrychange', listener);
    else {
      window.addEventListener('popstate', listener);
      window.addEventListener('hashchange', listener);
    }
  },
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
});
