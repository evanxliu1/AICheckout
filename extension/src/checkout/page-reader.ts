import { parseUsd } from '@ai-checkout/rewards-core/money';
import { MERCHANTS, merchantForCheckout } from './merchants';
import { SITE_ADAPTERS, type AmountKind, type MerchantId, type SiteAdapter } from './adapters';

export type { AmountKind };
export type PageRead =
  | {
      status: 'found';
      merchantId: MerchantId;
      currency: 'USD';
      amountCents: number;
      kind: AmountKind;
      extractorVersion: string;
    }
  | {
      status: 'unavailable';
      reason:
        | 'unsupported-page'
        | 'empty-cart'
        | 'summary-missing'
        | 'ambiguous-amount'
        | 'unsupported-currency'
        | 'page-loading';
    };

type Unavailable = Extract<PageRead, { status: 'unavailable' }>;

export function isSupportedCheckout(rawUrl: string): boolean {
  return merchantForCheckout(rawUrl) !== null;
}

const unavailable = (reason: Unavailable['reason']): Unavailable => ({
  status: 'unavailable',
  reason,
});
type Candidate = { kind: AmountKind; amountCents: number };
function amount(
  raw: string,
): { amountCents: number } | { reason: 'unsupported-currency' | 'ambiguous-amount' } {
  if (/CAD|CA\$|C\$|EUR|GBP|AUD|A\$|€|£|¥/i.test(raw)) return { reason: 'unsupported-currency' };
  if (!/^(?:USD\s*)?\$\s*[\d,.]+(?:\s*USD)?$/.test(raw)) return { reason: 'ambiguous-amount' };
  const amountCents = parseUsd(raw.replace(/USD/g, '').trim());
  return amountCents === null ? { reason: 'ambiguous-amount' } : { amountCents };
}
function found(merchantId: MerchantId, candidate: Candidate): PageRead {
  if (candidate.amountCents === 0) return unavailable('empty-cart');
  return {
    status: 'found',
    merchantId,
    currency: 'USD',
    ...candidate,
    extractorVersion: MERCHANTS[merchantId].extractorVersion,
  };
}

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse' ||
      style?.opacity === '0'
    )
      return false;
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
    if (
      !(node instanceof Element) ||
      !visible(node) ||
      /^(SCRIPT|STYLE|NOSCRIPT|INPUT|SELECT|TEXTAREA|OPTION|BUTTON)$/.test(node.tagName) ||
      node.hasAttribute('contenteditable')
    )
      return '';
    return Array.from(node.childNodes, read).join('');
  }
  const text = read(element).replace(/\s+/g, ' ').trim();
  if (text.length > 160) throw new Error('Oversized summary text');
  return text;
}

type Entry = { kind: AmountKind; amountCents: number | null };

/** Prefer totals over subtotals; every preferred amount must agree. */
function resolve(candidates: Candidate[]): Candidate | Unavailable {
  const totals = candidates.filter((c) => c.kind !== 'subtotal');
  const preferred = totals.length ? totals : candidates;
  if (!preferred.length) return unavailable('summary-missing');
  if (new Set(preferred.map((c) => c.amountCents)).size !== 1) return unavailable('ambiguous-amount');
  return preferred.find((c) => c.kind === 'total') ?? preferred[0];
}

/** Reads one summary's labelled amount rows according to the adapter. */
function readSummary(adapter: SiteAdapter, summary: Element): Entry[] | Unavailable {
  const busy = adapter.loading.busyAncestor;
  if (summary.closest(busy)) return unavailable('page-loading');
  const rows = (
    adapter.rows.selector ? [...summary.querySelectorAll(adapter.rows.selector)] : [summary]
  ).filter(visible);
  if (rows.length > adapter.rows.max) return unavailable('ambiguous-amount');
  const entries: Entry[] = [];
  for (const row of rows) {
    let labelEls: Element[] = [];
    for (const selector of adapter.label.selectors) {
      labelEls = [...row.querySelectorAll(selector)];
      if (labelEls.length) break;
    }
    if (!labelEls.length) continue;
    const text = cellText(labelEls[0]);
    const kind = adapter.labels.find((l) =>
      new RegExp(l.pattern, l.caseInsensitive ? 'i' : '').test(text),
    )?.kind;
    if (!kind) continue;
    const cells = row.querySelectorAll(adapter.amount.selector);
    if ((adapter.label.single && labelEls.length !== 1) || cells.length !== 1)
      return unavailable('ambiguous-amount');
    if (
      adapter.loading.checkMatchedRows &&
      (row.closest(busy) || [...row.querySelectorAll(busy)].some(visible))
    )
      return unavailable('page-loading');
    // USD is constrained by the supported US merchant and a visible dollar sign. A bare number,
    // range, installment price, or dual-currency quote is ambiguous.
    const raw = cellText(cells[0]);
    let amountCents: number | null;
    if (adapter.pending.some((p) => p.kind === kind && p.text === raw)) amountCents = null;
    else {
      const parsed = amount(raw);
      if ('reason' in parsed) return unavailable(parsed.reason);
      amountCents = parsed.amountCents;
    }
    const seen = entries.find((e) => e.kind === kind);
    if (seen && (adapter.duplicates === 'ambiguous' || seen.amountCents !== amountCents))
      return unavailable('ambiguous-amount');
    entries.push({ kind, amountCents });
  }
  if (adapter.requiredKinds.some((kind) => !entries.some((e) => e.kind === kind)))
    return unavailable('summary-missing');
  return entries;
}

/** The one generic interpreter for every bundled SiteAdapter. */
export function readWithAdapter(adapter: SiteAdapter, document: Document): PageRead {
  if (adapter.loading.indicators.some((s) => [...document.querySelectorAll(s)].some(visible)))
    return unavailable('page-loading');
  const summaries = [...document.querySelectorAll(adapter.summary.selector)].filter(visible);
  if (!summaries.length) {
    const empty = adapter.emptyCart;
    // Bounded: at most five candidate headings; oversized text simply doesn't match.
    const matches = (el: Element) => {
      try {
        return cellText(el) === empty!.text;
      } catch {
        return false;
      }
    };
    const isEmpty =
      empty && [...document.querySelectorAll(empty.selector)].filter(visible).slice(0, 5).some(matches);
    return unavailable(isEmpty ? 'empty-cart' : 'summary-missing');
  }
  if (summaries.length > adapter.summary.maxCount) return unavailable('ambiguous-amount');
  const pooled: Candidate[] = [],
    resolved: Candidate[] = [];
  for (const summary of summaries) {
    const entries = readSummary(adapter, summary);
    if (!Array.isArray(entries)) return entries;
    const candidates = entries.filter((e): e is Candidate => e.amountCents !== null);
    if (adapter.combine === 'pool-rows') pooled.push(...candidates);
    else {
      const one = resolve(candidates);
      if ('status' in one) return one;
      resolved.push(one);
    }
  }
  if (adapter.combine === 'pool-rows') {
    const one = resolve(pooled);
    return 'status' in one ? one : found(adapter.merchantId, one);
  }
  if (new Set(resolved.map((c) => `${c.kind}:${c.amountCents}`)).size !== 1)
    return unavailable('ambiguous-amount');
  return found(adapter.merchantId, resolved[0]);
}

export function readCheckoutPage(document: Document, url: string): PageRead {
  const merchant = merchantForCheckout(url);
  if (!merchant) return unavailable('unsupported-page');
  try {
    return readWithAdapter(SITE_ADAPTERS[merchant], document);
  } catch {
    return unavailable('ambiguous-amount');
  }
}
