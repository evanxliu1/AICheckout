import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readAnyCart, readManualCart } from '../src/checkout/manual-reader';

let throwNext = false;
vi.mock('@ai-checkout/cart-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ai-checkout/cart-reader')>();
  return {
    ...actual,
    readCartPage: (...args: Parameters<typeof actual.readCartPage>) => {
      if (throwNext) throw new Error('reader bug');
      return actual.readCartPage(...args);
    },
  };
});

// Synthetic pages only (no store text); jsdom has no layout, so the reader's box checks are the
// harness's business (evals/reader/). These cover the Phase 13b split and mapping, and since Phase
// 13c the detector in front of the generic reader (`readCartPage`: the URL or title must hint at a cart).
function page(body: string, url: string) {
  document.head.innerHTML = '';
  document.title = '';
  document.body.innerHTML = body;
  return readManualCart(document, url);
}
const row = (label: string, amount: string) => `<div><span>${label}</span><span>${amount}</span></div>`;
const summary = (inner: string) => `<section>${inner}<button>Checkout</button></section>`;
const store = 'https://shop.example.com/checkout';

describe('manual reader (Phase 13b)', () => {
  it('maps a shown USD total to a generic reading at the tab’s store', () => {
    const r = page(
      summary(row('Subtotal', '$90.00') + row('Shipping', '$10.00') + row('Order total', '$100.00')),
      store,
    );
    expect(r).toEqual({
      status: 'found',
      merchantId: 'generic-us-online',
      currency: 'USD',
      amountCents: 10000,
      kind: 'estimated-total',
      extractorVersion: 'generic-reader-v1',
    });
  });
  it('maps the reader’s kinds: afterCredit → total, subtotal → subtotal', () => {
    expect(
      page(
        summary(
          row('Total', '$50.00') + row('Gift card', '-$10.00') + row('Total after gift card', '$40.00'),
        ),
        store,
      ),
    ).toMatchObject({ status: 'found', kind: 'total', amountCents: 4000 });
    expect(page(summary(row('Subtotal (1 item)', '$65')), store)).toMatchObject({
      status: 'found',
      kind: 'subtotal',
      amountCents: 6500,
    });
  });
  it('reports another currency as unsupported and fills nothing', () => {
    expect(page(summary(row('Subtotal', '€90.00') + row('Total', '€100.00')), store)).toEqual({
      status: 'unavailable',
      reason: 'unsupported-currency',
    });
  });
  it('withholds when the reader withholds (no summary, ambiguous totals) and when the total is zero', () => {
    // A checkout URL with no summary rows or line items is not a cart page to the detector (Phase 13c).
    expect(page('<p>Order total $100.00</p>', store)).toEqual({
      status: 'unavailable',
      reason: 'not-a-cart',
    });
    expect(page(summary(row('Total', '$100.00') + row('Total', '$120.00')), store)).toEqual({
      status: 'unavailable',
      reason: 'withheld',
    });
    expect(page(summary(row('Total', '$0.00')), store)).toEqual({
      status: 'unavailable',
      reason: 'empty-cart',
    });
  });
  it('names a legacy site’s store for a generic reading of its other (hinted) pages', () => {
    expect(page(summary(row('Total', '$100.00')), 'https://www.bestbuy.com/site/basket')).toMatchObject({
      status: 'found',
      merchantId: 'best-buy-us',
      extractorVersion: 'generic-reader-v1',
    });
  });
  it('withholds on a page the detector does not recognise as a cart (Phase 13c)', () => {
    // No cart word in the URL or title: no DOM is read, nothing is shown, nothing is asked.
    document.title = 'Leather bag';
    document.body.innerHTML = summary(row('Total', '$100.00'));
    expect(readAnyCart(document, 'https://shop.example.com/products/leather-bag')).toEqual({
      page: 'none',
      reading: { status: 'unavailable', reason: 'not-a-cart' },
    });
    // A hinted page the detector still calls none (a cart title over a product heading) is not-a-cart either,
    // even when a drawer shows a euro total: the page is not the cart.
    document.title = 'Cart';
    document.body.innerHTML = `<main><h1>Leather bag</h1></main><aside>${summary(row('Total', '€100.00'))}</aside>`;
    expect(readManualCart(document, 'https://shop.example.com/products/leather-bag')).toEqual({
      status: 'unavailable',
      reason: 'not-a-cart',
    });
    // A hinted URL whose page shows an empty cart: `empty-cart`, which hides the badge.
    expect(
      page(`<h1>Your cart</h1>${summary(row('Total', '$0.00'))}`, 'https://shop.example.com/cart'),
    ).toEqual({
      status: 'unavailable',
      reason: 'empty-cart',
    });
    // A legacy cart URL reports `legacy`, the adapter's reading untouched.
    expect(readAnyCart(document, 'https://www.bestbuy.com/cart').page).toBe('legacy');
  });
  it('runs the legacy adapter first on its cart pages', () => {
    const fixture = readFileSync('tests/fixtures/bestbuy-observed-summary.html', 'utf8');
    expect(page(fixture, 'https://www.bestbuy.com/cart')).toMatchObject({
      status: 'found',
      merchantId: 'best-buy-us',
      amountCents: 2723,
      extractorVersion: 'bestbuy-summary-v1',
    });
    // A generic-looking summary on a legacy cart URL is the adapter's call, not the generic reader's.
    expect(page(summary(row('Total', '$100.00')), 'https://www.bestbuy.com/cart')).toMatchObject({
      status: 'unavailable',
    });
  });
  it('withholds when the reader throws', () => {
    throwNext = true;
    try {
      expect(page(summary(row('Total', '$100.00')), store)).toEqual({
        status: 'unavailable',
        reason: 'withheld',
      });
    } finally {
      throwNext = false;
    }
  });
  it('reports a dollar total on a .ca storefront as another currency (storefront rule)', () => {
    expect(
      page(summary(row('Subtotal', '$90.00') + row('Total', '$100.00')), 'https://www.bestbuy.ca/cart'),
    ).toEqual({ status: 'unavailable', reason: 'unsupported-currency' });
  });
  it('reads nothing on a non-web page', () => {
    expect(page(summary(row('Total', '$100.00')), 'chrome://extensions/')).toEqual({
      status: 'unavailable',
      reason: 'unsupported-page',
    });
  });
});
