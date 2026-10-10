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
import { analyze, hiddenWhy, inHeader, parentOf, visibleText, type Ctx } from './reader.ts';
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
  'ödeme',
  'odeme',
  'оформление',
]);
const CHECKOUT_SUBSTRINGS = ['レジ', '結帳', '结算', '결제'];
/** Words that may stand beside a cart word in a title segment or heading without changing what it names ("Your
 * shopping cart (2 items)", "Mon panier", "Dein Warenkorb", "Mi cesta"), in the supported languages; a count too. */
const PHRASE_FILLER = new Set([
  ...[
    'your',
    'my',
    'the',
    'shopping',
    'review',
    'items',
    'item',
    'view',
    'in',
    'of',
    'a',
    'and',
    'purchases',
  ],
  ...[
    'votre',
    'vos',
    'ton',
    'ta',
    'mon',
    'ma',
    'le',
    'la',
    'les',
    'articles',
    'article',
    'd',
    'de',
    'du',
    'achats',
    'achat',
  ],
  ...[
    'dein',
    'deine',
    'ihr',
    'ihre',
    'mein',
    'meine',
    'der',
    'die',
    'das',
    'artikel',
    'im',
    'einkauf',
    'einkäufe',
  ],
  ...[
    'tu',
    'tus',
    'su',
    'sus',
    'mi',
    'mis',
    'el',
    'los',
    'las',
    'artículos',
    'articulos',
    'en',
    'compra',
    'compras',
  ],
  ...['il', 'tuo', 'tua', 'mio', 'mia', 'i', 'gli', 'articoli', 'nel', 'acquisti', 'spesa'],
  ...['je', 'jouw', 'uw', 'mijn', 'het', 'artikelen', 'aankopen'],
  ...['o', 'seu', 'sua', 'meu', 'minha', 'itens', 'no', 'compras'],
  ...['din', 'dit', 'min', 'mitt', 'varor', 'varer'],
  ...['twój', 'twoj', 'mój', 'moj', 'produkty', 'produktów'],
  ...['ваша', 'ваш', 'моя', 'мой', 'товары', 'товаров'],
  ...['あなたの', 'ショッピング', '我的', '내', '나의', '購物', '购物', 'التسوق', 'تسوق', 'הקניות', 'สินค้า'],
]);
/** How a title lists its parts ("Your cart | Shop", "Shop - Basket", "Checkout: payment"). */
const TITLE_SEPARATOR = /\s*[|\-–—:·»«>/]+\s*/u;
/** A path segment that names what the next segment is: a product, collection, category or search slug, not a page. */
const SLUG_PARENT = new Set([
  'product',
  'products',
  'produkt',
  'produkte',
  'produit',
  'produits',
  'producto',
  'productos',
  'prodotto',
  'prodotti',
  'produto',
  'produtos',
  'p',
  'item',
  'items',
  'collection',
  'collections',
  'category',
  'categories',
  'categoria',
  'categorias',
  'categorie',
  'kategorie',
  'kategorien',
  'c',
  'catalog',
  'catalogue',
  'brand',
  'brands',
  'marque',
  'marke',
  'tag',
  'tags',
  'search',
  'recherche',
  'suche',
  'busca',
  'buscar',
  'ricerca',
  'zoeken',
  's',
  'q',
]);
/** Query keys whose value is a search term, never a route ("?q=basket"). */
const SEARCH_KEY = /^(?:q|query|search|s|k|keyword|keywords|term|text|searchterm|search_query|w|wd)$/iu;
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

/**
 * Whether a short lower-cased title or heading names the cart or the checkout: one of its segments (split on the
 * title separators) must be a cart or checkout word with nothing beside it but filler words and counts ("Your cart
 * (2 items)", "Mon panier", "カート (3)"). "Gift basket", "Tote bag" and "Sleeping bag" are products, not the cart.
 */
function wordIn(text: string): 'cart' | 'checkout' | null {
  let checkout = false;
  for (const segment of text.split(TITLE_SEPARATOR)) {
    const w = phraseWord(segment.trim());
    if (w === 'cart') return 'cart';
    if (w === 'checkout') checkout = true;
  }
  return checkout ? 'checkout' : null;
}
/** The cart or checkout word a whole segment stands for, or null when any other word is in it. */
function phraseWord(segment: string): 'cart' | 'checkout' | null {
  if (!segment) return null;
  const tokens = segment
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !PHRASE_FILLER.has(t) && !/^\p{N}+$/u.test(t));
  if (tokens.length > 0) {
    if (!tokens.every((t) => CART_TOKENS.has(t) || CHECKOUT_TOKENS.has(t))) {
      // Scripts without word spacing: the segment is the cart word plus filler and at most a few other characters.
      let stripped = segment;
      for (const f of PHRASE_FILLER) stripped = stripped.replaceAll(f, '');
      const rest = (s: string) => stripped.replace(s, '').replace(/[\p{N}\p{P}\p{S}\s]/gu, '');
      for (const s of CART_SUBSTRINGS) if (segment.includes(s) && rest(s).length <= 4) return 'cart';
      for (const s of CHECKOUT_SUBSTRINGS) if (segment.includes(s) && rest(s).length <= 4) return 'checkout';
      return null;
    }
    return tokens.some((t) => CART_TOKENS.has(t)) ? 'cart' : 'checkout';
  }
  return null;
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
    // "?q=basket" is a search term; a routing value ("?route=checkout/cart") still counts.
    if (!SEARCH_KEY.test(k)) pushPath(v);
  }
  pushPath(u.hash.replace(/^#!?/, '').split('?')[0] ?? '');
  // Host labels but the registrable name (`cart.example.com`, not `cart.com`). A host label alone never makes a
  // checkout (`checkout.example.com` hosts billing pages of every kind); it can name the cart.
  const hostLabels = u.hostname.split('.').slice(0, -2);
  const fromHost = segments.length;
  segments.push(...hostLabels);
  let checkout = false;
  for (const [i, seg] of segments.entries()) {
    const lower = seg.toLowerCase();
    // "/cart/add", "add-to-cart", "/cart/count": an endpoint, not the page.
    if (NOT_PAGE_RE.test(seg.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())) continue;
    if (NOT_PAGE_RE.test(segments[i + 1]?.toLowerCase() ?? '')) continue;
    // "/products/bag", "/collections/basket", "/search/basket": a slug under a listing, not the cart page.
    if (i > 0 && i < fromHost && SLUG_PARENT.has(segments[i - 1]!.toLowerCase())) continue;
    // camelCase is split too (CartList, viewCart).
    const tokens = seg
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    // Counts and ids beside the word ("cart--4362", "cart-2") do not change what the segment is.
    const words = tokens.filter((t) => !SEGMENT_FILLER.has(t) && !/^\p{N}+$/u.test(t));
    if (words.length === 0) continue;
    if (words.every((t) => CART_TOKENS.has(t) || CHECKOUT_TOKENS.has(t))) {
      if (words.some((t) => CART_TOKENS.has(t))) return 'cart';
      if (i < fromHost) checkout = true;
      continue;
    }
    // A product slug ("leather-bag", "basketball") is not the cart; scripts without spacing are matched inside.
    if (CART_SUBSTRINGS.some((s) => lower.includes(s))) return 'cart';
    if (i < fromHost && CHECKOUT_SUBSTRINGS.some((s) => lower.includes(s))) checkout = true;
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
  // content, whether or not the reader could show their amount. A summary of zeros is an empty cart's.
  const summary = rows.some(
    (r) =>
      r.kind !== null &&
      r.kind !== 'credit' &&
      r.inSummary &&
      !(r.why ?? '').startsWith('hidden') &&
      r.why !== 'struck' &&
      r.minor !== 0 &&
      inMain(r.els[0]!, ctx),
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
 * Whether an element is in the main content: outside page headers, footers, navigation, dialogs and fixed-position
 * boxes (an open drawer, whether or not it is a dialog). The `main` landmark is not relied on (stores often wrap only
 * part of the cart page in it), and in-flow asides count as main content (a checkout step's order summary is often
 * one).
 */
function inMain(el: Element, ctx: Ctx): boolean {
  if (inHeader(el)) return false;
  for (let a: Element | null = el; a && a.nodeName !== 'BODY'; a = parentOf(a)) {
    const role = a.getAttribute('role');
    // A fixed box as tall as most of the viewport is an open drawer; a shorter one (a summary made sticky by script,
    // a bottom bar) is the page's own content.
    if (
      styleOf(a, ctx).position === 'fixed' &&
      (!ctx.layout || a.getBoundingClientRect().height >= DRAWER_HEIGHT * viewH(ctx))
    )
      return false;
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
  for (const h of queryAll(document, ctx, 'h1, h2, [role="heading"]')) {
    if (h.nodeName !== 'H1' && h.nodeName !== 'H2') {
      const level = h.getAttribute('aria-level');
      if (level !== null && level !== '1' && level !== '2') continue;
    }
    if (!inMain(h, ctx) || hiddenWhy(h, ctx)) continue;
    if (consider(visibleText(h, ctx))) return 'cart';
  }
  return checkout ? 'checkout' : null;
}

/**
 * Cart line items in the main content: a visible quantity control (a number input, or a control whose label names
 * the quantity) and a visible remove control in the same line block (a shared ancestor within LINE_LEVELS levels,
 * review fix). A product page's own stepper beside a "Delete my review" link, or a listing's quick-add tiles beside a
 * "Remove filter" button, do not pair up; filter, compare, review, account and "remove all" controls never count.
 */
function hasLineItems(document: Document, ctx: Ctx): boolean {
  const controls = queryAll(document, ctx, 'input[type="number"], select, button, a, input[type="text"]');
  let seen = 0;
  const qtys: Element[] = [];
  const removes: Element[] = [];
  for (const c of controls) {
    if (seen++ >= MAX_CONTROLS) break;
    const label =
      `${c.getAttribute('aria-label') ?? ''} ${c.getAttribute('name') ?? ''} ${c.getAttribute('title') ?? ''} ${
        c.nodeName === 'INPUT' || c.nodeName === 'SELECT' ? '' : (c.textContent ?? '').slice(0, 60)
      }`.toLowerCase();
    const isQty = c.getAttribute('type') === 'number' || LINE_ITEM_RE.test(label);
    // "Add or remove from wishlist", "save for later", "remove filter", "delete my review": not a line's control.
    const isRemove = REMOVE_RE.test(label) && !WISHLIST_RE.test(label) && !NOT_LINE_REMOVE_RE.test(label);
    if (!isQty && !isRemove) continue;
    if (!inMain(c, ctx) || hiddenWhy(c, ctx)) continue;
    if (isQty) qtys.push(c);
    if (isRemove) removes.push(c);
  }
  if (!qtys.length || !removes.length) return false;
  const blocks = new Set<Element>();
  for (const q of qtys) {
    let a = parentOf(q);
    for (let depth = 0; a && a.nodeName !== 'BODY' && depth < LINE_LEVELS; depth += 1, a = parentOf(a))
      blocks.add(a);
  }
  for (const r of removes) {
    let a = parentOf(r);
    for (let depth = 0; a && a.nodeName !== 'BODY' && depth < LINE_LEVELS; depth += 1, a = parentOf(a))
      if (blocks.has(a)) return true;
  }
  return false;
}
/** A fixed box at least this share of the viewport's height is a drawer, not a sticky summary or bar. */
const DRAWER_HEIGHT = 0.6;
const viewH = (ctx: Ctx) => ctx.view?.innerHeight ?? 0;
/** How many levels up a quantity control and a remove control may meet and still be one line. */
const LINE_LEVELS = 6;
/** Remove controls that are not a cart line's: filters, comparisons, reviews, accounts, addresses, "remove all". */
const NOT_LINE_REMOVE_RE =
  /filter|filtre|filtro|facet|compar|vergleich|review|avis|bewertung|rese[ñn]a|recensi|account|konto|compte|cuenta|address|adresse|direcci[óo]n|card\b|payment|\ball\b|alle\b|tout|tous|todo|tutti|coupon|promo|voucher/u;

/** An element's computed style through the reader's cache. `analyze` has already run when the detector asks, so
 * writing new entries to `ctx.styles` only extends that pass's cache; the reader never reads it again. */
function styleOf(el: Element, ctx: Ctx): CSSStyleDeclaration {
  let cs = ctx.styles.get(el);
  if (!cs) {
    cs = ctx.view ? ctx.view.getComputedStyle(el) : ({} as CSSStyleDeclaration);
    ctx.styles.set(el, cs);
  }
  return cs;
}

/** Elements matching a selector in the document and its open shadow roots. */
function queryAll(document: Document, ctx: Ctx, selector: string): Element[] {
  const out = [...document.querySelectorAll(selector)];
  for (const sr of ctx.shadowRoots) out.push(...sr.querySelectorAll(selector));
  return out;
}

const WISHLIST_RE = /wish|favou?rite|favorit|merkzettel|later|sp[äa]ter|plus tard|m[áa]s tarde|\bsave\b/u;

/** A line's remove control, in many languages (the reader's list). */
const REMOVE_RE =
  /\bremove\b|\bdelete\b|entfernen|l[öo]schen|supprimer|retirer|eliminar|quitar|rimuovi|elimina|verwijder|usu[ńn]|kaldır|\bsil\b|удалить|削除|삭제|حذف|إزالة/u;
