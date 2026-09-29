import { beforeEach, describe, expect, it } from 'vitest';
import subtotal from './fixtures/newegg-observed-subtotal.html?raw';
import quantity from './fixtures/newegg-observed-quantity.html?raw';
import empty from './fixtures/newegg-observed-empty.html?raw';
import { readCheckoutPage } from '../src/checkout/page-reader';
import { merchantForCheckout } from '../src/checkout/merchants';
import { probeSchema } from '../src/checkout/contracts';

const url = 'https://secure.newegg.com/shop/cart';
const read = () => readCheckoutPage(document, url);
const totalCell = () => document.querySelector('.summary-content-total > span')!;
beforeEach(() => {
  document.body.innerHTML = subtotal;
});

describe('observed Newegg summary boundary', () => {
  it('keeps the observed subtotal distinct from a TBD estimated total and ignores gift counts', () => {
    expect(read()).toEqual({
      status: 'found',
      merchantId: 'newegg-us',
      currency: 'USD',
      amountCents: 24999,
      kind: 'subtotal',
      extractorVersion: 'newegg-summary-v1',
    });
    document.body.innerHTML = quantity;
    expect(read()).toMatchObject({ amountCents: 49998, kind: 'subtotal' });
    document.querySelector('.row-title-note')!.textContent = '(999 selected)';
    expect(read()).toMatchObject({ amountCents: 49998 });
  });
  it('recognizes the observed empty state without consulting recommended product prices', () => {
    document.body.innerHTML = empty + '<p>Top selling item: $1,099.99</p>';
    expect(read()).toEqual({ status: 'unavailable', reason: 'empty-cart' });
  });
  it('labels a synthetic numeric estimated total explicitly', () => {
    totalCell().textContent = '$271.87';
    expect(read()).toMatchObject({ amountCents: 27187, kind: 'estimated-total' });
  });
  it.each(['Calculating…', '', '249.99', '$24.99 / month', '$1,00.00', '$100000.01'])(
    'never treats malformed total %s as TBD',
    (value) => {
      totalCell().textContent = value;
      expect(read()).toMatchObject({ status: 'unavailable', reason: 'ambiguous-amount' });
    },
  );
  it.each(['CAD $249.99', '€249.99', 'A$249.99'])('rejects non-USD totals %s', (value) => {
    totalCell().textContent = value;
    expect(read()).toMatchObject({ reason: 'unsupported-currency' });
  });
  it('requires both observed amount rows, rejects duplicates and loading state', () => {
    document.querySelector('.summary-content-total')!.remove();
    expect(read()).toMatchObject({ reason: 'summary-missing' });
    document.body.innerHTML = subtotal;
    document
      .querySelector('.summary-content-total')!
      .insertAdjacentHTML('afterend', '<li><label>Est. Total</label><span>TBD</span></li>');
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
    document.body.innerHTML = subtotal;
    totalCell().setAttribute('aria-busy', 'true');
    expect(read()).toMatchObject({ reason: 'page-loading' });
  });
  it('ignores hidden duplicates but rejects conflicting visible summaries or total states', () => {
    document.body.innerHTML += `<div hidden>${quantity}</div>`;
    expect(read()).toMatchObject({ amountCents: 24999 });
    document.body.innerHTML += subtotal;
    expect(read()).toMatchObject({ amountCents: 24999 });
    totalCell().textContent = '$249.99';
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
    document.body.innerHTML = subtotal + quantity;
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it('does not inspect address text, form values, product prices, or embedded data', () => {
    document.querySelector('[data-name=delivery-address]')!.textContent = 'Private address, $1000';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<input value="secret $100"><p>Total $999.99</p><script type="application/json">{"total": 99999}</script>',
    );
    expect(read()).toMatchObject({ amountCents: 24999, kind: 'subtotal' });
    expect(probeSchema.parse({ url, reading: read() }).reading).toEqual(read());
  });
  it('bounds cells and rows', () => {
    totalCell().innerHTML = '<b>T</b>'.repeat(81);
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
    document.body.innerHTML = subtotal;
    document.querySelector('.summary-content > ul')!.innerHTML +=
      '<li><label>Other</label><span>0</span></li>'.repeat(30);
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it.each([
    'https://www.newegg.com/shop/cart',
    'https://secure.newegg.ca/shop/cart',
    'https://secure.newegg.com.attacker.test/shop/cart',
    'https://secure.newegg.com/shop/checkout',
    'https://secure.newegg.com/shop/cart/extra',
    'http://secure.newegg.com/shop/cart',
    'https://secure.newegg.com:444/shop/cart',
    'https://user:pass@secure.newegg.com/shop/cart',
  ])('rejects unobserved or unsafe URL %s', (raw) => {
    expect(merchantForCheckout(raw)).toBeNull();
    expect(readCheckoutPage(document, raw)).toMatchObject({ reason: 'unsupported-page' });
  });
});
