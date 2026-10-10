// Cart page detector (Phase 13c, wiki/product/phase-13c-cart-detection.md, "The detector"). Same rules as the
// reader: deterministic, synchronous, generic (no domain lists, no per-site selectors, never `data-pane-*`), and it
// reads only the document and URL it is given. Signals, cheapest first:
//   1. `cartUrlHint`: cart, basket, bag, trolley and checkout words in many languages in the URL's path, query,
//      fragment and host labels, as whole tokens ("cartier", "/cartography" and "add-to-cart" don't count), and in
//      the document title. A page with neither hint is `none` without the DOM being touched (under 1 ms).
//   2. Main headings (h1, role=heading level 1–2, aria-label of main) with the same words, in the main content.
//   3. Structure in the visible main content: the summary rows the reader finds, or cart line items (quantity and
//      remove controls).
// A positive needs a URL or heading signal (the title alone opens the DOM but decides nothing) and a structure
// signal. An empty cart (a zero total read by the reader, a summary of zeros, no line items) and a product page whose
// only cart is an open drawer (no URL hint, headings only in the drawer) are `none`.
import type { CartReading, DetectOptions, PageDetection } from './types.ts';
import { analyze, blockText, hiddenWhy, inHeader, parentOf, visibleText, type Ctx } from './reader.ts';
import { LINE_ITEM_RE } from './words.ts';

/** Cart words, one per token, lower-cased: Latin scripts as whole tokens, other scripts as substrings. */
const CART_TOKENS = new Set([
  'cart',
  'shoppingcart',
  'viewcart',
  'showcart',
  'mycart',
  'cartview',
  'cartpage',
  'cartlist',
  'cartdetail',
  'cartdetails',
  'cartitems',
  'viewbasket',
  'viewbag',
  'basket',
  'shoppingbasket',
  'mybasket',
  'bag',
  'shoppingbag',
  'mybag',
  'trolley',
  'panier',
  'monpanier',
  'warenkorb',
  'einkaufswagen',
  'einkaufskorb',
  'korb',
  'carrello',
  'carrito',
  'cesta',
  'cesto',
  'carrinho',
  'sacola',
  'winkelwagen',
  'winkelwagentje',
  'winkelmand',
  'winkelmandje',
  'mandje',
  'kurv',
  'varukorg',
  'kundvagn',
  'handlekurv',
  'ostoskori',
  'koszyk',
  'kosik',
  'košík',
  'kosar',
  'kosár',
  'sepet',
  'sepetim',
  'корзина',
  'keranjang',
  'troli',
]);
/** Cart words in scripts without word spacing, matched as substrings. */
const CART_SUBSTRINGS = [
  'カート',
  '買い物かご',
  '買物かご',
  '购物车',
  '购物袋',
  '購物車',
  '購物袋',
  '장바구니',
  'سلة',
  'السلة',
  'عربة',
  'עגלה',
  'ตะกร้า',
  'giỏ hàng',
];
const CHECKOUT_TOKENS = new Set([
  'checkout',
  'checkouts',
  'kasse',
  'kassa',
  'kassan',
  'caisse',
  'cassa',
  'pokladna',
  'afrekenen',
  'commande',
  'pedido',
  'ödeme',
  'odeme',
  'оформление',
]);
const CHECKOUT_SUBSTRINGS = ['レジ', '結帳', '结算', '결제'];
/** Tokens that may share a URL segment with a cart word without changing what the segment is. */
const SEGMENT_FILLER = new Set([
  'shopping',
  'shop',
  'view',
  'show',
  'my',
  'your',
  'mon',
  'mein',
  'mi',
  'mijn',
  'main',
  'page',
  'index',
  'default',
  'list',
  'detail',
  'details',
  'overview',
  'summary',
  'review',
  'items',
  'html',
  'htm',
  'php',
  'asp',
  'aspx',
  'jsp',
  'do',
  'action',
  'cfm',
  'en',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'us',
  'uk',
]);
/** Words beside a cart word that make the URL an endpoint or a widget, not the cart page. */
const NOT_PAGE_RE =
  /\b(?:add|remove|delete|update|ajax|api|json|mini|count|quick|empty|clear|merge|share|saved|wishlist)\b|minicart/u;
const PAGE_FILES = /\.(?:html?|php|aspx?|jsp|cfm|do|action)$/iu;
const MAX_HEADING_TEXT = 80;
const MAX_LINE_ITEM_TEXT = 600;
const MAX_CONTROLS = 2000;

export type UrlHint = { url: 'cart' | 'checkout' | null; title: 'cart' | 'checkout' | null };

/**
 * The cheapest signal, meant to run before any DOM work: cart or checkout words in the page URL and title. `null`
 * when neither carries one, so the content script can stop there.
 */
export function cartUrlHint(url: string, title: string): UrlHint | null {
  const hint = { url: urlWord(url), title: wordIn(title.toLowerCase()) };
  return hint.url || hint.title ? hint : null;
}

/** Whether a short lower-cased text names the cart or the checkout, on token boundaries. */
function wordIn(text: string): 'cart' | 'checkout' | null {
  const tokens = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let checkout = false;
  for (const t of tokens) {
    if (CART_TOKENS.has(t)) return 'cart';
    if (CHECKOUT_TOKENS.has(t)) checkout = true;
  }
  for (const s of CART_SUBSTRINGS) if (text.includes(s)) return 'cart';
  if (!checkout) for (const s of CHECKOUT_SUBSTRINGS) if (text.includes(s)) checkout = true;
  return checkout ? 'checkout' : null;
}

/** Cart or checkout words in the URL's path segments, query keys and values, fragment and host labels. */
function urlWord(url: string): 'cart' | 'checkout' | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const segments: string[] = [];
  const pushPath = (p: string) => {
    for (const seg of decodeURIComponent(p).split('/')) if (seg) segments.push(seg.replace(PAGE_FILES, ''));
  };
  pushPath(u.pathname);
  for (const [k, v] of u.searchParams) {
    segments.push(k);
    pushPath(v);
  }
  pushPath(u.hash.replace(/^#!?/, '').split('?')[0] ?? '');
  // Host labels but the registrable name (`cart.example.com`, not `cart.com`).
  segments.push(...u.hostname.split('.').slice(0, -2));
  let checkout = false;
  for (const [i, seg] of segments.entries()) {
    const lower = seg.toLowerCase();
    // "/cart/add", "add-to-cart", "/cart/count": an endpoint, not the page.
    if (NOT_PAGE_RE.test(seg.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())) continue;
    if (NOT_PAGE_RE.test(segments[i + 1]?.toLowerCase() ?? '')) continue;
    // camelCase is split too (CartList, viewCart).
    const tokens = seg
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    const words = tokens.filter((t) => !SEGMENT_FILLER.has(t));
    if (words.length === 0) continue;
    if (words.every((t) => CART_TOKENS.has(t) || CHECKOUT_TOKENS.has(t))) {
      if (words.some((t) => CART_TOKENS.has(t))) return 'cart';
      checkout = true;
      continue;
    }
    // A product slug ("leather-bag", "basketball") is not the cart; scripts without spacing are matched inside.
    if (CART_SUBSTRINGS.some((s) => lower.includes(s))) return 'cart';
    if (CHECKOUT_SUBSTRINGS.some((s) => lower.includes(s))) checkout = true;
  }
  return checkout ? 'checkout' : null;
}

export function detectCartPage(document: Document, options: DetectOptions): PageDetection {
  return readCartPage(document, options).detection;
}

/**
 * Detection and the reader's reading in one pass over the page (the reader's rows are the detector's summary
 * signal). The reading is the one `readCart` returns; it is `null` when the detector stopped before reading.
 */
export function readCartPage(
  document: Document,
  options: DetectOptions,
): { detection: PageDetection; reading: CartReading | null } {
  const hint = cartUrlHint(options.url, document.title ?? '');
  if (!hint) return { detection: { page: 'none', reason: 'no-hint' }, reading: null };
  const { reading, rows, ctx } = analyze(document, options);
  const none = (reason: string) => ({ detection: { page: 'none' as const, reason }, reading });
  if (!ctx || !document.body) return none('no-body');
  const word = hint.url ?? headingWord(document, ctx);
  if (!word) return none('title-only');
  if (reading.shown && reading.amountMinor === 0) return none('zero-total');
  // The reader's summary rows (visible, labelled, beside shipping, tax or a checkout control, not zero) in the main
  // content. A summary of zeros is an empty cart's.
  const summary = rows.some(
    (r) =>
      r.kind !== null && r.kind !== 'credit' && r.inSummary && !r.why && r.minor !== 0 && inMain(r.els[0]!),
  );
  const items = summary ? false : hasLineItems(document, ctx);
  if (!summary && !items) return none('no-structure');
  const by = hint.url ? 'url' : 'heading';
  return {
    detection: { page: word, reason: `${by}-${summary ? 'summary' : 'items'}` },
    reading,
  };
}

/**
 * Whether an element is in the main content: outside page headers, footers, navigation and dialogs (an open
 * drawer). The `main` landmark is not relied on (stores often wrap only part of the cart page in it), and asides
 * count as main content (a checkout step's order summary is often one).
 */
function inMain(el: Element): boolean {
  if (inHeader(el)) return false;
  for (let a: Element | null = el; a && a.nodeName !== 'BODY'; a = parentOf(a)) {
    const role = a.getAttribute('role');
    if (
      a.nodeName === 'FOOTER' ||
      a.nodeName === 'NAV' ||
      a.nodeName === 'DIALOG' ||
      role === 'dialog' ||
      role === 'alertdialog' ||
      role === 'navigation' ||
      role === 'contentinfo' ||
      a.getAttribute('aria-modal') === 'true'
    )
      return false;
  }
  return true;
}

/** A cart or checkout word in a visible main heading: h1, h2, role=heading level 1–2, or the main landmark's aria-label. */
function headingWord(document: Document, ctx: Ctx): 'cart' | 'checkout' | null {
  let checkout = false;
  const consider = (text: string | null) => {
    if (!text) return;
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || t.length > MAX_HEADING_TEXT) return;
    const w = wordIn(t.toLowerCase());
    if (w === 'checkout') checkout = true;
    return w === 'cart';
  };
  const main = document.querySelector('main, [role="main"]');
  if (main && consider(main.getAttribute('aria-label'))) return 'cart';
  const headings = document.querySelectorAll('h1, h2, [role="heading"]');
  for (const h of headings) {
    if (h.nodeName !== 'H1' && h.nodeName !== 'H2') {
      const level = h.getAttribute('aria-level');
      if (level !== null && level !== '1' && level !== '2') continue;
    }
    if (!inMain(h) || hiddenWhy(h, ctx)) continue;
    if (consider(visibleText(h, ctx))) return 'cart';
  }
  return checkout ? 'checkout' : null;
}

/**
 * Cart line items in the main content: a visible quantity control (a number input, or a control whose label names
 * the quantity) and a visible remove control, or either of them inside a block with a product image.
 */
function hasLineItems(document: Document, ctx: Ctx): boolean {
  const controls = document.querySelectorAll('input[type="number"], select, button, a, input[type="text"]');
  let seen = 0;
  let qty = false;
  let remove = false;
  for (const c of controls) {
    if (seen++ >= MAX_CONTROLS) break;
    const label =
      `${c.getAttribute('aria-label') ?? ''} ${c.getAttribute('name') ?? ''} ${c.getAttribute('title') ?? ''} ${
        c.nodeName === 'INPUT' || c.nodeName === 'SELECT' ? '' : (c.textContent ?? '').slice(0, 60)
      }`.toLowerCase();
    const isQty = c.getAttribute('type') === 'number' || LINE_ITEM_RE.test(label);
    // "Add or remove from wishlist", "save for later": not a line's remove control.
    const isRemove = REMOVE_RE.test(label) && !WISHLIST_RE.test(label);
    if (!isQty && !isRemove) continue;
    if (!inMain(c) || hiddenWhy(c, ctx)) continue;
    if (isQty) qty = true;
    if (isRemove) remove = true;
    if (qty && remove) return true;
    // The control sits in a product line: a small block within five levels holds an image.
    let a = parentOf(c);
    for (let depth = 0; a && a.nodeName !== 'BODY' && depth < 5; depth += 1) {
      if (blockText(a, ctx).length > MAX_LINE_ITEM_TEXT) break;
      if (a.querySelector('img, picture') !== null) return true;
      a = parentOf(a);
    }
  }
  return false;
}

const WISHLIST_RE = /wish|favou?rite|favorit|merkzettel|later|sp[äa]ter|plus tard|m[áa]s tarde|\bsave\b/u;

/** A line's remove control, in many languages (the reader's list). */
const REMOVE_RE =
  /\bremove\b|\bdelete\b|entfernen|l[öo]schen|supprimer|retirer|eliminar|quitar|rimuovi|elimina|verwijder|usu[ńn]|kaldır|\bsil\b|удалить|削除|삭제|حذف|إزالة/u;
