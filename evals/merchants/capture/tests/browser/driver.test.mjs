// Browser tests of the capture driver's refusals and stops against the local fixture shop (127.0.0.1 only).
// Run: npm run test:capture:browser (needs Playwright's Chromium).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { MAX_NAVIGATIONS, MAX_REQUESTS_PER_ACTION, createDriver } from '../../driver.mjs';
import { RefusalError, StopError, inspectControl } from '../../guards.mjs';
import { parseRobots, robotsPosture } from '../../robots.mjs';
import { fixtureRecipe, startShop } from '../fixture-shop.mjs';

let browser;
let shop;
let tmp;
const open = [];

before(async () => {
  browser = await chromium.launch({ headless: true });
  shop = await startShop();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'capture-driver-'));
});
after(async () => {
  for (const c of open) await c.close().catch(() => {});
  await browser?.close();
  await shop?.close();
  await rm(tmp, { recursive: true, force: true });
});

async function fresh(mode = 'serve', { extra = {}, robotsGroups = [] } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  open.push(context);
  const page = await context.newPage();
  const sessionDir = await mkdtemp(path.join(tmp, 's-'));
  // As capture.mjs does: another host's robots.txt through the browser's request context, never a page.
  const fetchRobots = async (origin) => {
    const res = await context.request.get(`${origin}/robots.txt`, { failOnStatusCode: false });
    const body = res.status() < 300 ? await res.text() : null;
    return { ...robotsPosture({ httpStatus: res.status(), body }), url: `${origin}/robots.txt` };
  };
  const { driver, session } = await createDriver({
    context,
    page,
    recipe: fixtureRecipe(shop.origin, extra),
    sessionDir,
    paceMs: 20,
    mode,
    browserVersion: 'test',
    robotsGroups,
    fetchRobots,
  });
  return { driver, session, page };
}
const refusal = (code) => (e) => e instanceof RefusalError && e.code === code;
const stopped = (code) => (e) => e instanceof StopError && e.code === code;
const posts = () => shop.log.filter((r) => r.method === 'POST').map((r) => r.path);

test('refuses a submit button that is not an allowlisted add-to-cart (promo Apply)', async () => {
  const { driver } = await fresh('run');
  await driver.goto(`${shop.origin}/products/tee`);
  shop.cart.push({ id: 'tee', size: 'M', qty: 1 });
  await driver.goto(`${shop.origin}/cart`);
  await assert.rejects(driver.click({ role: 'button', name: 'Apply' }), refusal('refused-submit'));
  await assert.rejects(driver.click({ role: 'button', name: 'Remove' }), refusal('refused-submit'));
  shop.cart.length = 0;
  assert.deepEqual(posts(), []);
});

const withAllow = (entries) => ({
  allowlist: [...fixtureRecipe('http://127.0.0.1:1').allowlist, ...entries],
});

test('refuses add-to-cart purpose on a promo or sign-in form, and any purpose not on the recipe allowlist', async () => {
  const { driver } = await fresh('serve', {
    extra: { ...withAllow([
      { purpose: 'add-to-cart', target: { role: 'button', name: 'Apply' } },
      { purpose: 'add-to-cart', target: { role: 'button', name: 'Sign in' } },
    ]) },
  });
  shop.cart.push({ id: 'tee', size: 'M', qty: 1 });
  await driver.goto(`${shop.origin}/cart`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Apply' }, 'add-to-cart'),
    refusal('refused-input-form'),
  );
  await driver.goto(`${shop.origin}/guest-or-sign-in`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Sign in' }, 'add-to-cart'),
    refusal('refused-order-or-account'),
  );
  shop.cart.length = 0;
  // Neither mode adds to the allowlist at run time.
  for (const mode of ['run', 'serve']) {
    const d = await fresh(mode);
    await d.driver.goto(`${shop.origin}/products/tee`);
    await assert.rejects(
      d.driver.click({ role: 'button', name: 'Subscribe' }, 'add-to-cart'),
      refusal('refused-not-allowlisted'),
    );
    assert.equal(d.session.allowlist.length, fixtureRecipe(shop.origin).allowlist.length);
  }
  assert.deepEqual(posts(), []);
});

test('typeless buttons outside a form are plain buttons (cookie decline, popup close)', async () => {
  const { driver } = await fresh('serve', {
    extra: withAllow([
      { purpose: 'decline-cookies', target: { role: 'button', name: 'Reject all' } },
      { purpose: 'close-popup', target: { role: 'button', name: 'Close' } },
    ]),
  });
  await driver.goto(`${shop.origin}/`);
  await driver.click({ role: 'button', name: 'Reject all' }, 'decline-cookies');
  await driver.click({ role: 'button', name: 'Close' }, 'close-popup');
  await driver.click({ role: 'button', name: 'Reject all' });
});

test('a submit-typed option button in a text-free form is clicked only if no navigation results', async () => {
  const { driver } = await fresh('serve', {
    extra: withAllow([
      { purpose: 'option', target: { selector: '#sw-red' } },
      { purpose: 'option', target: { selector: '#sw-blue' } },
    ]),
  });
  await driver.goto(`${shop.origin}/products/tee`);
  await driver.click({ selector: '#sw-red' }, 'option'); // its script prevents the submit
  await assert.rejects(driver.click({ selector: '#sw-blue' }, 'option'), refusal('refused-submit'));
  assert.ok(!posts().includes('/cart/add'));
});

test('order, payment, buy-now and sign-in controls are refused for every click, in any language', async () => {
  const { driver } = await fresh('serve', {
    extra: withAllow([
      { purpose: 'add-to-cart', target: { selector: '#place button:not(#go)' } },
      { purpose: 'add-to-cart', target: { selector: '#go' } },
      { purpose: 'add-to-cart', target: { selector: '#atb' } },
      { purpose: 'add-to-cart', target: { role: 'button', name: 'Buy now' } },
    ]),
  });
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(
    driver.click({ selector: '#place button:not(#go)' }, 'add-to-cart'),
    refusal('refused-order-or-account'),
  );
  await assert.rejects(driver.click({ selector: '#fake-order' }), refusal('refused-order-or-account'));
  await assert.rejects(
    driver.click({ selector: '#go' }, 'add-to-cart'),
    refusal('refused-allowlist-mismatch'),
  );
  await assert.rejects(
    driver.click({ selector: '#atb' }, 'add-to-cart'),
    refusal('refused-allowlist-mismatch'),
  );
  await assert.rejects(
    driver.click({ role: 'button', name: 'Buy now' }, 'add-to-cart'),
    refusal('refused-order-or-account'),
  );
  assert.deepEqual(posts(), []);
});

test('add-to-cart is clicked only on a recipe product page', async () => {
  const { driver } = await fresh('serve');
  await driver.goto(`${shop.origin}/products`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Add to cart' }, 'add-to-cart'),
    refusal('refused-not-product-page'),
  );
  assert.deepEqual(posts(), []);
});

test('same-site writes by fetch are aborted outside an add-to-cart or increment click', async () => {
  const { driver, session } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  await driver.click({ role: 'button', name: 'Like', exact: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!posts().includes('/api/like'));
  assert.ok(session.events.some((e) => e.kind === 'request-aborted' && e.detail.startsWith('POST ')));
});

test('protocol .6: the site\'s own background writes go through, logged; not to account or checkout paths, not after a plain click', async () => {
  const { driver, session } = await fresh('serve');
  await driver.goto(`${shop.origin}/bg-load`);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(posts().includes('/api/graphql'));
  assert.ok(!posts().includes('/api/account/session'));
  assert.ok(!posts().includes('/checkout/session'));
  assert.ok(session.backgroundWrites.sample.some((d) => d.endsWith('/api/graphql')));
  assert.ok(session.events.some((e) => e.kind === 'request-aborted' && e.detail.endsWith('/api/account/session')));
  // A write 1 s after a plain click is inside the 3 s window: aborted.
  await driver.click({ role: 'button', name: 'Show more' });
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(!posts().includes('/api/after-click'));
  assert.ok(session.events.some((e) => e.kind === 'request-aborted' && e.detail.endsWith('/api/after-click')));
});

test('protocol .7: blocked write paths apply inside the add-to-cart window; the add-to-cart write goes through', async () => {
  const { driver, session } = await fresh('serve', {
    extra: { productUrls: [`${shop.origin}/products/tee`, `${shop.origin}/products/js-atc`] },
  });
  await driver.goto(`${shop.origin}/products/js-atc`);
  await driver.click({ role: 'button', name: 'Add to cart' }, 'add-to-cart');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(posts().includes('/cart/add.js'));
  assert.ok(!posts().includes('/api/orders/track'));
  assert.ok(session.events.some((e) => e.kind === 'request-aborted' && e.detail.endsWith('/api/orders/track')));
});

test('protocol .7: background writes are counted apart from events, so other events are never pushed out', async () => {
  const { driver, session } = await fresh('serve');
  await driver.goto(`${shop.origin}/chatty`);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(session.backgroundWrites.count, 250);
  assert.equal(session.backgroundWrites.sample.length, 100);
  assert.ok(!session.events.some((e) => e.kind === 'background-write'));
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ role: 'link', name: 'Partner store' }), refusal('refused-off-site'));
  assert.ok(session.events.some((e) => e.kind === 'navigation-aborted' && e.detail.startsWith('refused-off-site')));
});

test('protocol .7: an invisible Turnstile widget in a host page does not stop the site', async () => {
  const { driver } = await fresh('serve');
  const st = await driver.goto(`${shop.origin}/turnstile-host`);
  assert.equal(st.stopped, null);
});

test('protocol .6: vendor challenge pages stop the site before any snapshot', async () => {
  for (const [route, code, reason] of [
    ['/akamai', 'blocked-bot-wall', 'vendor-akamai'],
    ['/cf-challenge', 'blocked-bot-wall', 'vendor-cloudflare'],
  ]) {
    const { driver, session } = await fresh('serve');
    await assert.rejects(driver.goto(`${shop.origin}${route}`), stopped(code));
    assert.equal(session.stopped.detail, reason);
    await assert.rejects(driver.snapshot('view-01'), refusal('refused-after-stop'));
    assert.equal(session.snapshots.length, 0);
  }
  const { driver } = await fresh('serve');
  const st = await driver.goto(`${shop.origin}/sensors-only`);
  assert.equal(st.stopped, null);
});

test('a GET form submission by script is a form submission', async () => {
  const { driver } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ role: 'button', name: 'More like this' }), refusal('refused-submit'));
  assert.ok(!shop.log.some((r) => r.path === '/search'));
});

test('inspection runs in an isolated world: a page that patches DOM prototypes cannot disguise a submit', async () => {
  const { driver, page } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/patched`);
  // The fixture fools a main-world inspection: type, form owner and closest() all say "plain button".
  const fooled = await page.evaluate(`(${inspectControl})(document.getElementById('disguised'))`);
  assert.equal(fooled.submit, false);
  assert.equal(fooled.inForm, false);
  // The driver's isolated-world inspection is not fooled and refuses before any request is sent.
  await assert.rejects(
    driver.click({ role: 'button', name: 'Next step' }),
    (e) => refusal('refused-submit')(e) && !/navigation aborted/.test(e.message),
  );
  assert.ok(!posts().includes('/cart/update'));
});

test('an image-only order control is refused by its alt text', async () => {
  const { driver } = await fresh('serve', {
    extra: withAllow([{ purpose: 'add-to-cart', target: { selector: '#img-order' } }]),
  });
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(
    driver.click({ selector: '#img-order' }, 'add-to-cart'),
    refusal('refused-order-or-account'),
  );
  await assert.rejects(driver.click({ selector: '#img-order' }), refusal('refused-order-or-account'));
  assert.ok(!posts().includes('/finalize'));
});

test('protocol .5: an off-site redirect landing stops the site as redirected-off-domain', async () => {
  const { driver, session } = await fresh('serve');
  await assert.rejects(driver.goto(`${shop.origin}/r`), stopped('redirected-off-domain'));
  assert.equal(session.offsite, new URL(shop.thirdParty).host);
  assert.ok(session.events.some((e) => e.kind === 'off-site-landing'));
  await assert.rejects(driver.snapshot('view-01'), refusal('refused-after-stop'));
  await assert.rejects(driver.goto(`${shop.origin}/`), refusal('refused-after-stop'));
  assert.equal(session.snapshots.length, 0);
});

test('an add-to-cart POST answered by a 303 to another site is caught the same way', async () => {
  const { driver, session } = await fresh('serve', {
    extra: { productUrls: [`${shop.origin}/products/tee`, `${shop.origin}/products/hat`] },
  });
  await driver.goto(`${shop.origin}/products/hat`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Add to cart' }, 'add-to-cart'),
    stopped('redirected-off-domain'),
  );
  assert.equal(session.offsite, new URL(shop.thirdParty).host);
  await assert.rejects(driver.snapshot('cart-1'), refusal('refused-after-stop'));
});

test('robots (.4): a disallowed path on the entry host loads and is recorded, never refused', async () => {
  const groups = parseRobots('User-agent: *\nDisallow: /terms\nDisallow: /cart\n');
  const { driver, session } = await fresh('serve', { robotsGroups: groups });
  const st = await driver.goto(`${shop.origin}/terms`);
  assert.equal(st.stopped, null);
  assert.ok(shop.log.some((r) => r.path === '/terms'));
  await driver.goto(`${shop.origin}/r-terms`);
  await driver.goto(`${shop.origin}/cart`);
  await driver.snapshot('empty-cart');
  assert.equal(session.snapshots[0].robotsAllowed, false);
  assert.ok(session.events.some((e) => e.kind === 'robots-disallowed-path'));
  // The shop's rules never apply to another site, which is never loaded (protocol .5).
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ role: 'link', name: 'Partner store' }), refusal('refused-off-site'));
});

test('robots (.4): another host of the site is checked before its first page; disallow-all stops the site', async () => {
  const { driver, session } = await fresh('serve');
  const before = shop.log.length;
  await assert.rejects(driver.goto(`${shop.sister}/bag`), stopped('robots-disallow-all'));
  const sent = shop.log.slice(before).filter((r) => r.site === 'sister');
  assert.deepEqual(
    sent.map((r) => r.path),
    ['/robots.txt'],
  );
  assert.equal(session.robotsHosts.get(new URL(shop.sister).host).decision, 'robots-disallow-all');
  await assert.rejects(driver.snapshot('empty-cart'), refusal('refused-after-stop'));
});

test('robots (.4): a redirect onto a disallow-all host stops the site after landing, with no snapshot', async () => {
  const { driver, session } = await fresh('serve');
  await assert.rejects(driver.goto(`${shop.origin}/r-sister`), stopped('robots-disallow-all'));
  assert.equal(session.stopped.detail, 'landing-host-robots-disallow-all');
  await assert.rejects(driver.snapshot('terms'), refusal('refused-after-stop'));
  assert.equal(session.snapshots.length, 0);
});

test('stop check before robots: a redirect onto a challenge page on a disallow-all host stops as captcha', async () => {
  const { driver, session } = await fresh('serve');
  await assert.rejects(driver.goto(`${shop.origin}/r-sister-px`), stopped('captcha'));
  assert.equal(session.stopped.code, 'captcha');
  await assert.rejects(driver.snapshot('terms'), refusal('refused-after-stop'));
  assert.equal(session.snapshots.length, 0);
});

test('a host allowed by its robots.txt loads; a later landing there is not re-fetched', async () => {
  await shop.close();
  shop = await startShop({ sisterRobots: 'User-agent: *\nDisallow: /bag-private\n' });
  try {
    const { driver, session } = await fresh('serve');
    const st = await driver.goto(`${shop.sister}/bag`);
    assert.equal(st.stopped, null);
    await driver.goto(`${shop.origin}/r-sister`);
    assert.equal(shop.log.filter((r) => r.site === 'sister' && r.path === '/robots.txt').length, 1);
    await driver.snapshot('empty-cart');
    assert.equal(session.snapshots[0].robotsAllowed, true);
  } finally {
    await shop.close();
    shop = await startShop();
  }
});

test('no snapshot of a challenge page: a redirect to one stops the site, and so does a wall that appears late', async () => {
  const a = await fresh('serve');
  await assert.rejects(a.driver.goto(`${shop.origin}/r-px`), stopped('captcha'));
  await assert.rejects(a.driver.snapshot('terms'), refusal('refused-after-stop'));
  assert.equal(a.session.snapshots.length, 0);
  const b = await fresh('serve');
  await b.driver.goto(`${shop.origin}/late-wall`);
  await new Promise((r) => setTimeout(r, 600));
  await assert.rejects(b.driver.snapshot('terms'), stopped('blocked-bot-wall'));
  assert.equal(b.session.snapshots.length, 0);
});

test('recon mode: look only (view-NN snapshots, no add-to-cart, no choices) and findings must be pages it loaded', async () => {
  const { driver, session } = await fresh('recon', { extra: { productUrls: [], allowlist: [] } });
  await driver.goto(`${shop.origin}/listing`);
  await driver.snapshot('view-01');
  for (const state of ['empty-cart', 'cart-1', 'terms'])
    await assert.rejects(driver.snapshot(state), refusal('refused-recon-snapshot'));
  await assert.rejects(
    driver.click({ role: 'button', name: 'Add to cart' }, 'add-to-cart'),
    refusal('refused-recon-purpose'),
  );
  await assert.rejects(driver.click({ selector: '#plain-atc' }), refusal('refused-recon-add-to-cart'));
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(
    driver.click({ selector: 'button.size[data-size="M"]' }, 'option'),
    refusal('refused-recon-purpose'),
  );
  await assert.rejects(driver.click({ role: 'button', name: 'Add to cart' }), refusal('refused-submit'));
  assert.deepEqual(posts(), []);
  const base = { listingUrl: `${shop.origin}/listing`, productUrls: [`${shop.origin}/products/tee`], checkoutPaths: [] };
  await assert.rejects(driver.end({ findings: { ...base, cartPath: '/cart' } }), refusal('refused-findings-not-seen'));
  await assert.rejects(driver.end({}), refusal('refused-bad-end'));
  assert.equal(session.ended, null);
  assert.equal(session.views, 1);
});

test('recon mode: findings need views of the home page and listing, frame hosts, and record the cart host', async () => {
  const { driver, session } = await fresh('recon', {
    extra: { productUrls: [], allowlist: [], hosts: ['127.0.0.1'] },
  });
  await driver.goto(`${shop.origin}/`);
  await driver.goto(`${shop.origin}/listing`);
  await driver.goto(`${shop.origin}/products/tee`);
  await driver.goto(`${shop.origin}/listing`);
  await driver.click({ role: 'link', name: 'Cart' });
  const findings = {
    listingUrl: `${shop.origin}/listing`,
    productUrls: [`${shop.origin}/products/tee`],
    cartPath: '/cart',
    checkoutPaths: ['/checkout'],
  };
  // No view-NN of the home page or the listing yet.
  await assert.rejects(driver.end({ findings }), refusal('refused-findings-no-view'));
  await driver.goto(`${shop.origin}/`);
  await driver.snapshot('view-01');
  await assert.rejects(driver.end({ findings }), refusal('refused-findings-no-view'));
  await driver.goto(`${shop.origin}/listing`);
  await driver.snapshot('view-02');
  await driver.end({ findings });
  assert.deepEqual(session.ended.findings, findings);
  assert.equal(session.ended.cartHost, new URL(shop.origin).host);
  assert.deepEqual(
    session.navigationLog.map((u) => new URL(u).pathname),
    ['/', '/listing', '/products/tee', '/listing', '/cart', '/', '/listing'],
  );
});

test('protocol .5: the home view may be taken where a goto to the origin landed on the same site', async () => {
  await shop.close();
  shop = await startShop({ homeRedirect: true });
  try {
    const { driver, session } = await fresh('recon', {
      extra: { productUrls: [], allowlist: [], hosts: ['127.0.0.1'] },
    });
    const st = await driver.goto(`${shop.origin}/`);
    assert.equal(new URL(st.url).pathname, '/shop/us');
    await driver.snapshot('view-01');
    await driver.goto(`${shop.origin}/listing`);
    await driver.snapshot('view-02');
    await driver.goto(`${shop.origin}/products/tee`);
    await driver.goto(`${shop.origin}/cart`);
    await driver.end({
      findings: {
        listingUrl: `${shop.origin}/listing`,
        productUrls: [`${shop.origin}/products/tee`],
        cartPath: '/cart',
        checkoutPaths: [],
      },
    });
    assert.deepEqual(
      session.homeLandings.map((h) => [h.chain.map((u) => new URL(u).pathname), new URL(h.landed).pathname, h.sameSite]),
      [[['/', '/shop/us'], '/shop/us', true]],
    );
  } finally {
    await shop.close();
    shop = await startShop();
  }
});

test('protocol .5: a goto and the redirects and script navigations it causes count as one navigation', async () => {
  const { driver, session } = await fresh('serve');
  await driver.goto(`${shop.origin}/js-hops`);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(new URL(driver.status().url).pathname, '/terms');
  assert.equal(session.navigations, 1);
  assert.equal(session.navigationRequests, 3);
  await driver.goto(`${shop.origin}/terms`);
  assert.equal(session.navigations, 2);
  // A page that keeps navigating is cut off after a fixed number of requests in one action.
  await assert.rejects(driver.goto(`${shop.origin}/js-loop`), refusal('refused-navigation-loop'));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(session.navigations, 3);
  assert.equal(session.requestsThisAction, MAX_REQUESTS_PER_ACTION);
  assert.ok(session.events.some((e) => e.detail.startsWith('refused-navigation-loop')));
});

test("recon mode: listing and product URLs must be on the frame's hosts", async () => {
  const { driver } = await fresh('recon', {
    extra: { productUrls: [], allowlist: [], hosts: ['www.shop.example'] },
  });
  await driver.goto(`${shop.origin}/`);
  await driver.snapshot('view-01');
  await driver.goto(`${shop.origin}/listing`);
  await driver.snapshot('view-02');
  await driver.goto(`${shop.origin}/products/tee`);
  await driver.goto(`${shop.origin}/cart`);
  await assert.rejects(
    driver.end({
      findings: {
        listingUrl: `${shop.origin}/listing`,
        productUrls: [`${shop.origin}/products/tee`],
        cartPath: '/cart',
        checkoutPaths: [],
      },
    }),
    refusal('refused-findings-off-hosts'),
  );
});

test('a challenge element in the main document stops the site', async () => {
  const { driver } = await fresh('serve');
  await assert.rejects(driver.goto(`${shop.origin}/pxwall`), stopped('captcha'));
});

test('a wall that appears after load is caught before the next click', async () => {
  const { driver, session } = await fresh('serve');
  await driver.goto(`${shop.origin}/late-wall`);
  await new Promise((r) => setTimeout(r, 600));
  await assert.rejects(driver.click({ selector: 'p' }), stopped('blocked-bot-wall'));
  assert.equal(session.stopped.detail, 'wall-wording');
});

test('refuses an in-form control that is not on the allowlist', async () => {
  const { driver } = await fresh('run');
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ selector: 'button.size[data-size="S"]' }), refusal('refused-in-form'));
});

test('refuses text fields, their labels, <select>, options and file inputs', async () => {
  const { driver } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ selector: '#giftmsg' }), refusal('refused-text-entry'));
  await assert.rejects(driver.click({ selector: '#giftlabel' }), refusal('refused-text-entry'));
  await assert.rejects(driver.click({ selector: '#colour' }), refusal('refused-select'));
  await assert.rejects(driver.click({ role: 'option', name: 'Blue' }), refusal('refused-select'));
  await assert.rejects(driver.click({ selector: '#upload' }), refusal('refused-file-input'));
  await assert.rejects(driver.click({ selector: 'input[name=qty]' }), refusal('refused-text-entry'));
});

test('refuses coordinates and anything touching a cross-origin frame', async () => {
  const { driver } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ x: 100, y: 100 }), refusal('refused-coordinate-click'));
  await assert.rejects(driver.click({ selector: 'iframe' }), refusal('refused-cross-origin-frame'));
  await assert.rejects(driver.click({ selector: '#frame-box' }), refusal('refused-cross-origin-frame'));
  await assert.rejects(
    driver.click({ selector: 'iframe >> internal:control=enter-frame >> #w' }),
    refusal('refused-cross-origin-frame'),
  );
  // Role lookups never pierce frames: the widget's button is not found in the top frame.
  await assert.rejects(driver.click({ role: 'button', name: 'Widget' }), refusal('target-not-unique'));
});

test('refuses navigation to another registrable domain', async () => {
  const { driver } = await fresh('serve');
  await assert.rejects(driver.goto(`${shop.thirdParty}/checkout`), refusal('refused-off-site'));
  await assert.rejects(driver.goto('https://example.com/'), refusal('refused-off-site'));
  await assert.rejects(driver.goto('file:///etc/hosts'), refusal('refused-scheme'));
});

test('aborts a form-submitting navigation that a plain button triggers in script', async () => {
  const { driver } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ role: 'button', name: 'Show offers' }), refusal('refused-submit'));
  assert.ok(!posts().includes('/newsletter'));
});

test('protocol .5: a click to another site is refused and nothing of it loads', async () => {
  const { driver, session } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  const before = shop.log.length;
  await assert.rejects(driver.click({ role: 'link', name: 'Partner store' }), refusal('refused-off-site'));
  assert.equal(session.offsite, null);
  assert.ok(!shop.log.slice(before).some((r) => r.site === 'third-party'));
  // The session goes on on the shop's own pages.
  await driver.goto(`${shop.origin}/cart`);
  // checkout-1 is not a robot state since protocol .5.
  await assert.rejects(driver.snapshot('checkout-1'), refusal('refused-bad-state'));
});

test('protocol .5: no session enters a checkout (goto refused, click refused, landing stops)', async () => {
  const a = await fresh('serve');
  const before = shop.log.length;
  await assert.rejects(a.driver.goto(`${shop.origin}/checkout`), refusal('refused-checkout'));
  await assert.rejects(a.driver.goto(`${shop.origin}/checkout/`), refusal('refused-checkout'));
  shop.cart.push({ id: 'tee', size: 'M', qty: 1 });
  try {
    await a.driver.goto(`${shop.origin}/cart`);
    await assert.rejects(
      a.driver.click({ role: 'link', name: 'Checkout', exact: true }),
      refusal('refused-checkout'),
    );
  } finally {
    shop.cart.length = 0;
  }
  assert.ok(!shop.log.slice(before).some((r) => r.path === '/checkout'));
  const b = await fresh('serve');
  await assert.rejects(b.driver.goto(`${shop.origin}/r-checkout`), stopped('would-need-forbidden-action'));
  assert.equal(b.session.stopped.detail, 'landed-on-checkout');
  // Backstop when the recipe names no checkout path: checkout-like path segments and checkout wording.
  const c = await fresh('serve', { extra: { checkoutPaths: [] } });
  const pre = shop.log.length;
  for (const p of ['/checkout', '/checkouts/abc', '/en/checkout', '/Secure-Checkout/step1'])
    await assert.rejects(c.driver.goto(`${shop.origin}${p}`), refusal('refused-checkout'), p);
  assert.ok(!shop.log.slice(pre).some((r) => /checkout/i.test(r.path)));
  const ok = await c.driver.goto(`${shop.origin}/checkout/cart`);
  assert.equal(ok.stopped, null);
  shop.cart.push({ id: 'tee', size: 'M', qty: 1 });
  try {
    await c.driver.goto(`${shop.origin}/cart`);
    await assert.rejects(c.driver.click({ selector: '#checkout-link' }), refusal('refused-checkout'));
  } finally {
    shop.cart.length = 0;
  }
  const d = await fresh('serve', { extra: { checkoutPaths: [] } });
  await assert.rejects(d.driver.goto(`${shop.origin}/r-checkout`), stopped('would-need-forbidden-action'));
  // The continue-as-guest purpose is retired.
  await assert.rejects(
    (await fresh('serve')).driver.click({ role: 'button', name: 'Continue as guest' }, 'continue-as-guest'),
    refusal('refused-not-allowlisted'),
  );
});

for (const [route, code] of [
  ['/blocked', 'blocked-http-403'],
  ['/ratelimited', 'blocked-http-429'],
  ['/captcha', 'captcha'],
  ['/wall', 'blocked-bot-wall'],
  ['/extcheck', 'blocked-extension-check'],
  ['/account/login', 'sign-in-required'],
]) {
  test(`stops the site at once on ${code}, with screenshot evidence, and refuses everything after`, async () => {
    const { driver, session } = await fresh('serve');
    await assert.rejects(driver.goto(`${shop.origin}${route}`), stopped(code));
    assert.equal(session.stopped.code, code);
    assert.match(session.stopped.evidenceSha256, /^[0-9a-f]{64}$/);
    await assert.rejects(driver.goto(`${shop.origin}/`), refusal('refused-after-stop'));
    await assert.rejects(driver.click({ role: 'link', name: 'Terms of use' }), refusal('refused-after-stop'));
    await assert.rejects(driver.snapshot('cart-1'), refusal('refused-after-stop'));
  });
}

test('a sign-in form beside guest checkout does not stop the site, and is never touched', async () => {
  // The fixture's checkout page under a non-checkout path (no session enters a real checkout).
  const { driver } = await fresh('serve');
  const st = await driver.goto(`${shop.origin}/guest-or-sign-in`);
  assert.equal(st.stopped, null);
  assert.ok(!posts().includes('/login'));
});

test(`refuses navigation ${MAX_NAVIGATIONS + 1}`, async () => {
  const { driver } = await fresh('serve');
  for (let i = 0; i < MAX_NAVIGATIONS; i += 1) await driver.goto(`${shop.origin}/terms?i=${i}`);
  await assert.rejects(driver.goto(`${shop.origin}/terms`), refusal('refused-navigation-limit'));
});

test('paces navigations and clicks', async () => {
  const context = await browser.newContext();
  open.push(context);
  const page = await context.newPage();
  const { driver } = await createDriver({
    context,
    page,
    recipe: fixtureRecipe(shop.origin),
    sessionDir: tmp,
    paceMs: 700,
    mode: 'serve',
    browserVersion: 'test',
  });
  const t0 = Date.now();
  await driver.goto(`${shop.origin}/`);
  await driver.goto(`${shop.origin}/terms`);
  await driver.goto(`${shop.origin}/products`);
  assert.ok(Date.now() - t0 >= 1400, `${Date.now() - t0} ms`);
});
