// Synthetic pages only (no store text). jsdom has no layout, so these cover the rules, not the box checks.
import { describe, expect, it } from 'vitest';
import { cartUrlHint, detectCartPage, readCartPage } from '../src/index.ts';

function page(body: string, { url = 'https://shop.example.com/cart', title = 'Shop', lang = 'en' } = {}) {
  document.documentElement.setAttribute('lang', lang);
  document.title = title;
  document.body.innerHTML = body;
  return detectCartPage(document, { url });
}
const row = (label: string, amount: string) => `<div><span>${label}</span><span>${amount}</span></div>`;
const summary = (rows: string) => `<section>${rows}<button>Checkout</button></section>`;
const item = (name = 'Widget', qty = '1', price = '$20.00') =>
  `<div class="line"><img src="w.png" alt=""><span>${name}</span><label>Qty <input type="number" value="${qty}"></label><button>Remove</button><span>${price}</span></div>`;
const cart = (rows = row('Subtotal', '$20.00') + row('Shipping', '$5.00') + row('Total', '$25.00')) =>
  `<main><h1>Your cart</h1>${item()}${summary(rows)}</main>`;

describe('cartUrlHint', () => {
  it('finds cart words on token boundaries in the path, in many languages', () => {
    for (const u of [
      'https://a.example/cart',
      'https://a.example/cart/',
      'https://a.example/checkout/cart',
      'https://a.example/shoppingcart.html',
      'https://a.example/en/shopping-cart.html',
      'https://a.example/main_view_cart.php',
      'https://a.example/Form/Order/CartList.aspx',
      'https://a.example/gp/cart/view.html',
      'https://a.example/us/bag',
      'https://a.example/panier',
      'https://a.example/warenkorb',
      'https://a.example/carrello',
      'https://a.example/carrito',
      'https://a.example/cesta',
      'https://a.example/carrinho',
      'https://a.example/winkelwagen',
      'https://a.example/koszyk',
      'https://a.example/kosik',
      'https://a.example/sepet',
      'https://a.example/корзина',
      'https://a.example/%E3%82%AB%E3%83%BC%E3%83%88',
      'https://a.example/购物车',
      'https://a.example/장바구니',
    ])
      expect(cartUrlHint(u, '')?.url, u).toBe('cart');
  });
  it('finds query-routed, fragment-routed and host carts', () => {
    expect(cartUrlHint('https://a.example/index.php?route=checkout/cart', '')?.url).toBe('cart');
    expect(cartUrlHint('https://a.example/?page=cart', '')?.url).toBe('cart');
    expect(cartUrlHint('https://a.example/app#/cart', '')?.url).toBe('cart');
    expect(cartUrlHint('https://cart.a.example/', '')?.url).toBe('cart');
    expect(cartUrlHint('https://checkout.a.example/c/abc', '')?.url).toBe('checkout');
  });
  it('tells checkout from cart', () => {
    expect(cartUrlHint('https://a.example/checkout', '')?.url).toBe('checkout');
    expect(cartUrlHint('https://a.example/checkouts/cn/abc/information', '')?.url).toBe('checkout');
    expect(cartUrlHint('https://a.example/kasse', '')?.url).toBe('checkout');
  });
  it('does not match parts of other words, product slugs or cart endpoints', () => {
    for (const u of [
      'https://www.cartier.example/en-us/jewelry',
      'https://a.example/cartography/maps',
      'https://a.example/cart/add?id=1',
      'https://a.example/?add-to-cart=123',
      'https://a.example/products/leather-bag',
      'https://a.example/bags',
      'https://a.example/sports/basketball',
      'https://a.example/minicart',
      'https://a.example/cart.js',
      'https://a.example/',
      'https://cart.com/',
      'not a url',
    ])
      expect(cartUrlHint(u, '')?.url ?? null, u).toBe(null);
  });
  it('reads the title as a hint of its own', () => {
    expect(cartUrlHint('https://a.example/shop/OrderItemDisplayView', 'Shopping Bag | A')).toEqual({
      url: null,
      title: 'cart',
    });
    expect(cartUrlHint('https://a.example/x', 'سلة التسوق')).toEqual({ url: null, title: 'cart' });
    expect(cartUrlHint('https://a.example/x', 'Cartier watches')).toBe(null);
    expect(cartUrlHint('https://a.example/x', 'Great deals')).toBe(null);
  });
});

describe('detectCartPage', () => {
  it('is cart on a cart URL with a summary', () => {
    expect(page(cart())).toEqual({ page: 'cart', reason: 'url-summary' });
  });
  it('is cart on a cart URL with line items and no summary', () => {
    expect(page(`<main><h1>Bag</h1>${item()}</main>`)).toEqual({ page: 'cart', reason: 'url-items' });
  });
  it('is cart from the heading when only the title hints', () => {
    const r = page(cart(), { url: 'https://a.example/shop/OrderItemDisplayView', title: 'Shopping Bag | A' });
    expect(r).toEqual({ page: 'cart', reason: 'heading-summary' });
  });
  it('is cart in other languages', () => {
    const de = `<main><h1>Dein Warenkorb</h1>${item('Ding', '1', '20,00 €')}${summary(row('Zwischensumme', '20,00 €') + row('Versand', '5,00 €') + row('Gesamtsumme', '25,00 €'))}</main>`;
    expect(page(de, { url: 'https://a.example/warenkorb', lang: 'de' })).toMatchObject({ page: 'cart' });
    const ja = `<main><h1>ショッピングカート</h1>${item('品', '1', '¥2,000')}${summary(row('小計', '¥2,000') + row('送料', '¥500') + row('合計', '¥2,500'))}</main>`;
    expect(page(ja, { url: 'https://a.example/shop/cartview', lang: 'ja' })).toMatchObject({ page: 'cart' });
  });
  it('is checkout on a checkout step with an order summary', () => {
    const body = `<main><h1>Shipping</h1><form><label>Address <input></label></form><aside>${summary(row('Subtotal', '$20.00') + row('Shipping', '$5.00') + row('Order total', '$25.00'))}</aside></main>`;
    expect(page(body, { url: 'https://a.example/checkouts/cn/abc/shipping' })).toEqual({
      page: 'checkout',
      reason: 'url-summary',
    });
  });
  it('is cart on a query-routed cart', () => {
    expect(page(cart(), { url: 'https://a.example/index.php?route=checkout/cart' })).toMatchObject({
      page: 'cart',
    });
  });
  it('is none without a URL or title hint, without reading the page', () => {
    expect(readCartPage(document, { url: 'https://a.example/products/widget' })).toEqual({
      detection: { page: 'none', reason: 'no-hint' },
      reading: null,
    });
  });
  it('is none on a blog post about carts', () => {
    const body = `<main><h1>Ten ways to cut cart abandonment</h1><p>Shoppers leave carts for many reasons. A $5.00 shipping fee is the most common.</p><a href="/cart">View your cart</a></main>`;
    expect(page(body, { url: 'https://blog.example/posts/cart-abandonment', title: 'Cart abandonment' })).toEqual(
      { page: 'none', reason: 'no-structure' },
    );
  });
  it('is none on a page that only links to /cart', () => {
    const body = `<header><a href="/cart">Cart (0)</a></header><main><h1>New arrivals</h1><p>$20.00</p></main>`;
    expect(page(body, { url: 'https://a.example/collections/new', title: 'Cart link page' })).toEqual({
      page: 'none',
      reason: 'title-only',
    });
  });
  it('is none on a product page with an open mini-cart drawer', () => {
    const drawer = `<div role="dialog" aria-modal="true"><h2>Your cart</h2>${item()}${summary(row('Subtotal', '$20.00'))}</div>`;
    const body = `<main><h1>Widget</h1><p>$20.00</p><button>Add to cart</button></main>${drawer}`;
    expect(page(body, { url: 'https://a.example/products/widget', title: 'Widget | Shop' })).toEqual({
      page: 'none',
      reason: 'no-hint',
    });
    // Even when the title names the cart, the drawer's heading is not a main heading.
    expect(page(body, { url: 'https://a.example/products/widget', title: 'Widget | Cart' })).toEqual({
      page: 'none',
      reason: 'title-only',
    });
  });
  it('is none on an empty cart in several languages', () => {
    const empty = (h: string, msg: string, rows = '') => `<main><h1>${h}</h1><p>${msg}</p>${rows}</main>`;
    expect(page(empty('Your cart', 'Your cart is empty.'))).toEqual({ page: 'none', reason: 'no-structure' });
    expect(
      page(empty('Your cart', 'Your cart is empty.', summary(row('Subtotal', '$0.00') + row('Total', '$0.00')))),
    ).toEqual({ page: 'none', reason: 'zero-total' });
    expect(page(empty('Warenkorb', 'Ihr Warenkorb ist leer.'), { url: 'https://a.example/warenkorb', lang: 'de' })).toMatchObject({ page: 'none' });
    expect(page(empty('Panier', 'Votre panier est vide.'), { url: 'https://a.example/panier', lang: 'fr' })).toMatchObject({ page: 'none' });
    expect(
      page(empty('カート', 'カートに商品がありません。', summary(row('小計', '¥0'))), {
        url: 'https://a.example/cart',
        lang: 'ja',
      }),
    ).toMatchObject({ page: 'none' });
  });
  it('is none on a non-store page whose URL happens to say cart', () => {
    const body = `<main><h1>Cart</h1><p>A cart is a vehicle designed for transport, using two or more wheels.</p></main>`;
    expect(page(body, { url: 'https://wiki.example/wiki/Cart' })).toEqual({ page: 'none', reason: 'no-structure' });
  });
  it('readCartPage returns the reading beside the detection', () => {
    document.title = 'Cart';
    document.body.innerHTML = cart();
    expect(readCartPage(document, { url: 'https://a.example/cart' })).toEqual({
      detection: { page: 'cart', reason: 'url-summary' },
      reading: { shown: true, kind: 'estimatedTotal', amountMinor: 2500, currency: 'USD' },
    });
  });
});
