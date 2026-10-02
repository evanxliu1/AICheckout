// Content script for the automatic badge, declared only for the supported carts' and order pages'
// URL patterns. Built as one small IIFE (no zod, no wallet code). It never makes network requests.
import { merchantForCheckout, merchantForOrderConfirmation } from '../checkout/merchants';
import { readCheckoutPage } from '../checkout/page-reader';
import { startAutoReader } from './auto-reader';
import { createBadgeFrame } from './frame';
import { observeCart } from './observe';

const frame = createBadgeFrame(document, (path) => chrome.runtime.getURL(path));
startAutoReader({
  url: () => location.href,
  initialUrl: () =>
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.name ??
    location.href,
  read: () => readCheckoutPage(document, location.href),
  isCart: (url) => merchantForCheckout(url) !== null && merchantForOrderConfirmation(url) === null,
  isOrderConfirmation: (url) => merchantForOrderConfirmation(url) !== null,
  send: (message) => chrome.runtime.sendMessage(message),
  observe: (onChange) => observeCart(document, onChange),
  frame,
  hidden: () => document.visibilityState === 'hidden',
  onVisibilityChange: (listener) => document.addEventListener('visibilitychange', listener),
  onPageHide: (listener) => window.addEventListener('pagehide', listener, { once: true }),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
});
