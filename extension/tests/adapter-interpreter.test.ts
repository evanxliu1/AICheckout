import { beforeEach, describe, expect, it } from 'vitest';
import { readWithAdapter } from '../src/checkout/page-reader';
import { SITE_ADAPTERS, type SiteAdapter } from '../src/checkout/adapters';

/** A synthetic spec exercising interpreter features directly (not a real merchant). */
function spec(change: Partial<SiteAdapter> = {}): SiteAdapter {
  return {
    ...structuredClone(SITE_ADAPTERS['best-buy-us']),
    summary: { selector: '.summary', maxCount: 3 },
    emptyCart: { selector: '.empty', text: 'Cart is empty' },
    rows: { selector: 'li', max: 10 },
    label: { selectors: ['.label'], single: true },
    amount: { selector: '.amount' },
    labels: [
      { pattern: '^Total$', caseInsensitive: false, kind: 'total' },
      { pattern: '^Subtotal$', caseInsensitive: false, kind: 'subtotal' },
    ],
    pending: [],
    requiredKinds: [],
    duplicates: 'ambiguous',
    combine: 'per-summary',
    ...change,
  };
}
const row = (label: string, amount: string) =>
  `<li><span class="label">${label}</span><span class="amount">${amount}</span></li>`;
const summary = (...rows: string[]) => `<ul class="summary">${rows.join('')}</ul>`;
const read = (adapter: SiteAdapter) => readWithAdapter(adapter, document);
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('generic adapter interpreter', () => {
  it('per-summary requires every summary to agree; pool-rows prefers any total across summaries', () => {
    document.body.innerHTML = summary(row('Total', '$10.00')) + summary(row('Subtotal', '$8.00'));
    expect(read(spec())).toMatchObject({ reason: 'ambiguous-amount' });
    expect(read(spec({ combine: 'pool-rows' }))).toMatchObject({ amountCents: 1000, kind: 'total' });
  });
  it('treats pending text as unknown and falls back to the subtotal', () => {
    const adapter = spec({ pending: [{ kind: 'total', text: 'TBD' }] });
    document.body.innerHTML = summary(row('Subtotal', '$8.00'), row('Total', 'TBD'));
    expect(read(adapter)).toMatchObject({ amountCents: 800, kind: 'subtotal' });
    document.body.innerHTML = summary(row('Subtotal', '$8.00'), row('Total', 'Pending'));
    expect(read(adapter)).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it('reports a summary missing a required kind', () => {
    document.body.innerHTML = summary(row('Subtotal', '$8.00'));
    expect(read(spec({ requiredKinds: ['subtotal', 'total'] }))).toMatchObject({ reason: 'summary-missing' });
    expect(read(spec())).toMatchObject({ amountCents: 800 });
  });
  it('allow-equal accepts a repeated equal row and rejects a conflicting one; ambiguous rejects both', () => {
    document.body.innerHTML = summary(row('Total', '$5.00'), row('Total', '$5.00'));
    expect(read(spec({ duplicates: 'allow-equal' }))).toMatchObject({ amountCents: 500 });
    expect(read(spec())).toMatchObject({ reason: 'ambiguous-amount' });
    document.body.innerHTML = summary(row('Total', '$5.00'), row('Total', '$6.00'));
    expect(read(spec({ duplicates: 'allow-equal' }))).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it('treats an oversized empty-cart heading as missing, never as an error or an empty cart', () => {
    document.body.innerHTML = `<h3 class="empty">${'Cart is empty '.repeat(20)}</h3>`;
    expect(read(spec())).toEqual({ status: 'unavailable', reason: 'summary-missing' });
    document.body.innerHTML = '<h3 class="empty">Cart is empty</h3>';
    expect(read(spec())).toEqual({ status: 'unavailable', reason: 'empty-cart' });
  });
  it('never reads option, button, or contenteditable text as a label or amount', () => {
    document.body.innerHTML = summary(
      '<li><span class="label">Total<button>Subtotal</button></span><span class="amount">$7.00<option>$1.00</option></span></li>',
    );
    expect(read(spec())).toMatchObject({ amountCents: 700, kind: 'total' });
    document.body.innerHTML = summary(
      '<li><span class="label">Total</span><span class="amount"><span contenteditable="true">$9.00</span></span></li>',
    );
    expect(read(spec())).toMatchObject({ reason: 'ambiguous-amount' });
  });
  it('reports loading from a visible indicator anywhere on the page', () => {
    document.body.innerHTML = summary(row('Total', '$5.00')) + '<div class="spinner"></div>';
    const adapter = spec({
      loading: { busyAncestor: '[aria-busy="true"]', checkMatchedRows: false, indicators: ['.spinner'] },
    });
    expect(read(adapter)).toMatchObject({ reason: 'page-loading' });
    document.querySelector('.spinner')!.setAttribute('hidden', '');
    expect(read(adapter)).toMatchObject({ amountCents: 500 });
  });
});
