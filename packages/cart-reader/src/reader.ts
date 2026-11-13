// Generic cart reader (Phase 13). Contract: docs/evals/generic-reader-protocol.md and
// wiki/system/extension.md#generic-cart-reader. `readCart` is deterministic and synchronous; it reads
// only the document it is given (open shadow roots included), never the network, a model, storage or the clock, and
// never the rebuild's `data-pane-*` attributes or any per-domain list. It shows an amount only when certain and
// otherwise withholds. The evaluation harness is evals/reader/.
//
// How it reads (development rounds 1 to 4 and round 6, 2026-10-08):
// 1. Every text node that looks like an amount climbs to its row: the nearest small ancestor whose text carries a
//    summary label (total, subtotal, amount due, in many languages), or a labelled previous sibling of an ancestor
//    (dt/dd, th/td, label/value pairs).
//    An amount drawn one character per element (an animated total: "$", "8", "4", ".", "0", "0", each in its own
//    span) is one text: it climbs once, from the element that holds the characters, and reads as one word.
//    A collapsed order summary is a row too: the control that opens it ("Order summary ⌄ $84.00", aria-expanded
//    or a <summary>) names the summary and shows one amount, the order's total, often with no label the shopper
//    sees (`summaryToggle`).
// 2. A row counts when it is visible to the shopper (display, visibility, opacity below one half, clipping, not slid
//    out of view by a transform, on the page or inside a scrolling panel), its visible text has exactly one distinct
//    non-negative amount, and its label
//    is a total, subtotal or, next to a credit row, an after-credit total. Savings, shipping, tax, points, instalment
//    and line-item rows are excluded. A total label ending in a bare number the grammar cannot read is a total the
//    reader cannot show, and withholds. A card offer's hypothetical credit ("upon approval", "statement credit") is
//    neither a credit nor a total after one. A credit row in a card-offer panel beside no summary total neither
//    blocks the summary's amount nor makes an after-credit total (15.1b, 2026-10-20); any other credit row beside a
//    total still counts. Rows inside a page header (a basket flyout) are left out when a summary
//    row sits outside every header: the page's own summary outranks the flyout.
// 3. The most preferred kind present wins (afterCredit > estimatedTotal > subtotal). Two different amounts of that
//    kind mean withhold, unless only one of them sits in a cart summary (next to shipping, tax or a checkout control)
//    or, within one summary list, one is an order total and the other a bare total.
//    A total outside any summary (a bundle offer's "total price") withholds. A subtotal alone is shown only when no
//    other row of its summary holds a total label or an unexplained different amount (shipping, tax, savings,
//    threshold and rewards rows explain theirs).
// 4. Currency by the protocol's evidence order; the storefront's currency (rule (d)) is not used when the page's text
//    names another currency, nor when its structured data disagrees with itself and another code is in view.
//    Unparseable amounts withhold. A zero total is shown (an empty cart); a zero subtotal is withheld, since it is
//    often a drawer's placeholder.
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
  OFFER_RE,
  PREP_RE,
  SHIP_RE,
  SUBTOTAL_RE,
  SUMMARY_NAME_RE,
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
const VISIBILITY_OPTS = { opacityProperty: true, visibilityProperty: true };
const MAX_ROW_TEXT = 200;
const MAX_LABEL_TEXT = 80;
const MAX_ROW_NODES = 300;
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
/** A bare numeric fragment ("12", "99" of a split price): its marker and label sit within a few levels. */
const FRAGMENT_RE = /^\s*[\d.,' \u00a0]+\s*$/u;
const MAX_FRAGMENT_CLIMB = 5;

export type Ctx = {
  doc: Document;
  view: Window | null;
  styles: Map<Element, CSSStyleDeclaration>;
  layout: boolean;
  pageW: number;
  pageH: number;
  /** Candidate rows keyed by the element holding the amount. */
  rows: Map<Element, Element[]>;
  /** Short texts (`shortText`) and block texts (`blockText`), cached: the climbs share ancestors. */
  texts: Map<Element, string | null>;
  blocks: Map<Element, string>;
  visible: Map<Element, string>;
  /** Open shadow roots of the page, nested ones included (filled by `analyze`). */
  shadowRoots: ShadowRoot[];
  /** Whether an element's text is split one character per child element (`isCharRun`), cached. */
  runs: Map<Element, boolean>;
};

/** Page-wide currency evidence, read lazily once: structured data (rule (b)) and currencies named in the text. */
type PageEvidence = { structured: () => string | 'conflict' | null; named: () => Set<string> };
const CODE_WORD_RE = /(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g;

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
export type Row = RowReport & { els: Element[] };

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

/** The reader's one pass over a page: its reading, its candidate rows and the context (styles, texts) it built. */
export function analyze(
  document: Document,
  options: ReadOptions,
): { reading: CartReading; rows: Row[]; ctx: Ctx | null } {
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
    texts: new Map(),
    blocks: new Map(),
    visible: new Map(),
    shadowRoots: [],
    runs: new Map(),
  };
  // A body that clips or scrolls its own overflow bounds what the shopper can reach sideways: its overflow applies to
  // the viewport (the body's own box may be narrower or offset, as on a right-to-left page), so the bound is the
  // viewport's width.
  if (document.body && view && ctx.layout && view.getComputedStyle(document.body).overflowX !== 'visible')
    ctx.pageW = Math.min(ctx.pageW, root.clientWidth);
  const withhold = (reason: string, rows: Row[] = []) => ({
    reading: { shown: false, reason } as CartReading,
    rows,
    ctx,
  });
  if (!document.body) return withhold('no-summary');
  const store = storefrontOf(options.url, root?.getAttribute('lang') ?? '');
  // Open shadow roots, nested ones included (a host inside a shadow tree is not in the document's own tree).
  const shadowRoots = ctx.shadowRoots;
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

  let structured: string | 'conflict' | null | undefined;
  let named: Set<string> | undefined;
  const evidence: PageEvidence = {
    // Memoized with `undefined` as the sentinel: a page with no structured currency (null) is read once too.
    structured: () => (structured === undefined ? (structured = structuredCurrency(document)) : structured),
    named: () => {
      if (named) return named;
      const text = pageText([document.body, ...shadowRoots], ctx);
      named = namedCurrencies(
        text,
        [document, ...shadowRoots].flatMap((r) =>
          [...r.querySelectorAll('select')].map((s) =>
            [...s.options].map((o) => ({ text: o.textContent ?? '', selected: o.selected })),
          ),
        ),
      );
      // Structured data that disagrees with itself (a storefront serving several currencies) makes every currency
      // code the shopper can see count against the storefront's currency (rule (d)).
      if (evidence.structured() === 'conflict')
        for (const m of text.matchAll(CODE_WORD_RE)) if (isCode(m[0])) named.add(m[0]);
      return named;
    },
  };
  let rows: Row[] = [];
  for (const els of ctx.rows.values()) {
    const row = readRow(els, ctx, store, evidence);
    if (row) rows.push(row);
  }
  // A header's basket flyout (often laid out off the page by stylesheets the rebuild lacks) yields to the page's own
  // summary: when a summary row outside every header holds a non-zero amount of the same or a more preferred kind,
  // the rows inside headers are left out. A header total that disagrees with an outside row is otherwise ambiguous.
  const labelled = rows.filter((r) => r.kind !== null && r.kind !== 'credit');
  const inside = labelled.filter((r) => inHeader(r.els[0]!));
  if (inside.length > 0) {
    const rank = (r: Row) => (r.kind === 'after-candidate' ? 1 : KINDS.indexOf(r.kind as Kind));
    const best = Math.min(...inside.map(rank));
    const outside = labelled.filter((r) => r.inSummary && !inHeader(r.els[0]!));
    const amount = (r: Row) => `${r.currency ?? '?'}:${r.minor ?? 'unreadable'}`;
    if (outside.some((r) => r.minor !== 0 && rank(r) <= best))
      rows = rows.filter((r) => !inHeader(r.els[0]!));
    else if (outside.some((o) => inside.some((i) => amount(o) !== amount(i))))
      return withhold('ambiguous', rows);
  }
  // An unreadable total row that wraps another total row is an aggregate (a block whose other amounts climbed to
  // its label), not a second total of its kind.
  for (const r of rows)
    if (r.why === 'several-amounts' && rows.some((o) => o !== r && r.els.at(-1)!.contains(o.els.at(-1)!)))
      r.kind = null;
  // "Amount due", "balance" and the like are after-credit totals only beside a credit row (same parent); otherwise
  // they are plain totals when they say so, and nothing at all when they do not. A credit beside no summary total is
  // left out only when it sits in a card offer (15.1b, 2026-10-20; narrowed in review): a card-offer panel's
  // illustration ("Current subtotal", "Gift card savings: -$50") is not a credit the shopper's total carries, but a
  // gift card applied in a payment section or a credits panel beside the summary is, and still withholds. A credit
  // that says it is applied or redeemed always counts, whatever block it sits in.
  const totals = rows.filter((r) => r.kind !== null && r.kind !== 'credit');
  const offerCredit = (r: Row) =>
    !APPLIED_RE.test(r.text.toLowerCase()) && inOfferBlock(r.els.at(-1)!, ctx, true);
  const credits = rows.filter(
    (r) => r.kind === 'credit' && totals.some((t) => near(r, t) && (t.inSummary || !offerCredit(r))),
  );
  const resolved: (Row & { kind: Kind })[] = [];
  for (const r of rows) {
    if (r.kind === 'credit' || r.kind === null) continue;
    if (r.kind !== 'after-candidate') resolved.push(r as Row & { kind: Kind });
    else if (credits.some((c) => near(r, c))) resolved.push({ ...r, kind: 'afterCredit' });
    else if (TOTAL_RE.test(r.text.toLowerCase())) resolved.push({ ...r, kind: 'estimatedTotal' });
  }
  // Arithmetic between two labelled rows of one kind: a row that equals another plus one shipping row of that other's
  // summary is the order total, and the other the items total ("Total $139.95" + "Est. shipping $5.95" = "Total Price
  // $145.90"; "Item total" + "Shipping total" = "Subtotal"). Tax does not count: a total before tax and one after it
  // are the protocol's ambiguous pair, and sums of several rows are left alone.
  const summed = resolved.filter((r) => r.minor !== null && r.minor > 0 && r.inSummary);
  // Two items totals are promoted only when no order total is labelled already (review fix, 13c.5): "Item total" +
  // "Shipping total" = "Subtotal" beside a "Total" row would make a second total. Every pair is judged on the rows as
  // labelled, so two sellers' sub-carts promote together and stay ambiguous.
  const hadTotal = resolved.some((r) => r.kind === 'estimatedTotal');
  const promoted: [Row, Row][] = [];
  for (const b of summed)
    for (const a of summed) {
      if (a === b || a.kind !== b.kind || a.kind === 'afterCredit') continue;
      if (a.currency !== b.currency || a.minor! >= b.minor!) continue;
      if (a.kind === 'subtotal' && hadTotal) continue;
      const summary = summaryOf(a.els.at(-1)!, a.kind, ctx);
      if (!summary) continue;
      const addons = shippingAmounts(summary, [...a.els, ...b.els], ctx, MINOR_UNITS[b.currency!]!);
      if (addons.includes(b.minor! - a.minor!)) promoted.push([a, b]);
    }
  for (const [a, b] of promoted) {
    b.kind = 'estimatedTotal';
    a.kind = 'subtotal';
    a.why = 'items-total-by-sum';
  }
  const kind = KINDS.find((k) => resolved.some((r) => r.kind === k));
  if (!kind) return withhold('no-summary', rows);
  if (credits.length > 0 && kind !== 'afterCredit') return withhold('credit-unclear', rows);
  let chosen = resolved.filter((r) => r.kind === kind);
  const key = (r: Row) => (r.minor === null ? 'unreadable' : `${r.currency ?? '?'}:${r.minor}`);
  if (new Set(chosen.map(key)).size > 1) {
    chosen = chosen.filter((r) => r.inSummary);
    // Several different totals in one summary list: an order total ("grand total", "order total", "to pay") outranks
    // a bare "total". A different total elsewhere (a fixed bar, another panel) stays ambiguous.
    if (new Set(chosen.map(key)).size > 1 && kind === 'estimatedTotal') {
      const grand = chosen.filter((r) => GRAND_RE.test(r.text.toLowerCase()));
      if (grand.length > 0 && chosen.every((r) => grand.some((g) => g === r || near(g, r)))) chosen = grand;
    }
    if (new Set(chosen.map(key)).size !== 1) return withhold('ambiguous', rows);
  }
  const row = chosen[0]!;
  // A total outside any cart summary ("Total price" of a bundle offer, "total value of free gifts") is not the cart's.
  if (!chosen.some((r) => r.inSummary))
    return withhold(`${kind === 'subtotal' ? 'sub' : ''}total-outside-summary`, rows);
  if (row.minor === null) return withhold('amount-unreadable', rows);
  if (!row.currency) return withhold('currency-undetermined', rows);
  // A total below every readable items total of its summary, with no credit row and no negative amount in the
  // summary's text to explain it, is a misread row (a tax row taken for a total, say). An items total above it beside
  // another that matches is a discount shown without a negative amount.
  if (kind === 'estimatedTotal') {
    const subs = rows.filter((r) => r.kind === 'subtotal' && r.minor !== null && near(r, row));
    if (subs.length > 0 && subs.every((r) => r.minor! > row.minor!)) {
      const first = row.els[0]!;
      const scope = parentOf(parentOf(first) ?? first) ?? first;
      const negative = findAmounts(normalizeText(visibleText(scope, ctx)), isCode).some((a) => a.negative);
      if (!negative && credits.length === 0) return withhold('total-below-subtotal', rows);
    }
  }
  if (kind === 'subtotal') {
    // An items total of zero is an empty cart: nothing to recommend a card for, and often a drawer's placeholder.
    if (row.minor === 0) return withhold('subtotal-zero', rows);
    for (const r of chosen) {
      // A wrapper row around another chosen row is an aggregate of it: the inner row's company is checked.
      if (chosen.some((o) => o !== r && r.els.at(-1)!.contains(o.els.at(-1)!))) continue;
      const blocker = subtotalBlocker(r, ctx, store, evidence);
      if (blocker) {
        r.why = `not-alone: ${blocker}`;
        return withhold('subtotal-not-alone', rows);
      }
    }
  }
  return { reading: { shown: true, kind, amountMinor: row.minor, currency: row.currency }, rows, ctx };
}

/** Finds the rows of a tree: each amount-like text node climbs to its nearest small labelled ancestor or pair. */
function collectRows(root: Node, ctx: Ctx): void {
  const walker = ctx.doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const runs = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // Digits of any script (Arabic-Indic, Devanagari, full-width) are normalized before the amount gate.
    if (!/\p{Nd}/u.test((n as Text).data)) continue;
    const parent = n.parentNode as Element | null;
    if (
      !parent ||
      parent.nodeType !== 1 ||
      SKIP_PARENTS.has(parent.nodeName) ||
      parent.namespaceURI !== XHTML
    )
      continue;
    let el: Element | null = parent;
    let data = normalizeText((n as Text).data);
    // An amount split one character per element climbs once, from the element that holds the characters, as its
    // whole text: a lone "8" is a fragment whose label may sit further up than a fragment climbs.
    const run = parentOf(parent);
    if (run && isCharRun(run, ctx)) {
      if (runs.has(run)) continue;
      runs.add(run);
      data = normalizeText(run.textContent ?? '');
      el = run;
    }
    if (!CANDIDATE_RE.test(data)) continue;
    const climb = FRAGMENT_RE.test(data) && !MARK_RE.test(data) ? MAX_FRAGMENT_CLIMB : MAX_CLIMB;
    for (let depth = 0; el && depth < climb; depth += 1) {
      if (LIST_TAGS.has(el.nodeName)) break;
      const text = shortText(el, ctx);
      if (text === null) break;
      // A label the shopper sees (a screen-reader-only label does not count; the climb goes on).
      if (ANY_LABEL_RE.test(text.toLowerCase()) && ANY_LABEL_RE.test(visibleText(el, ctx).toLowerCase())) {
        if (!ctx.rows.has(el)) ctx.rows.set(el, [el]);
        break;
      }
      // A label in the previous sibling: <dt>Total</dt><dd>$12</dd>, <th>Total</th><td>$12</td>. A count in
      // parentheses ("Subtotal (2 items)") is part of the label; any other digit makes it something else.
      const prev = el.previousElementSibling;
      const prevText = prev ? shortText(prev, ctx) : null;
      if (
        prev &&
        prevText !== null &&
        prevText.length <= MAX_LABEL_TEXT &&
        !/\d/.test(prevText.replace(/\([^)]*\)/g, '')) &&
        ANY_LABEL_RE.test(prevText.toLowerCase()) &&
        !hiddenWhy(prev, ctx)
      ) {
        if (!ctx.rows.has(el)) ctx.rows.set(el, [prev, el]);
        break;
      }
      // The control of a collapsed order summary: its amount has no label of its own to climb to.
      if (summaryToggle(el, ctx)) {
        if (!ctx.rows.has(el)) ctx.rows.set(el, [el]);
        break;
      }
      el = parentOf(el);
    }
  }
}

/**
 * An element's text with the markup's indentation collapsed (lengths are of the words), or null when it is longer
 * than `MAX_ROW_TEXT`: the walk stops as soon as that is certain, and the result is cached.
 */
function shortText(el: Element, ctx: Ctx): string | null {
  let text = ctx.texts.get(el);
  if (text !== undefined) return text;
  const parts: string[] = [];
  let letters = 0;
  const walker = ctx.doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const data = (n as Text).data;
    parts.push(data);
    letters += data.trim().length;
    // A block of thousands of text nodes (a navigation of whitespace and icons) is no row, whatever its words.
    if (letters > MAX_ROW_TEXT || parts.length > MAX_ROW_NODES) {
      letters = MAX_ROW_TEXT + 1;
      break;
    }
  }
  text = letters > MAX_ROW_TEXT ? null : parts.join('').replace(/\s+/g, ' ');
  if (text !== null && text.length > MAX_ROW_TEXT) text = null;
  ctx.texts.set(el, text);
  return text;
}

/**
 * The text a shopper can see across whole trees: hidden boxes (own styles only), scripts, styles and option lists left
 * out. Layout is not checked: this is a page-wide gate.
 */
function pageText(roots: Node[], ctx: Ctx): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) parts.push((n as Text).data);
      else if (n.nodeType === 1 && !SKIP_PARENTS.has(n.nodeName)) {
        const el = n as Element;
        // The browser's own check first (cheap); computed styles only for boxes it reports hidden, since a box-less
        // element (display: contents) still shows its text.
        if (!el.checkVisibility || !el.checkVisibility(VISIBILITY_OPTS)) {
          const cs = style(el, ctx);
          if (hiddenBox(cs) || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
        }
        walk(n);
      }
    }
  };
  for (const root of roots) walk(root);
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

/** Whether an element sits inside a page header (a `header` not within `main`, or a banner landmark). */
export function inHeader(el: Element): boolean {
  for (let a: Element | null = el; a && a.nodeName !== 'BODY'; a = parentOf(a)) {
    if (a.nodeName === 'MAIN' || a.getAttribute('role') === 'main') return false;
    if (a.nodeName === 'HEADER' || a.getAttribute('role') === 'banner') return true;
  }
  return false;
}

export function parentOf(el: Element): Element | null {
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
export function hiddenWhy(el: Element, ctx: Ctx): string | null {
  const own = style(el, ctx);
  if (own.visibility === 'hidden' || own.visibility === 'collapse') return 'visibility';
  for (let a: Element | null = el; a; a = parentOf(a))
    if (hiddenBox(style(a, ctx))) return a === el ? 'box' : 'ancestor-box';
  if (!ctx.layout) return null;
  // An off-canvas drawer slid out of view: an ancestor translated by at least its own width or height to beyond the
  // viewport's edge (a box aligned right by left:100% and translateX(-100%) stays on screen).
  for (let a: Element | null = el; a; a = parentOf(a)) if (translatedAway(a, ctx)) return 'translated-away';
  // The box of the element's contents (a wrapper's own box may be collapsed); a void element (an input) has none and
  // is measured by its own box.
  const range = ctx.doc.createRange();
  range.selectNodeContents(el);
  const r = el.firstChild ? range.getBoundingClientRect() : el.getBoundingClientRect();
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

/**
 * Whether a box is translated (translateX(100%), translateY(-100%)) at least its own width or height away, and lies
 * beyond the viewport's edge where it ends up.
 */
function translatedAway(el: Element, ctx: Ctx): boolean {
  const m = /^matrix\(([^)]*)\)$/.exec(style(el, ctx).transform ?? '');
  if (!m) return false;
  const [, , , , tx, ty] = m[1]!.split(',').map(Number);
  const r = el.getBoundingClientRect();
  const viewW = ctx.view?.innerWidth ?? 0;
  const viewH = ctx.view?.innerHeight ?? 0;
  if (r.width >= 1 && Math.abs(tx!) >= r.width - 1 && (r.right <= 0 || r.left >= viewW)) return true;
  return r.height >= 1 && Math.abs(ty!) >= r.height - 1 && (r.bottom <= 0 || r.top >= viewH);
}

/** Whether an ancestor scrolls vertically, so that content below the page's own end is still reachable. */
function inScroller(el: Element, ctx: Ctx): boolean {
  for (let a = parentOf(el); a && a.nodeName !== 'BODY'; a = parentOf(a))
    if (/auto|scroll/.test(style(a, ctx).overflowY) && a.scrollHeight > a.clientHeight + 1) return true;
  return false;
}

/** The text a shopper sees inside `el`: hidden and struck-through parts dropped, boxes separated by spaces; cached. */
export function visibleText(el: Element, ctx: Ctx): string {
  let text = ctx.visible.get(el);
  if (text === undefined) ctx.visible.set(el, (text = readVisibleText(el, ctx)));
  return text;
}

function readVisibleText(el: Element, ctx: Ctx): string {
  const parts: string[] = [];
  // A block of hundreds of elements (a navigation of icons) is no row: its walk stops there.
  let budget = MAX_ROW_NODES;
  const walk = (node: Node) => {
    for (let c = node.firstChild; c && budget > 0; c = c.nextSibling) {
      if (c.nodeType === 3) {
        // Two words or numbers that touch across elements are separate things ("Subtotal" "USD 16.34").
        const data = (c as Text).data;
        if (ALNUM_END.test(parts.at(-1) ?? '') && ALNUM_START.test(data)) parts.push(' ');
        parts.push(data);
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      budget -= 1;
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
      if (!word(e)) walk(e.shadowRoot ?? e);
      if (!inline) parts.push(' ');
    }
  };
  // A text split one character per element is one word: "$", "8", "4" are "$84", not "$8 4". Only when every
  // character is plainly shown (`charState`), nothing around the run is part-way through a fade (`fading`) and the
  // characters stand in one line inside their clipping boxes (`charLine`). A run that is wholly hidden (the amount
  // being replaced) is left out. Any other is read element by element as before, and so not as a number.
  const word = (e: Element): boolean => {
    if (e.shadowRoot || !isCharRun(e, ctx)) return false;
    const chars = [...e.children];
    budget -= chars.length;
    const states = chars.map((c) => charState(c, ctx));
    if (states.every((state) => state === 'hidden')) return true;
    if (!states.every((state) => state === 'shown') || fading(e, ctx) || !charLine(e, chars, ctx))
      return false;
    const text = chars.map((c) => c.textContent ?? '').join('');
    if (ALNUM_END.test(parts.at(-1) ?? '') && ALNUM_START.test(text)) parts.push(' ');
    parts.push(text);
    return true;
  };
  if (!word(el)) walk(el.shadowRoot ?? el);
  return parts.join('');
}

/** The fewest characters, one per element, that make one split text: two neighbours ("2" beside "x") are not one. */
const MIN_CHAR_RUN = 3;

/**
 * Whether an element's text is split one character per child element, as animated prices and split-text effects
 * draw it ("$", "8", "4", ".", "0", "0"): at least MIN_CHAR_RUN children and nothing else (no text of its own, not
 * even spaces, which would show between the characters), all of one tag, each an inline or inline-block box holding
 * exactly one character. A stepper ("−", "1", "+": buttons around a span) and a list of two-digit numbers are not.
 */
function isCharRun(el: Element, ctx: Ctx): boolean {
  let run = ctx.runs.get(el);
  if (run !== undefined) return run;
  const first = el.firstElementChild;
  run = first !== null && el.childElementCount >= MIN_CHAR_RUN && first.namespaceURI === XHTML;
  for (let c = el.firstChild; c && run; c = c.nextSibling) {
    // Comments (a framework's markers between its text) are not content.
    if (c.nodeType === 8) continue;
    const only = c.firstChild;
    run =
      c.nodeType === 1 &&
      c.nodeName === first!.nodeName &&
      !SKIP_TAGS.has(c.nodeName) &&
      only !== null &&
      only === c.lastChild &&
      only.nodeType === 3 &&
      [...(only as Text).data].length === 1;
  }
  // Styles last: only for elements whose children already look like characters.
  if (run)
    run = [...el.children].every((c) => {
      const display = style(c, ctx).display;
      return display === 'inline' || display === 'inline-block' || display === '';
    });
  ctx.runs.set(el, run);
  return run;
}

/** Whether a computed colour paints next to nothing: `transparent`, or an alpha below a tenth. */
function faint(colour: string | undefined): boolean {
  if (!colour) return false;
  if (colour === 'transparent') return true;
  const alpha = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(colour) ?? /\/\s*([\d.]+)(%?)\)$/.exec(colour);
  return alpha !== null && Number(alpha[1]) / (alpha[2] ? 100 : 1) < 0.1;
}
/** An opacity part-way between hidden and shown: a fade in progress. */
const midFade = (opacity: string | undefined): boolean => {
  const value = parseFloat(opacity ?? '');
  return value > 0.01 && value < 0.99;
};
/** A clip path or a mask on a box: part of what is in it may not show, and which part is not worked out. */
const veiled = (cs: CSSStyleDeclaration): boolean => {
  const mask = (cs as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage;
  return [cs.clipPath, cs.maskImage, mask].some((value) => Boolean(value) && value !== 'none');
};
/** Characters that take no room in a line (spaces, zero-width and direction marks): not measured. */
const UNSEEN_RE = /^[\s\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]*$/;

/**
 * How one character of a split text is drawn: plainly shown, hidden (by its own styles, a colour that paints next
 * to nothing or, where there is layout, an empty box), or `partly`: an opacity between the two (a fade in
 * progress), or a transparent colour under a background clipped to the text (gradient lettering, which does show).
 */
function charState(el: Element, ctx: Ctx): 'shown' | 'hidden' | 'partly' {
  const cs = style(el, ctx);
  if (midFade(cs.opacity) || veiled(cs)) return 'partly';
  if (hiddenBox(cs) || cs.visibility === 'hidden' || cs.visibility === 'collapse') return 'hidden';
  const fill = (cs as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor;
  if (faint(cs.color) || faint(fill))
    return (cs.backgroundClip ?? '').includes('text') || (cs.webkitBackgroundClip ?? '').includes('text')
      ? 'partly'
      : 'hidden';
  if (!ctx.layout || UNSEEN_RE.test(el.textContent ?? '')) return 'shown';
  const r = el.getBoundingClientRect();
  return r.width < 1 || r.height < 1 ? 'hidden' : 'shown';
}

/** How many levels above a split text a fade or a clipping box is looked for. */
const RUN_LEVELS = 6;

/**
 * Whether the run or a box near it is part-way through a fade (a layer cross-fading with the one it replaces) or
 * cut by a clip path or a mask.
 */
function fading(run: Element, ctx: Ctx): boolean {
  let a: Element | null = run;
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < RUN_LEVELS; depth += 1, a = parentOf(a)) {
    const cs = style(a, ctx);
    if (midFade(cs.opacity) || veiled(cs)) return true;
  }
  return false;
}

/**
 * Whether the characters of a split text stand as the shopper reads them (checked where there is layout): every
 * box within the height of the tallest one (a smaller raised "$" is; a digit part-way through a roll is not), each
 * after the one before without overlapping it, in one direction, and every box whole inside each box near the run
 * that cuts off its overflow. A digit rolled off the line, drawn over its neighbour or cut by the box around the
 * amount fails: the run would read as a number the shopper does not see.
 */
function charLine(run: Element, chars: Element[], ctx: Ctx): boolean {
  if (!ctx.layout) return true;
  const rects = chars
    .filter((c) => !UNSEEN_RE.test(c.textContent ?? ''))
    .map((c) => c.getBoundingClientRect());
  if (rects.length === 0) return true;
  const tallest = rects.reduce((a, b) => (b.height > a.height ? b : a));
  const lift = Math.max(1, tallest.height * 0.08);
  for (const [i, r] of rects.entries()) {
    if (r.top < tallest.top - lift || r.bottom > tallest.bottom + lift) return false;
    if (i === 0) continue;
    const prev = rects[i - 1]!;
    // Kerning may pull neighbours a little into each other; a quarter of the narrower box is the most.
    const slack = Math.min(prev.width, r.width) / 4;
    const step = r.left >= prev.right - slack ? 1 : r.right <= prev.left + slack ? -1 : 0;
    const before = i > 1 ? Math.sign(prev.left - rects[i - 2]!.left) : step;
    if (step === 0 || step !== before) return false;
  }
  let a: Element | null = run;
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < RUN_LEVELS; depth += 1, a = parentOf(a)) {
    const cs = style(a, ctx);
    // Sideways, a scrolling box counts too: its scrollbar may be hidden, and an amount is not scrolled to be read.
    // Downwards it does not: a summary further down a scrolling panel is the shopper's to reach.
    const clipX = /hidden|clip|auto|scroll/.test(cs.overflowX ?? '');
    const clipY = /hidden|clip/.test(cs.overflowY ?? '');
    if (!clipX && !clipY) continue;
    const box = a.getBoundingClientRect();
    for (const r of rects) {
      if (clipX && (r.left < box.left - 1 || r.right > box.right + 1)) return false;
      // A line box may be a little shorter than the glyph boxes in it, which then stand out of it unclipped.
      const over = Math.max(1, r.height * 0.15);
      if (clipY && (r.top < box.top - over || r.bottom > box.bottom + over)) return false;
    }
  }
  return true;
}

/** Reads one candidate row (one element, or a label element and a value element). */
function readRow(els: Element[], ctx: Ctx, store: Storefront, page: PageEvidence): Row | null {
  const text = withoutSavedNote(normalizeText(els.map((el) => visibleText(el, ctx)).join(' ')));
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
    if (kind && !lineItemOf(els.at(-1)!, ctx))
      return { ...report, kind, why: 'bare-number', inSummary: inSummary(els.at(-1)!, kind, ctx) };
    return dropped('no-amount');
  }
  const label = withoutAmounts(text);
  const lower = label.toLowerCase();
  // "$12" and "$12.00" are one amount.
  const values = new Set(
    amounts.map((a) => (a.number ? `${a.number.int}.${a.number.frac.padEnd(2, '0')}` : 'unreadable')),
  );
  if (amounts.some((a) => a.negative))
    return CREDIT_RE.test(lower) && !OFFER_RE.test(lower)
      ? { ...report, kind: 'credit' }
      : dropped('negative');
  // A collapsed order summary's control shows the order's total (`toggleKind`).
  const toggle = els.length === 1 && summaryToggle(els[0]!, ctx);
  const kind = classifyLabel(lower) ?? (toggle && values.size === 1 ? toggleKind(els[0]!, lower) : null);
  if (!kind) return dropped('label');
  if ((kind === 'after-candidate' && OFFER_RE.test(lower)) || inOfferBlock(els.at(-1)!, ctx))
    return dropped('offer');
  if (lineItemOf(els.at(-1)!, ctx)) return dropped('line-item');
  // Several different amounts in one total row (a converted price, say): unreadable, but still a total of its kind.
  if (values.size !== 1)
    return { ...report, kind, why: 'several-amounts', inSummary: inSummary(els.at(-1)!, kind, ctx) };
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
  return { ...report, kind, minor, currency, inSummary: inSummary(els.at(-1)!, kind, ctx) };
}

/**
 * A block's text, lower-cased, with the markup's indentation collapsed (lengths are of the words); cached. Scripts,
 * styles, templates and option lists inside the block are left out (an inline stylesheet or JSON blob beside a
 * summary row is not the shopper's words); the walk stops once the text is longer than any caller reads.
 */
export function blockText(el: Element, ctx: Ctx): string {
  let text = ctx.blocks.get(el);
  if (text === undefined) {
    // A plain walk: a TreeWalker filter callback cannot run in a document whose scripting is off.
    const parts: string[] = [];
    let length = 0;
    const walk = (node: Node) => {
      for (let c = node.firstChild; c && length <= MAX_BLOCK_TEXT; c = c.nextSibling) {
        if (c.nodeType === 3) {
          parts.push((c as Text).data);
          length += (c as Text).data.length;
        } else if (c.nodeType === 1 && !SKIP_PARENTS.has(c.nodeName)) walk(c);
      }
    };
    walk(el);
    ctx.blocks.set(el, (text = parts.join('').replace(/\s+/g, ' ').toLowerCase()));
  }
  return text;
}
const MAX_BLOCK_TEXT = 4000;
/** The longest text a cart summary block (totals, shipping, tax, promo field, checkout controls) runs to. */
const MAX_SUMMARY_TEXT = 1500;
/** Table structure between a row and its summary: these levels do not count toward the summary climb. */
const TABLE_TAGS = new Set(['TR', 'TBODY', 'THEAD', 'TFOOT', 'TABLE']);

/**
 * Whether a row sits inside one product line (a product image or quantity control within three levels, before any
 * summary words): its total is the line's, not the cart's.
 */
function lineItemOf(el: Element, ctx: Ctx): boolean {
  let a = parentOf(el);
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 3; depth += 1) {
    const text = blockText(a, ctx);
    if (text.length > 600) return false;
    if (SHIP_RE.test(text) || TAX_RE.test(text) || CHECKOUT_RE.test(text) || SUBTOTAL_RE.test(text))
      return false;
    if (LINE_ITEM_RE.test(text) || a.querySelector('img, picture') !== null) return true;
    a = parentOf(a);
  }
  return false;
}

/**
 * The nearest (or, with `outermost`, the largest) ancestor up to five under body that reads as a cart summary. For
 * the nearest, table structure (a row in a table footer) does not count toward the five.
 */
function summaryOf(
  el: Element,
  kind: Kind | 'after-candidate',
  ctx: Ctx,
  outermost = false,
  maxText = MAX_BLOCK_TEXT,
): Element | null {
  let found: Element | null = null;
  let a = parentOf(el);
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 5;) {
    // Table structure is free only for the nearest summary; the largest scope stays tight.
    if (outermost || !TABLE_TAGS.has(a.nodeName)) depth += 1;
    const text = blockText(a, ctx);
    if (text.length > maxText) break;
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
function inSummary(el: Element, kind: Kind | 'after-candidate', ctx: Ctx): boolean {
  if (summaryOf(el, kind, ctx) !== null) return true;
  // A row inside the control of a collapsed order summary ("Order summary · Total $84.00") is in that summary.
  let a: Element | null = el;
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < TOGGLE_LEVELS; depth += 1, a = parentOf(a))
    if (summaryToggle(a, ctx)) return true;
  return false;
}

/** How many levels up a row may sit inside the control of a collapsed order summary. */
const TOGGLE_LEVELS = 4;
/** The longest text such a control runs to: its name, a count and one amount. */
const MAX_TOGGLE_TEXT = 100;

/**
 * Whether an element is the control of a collapsed order summary: a disclosure (`aria-expanded`, or a `<summary>`)
 * outside the page header whose short text names the order summary. Checkouts fold the summary behind it on narrow
 * windows and leave only the total beside the name. A header's cart button is not one.
 */
function summaryToggle(el: Element, ctx: Ctx): boolean {
  if (!el.hasAttribute('aria-expanded') && el.nodeName !== 'SUMMARY') return false;
  const text = shortText(el, ctx);
  if (text === null || text.length > MAX_TOGGLE_TEXT || !SUMMARY_NAME_RE.test(text.toLowerCase()))
    return false;
  return !inHeader(el);
}

/** Words such a control carries beside the summary's name: "show", "hide" and their like. */
const TOGGLE_WORDS_RE =
  /\b(?:show|hide|view|toggle|open|close|expand|collapse|details)\b|anzeigen|ausblenden|einblenden|afficher|masquer|mostrar|ocultar|mostra|nascondi|tonen|verbergen|poka[żz]|ukryj|g[öo]ster|gizle|表示|非表示|显示|隐藏|顯示|隱藏|보기|숨기기|عرض|إخفاء/gu;
/** A count of items on it: "(3)", "3 items", "(2 articles)". */
const TOGGLE_COUNT_RE =
  /\(\s*\d+\s*\)|\(?\s*\b\d+\s*(?:items?|products?|articles?|artikel|produkte?|produits?|art[ií]culos?|productos?|articoli|prodotti|itens|producten|st[üu]ck|stuks?)\b\s*\)?/gu;

/** What a summary control's label (lower-cased, amounts removed) says beside its name, "show" or "hide" and a count. */
function toggleRest(label: string): string {
  return label
    .replace(SUMMARY_NAME_RE, ' ')
    .replace(TOGGLE_COUNT_RE, ' ')
    .replace(TOGGLE_WORDS_RE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
/** Articles and possessives that may stand in the summary's name ("the", "your", "le", "de la", "het"). */
const TOGGLE_FILLER = new Set(
  'the your my a le la les l de du des votre vos mon ma der die das den dem ihre ihr deine meine el los las del tu su mi il lo i gli dell della tuo tua het je uw mijn een o os as do da seu sua meu minha'.split(
    ' ',
  ),
);
/** Nothing of substance left: only articles and possessives, if anything. */
const bare = (rest: string): boolean => rest.split(' ').every((word) => !word || TOGGLE_FILLER.has(word));

/**
 * The kind of the one amount on a collapsed order summary's control, or null when the control says anything else.
 * The label the shopper sees must be the summary's name alone ("Order summary", "Show order summary (3 items)"):
 * with any other word or number beside it ("each", "tip", an order number) it is not read, nor with savings,
 * shipping or tax words. The words only a screen reader gets then decide the kind ("Total price", "Subtotal");
 * words that are no total label ("Shipping") leave it unread, and with none it is the order's total.
 */
function toggleKind(el: Element, label: string): Kind | 'after-candidate' | null {
  if (!bare(toggleRest(label)) || EXCLUDE_RE.test(label) || SHIP_RE.test(label) || TAX_RE.test(label))
    return null;
  const hidden = toggleRest(withoutAmounts(normalizeText(spacedText(el))).toLowerCase());
  return bare(hidden) ? 'estimatedTotal' : classifyLabel(hidden);
}

/** A short element's whole text, hidden parts included, with a space between its text nodes. */
function spacedText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (let c = node.firstChild; c && parts.length < MAX_ROW_NODES; c = c.nextSibling) {
      if (c.nodeType === 3) parts.push((c as Text).data);
      else if (c.nodeType === 1 && !SKIP_TAGS.has(c.nodeName) && (c as Element).namespaceURI === XHTML)
        walk(c);
    }
  };
  walk(el);
  return parts.join(' ');
}

/**
 * Whether a row of the summary sits in a product line: an ancestor below the summary, not holding the subtotal row,
 * shows a product image, a quantity or a remove control. Its prices are the line's, not an unlabelled total.
 */
function inProductLine(el: Element, summary: Element, subtotal: Element, ctx: Ctx): boolean {
  for (let a: Element | null = el; a && a !== summary; a = parentOf(a)) {
    if (a.contains(subtotal)) return false;
    const text = blockText(a, ctx);
    if (text.length > 600) return false;
    if (LINE_ITEM_RE.test(text) || REMOVE_RE.test(text) || a.querySelector('img, picture') !== null)
      return true;
  }
  return false;
}

/**
 * The amounts of the summary's visible shipping rows (one non-negative amount each, in `exponent` minor units),
 * leaving out rows inside `exclude`. The rows are found as `subtotalBlocker` finds them.
 */
function shippingAmounts(summary: Element, exclude: Element[], ctx: Ctx, exponent: number): number[] {
  const out: number[] = [];
  const seen = new Set<Element>();
  const walker = ctx.doc.createTreeWalker(summary, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\d/.test((n as Text).data)) continue;
    let el = n.parentNode as Element | null;
    if (!el || el.nodeType !== 1 || SKIP_PARENTS.has(el.nodeName)) continue;
    while (el && el !== summary && !/\p{L}{2}/u.test(withoutAmounts(normalizeText(el.textContent ?? ''))))
      el = parentOf(el);
    if (!el || seen.has(el) || exclude.some((e) => e.contains(el) || el!.contains(e))) continue;
    seen.add(el);
    if (hiddenWhy(el, ctx)) continue;
    const text = normalizeText(visibleText(el, ctx));
    if (text.length > MAX_ROW_TEXT) continue;
    const label = withoutAmounts(text).toLowerCase();
    if (EXCLUDE_RE.test(label) || !SHIP_RE.test(label) || TAX_RE.test(label) || classifyLabel(label))
      continue;
    const amounts = findAmounts(text, isCode);
    if (amounts.length !== 1 || amounts[0]!.negative || !amounts[0]!.number) continue;
    const minor = toMinor(amounts[0]!.number, exponent);
    if (minor !== null && minor > 0) out.push(minor);
  }
  return out;
}

/** A "you save" note at the end of a total row ("Total 96.95 🎉 You saved 2.57", "You Save: £399.99 EGP"): dropped. */
const SAVED_NOTE_RE = /\byou(?:'ve| have)? sav(?:e|ed)\b\s*:?\s*/giu;
function withoutSavedNote(text: string): string {
  let m: RegExpExecArray | null = null;
  for (const x of text.matchAll(SAVED_NOTE_RE)) m = x;
  if (!m) return text;
  const tail = text.slice(m.index + m[0].length);
  const tailAmounts = findAmounts(tail, isCode);
  if (tailAmounts.length > 1 || /[\p{L}\d]/u.test(withoutAmounts(tail))) return text;
  const head = text.slice(0, m.index).replace(/[^\p{L}\d)%]+$/u, '');
  return findAmounts(head, isCode).length > 0 ? head : text;
}

/**
 * Whether a row sits in a card offer's illustration ("Apply now", "upon approval"): a block within three levels,
 * short and with no shipping or tax words, whose text matches OFFER_RE. Its "new total" is not the cart's.
 */
function inOfferBlock(el: Element, ctx: Ctx, tablesFree = false): boolean {
  let a = parentOf(el);
  // With `tablesFree` (a credit row outside every summary, 15.1b review), table structure does not count toward the
  // three levels: an offer's illustration is often a small table under its copy.
  for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 3; a = parentOf(a)) {
    if (!tablesFree || !TABLE_TAGS.has(a.nodeName)) depth += 1;
    const text = blockText(a, ctx);
    // A real summary (shipping, tax or a checkout control) with a promo "Apply now" or a "Terms apply" footnote is not
    // an offer block (review fix, 13c.5): the offer must also talk of a card, a credit or a new total.
    if (text.length > 500 || SHIP_RE.test(text) || TAX_RE.test(text) || CHECKOUT_RE.test(text)) return false;
    if (OFFER_RE.test(text) && OFFER_CONTEXT_RE.test(text)) return true;
  }
  return false;
}
const OFFER_CONTEXT_RE = /credit|\bcard\b|karte|carte|tarjeta|new total/u;
/** A credit row that says it is in use ("Gift card applied", "Points redeemed"): never an offer's illustration. */
const APPLIED_RE = /appl(?:ied|iqu)|redeem|eingel[öo]st|angewendet|aplicad|utilis|\bused\b/u;

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
  // The largest summary block of summary length: the page's columns beyond it are not the subtotal's company.
  const summary = summaryOf(own, 'subtotal', ctx, true, MAX_SUMMARY_TEXT);
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
    if (hiddenWhy(el, ctx) || lineItemOf(el, ctx) || inProductLine(el, summary, own, ctx)) continue;
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
