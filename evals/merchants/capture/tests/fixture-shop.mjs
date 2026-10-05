// A local fixture shop for the capture tool's browser tests. The shop is 127.0.0.1:<port> (its registrable domain
// for the tool is 127.0.0.1); a second server answers as localhost:<port2>, a different site (third-party checkout,
// cross-origin frame, off-site link). Every request is logged so tests can prove what was and was not sent.
import { createServer } from 'node:http';

const page = (title, body, { lang = 'en-GB', head = '' } = {}) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>
<meta property="og:price:currency" content="GBP">
<style>.was{text-decoration:line-through}.hidden{display:none}</style>${head}
<!-- platform marker for the test: cdn11.bigcommerce.com -->
</head><body>${body}
<footer><a href="/terms" id="terms-link">Terms of use</a></footer></body></html>`;

export async function startShop({ robots = 'User-agent: *\nDisallow: /admin\n' } = {}) {
  const log = [];
  const cart = [];
  let tpPort = 0;
  const tp = () => `http://localhost:${tpPort}`;

  const readBody = (req) =>
    new Promise((resolve) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    });

  const shop = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const body = req.method === 'POST' ? await readBody(req) : '';
    log.push({ site: 'shop', method: req.method, path: url.pathname, body });
    const html = (status, text) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'x-fixture': 'shop' });
      res.end(text);
    };
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /robots.txt':
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end(robots);
      case 'GET /':
        return html(
          200,
          page(
            'Fixture Shop',
            '<a href="/products">All products</a><div id="cookies"><p>Cookies?</p><button>Reject all</button><button aria-label="Close">×</button></div>',
          ),
        );
      case 'GET /terms':
        return html(200, page('Terms', '<p>Fixture terms text.</p>'));
      case 'GET /products':
        return html(
          200,
          page(
            'Products',
            '<a href="/products/tee" id="tee">Fixture Tee £20.00</a><form action="/cart/add" method="post"><input type="hidden" name="id" value="tee"><button type="submit">Add to cart</button></form>',
          ),
        );
      case 'GET /products/tee':
        return html(
          200,
          page(
            'Fixture Tee',
            `<h1>Fixture Tee</h1><p>£20.00</p>
<form id="product-form" action="/cart/add" method="post">
  <fieldset><button type="button" class="size" data-size="S">S</button><button type="button" class="size" data-size="M">M</button></fieldset>
  <input type="hidden" name="id" value="tee"><input type="hidden" name="size" id="size" value="">
  <label>Qty <input type="number" name="qty" value="1" min="1"></label>
  <button type="submit" id="atc">Add to cart</button>
  <button type="submit" id="atb" formaction="/account/login">Add to bag</button>
</form>
<form id="newsletter" action="/newsletter" method="post"><input type="email" name="email" aria-label="Email"><button type="submit">Subscribe</button></form>
<select id="colour" aria-label="Colour"><option>Red</option><option>Blue</option></select>
<input type="file" id="upload" aria-label="Upload">
<label for="giftmsg" id="giftlabel">Gift message</label><input id="giftmsg" type="text">
<div id="frame-box" style="display:inline-block"><iframe src="${tp()}/widget" title="widget" width="300" height="80"></iframe></div>
<button type="button" id="sneaky">Show offers</button>
<a id="offsite" href="${tp()}/elsewhere">Partner store</a>
<form id="swatches" action="/cart/add" method="post"><button class="swatch" id="sw-red">Red</button><button class="swatch" id="sw-blue">Blue</button></form>
<form id="place" action="/checkout/complete" method="post"><input type="hidden" name="token" value="t"><button type="submit">Place order</button><button type="submit" id="go">Continue</button></form>
<form id="buynow" action="/cart/add" method="post"><input type="hidden" name="id" value="tee"><button type="submit">Buy now</button></form>
<div role="button" id="fake-order" tabindex="0">Place order</div>
<button type="button" id="like">Like</button>
<form id="getform" action="/search" method="get"><input type="hidden" name="q" value="tee"></form>
<button type="button" id="sneaky-get">More like this</button>
<script>
for (const b of document.querySelectorAll('.size')) b.addEventListener('click', () => { document.getElementById('size').value = b.dataset.size; });
document.getElementById('sneaky').addEventListener('click', () => document.getElementById('newsletter').requestSubmit());
document.getElementById('sneaky-get').addEventListener('click', () => document.getElementById('getform').requestSubmit());
document.getElementById('sw-red').addEventListener('click', (e) => e.preventDefault());
document.getElementById('like').addEventListener('click', () => fetch('/api/like', { method: 'POST', body: 'x' }).catch(() => {}));
</script>`,
          ),
        );
      case 'POST /cart/add': {
        const form = new URLSearchParams(body);
        cart.push({ id: form.get('id'), size: form.get('size'), qty: Number(form.get('qty') ?? 1) });
        res.writeHead(303, { location: '/cart' });
        return res.end();
      }
      case 'GET /cart': {
        if (cart.length === 0) return html(200, page('Cart', '<h1>Your cart is empty</h1>'));
        return html(
          200,
          page(
            'Cart',
            `<h1>Cart</h1>
<form id="cart-form" action="/cart/update" method="post">
  <div class="line">Fixture Tee (${cart[0].size || '-'}) <span class="was">£25.00</span> £20.00</div>
  <input type="number" name="qty" id="qty" value="1" aria-label="Quantity">
  <button type="button" id="inc" aria-label="Increase quantity">+</button>
  <button type="submit" name="remove">Remove</button>
</form>
<form id="promo" action="/promo" method="post"><input type="text" name="code" id="promo-code" aria-label="Promo code"><button type="submit">Apply</button></form>
<cart-summary id="summary"></cart-summary>
<a href="/checkout" id="checkout-link">Checkout</a>
<a href="${tp()}/checkout" id="tp-checkout">Partner checkout</a>
<script>
document.getElementById('summary').attachShadow({ mode: 'open' }).innerHTML = '<style>b{font-weight:700}</style><p>Subtotal <b id="sub">£20.00</b></p>';
document.getElementById('inc').addEventListener('click', () => { const q = document.getElementById('qty'); q.value = String(Number(q.value) + 1); fetch('/cart/change', { method: 'POST', body: 'qty=' + q.value }).catch(() => {}); });
</script>`,
          ),
        );
      }
      case 'GET /checkout':
        return html(
          200,
          page(
            'Checkout',
            `<h1>Checkout</h1>
<form id="signin" action="/login" method="post"><input type="email" name="email" id="email" aria-label="Email"><input type="password" name="password" id="password" aria-label="Password"><button type="submit">Sign in</button></form>
<button type="button" id="guest">Continue as guest</button>
<section id="order-summary"><p>Subtotal £20.00</p><p>Estimated total £24.00</p></section>`,
          ),
        );
      case 'GET /account/login':
        return html(
          200,
          page(
            'Sign in',
            '<form action="/login" method="post"><input type="email" aria-label="Email"><input type="password" aria-label="Password"><button>Sign in</button></form>',
          ),
        );
      case 'GET /blocked':
        return html(403, page('Forbidden', '<p>Forbidden</p>'));
      case 'GET /ratelimited':
        return html(429, page('Slow down', '<p>Too many requests</p>'));
      case 'GET /captcha':
        return html(
          200,
          page(
            'Check',
            `<iframe src="${tp()}/captcha/challenge" width="300" height="300" title="challenge"></iframe>`,
          ),
        );
      case 'GET /wall':
        return html(200, page('One moment', '<p>Press and hold to confirm you are human.</p>'));
      case 'GET /r':
        res.writeHead(302, { location: `${tp()}/elsewhere` });
        return res.end();
      case 'GET /r-terms':
        res.writeHead(302, { location: '/terms' });
        return res.end();
      case 'GET /products/hat':
        return html(
          200,
          page(
            'Fixture Hat',
            '<h1>Fixture Hat</h1><form action="/cart/add-offsite" method="post"><input type="hidden" name="id" value="hat"><button type="submit">Add to cart</button></form>',
          ),
        );
      case 'POST /cart/add-offsite':
        res.writeHead(303, { location: `${tp()}/landing` });
        return res.end();
      case 'POST /cart/change':
      case 'POST /api/like':
        res.writeHead(204);
        return res.end();
      case 'GET /search':
        return html(200, page('Search', '<p>Results</p>'));
      case 'GET /products/patched':
        return html(
          200,
          page(
            'Patched',
            `<form action="/cart/update" method="post"><button id="disguised">Next step</button></form>
<script>
Object.defineProperty(HTMLButtonElement.prototype, 'type', { get() { return 'button'; } });
Object.defineProperty(HTMLButtonElement.prototype, 'form', { get() { return null; } });
Element.prototype.closest = function () { return null; };
Element.prototype.matches = function () { return false; };
Element.prototype.getAttribute = function () { return null; };
</script>`,
          ),
        );
      case 'GET /pxwall':
        return html(200, page('Store', '<div id="px-captcha" style="width:300px;height:100px">.</div>'));
      case 'GET /late-wall':
        return html(
          200,
          page(
            'Store',
            '<a href="/terms" id="t2">More</a><script>setTimeout(() => { document.body.innerHTML = "<p>Press and hold to confirm you are human.</p>"; }, 400);</script>',
          ),
        );
      case 'GET /extcheck':
        return html(200, page('Oops', '<p>Please disable your ad blocker to continue.</p>'));
      default:
        return html(404, page('Not found', '<p>Not found</p>'));
    }
  });

  const third = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    log.push({ site: 'third-party', method: req.method, path: url.pathname, body: '' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (url.pathname === '/widget') return res.end('<!doctype html><button id="w">Widget</button>');
    if (url.pathname === '/checkout')
      return res.end(
        '<!doctype html><html lang="en"><title>Partner checkout</title><h1>Partner checkout</h1><a href="/next" id="next">Next</a>',
      );
    return res.end('<!doctype html><p>third party</p>');
  });

  const listen = (s, host) =>
    new Promise((resolve) => {
      s.listen(0, host, () => resolve(s.address().port));
    });
  const port = await listen(shop, '127.0.0.1');
  tpPort = await listen(third, '127.0.0.1');
  return {
    origin: `http://127.0.0.1:${port}`,
    thirdParty: tp(),
    log,
    cart,
    close: async () => {
      shop.closeAllConnections?.();
      third.closeAllConnections?.();
      await Promise.all([new Promise((r) => shop.close(r)), new Promise((r) => third.close(r))]);
    },
  };
}

/** The end-to-end recipe for the fixture shop. */
export function fixtureRecipe(origin, extra = {}) {
  return {
    schema: 'capture-recipe.1',
    domain: '127.0.0.1',
    origin,
    listingUrl: `${origin}/products`,
    productUrls: [`${origin}/products/tee`],
    cartPath: '/cart',
    checkoutPaths: ['/checkout'],
    termsUrl: `${origin}/terms`,
    allowlist: [
      { purpose: 'option', target: { selector: 'button.size[data-size="M"]' } },
      { purpose: 'add-to-cart', target: { role: 'button', name: 'Add to cart' } },
      { purpose: 'quantity-increment', target: { role: 'button', name: 'Increase quantity' } },
      { purpose: 'continue-as-guest', target: { role: 'button', name: 'Continue as guest' } },
    ],
    steps: [],
    ...extra,
  };
}
