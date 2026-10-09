// Generic cart reader (Phase 13). Contract: docs/evals/generic-reader-protocol.md and
// wiki/system/merchant-coverage-design.md#generic-cart-reader. `readCart` is deterministic and synchronous; it reads
// only the document it is given (open shadow roots included), never the network, a model, storage or the clock, and
// never the rebuild's `data-pane-*` attributes or any per-domain list. It shows an amount only when certain and
// otherwise withholds. The evaluation harness is evals/reader/.
//
// How it reads (development rounds 1 to 4, 2026-10-08):
// 1. Every text node that looks like an amount climbs to its row: the nearest small ancestor whose text carries a
//    summary label (total, subtotal, amount due, in many languages), or a labelled previous sibling of an ancestor
//    (dt/dd, th/td, label/value pairs).
// 2. A row counts when it is visible to the shopper (display, visibility, opacity below one half, clipping, on the
//    page or inside a scrolling panel), its visible text has exactly one distinct non-negative amount, and its label
//    is a total, subtotal or, next to a credit row, an after-credit total. Savings, shipping, tax, points, instalment
//    and line-item rows are excluded. A total label ending in a bare number the grammar cannot read is a total the
//    reader cannot show, and withholds.
// 3. The most preferred kind present wins (afterCredit > estimatedTotal > subtotal). Two different amounts of that
//    kind mean withhold, unless only one of them sits in a cart summary (next to shipping, tax or a checkout control).
//    A total outside any summary (a bundle offer's "total price") withholds. A subtotal alone is shown only when no
//    other row of its summary holds a total label or an unexplained different amount (shipping, tax, savings,
//    threshold and rewards rows explain theirs).
// 4. Currency by the protocol's evidence order; the storefront's currency (rule (d)) is not used when the page's text
//    names another currency. Unparseable amounts withhold. A zero total is shown (an empty cart);
//    a zero subtotal is withheld, since it is often a drawer's placeholder.
import { MARK_RE, findAmounts, normalizeText, toMinor } from './amounts.ts';
import {
  MINOR_UNITS,
  isCode,
  namedCurrencies,
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
  EXCLUDE_RE,
  GRAND_RE,
  LINE_ITEM_RE,
  PREP_RE,
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
/** A line's remove control, in many languages. */
const REMOVE_RE =
  /\bremove\b|\bdelete\b|entfernen|l[öo]schen|supprimer|retirer|eliminar|quitar|rimuovi|elimina|verwijder|usu[ńn]|kaldır|\bsil\b|удалить|削除|삭제|حذف|إزالة/u;
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

/** Page-wide currency evidence, read lazily once: structured data (rule (b)) and currencies named in the text. */
type PageEvidence = { structured: () => string | null; named: () => Set<string> };

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
    // The page's height is the taller of the root's and the body's (either may be the scrolling element).
    pageH: root ? Math.max(root.scrollHeight, root.clientHeight, document.body?.scrollHeight ?? 0) : 0,
    rows: new Map(),
  };
  // A body that clips or scrolls its own overflow bounds what the shopper can reach sideways.
  if (document.body && view && ctx.layout && view.getComputedStyle(document.body).overflowX !== 'visible')
    ctx.pageW = Math.min(ctx.pageW, document.body.scrollWidth);
  const withhold = (reason: string, rows: Row[] = []) => ({
    reading: { shown: false, reason } as CartReading,
    rows,
  });
  if (!document.body) return withhold('no-summary');
  const store = storefrontOf(options.url, root?.getAttribute('lang') ?? '');
  // Open shadow roots, nested ones included (a host inside a shadow tree is not in the document's own tree).
  const shadowRoots: ShadowRoot[] = [];
  const findHosts = (scope: ParentNode) => {
    for (const el of scope.querySelectorAll('*'))
      if (el.shadowRoot) {
        shadowRoots.push(el.shadowRoot);
        findHosts(el.shadowRoot);
      }
  };
  findHosts(document);
  collectRows(document.body, ctx);
  for (const sr of shadowRoots) collectRows(sr, ctx);
  if (ctx.rows.size === 0) return withhold('no-summary');

  let structured: string | null | undefined;
  let named: Set<string> | undefined;
  const evidence: PageEvidence = {
    structured: () => (structured ??= structuredCurrency(document)),
    named: () => (named ??= namedCurrencies(pageText([document.body, ...shadowRoots], ctx))),
  };
  const rows: Row[] = [];
  for (const els of ctx.rows.values()) {
    const row = readRow(els, ctx, store, evidence);
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
    // Several different totals: an order total ("grand total", "order total", "to pay") outranks a bare "total".
    if (new Set(chosen.map(key)).size > 1 && kind === 'estimatedTotal') {
      const grand = chosen.filter((r) => GRAND_RE.test(r.text.toLowerCase()));
      if (grand.length > 0) chosen = grand;
    }
    if (new Set(chosen.map(key)).size !== 1) return withhold('ambiguous', rows);
  }
  const row = chosen[0]!;
  // A total outside any cart summary ("Total price" of a bundle offer, "total value of free gifts") is not the cart's.
  if (!chosen.some((r) => r.inSummary))
    return withhold(`${kind === 'subtotal' ? 'sub' : ''}total-outside-summary`, rows);
  if (row.minor === null) return withhold('amount-unreadable', rows);
  if (!row.currency) return withhold('currency-undetermined', rows);
  if (kind === 'subtotal') {
    // An items total of zero is an empty cart: nothing to recommend a card for, and often a drawer's placeholder.
    if (row.minor === 0) return withhold('subtotal-zero', rows);
    for (const r of chosen) {
      const blocker = subtotalBlocker(r, ctx, store, evidence);
      if (blocker) {
        r.why = `not-alone: ${blocker}`;
        return withhold('subtotal-not-alone', rows);
      }
    }
  }
  return { reading: { shown: true, kind, amountMinor: row.minor, currency: row.currency }, rows };
}

/** Finds the rows of a tree: each amount-like text node climbs to its nearest small labelled ancestor or pair. */
function collectRows(root: Node, ctx: Ctx): void {
  const walker = ctx.doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // Digits of any script (Arabic-Indic, Devanagari, full-width) are normalized before the amount gate.
    if (!/\p{Nd}/u.test((n as Text).data)) continue;
    const data = normalizeText((n as Text).data);
    if (!CANDIDATE_RE.test(data)) continue;
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
      // Lengths are of the words, not of the markup's indentation.
      const text = (el.textContent ?? '').replace(/\s+/g, ' ');
      if (text.length > MAX_ROW_TEXT) break;
      // A label the shopper sees (a screen-reader-only label does not count; the climb goes on).
      if (ANY_LABEL_RE.test(text.toLowerCase()) && ANY_LABEL_RE.test(visibleText(el, ctx).toLowerCase())) {
        if (!ctx.rows.has(el)) ctx.rows.set(el, [el]);
        break;
      }
      // A label in the previous sibling: <dt>Total</dt><dd>$12</dd>, <th>Total</th><td>$12</td>. A count in
      // parentheses ("Subtotal (2 items)") is part of the label; any other digit makes it something else.
      const prev = el.previousElementSibling;
      const prevText = (prev?.textContent ?? '').replace(/\s+/g, ' ');
      if (
        prev &&
        prevText.length <= MAX_LABEL_TEXT &&
        !/\d/.test(prevText.replace(/\([^)]*\)/g, '')) &&
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

/** The text of whole trees, scripts and styles left out (visibility is not checked: this is a page-wide gate). */
function pageText(roots: Node[], ctx: Ctx): string {
  const parts: string[] = [];
  for (const root of roots) {
    const walker = ctx.doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentNode as Element | null;
      if (parent && parent.nodeType === 1 && !SKIP_PARENTS.has(parent.nodeName)) parts.push((n as Text).data);
    }
  }
  return parts.join(' ');
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

/** Hidden by its own styles (not inherited ones): display, opacity (a faded, inactive block too), clipping and screen-reader-only boxes. */
function hiddenBox(cs: CSSStyleDeclaration): boolean {
  if (cs.display === 'none' || parseFloat(cs.opacity) < 0.5 || cs.fontSize === '0px') return true;
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
  if (r.right + sx <= 0 || r.bottom + sy <= 0 || r.left + sx >= ctx.pageW) return 'off-page';
  // Below the page's end, unless a scrolling ancestor (overflow auto or scroll, taller inside than out) reaches it.
  if (r.top + sy >= ctx.pageH && !inScroller(el, ctx)) return 'off-page';
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

/** Whether an ancestor scrolls vertically, so that content below the page's own end is still reachable. */
function inScroller(el: Element, ctx: Ctx): boolean {
  for (let a = parentOf(el); a && a.nodeName !== 'BODY'; a = parentOf(a))
    if (/auto|scroll/.test(style(a, ctx).overflowY) && a.scrollHeight > a.clientHeight + 1) return true;
  return false;
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
      // Exactly two digits in a superscript are cents ("$12" "99"); one digit is a footnote mark.
      if ((e.nodeName === 'SUP' || e.nodeName === 'SUB') && /^\s*\d{2}\s*$/.test(e.textContent ?? '')) {
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
function readRow(els: Element[], ctx: Ctx, store: Storefront, page: PageEvidence): Row | null {
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
  const report = { els, text, minor: null, currency: null, inSummary: false };
  const amounts = findAmounts(text, isCode);
  if (amounts.length === 0) {
    // A total label ending in a bare number the grammar cannot read ("Total: 196") is a total the reader cannot show.
    const kind = /\d[\d.,]*\s*$/.test(text) ? classifyLabel(text.toLowerCase()) : null;
    if (kind && !lineItemOf(els.at(-1)!))
      return { ...report, kind, why: 'bare-number', inSummary: inSummary(els.at(-1)!, kind) };
    return dropped('no-amount');
  }
  const label = withoutAmounts(text);
  const lower = label.toLowerCase();
  // "$12" and "$12.00" are one amount.
  const values = new Set(
    amounts.map((a) => (a.number ? `${a.number.int}.${a.number.frac.padEnd(2, '0')}` : 'unreadable')),
  );
  if (amounts.some((a) => a.negative))
    return CREDIT_RE.test(lower) ? { ...report, kind: 'credit' } : dropped('negative');
  const kind = classifyLabel(lower);
  if (!kind) return dropped('label');
  if (lineItemOf(els.at(-1)!)) return dropped('line-item');
  // Several different amounts in one total row (a converted price, say): unreadable, but still a total of its kind.
  if (values.size !== 1)
    return { ...report, kind, why: 'several-amounts', inSummary: inSummary(els.at(-1)!, kind) };
  // Rule (a): a code written next to an amount ("USD 16.34", "£1,200.00 EGP"); a code elsewhere in the label is not.
  const codes = new Set<string>();
  for (const a of amounts) if (a.code) codes.add(a.code);
  const markers = new Set(amounts.map((a) => a.marker).filter((m): m is string => m !== null));
  const marker = markers.size > 1 ? 'conflict' : ([...markers][0] ?? null);
  const shared = amounts.find((a) => a.marker === 'shared');
  const currency =
    marker === 'conflict'
      ? null
      : resolveCurrency(
          { codes: [...codes], marker, sharedText: shared?.markerText ?? null },
          page.structured(),
          store,
          page.named,
        );
  const number = amounts[0]!.number;
  const minor = number ? toMinor(number, currency ? MINOR_UNITS[currency]! : 2) : null;
  return { ...report, kind, minor, currency, inSummary: inSummary(els.at(-1)!, kind) };
}

/** A block's text, lower-cased, with the markup's indentation collapsed (lengths are of the words). */
function blockText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether a row sits inside one product line (a product image or quantity control within three levels, before any
 * summary words): its total is the line's, not the cart's.
 */
function lineItemOf(el: Element): boolean {
  let a = parentOf(el);
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 3; depth += 1) {
    const text = blockText(a);
    if (text.length > 600) return false;
    if (SHIP_RE.test(text) || TAX_RE.test(text) || CHECKOUT_RE.test(text) || SUBTOTAL_RE.test(text))
      return false;
    if (LINE_ITEM_RE.test(text) || a.querySelector('img, picture') !== null) return true;
    a = parentOf(a);
  }
  return false;
}

/** The nearest (or, with `outermost`, the largest) ancestor up to five under body that reads as a cart summary. */
function summaryOf(el: Element, kind: Kind | 'after-candidate', outermost = false): Element | null {
  let found: Element | null = null;
  let a = parentOf(el);
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 5; depth += 1) {
    const text = blockText(a);
    if (text.length > 4000) break;
    if (
      SHIP_RE.test(text) ||
      TAX_RE.test(text) ||
      CHECKOUT_RE.test(text) ||
      (kind !== 'subtotal' && SUBTOTAL_RE.test(text))
    ) {
      found = a;
      if (!outermost) break;
    }
    a = parentOf(a);
  }
  return found;
}

/** Whether a row sits in a cart summary: an ancestor also holds shipping, tax, a checkout control or a subtotal. */
function inSummary(el: Element, kind: Kind | 'after-candidate'): boolean {
  return summaryOf(el, kind) !== null;
}

/**
 * Whether a row of the summary sits in a product line: an ancestor below the summary, not holding the subtotal row,
 * shows a product image, a quantity or a remove control. Its prices are the line's, not an unlabelled total.
 */
function inProductLine(el: Element, summary: Element, subtotal: Element): boolean {
  for (let a = parentOf(el); a && a !== summary; a = parentOf(a)) {
    if (a.contains(subtotal)) return false;
    const text = blockText(a);
    if (text.length > 600) return false;
    if (LINE_ITEM_RE.test(text) || REMOVE_RE.test(text) || a.querySelector('img, picture') !== null)
      return true;
  }
  return false;
}

/** The text with its amounts taken out: the row's label. */
function withoutAmounts(text: string): string {
  let label = '';
  let at = 0;
  for (const a of findAmounts(text, isCode)) {
    label += text.slice(at, a.start) + ' ';
    at = a.end;
  }
  return (label + text.slice(at)).replace(/\s+/g, ' ').trim();
}

/**
 * A subtotal shown alone must really be alone. Every other row of its summary that holds a digit is read: a row
 * with a total label (whatever its amount, even one the grammar cannot read) and a row with a different positive
 * amount and no explanation both mean the shopper may pay something else. Shipping, tax, savings, threshold and
 * rewards rows explain their amounts and do not count; nor do unmarked numbers when the subtotal carries a marker.
 * Returns null when the subtotal is alone, otherwise the text of the row that is in the way.
 */
function subtotalBlocker(row: Row, ctx: Ctx, store: Storefront, page: PageEvidence): string | null {
  const own = row.els.at(-1)!;
  const summary = summaryOf(own, 'subtotal', true);
  if (!summary) return null;
  const marked = findAmounts(row.text, isCode).some((a) => a.marker !== null || a.code !== null);
  const seen = new Set<Element>();
  const labels = new Map<Element, string>();
  const labelOf = (el: Element) => {
    let l = labels.get(el);
    if (l === undefined) labels.set(el, (l = withoutAmounts(normalizeText(el.textContent ?? ''))));
    return l;
  };
  const walker = ctx.doc.createTreeWalker(summary, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\d/.test((n as Text).data)) continue;
    let el = n.parentNode as Element | null;
    if (!el || el.nodeType !== 1 || SKIP_PARENTS.has(el.nodeName)) continue;
    // The nearest ancestor with words (beyond the amounts' own markers) is the row the number belongs to.
    while (el && el !== summary && !/\p{L}{2}/u.test(labelOf(el))) el = parentOf(el);
    if (!el || seen.has(el) || row.els.some((e) => e.contains(el))) continue;
    seen.add(el);
    if (hiddenWhy(el, ctx) || lineItemOf(el) || inProductLine(el, summary, own)) continue;
    // A wrapper around the subtotal row is read without the subtotal's own text.
    const text = normalizeText(visibleText(el, ctx)).replace(row.text, ' ').trim();
    if (text.length > MAX_ROW_TEXT) continue;
    const amounts = findAmounts(text, isCode).filter((a) => !a.negative);
    const others = amounts.filter((a) => {
      if (!a.number || (marked && a.marker === null && a.code === null)) return false;
      const currency = resolveCurrency(
        { codes: a.code ? [a.code] : [], marker: a.marker, sharedText: a.markerText },
        page.structured(),
        store,
        page.named,
      );
      const minor = toMinor(a.number, currency ? MINOR_UNITS[currency]! : 2);
      return minor === null || (minor !== 0 && minor !== row.minor);
    });
    const label = withoutAmounts(text).toLowerCase();
    const bareNumber = amounts.length === 0 && /\d[\d.,]*\s*$/.test(text);
    if (classifyLabel(label) !== null && (others.length > 0 || bareNumber)) return text;
    // "Incl. tax" beside an amount qualifies a total; with a rate ("incl. VAT 19%") it is the tax itself.
    const explained =
      EXCLUDE_RE.test(label) ||
      ((SHIP_RE.test(label) || TAX_RE.test(label)) && (!PREP_RE.test(label) || /\d\s?%/.test(label)));
    if (others.length > 0 && !explained) return text;
  }
  return null;
}
