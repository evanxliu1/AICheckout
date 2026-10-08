// Generic cart reader (Phase 13). Contract: docs/evals/generic-reader-protocol.md and
// wiki/system/merchant-coverage-design.md#generic-cart-reader. `readCart` is deterministic and synchronous; it reads
// only the document it is given (open shadow roots included), never the network, a model, storage or the clock, and
// never the rebuild's `data-pane-*` attributes or any per-domain list. It shows an amount only when certain and
// otherwise withholds. The evaluation harness is evals/reader/.
//
// How it reads (development round 1, 2026-10-08):
// 1. Every text node that looks like an amount climbs to its row: the nearest small ancestor whose text carries a
//    summary label (total, subtotal, amount due, in many languages), or a labelled previous sibling of an ancestor
//    (dt/dd, th/td, label/value pairs).
// 2. A row counts when it is visible to the shopper (display, visibility, opacity, clipping, on the page), its
//    visible text has exactly one distinct non-negative amount, and its label is a total, subtotal or, next to a
//    credit row, an after-credit total. Savings, shipping, tax, points, instalment and line-item rows are excluded.
// 3. The most preferred kind present wins (afterCredit > estimatedTotal > subtotal). Two different amounts of that
//    kind mean withhold, unless only one of them sits in a cart summary (next to shipping, tax or a checkout control).
//    A subtotal alone is shown only when its summary holds no other, different amount.
// 4. Currency by the protocol's evidence order; unparseable amounts withhold (a zero total is shown: an empty cart).
import { MARK_RE, findAmounts, normalizeText, toMinor } from './amounts.ts';
import {
  MINOR_UNITS,
  isCode,
  resolveCurrency,
  storefrontOf,
  structuredCurrency,
  type Storefront,
} from './currency.ts';
import type { CartReading, ReadOptions } from './types.ts';
import {
  ANY_LABEL_RE,
  CHECKOUT_RE,
  CREDIT_RE,
  LINE_ITEM_RE,
  SHIP_RE,
  SUBTOTAL_RE,
  TAX_RE,
  TOTAL_RE,
  classifyLabel,
  type Kind,
} from './words.ts';

export type { CartReading, ReadOptions, ReadingKind, ShownReading, WithheldReading } from './types.ts';
export { READING_KINDS } from './types.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'SELECT',
  'TEXTAREA',
  'HEAD',
  'IFRAME',
  'OBJECT',
  'CANVAS',
]);
const SKIP_PARENTS = new Set([...SKIP_TAGS, 'OPTION', 'TITLE']);
/** Containers of repeated rows: a label found at this level belongs to a header or another item, not to the amount. */
const LIST_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'UL', 'OL']);
const KINDS: Kind[] = ['afterCredit', 'estimatedTotal', 'subtotal'];
const MAX_ROW_TEXT = 200;
const MAX_LABEL_TEXT = 80;
const MAX_CLIMB = 8;
const ALNUM_END = /[\p{L}\d]$/u;
const ALNUM_START = /^[\p{L}\d]/u;
/** Text that may hold an amount: a marker or code, two decimals, ",-" decimals, or a bare numeric fragment. */
const CANDIDATE_RE = new RegExp(
  `${MARK_RE.source}|\\d[.,:]\\d{2}(?!\\d)|\\d[.,:][-–—]|^\\s*[\\d.,' \\u00a0]+\\s*$`,
  'u',
);

type Ctx = {
  doc: Document;
  view: Window | null;
  styles: Map<Element, CSSStyleDeclaration>;
  layout: boolean;
  pageW: number;
  pageH: number;
  /** Candidate rows keyed by the element holding the amount. */
  rows: Map<Element, Element[]>;
};

/** One candidate row, as `explainCart` reports it. */
export type RowReport = {
  text: string;
  kind: Kind | 'after-candidate' | 'credit' | null;
  minor: number | null;
  currency: string | null;
  inSummary: boolean;
  /** Why a row was dropped, when it was. */
  why?: string;
};
type Row = RowReport & { els: Element[] };

export function readCart(document: Document, options: ReadOptions): CartReading {
  return analyze(document, options).reading;
}

/** The reader's candidate rows and decision, for tests and development; not part of the extension's contract. */
export function explainCart(
  document: Document,
  options: ReadOptions,
): { reading: CartReading; rows: RowReport[] } {
  const { reading, rows } = analyze(document, options);
  return {
    reading,
    rows: rows.map(({ text, kind, minor, currency, inSummary, why }) => ({
      text,
      kind,
      minor,
      currency,
      inSummary,
      why,
    })),
  };
}

function analyze(document: Document, options: ReadOptions): { reading: CartReading; rows: Row[] } {
  const view = document.defaultView;
  const root = document.documentElement;
  const ctx: Ctx = {
    doc: document,
    view,
    styles: new Map(),
    layout: Boolean(root && view && root.getBoundingClientRect().width > 0),
    pageW: root ? Math.max(root.scrollWidth, root.clientWidth) : 0,
    pageH: root ? Math.max(root.scrollHeight, root.clientHeight) : 0,
    rows: new Map(),
  };
  const withhold = (reason: string, rows: Row[] = []) => ({
    reading: { shown: false, reason } as CartReading,
    rows,
  });
  if (!document.body) return withhold('no-summary');
  const store = storefrontOf(options.url, root?.getAttribute('lang') ?? '');
  const shadowRoots: ShadowRoot[] = [];
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) shadowRoots.push(el.shadowRoot);
  collectRows(document.body, ctx);
  for (const sr of shadowRoots) collectRows(sr, ctx);
  if (ctx.rows.size === 0) return withhold('no-summary');

  let structured: string | null | undefined;
  const structuredLazy = () =>
    structured === undefined ? (structured = structuredCurrency(document)) : structured;
  const rows: Row[] = [];
  for (const els of ctx.rows.values()) {
    const row = readRow(els, ctx, store, structuredLazy);
    if (row) rows.push(row);
  }
  // An unreadable total row that wraps another total row is an aggregate (a block whose other amounts climbed to
  // its label), not a second total of its kind.
  for (const r of rows)
    if (r.why === 'several-amounts' && rows.some((o) => o !== r && r.els.at(-1)!.contains(o.els.at(-1)!)))
      r.kind = null;
  // "Amount due", "balance" and the like are after-credit totals only beside a credit row (same parent); otherwise
  // they are plain totals when they say so, and nothing at all when they do not.
  const totals = rows.filter((r) => r.kind !== null && r.kind !== 'credit');
  const credits = rows.filter((r) => r.kind === 'credit' && totals.some((t) => near(r, t)));
  const resolved: (Row & { kind: Kind })[] = [];
  for (const r of rows) {
    if (r.kind === 'credit' || r.kind === null) continue;
    if (r.kind !== 'after-candidate') resolved.push(r as Row & { kind: Kind });
    else if (credits.some((c) => near(r, c))) resolved.push({ ...r, kind: 'afterCredit' });
    else if (TOTAL_RE.test(r.text.toLowerCase())) resolved.push({ ...r, kind: 'estimatedTotal' });
  }
  const kind = KINDS.find((k) => resolved.some((r) => r.kind === k));
  if (!kind) return withhold('no-summary', rows);
  if (credits.length > 0 && kind !== 'afterCredit') return withhold('credit-unclear', rows);
  let chosen = resolved.filter((r) => r.kind === kind);
  const key = (r: Row) => (r.minor === null ? 'unreadable' : `${r.currency ?? '?'}:${r.minor}`);
  if (new Set(chosen.map(key)).size > 1) {
    chosen = chosen.filter((r) => r.inSummary);
    if (new Set(chosen.map(key)).size !== 1) return withhold('ambiguous', rows);
  }
  const row = chosen[0]!;
  if (row.minor === null) return withhold('amount-unreadable', rows);
  if (!row.currency) return withhold('currency-undetermined', rows);
  if (kind === 'subtotal') {
    if (!chosen.some((r) => r.inSummary)) return withhold('subtotal-outside-summary', rows);
    if (chosen.some((r) => !subtotalAlone(r, ctx, store, structuredLazy)))
      return withhold('subtotal-not-alone', rows);
  }
  return { reading: { shown: true, kind, amountMinor: row.minor, currency: row.currency }, rows };
}

/** Finds the rows of a tree: each amount-like text node climbs to its nearest small labelled ancestor or pair. */
function collectRows(root: Node, ctx: Ctx): void {
  const walker = ctx.doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const data = (n as Text).data;
    if (!/\d/.test(data) || !CANDIDATE_RE.test(data)) continue;
    const parent = n.parentNode as Element | null;
    if (
      !parent ||
      parent.nodeType !== 1 ||
      SKIP_PARENTS.has(parent.nodeName) ||
      parent.namespaceURI !== XHTML
    )
      continue;
    let el: Element | null = parent;
    for (let depth = 0; el && depth < MAX_CLIMB; depth += 1) {
      if (LIST_TAGS.has(el.nodeName)) break;
      const text = el.textContent ?? '';
      if (text.length > MAX_ROW_TEXT) break;
      // A label the shopper sees (a screen-reader-only label does not count; the climb goes on).
      if (ANY_LABEL_RE.test(text.toLowerCase()) && ANY_LABEL_RE.test(visibleText(el, ctx).toLowerCase())) {
        if (!ctx.rows.has(el)) ctx.rows.set(el, [el]);
        break;
      }
      // A label in the previous sibling: <dt>Total</dt><dd>$12</dd>, <th>Total</th><td>$12</td>.
      const prev = el.previousElementSibling;
      const prevText = prev?.textContent ?? '';
      if (
        prev &&
        prevText.length <= MAX_LABEL_TEXT &&
        !/\d/.test(prevText) &&
        ANY_LABEL_RE.test(prevText.toLowerCase()) &&
        !hiddenWhy(prev, ctx)
      ) {
        if (!ctx.rows.has(el)) ctx.rows.set(el, [prev, el]);
        break;
      }
      el = parentOf(el);
    }
  }
}

/** Two rows of the same summary list: an ancestor within two levels is shared. */
function near(a: Row, b: Row): boolean {
  const up = (r: Row) => {
    const p = parentOf(r.els[0]!);
    return [p, p && parentOf(p)];
  };
  const [a1, a2] = up(a);
  const [b1, b2] = up(b);
  return Boolean(a1 && (a1 === b1 || a1 === b2 || a2 === b1 || (a2 && a2 === b2)));
}

function parentOf(el: Element): Element | null {
  const p = el.parentNode;
  if (!p) return null;
  if (p.nodeType === 1) return p as Element;
  if (p.nodeType === 11) return (p as ShadowRoot).host ?? null;
  return null;
}

function style(el: Element, ctx: Ctx): CSSStyleDeclaration {
  let cs = ctx.styles.get(el);
  if (!cs) {
    cs = ctx.view ? ctx.view.getComputedStyle(el) : ({} as CSSStyleDeclaration);
    ctx.styles.set(el, cs);
  }
  return cs;
}

/** Hidden by its own styles (not inherited ones): display, opacity, clipping and screen-reader-only boxes. */
function hiddenBox(cs: CSSStyleDeclaration): boolean {
  if (cs.display === 'none' || cs.opacity === '0' || cs.fontSize === '0px') return true;
  if (/^rect\(0px,? 0px,? 0px,? 0px\)$/.test(cs.clip ?? '')) return true;
  if (/inset\((?:50|100)%\)/.test(cs.clipPath ?? '')) return true;
  if (cs.position === 'absolute' && parseFloat(cs.width) <= 1 && parseFloat(cs.height) <= 1) return true;
  return false;
}

/** Why `el` is not visible to the shopper (hidden ancestor, no box on the page, clipped away), or null if it is. */
function hiddenWhy(el: Element, ctx: Ctx): string | null {
  const own = style(el, ctx);
  if (own.visibility === 'hidden' || own.visibility === 'collapse') return 'visibility';
  for (let a: Element | null = el; a; a = parentOf(a))
    if (hiddenBox(style(a, ctx))) return a === el ? 'box' : 'ancestor-box';
  if (!ctx.layout) return null;
  const range = ctx.doc.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  const sx = ctx.view?.scrollX ?? 0;
  const sy = ctx.view?.scrollY ?? 0;
  if (r.width < 1 || r.height < 1) return 'empty-rect';
  if (r.right + sx <= 0 || r.bottom + sy <= 0 || r.left + sx >= ctx.pageW || r.top + sy >= ctx.pageH)
    return 'off-page';
  // A collapsed clipping ancestor (overflow hidden at zero height or width) hides everything inside. Partial
  // clipping is not checked: offline rebuilds lay content out differently from the live page.
  for (let a = parentOf(el); a; a = parentOf(a)) {
    const cs = style(a, ctx);
    if (!/hidden|clip/.test(cs.overflowX) && !/hidden|clip/.test(cs.overflowY)) continue;
    const ar = a.getBoundingClientRect();
    if (ar.width < 1 || ar.height < 1) return 'clipped';
  }
  return null;
}

/** The text a shopper sees inside `el`: hidden and struck-through parts dropped, boxes separated by spaces. */
function visibleText(el: Element, ctx: Ctx): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        // Two words or numbers that touch across elements are separate things ("Subtotal" "USD 16.34").
        const data = (c as Text).data;
        if (ALNUM_END.test(parts.at(-1) ?? '') && ALNUM_START.test(data)) parts.push(' ');
        parts.push(data);
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      if (SKIP_TAGS.has(e.nodeName) || e.namespaceURI !== XHTML) continue;
      if (e.nodeName === 'BR') {
        parts.push(' ');
        continue;
      }
      const cs = style(e, ctx);
      if (hiddenBox(cs) || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
      if ((cs.textDecorationLine ?? '').includes('line-through')) continue;
      const inline = cs.display === 'inline' || cs.display === 'contents' || cs.display === '';
      if ((e.nodeName === 'SUP' || e.nodeName === 'SUB') && /^\s*\d{1,2}\s*$/.test(e.textContent ?? '')) {
        if (/\d\s*$/.test(parts.at(-1) ?? '')) parts.push('.');
      } else if (!inline) parts.push(' ');
      walk(e.shadowRoot ?? e);
      if (!inline) parts.push(' ');
    }
  };
  walk(el.shadowRoot ?? el);
  return parts.join('');
}

/** Reads one candidate row (one element, or a label element and a value element). */
function readRow(els: Element[], ctx: Ctx, store: Storefront, structured: () => string | null): Row | null {
  const text = normalizeText(els.map((el) => visibleText(el, ctx)).join(' '));
  const dropped = (why: string): Row => ({
    els,
    text,
    kind: null,
    minor: null,
    currency: null,
    inSummary: false,
    why,
  });
  const hidden = els.map((el) => hiddenWhy(el, ctx)).find(Boolean);
  if (hidden) return dropped(`hidden:${hidden}`);
  if (els.some((el) => (style(el, ctx).textDecorationLine ?? '').includes('line-through')))
    return dropped('struck');
  const amounts = findAmounts(text, isCode);
  if (amounts.length === 0) return dropped('no-amount');
  let label = '';
  let at = 0;
  for (const a of amounts) {
    label += text.slice(at, a.start) + ' ';
    at = a.end;
  }
  label = (label + text.slice(at)).replace(/\s+/g, ' ').trim();
  const lower = label.toLowerCase();
  const report = { els, text, minor: null, currency: null, inSummary: false };
  const values = new Set(amounts.map((a) => (a.number ? `${a.number.int}.${a.number.frac}` : 'unreadable')));
  if (amounts.some((a) => a.negative))
    return CREDIT_RE.test(lower) ? { ...report, kind: 'credit' } : dropped('negative');
  const kind = classifyLabel(lower);
  if (!kind) return dropped('label');
  if (lineItemOf(els.at(-1)!)) return dropped('line-item');
  // Several different amounts in one total row (a converted price, say): unreadable, but still a total of its kind.
  if (values.size !== 1)
    return { ...report, kind, why: 'several-amounts', inSummary: inSummary(els.at(-1)!, kind) };
  const codes = new Set<string>();
  for (const m of label.matchAll(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g)) if (isCode(m[0])) codes.add(m[0]);
  for (const a of amounts) if (a.code) codes.add(a.code);
  const markers = new Set(amounts.map((a) => a.marker).filter((m): m is string => m !== null));
  const marker = markers.size > 1 ? 'conflict' : ([...markers][0] ?? null);
  const shared = amounts.find((a) => a.marker === 'shared');
  const currency =
    marker === 'conflict'
      ? null
      : resolveCurrency(
          { codes: [...codes], marker, sharedText: shared?.markerText ?? null },
          structured(),
          store,
        );
  const number = amounts[0]!.number;
  const minor = number ? toMinor(number, currency ? MINOR_UNITS[currency]! : 2) : null;
  return { ...report, kind, minor, currency, inSummary: inSummary(els.at(-1)!, kind) };
}

/**
 * Whether a row sits inside one product line (a product image or quantity control within three levels, before any
 * summary words): its total is the line's, not the cart's.
 */
function lineItemOf(el: Element): boolean {
  let a = parentOf(el);
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 3; depth += 1) {
    const text = (a.textContent ?? '').toLowerCase();
    if (text.length > 600) return false;
    if (SHIP_RE.test(text) || TAX_RE.test(text) || CHECKOUT_RE.test(text) || SUBTOTAL_RE.test(text))
      return false;
    if (LINE_ITEM_RE.test(text) || a.querySelector('img, picture') !== null) return true;
    a = parentOf(a);
  }
  return false;
}

/** The nearest ancestor (up to five, under body) that reads as a cart summary, or null. */
function summaryOf(el: Element, kind: Kind | 'after-candidate'): Element | null {
  let a = parentOf(el);
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 5; depth += 1) {
    const text = (a.textContent ?? '').toLowerCase();
    if (text.length > 4000) return null;
    if (SHIP_RE.test(text) || TAX_RE.test(text) || CHECKOUT_RE.test(text)) return a;
    if (kind !== 'subtotal' && SUBTOTAL_RE.test(text)) return a;
    a = parentOf(a);
  }
  return null;
}

/** Whether a row sits in a cart summary: an ancestor also holds shipping, tax, a checkout control or a subtotal. */
function inSummary(el: Element, kind: Kind | 'after-candidate'): boolean {
  return summaryOf(el, kind) !== null;
}

/**
 * A subtotal shown alone must really be alone: when its summary also shows another, different positive amount
 * (an unlabelled total, say), the reader cannot tell which one the shopper pays.
 */
function subtotalAlone(row: Row, ctx: Ctx, store: Storefront, structured: () => string | null): boolean {
  const summary = summaryOf(row.els.at(-1)!, 'subtotal');
  if (!summary) return true;
  const text = normalizeText(visibleText(summary, ctx));
  for (const a of findAmounts(text, isCode)) {
    if (a.negative || !a.number) continue;
    const currency = resolveCurrency(
      { codes: a.code ? [a.code] : [], marker: a.marker, sharedText: a.markerText },
      structured(),
      store,
    );
    const minor = toMinor(a.number, currency ? MINOR_UNITS[currency]! : 2);
    if (minor !== null && minor !== 0 && minor !== row.minor) return false;
  }
  return true;
}
