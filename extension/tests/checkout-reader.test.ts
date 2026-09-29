import { beforeEach, describe, expect, it } from 'vitest';
import populated from './fixtures/bestbuy-summary.html?raw';
import empty from './fixtures/bestbuy-empty.html?raw';
import observed from './fixtures/bestbuy-observed-summary.html?raw';
import { readCheckoutPage, isSupportedCheckout } from '../src/checkout/page-reader';

const url = 'https://www.bestbuy.com/cart';
beforeEach(() => {
  document.body.innerHTML = populated;
});
function read() {
  return readCheckoutPage(document, url);
}
function summary(rows: string) {
  document.body.innerHTML = `<table aria-label="Order Summary"><tbody>${rows}</tbody></table>`;
}
function row(label: string, value: string) {
  return `<tr><th scope="row">${label}</th><td>${value}</td></tr>`;
}

describe('bounded summary extraction', () => {
  it('matches the total from the populated live cart observation', () => {
    document.body.innerHTML = observed;
    expect(read()).toMatchObject({ amountCents: 2723, kind: 'total' });
  });
  it('reads the visible order total without recomputing quantity, tax, or product prices', () => {
    expect(read()).toEqual({
      status: 'found',
      merchantId: 'best-buy-us',
      currency: 'USD',
      amountCents: 140_399,
      kind: 'total',
      extractorVersion: 'bestbuy-summary-v1',
    });
    expect(JSON.stringify(read())).not.toContain('private');
  });
  it('identifies the observed empty cart', () => {
    document.body.innerHTML = empty;
    expect(read()).toEqual({ status: 'unavailable', reason: 'empty-cart' });
  });
  it('marks a subtotal when no total is available', () => {
    summary(row('Subtotal', '$1,299.99'));
    expect(read()).toMatchObject({ amountCents: 129_999, kind: 'subtotal' });
  });
  it('marks an estimated total explicitly', () => {
    summary(row('Estimated Total', 'USD $100.12'));
    expect(read()).toMatchObject({ amountCents: 10_012, kind: 'estimated-total' });
  });
  it('rejects conflicting visible totals, and accepts equal repeated responsive summaries', () => {
    document.body.innerHTML += populated;
    expect(read()).toMatchObject({ status: 'found' });
    document.body.innerHTML += `<table aria-label="Order Summary">${row('Total', '$10.00')}</table>`;
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it('does not fall back to a subtotal when a present total is malformed', () => {
    summary(row('Subtotal', '$100.00') + row('Total', 'Calculating…'));
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it.each(['C$100.00', 'CA$100.00', 'CAD $100.00', '€100.00', '£100.00', 'AUD $100.00'])(
    'rejects currency %s',
    (value) => {
      summary(row('Total', value));
      expect(read()).toMatchObject({ reason: 'unsupported-currency' });
    },
  );
  it.each(['100', '$1,00.00', '$1e3', '$10.001', '$100.00 / month', '$100.00 or $10.00', '$100000.01'])(
    'rejects ambiguous money %s',
    (value) => {
      summary(row('Total', value));
      expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
    },
  );
  it('ignores hidden rows and summaries', () => {
    document.body.innerHTML += `<div style="display:none"><table aria-label="Order Summary">${row('Total', '$1.00')}</table></div>`;
    expect(read()).toMatchObject({ amountCents: 140_399 });
    document.querySelector('table')!.setAttribute('aria-hidden', 'true');
    expect(read()).toMatchObject({ reason: 'summary-missing' });
  });
  it('rejects loading summaries and excessive cells', () => {
    document.querySelector('table')!.setAttribute('aria-busy', 'true');
    expect(read()).toMatchObject({ reason: 'page-loading' });
    summary(Array.from({ length: 31 }, () => row('Total', '$100')).join(''));
    expect(read()).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it('never scrapes arbitrary prices outside the summary', () => {
    document.body.innerHTML = '<h1>Your cart</h1><p>Total $100.00</p><input value="$200.00">';
    expect(read()).toMatchObject({ reason: 'summary-missing' });
  });
  it.each([
    'https://bestbuy.com.attacker.test/cart',
    'https://notbestbuy.com/cart',
    'https://www.bestbuy.ca/cart',
    'https://www.bestbuy.com/site/product',
    'http://www.bestbuy.com/cart',
    'https://www.bestbuy.com:444/cart',
    'https://user:pass@www.bestbuy.com/cart',
    'chrome://settings',
  ])('rejects unsupported URL %s', (value) => {
    expect(isSupportedCheckout(value)).toBe(false);
    expect(readCheckoutPage(document, value)).toMatchObject({ reason: 'unsupported-page' });
  });
});
