import { beforeEach, describe, expect, it } from 'vitest';
import subtotal from './fixtures/amazon-observed-subtotal.html?raw';
import quantity from './fixtures/amazon-observed-quantity.html?raw';
import empty from './fixtures/amazon-observed-empty.html?raw';
import { readCheckoutPage } from '../src/checkout/page-reader';
import { merchantForCheckout } from '../src/checkout/merchants';
import { probeSchema } from '../src/checkout/contracts';

const url = 'https://www.amazon.com/gp/cart/view.html';
const read = () => readCheckoutPage(document, url);
const amountCell = () => document.querySelector('#sc-subtotal-amount-buybox')!;
const labelCell = () => document.querySelector('#sc-subtotal-label-buybox')!;
beforeEach(() => {
  document.body.innerHTML = subtotal;
});

describe('observed Amazon US cart summary', () => {
  it('reads the buy-box subtotal and never the offer banner or item price', () => {
    expect(read()).toEqual({
      status: 'found',
      merchantId: 'amazon-us',
      currency: 'USD',
      amountCents: 649,
      kind: 'subtotal',
      extractorVersion: 'amazon-summary-v1',
    });
    expect(probeSchema.parse({ url, reading: read() }).reading).toEqual(read());
    document.querySelector('#sc-new-upsell td:last-child')!.textContent = '$999.99';
    expect(read()).toMatchObject({ amountCents: 649 });
  });
  it('follows a quantity change', () => {
    document.body.innerHTML = quantity;
    expect(read()).toMatchObject({ amountCents: 1298, kind: 'subtotal' });
  });
  it('recognizes the observed empty cart without consulting other prices', () => {
    document.body.innerHTML = empty + '<p>Subtotal: $19.99</p>';
    expect(read()).toEqual({ status: 'unavailable', reason: 'empty-cart' });
  });
  it('reports loading while a quantity update spins or the buy box is busy', () => {
    document
      .querySelector('.a-stepper-controls')!
      .insertAdjacentHTML('beforeend', '<span class="a-spinner a-spinner-small"></span>');
    expect(read()).toMatchObject({ reason: 'page-loading' });
    document.body.innerHTML = subtotal;
    document.querySelector('.sc-sss-spinner-box')!.classList.remove('sc-hidden');
    expect(read()).toMatchObject({ reason: 'page-loading' });
    document.body.innerHTML = subtotal;
    document.querySelector('#sc-buy-box')!.setAttribute('aria-busy', 'true');
    expect(read()).toMatchObject({ reason: 'page-loading' });
  });
  it('treats unexpected labels, amounts and duplicates as ambiguous or missing', () => {
    labelCell().textContent = 'Subtotal:';
    expect(read()).toMatchObject({ reason: 'summary-missing' });
    document.body.innerHTML = subtotal;
    amountCell().textContent = '$6.49 - $9.99';
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
    document.body.innerHTML = subtotal;
    amountCell().insertAdjacentHTML('afterend', '<span id="sc-subtotal-amount-extra">$1.00</span>');
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
    document.body.innerHTML = subtotal;
    amountCell().textContent = '€6.49';
    expect(read()).toMatchObject({ reason: 'unsupported-currency' });
  });
  it('accepts an equal active-cart subtotal and rejects a conflicting one', () => {
    const extra = (value: string) =>
      `<div data-name="Subtotals" class="sc-subtotal sc-subtotal-activecart"><span id="sc-subtotal-label-activecart">Subtotal (1 item):</span><span id="sc-subtotal-amount-activecart">${value}</span></div>`;
    document.querySelector('.sc-active-cart')!.insertAdjacentHTML('beforeend', extra('$6.49'));
    expect(read()).toMatchObject({ amountCents: 649 });
    document.body.innerHTML = subtotal;
    document.querySelector('.sc-active-cart')!.insertAdjacentHTML('beforeend', extra('$7.00'));
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it('ignores a hidden summary and never reads form values', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div hidden><div class="sc-active-cart"><div data-name="Subtotals"><span id="sc-subtotal-label-x">Subtotal (9 items):</span><span id="sc-subtotal-amount-x">$900.00</span></div></div></div><input value="$5.00">',
    );
    expect(read()).toMatchObject({ amountCents: 649 });
  });
  it.each([
    ['https://www.amazon.com/cart', 'amazon-us'],
    ['https://www.amazon.com/cart/', 'amazon-us'],
    ['https://www.amazon.com/gp/cart/view.html?ref=nav_cart', 'amazon-us'],
    ['https://amazon.com/cart', null],
    ['https://www.amazon.ca/cart', null],
    ['https://www.amazon.com/checkout/entry/cart', null],
    ['https://www.amazon.com/gp/buy/spc/handlers/display.html', null],
    ['https://www.amazon.com.attacker.test/cart', null],
    ['http://www.amazon.com/cart', null],
    ['https://user:pass@www.amazon.com/cart', null],
  ])('maps %s to %s', (raw, merchant) => {
    expect(merchantForCheckout(raw)).toBe(merchant);
  });
});
