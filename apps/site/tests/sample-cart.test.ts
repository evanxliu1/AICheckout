// @vitest-environment jsdom
// The sample cart page must be recognized and read by the extension's cart reader (the same package the
// badge bundles). jsdom has no layout, so the box and visibility rules are covered by the extension's
// browser test (extension/e2e/sample-cart.spec.ts), which loads the built page under the site's headers.
import { expect, it } from 'vitest';
import { cartUrlHint, readCartPage } from '../../../packages/cart-reader/src/index.ts';
import { renderPage } from '../src/render';

const URL = 'https://ai-checkout-api.onrender.com/sample-cart/';

it('is a cart to the detector and reads a certain $100.00 total', () => {
  const { head, body } = renderPage('sample-cart');
  const title = /<title>([^<]+)<\/title>/.exec(head)![1]!;
  document.documentElement.setAttribute('lang', 'en');
  document.title = title;
  document.body.innerHTML = body;
  // The path segment "sample-cart" is not a cart word on its own; the title carries the hint.
  expect(cartUrlHint(URL, title)).toEqual({ url: null, title: 'cart' });
  expect(readCartPage(document, { url: URL })).toEqual({
    detection: { page: 'cart', reason: 'heading-summary' },
    reading: { shown: true, kind: 'estimatedTotal', amountMinor: 10000, currency: 'USD' },
  });
});

it('says it is a sample for testing, is not indexed and has no form', () => {
  const { head, body } = renderPage('sample-cart');
  expect(head).toContain('<meta name="robots" content="noindex" />');
  expect(body).toContain('Sample cart for testing AI Checkout');
  expect(body).not.toMatch(/for sale|<form/i);
  for (const amount of ['$92.59', '$7.41', '$100.00']) expect(body.split(amount)).toHaveLength(2);
});
