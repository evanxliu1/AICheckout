import { parseUsd } from '@ai-checkout/rewards-core/money';
import { MERCHANTS, merchantForCheckout } from './merchants';
import type { MerchantId } from './merchants';

export type AmountKind = 'total' | 'estimated-total' | 'subtotal';
export type PageRead = { status: 'found'; merchantId: MerchantId; currency: 'USD'; amountCents: number;
  kind: AmountKind; extractorVersion: typeof MERCHANTS[MerchantId]['extractorVersion'] } |
  { status: 'unavailable'; reason: 'unsupported-page' | 'empty-cart' | 'summary-missing' | 'ambiguous-amount' | 'unsupported-currency' | 'page-loading' };

export function isSupportedCheckout(rawUrl: string): boolean {
  return merchantForCheckout(rawUrl) !== null;
}

const unavailable = (reason: Extract<PageRead, { status: 'unavailable' }>['reason']): PageRead => ({ status: 'unavailable', reason });
type Candidate = { kind: AmountKind; amountCents: number };
function amount(raw: string): { amountCents: number } | { reason: 'unsupported-currency' | 'ambiguous-amount' } {
  if (/CAD|CA\$|C\$|EUR|GBP|AUD|A\$|€|£|¥/i.test(raw)) return { reason: 'unsupported-currency' };
  if (!/^(?:USD\s*)?\$\s*[\d,.]+(?:\s*USD)?$/.test(raw)) return { reason: 'ambiguous-amount' };
  const amountCents = parseUsd(raw.replace(/USD/g, '').trim());
  return amountCents === null ? { reason: 'ambiguous-amount' } : { amountCents };
}
function found(merchantId: MerchantId, candidate: Candidate): PageRead {
  if (candidate.amountCents === 0) return unavailable('empty-cart');
  return { status: 'found', merchantId, currency: 'USD', ...candidate, extractorVersion: MERCHANTS[merchantId].extractorVersion };
}

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return false;
  }
  return true;
}

/** Read visible labels/amounts only. Never inspect form values, cart names, addresses,
 * embedded JSON, network traffic, or the full page HTML. */
function cellText(element: Element): string {
  let count = 0;
  function read(node: Node): string {
    if (++count > 80) throw new Error('Oversized summary cell');
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element) || !visible(node) || /^(SCRIPT|STYLE|NOSCRIPT|INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) return '';
    return Array.from(node.childNodes, read).join('');
  }
  const text = read(element).replace(/\s+/g, ' ').trim();
  if (text.length > 160) throw new Error('Oversized summary text');
  return text;
}

const labels: Record<string, AmountKind> = {
  total: 'total', 'order total': 'total', 'estimated total': 'estimated-total',
  subtotal: 'subtotal', 'item subtotal': 'subtotal', 'items subtotal': 'subtotal',
};

function readBestBuy(document: Document): PageRead {
  // Observed on the live Best Buy US cart on 2026-09-25. Semantic fallback preserves
  // the same table contract; arbitrary numbers elsewhere on the page are never used.
  const tables = [...document.querySelectorAll('table[data-testid="order-summary__price-summary-table"], table[aria-label="Order Summary"]')].filter(visible);
  if (!tables.length) return unavailable('summary-missing');
  if (tables.length > 3) return unavailable('ambiguous-amount');
  const candidates: Candidate[] = [];
  try {
    for (const table of tables) {
      if (table.closest('[aria-busy="true"]')) return unavailable('page-loading');
      const rows = [...table.querySelectorAll('tr')].filter(visible);
      if (rows.length > 30) return unavailable('ambiguous-amount');
      for (const row of rows) {
        const heading = row.querySelector('th[scope="row"]') ?? row.querySelector('th');
        if (!heading) continue;
        const kind = labels[cellText(heading).toLowerCase().replace(/:$/, '').trim()];
        if (!kind) continue;
        const cells = row.querySelectorAll('td');
        if (cells.length !== 1) return unavailable('ambiguous-amount');
        // USD is constrained by the supported US merchant and a visible dollar sign.
        // A bare number, range, installment price, or dual-currency quote is ambiguous.
        const parsed = amount(cellText(cells[0]));
        if ('reason' in parsed) return unavailable(parsed.reason);
        candidates.push({ kind, ...parsed });
      }
    }
  } catch { return unavailable('ambiguous-amount'); }
  const totals = candidates.filter(c => c.kind !== 'subtotal');
  const preferred = totals.length ? totals : candidates;
  if (!preferred.length) return unavailable('summary-missing');
  if (new Set(preferred.map(c => c.amountCents)).size !== 1) return unavailable('ambiguous-amount');
  const candidate = preferred.find(c => c.kind === 'total') ?? preferred[0];
  return found('best-buy-us', candidate);
}

function readNewegg(document: Document): PageRead {
  // Observed 2026-09-26: selected subtotal and an explicit TBD estimated total.
  // Read only the two amount rows; never inspect the delivery address or promotion form.
  const summaries = [...document.querySelectorAll('.summary-side')].filter(visible);
  if (!summaries.length) {
    const empty = [...document.querySelectorAll('.cart-empty > h3')].filter(visible);
    return unavailable(empty.some(el => cellText(el) === 'Your cart is currently empty.') ? 'empty-cart' : 'summary-missing');
  }
  if (summaries.length > 3) return unavailable('ambiguous-amount');
  const candidates: Candidate[] = [];
  for (const summary of summaries) {
    if (summary.closest('[aria-busy="true"]')) return unavailable('page-loading');
    const rows = [...summary.querySelectorAll(':scope > .summary-wrap > .summary-content > ul > li')].filter(visible);
    if (rows.length > 30) return unavailable('ambiguous-amount');
    let subtotal: number | undefined;
    let total: number | null | undefined;
    for (const row of rows) {
      const headings = row.querySelectorAll(':scope > label');
      if (!headings.length) continue;
      const label = cellText(headings[0]);
      if (label !== 'Selected Subtotal' && label !== 'Est. Total') continue;
      const cells = row.querySelectorAll(':scope > span');
      if (headings.length !== 1 || cells.length !== 1) return unavailable('ambiguous-amount');
      if (row.closest('[aria-busy="true"]') || [...row.querySelectorAll('[aria-busy="true"]')].some(visible)) return unavailable('page-loading');
      const raw = cellText(cells[0]);
      if (label === 'Est. Total' && raw === 'TBD') {
        if (total !== undefined) return unavailable('ambiguous-amount');
        total = null; continue;
      }
      const parsed = amount(raw);
      if ('reason' in parsed) return unavailable(parsed.reason);
      if (label === 'Selected Subtotal') {
        if (subtotal !== undefined) return unavailable('ambiguous-amount');
        subtotal = parsed.amountCents;
      } else {
        if (total !== undefined) return unavailable('ambiguous-amount');
        total = parsed.amountCents;
      }
    }
    if (subtotal === undefined || total === undefined) return unavailable('summary-missing');
    candidates.push(total === null ? { kind: 'subtotal', amountCents: subtotal } : { kind: 'estimated-total', amountCents: total });
  }
  if (new Set(candidates.map(c => `${c.kind}:${c.amountCents}`)).size !== 1) return unavailable('ambiguous-amount');
  return found('newegg-us', candidates[0]);
}

export function readCheckoutPage(document: Document, url: string): PageRead {
  const merchant = merchantForCheckout(url);
  if (!merchant) return unavailable('unsupported-page');
  try { return merchant === 'newegg-us' ? readNewegg(document) : readBestBuy(document); }
  catch { return unavailable('ambiguous-amount'); }
}
