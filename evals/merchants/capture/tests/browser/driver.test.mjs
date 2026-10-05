// Browser tests of the capture driver's refusals and stops against the local fixture shop (127.0.0.1 only).
// Run: npm run test:capture:browser (needs Playwright's Chromium).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { MAX_NAVIGATIONS, createDriver } from '../../driver.mjs';
import { RefusalError, StopError } from '../../guards.mjs';
import { parseRobots } from '../../robots.mjs';
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
  const { driver, session } = await createDriver({
    context,
    page,
    recipe: fixtureRecipe(shop.origin, extra),
    sessionDir,
    paceMs: 20,
    mode,
    browserVersion: 'test',
    robotsGroups,
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
    extra: withAllow([
      { purpose: 'add-to-cart', target: { role: 'button', name: 'Apply' } },
      { purpose: 'add-to-cart', target: { role: 'button', name: 'Sign in' } },
    ]),
  });
  shop.cart.push({ id: 'tee', size: 'M', qty: 1 });
  await driver.goto(`${shop.origin}/cart`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Apply' }, 'add-to-cart'),
    refusal('refused-input-form'),
  );
  await driver.goto(`${shop.origin}/checkout`);
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

test('a GET form submission by script is a form submission', async () => {
  const { driver } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(driver.click({ role: 'button', name: 'More like this' }), refusal('refused-submit'));
  assert.ok(!shop.log.some((r) => r.path === '/search'));
});

test('inspection runs in an isolated world: a page that patches DOM prototypes cannot disguise a submit', async () => {
  const { driver } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/patched`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Next step' }),
    (e) => refusal('refused-submit')(e) && !/navigation aborted/.test(e.message),
  );
  assert.ok(!posts().includes('/cart/update'));
});

test('an off-site redirect is caught after the action: offsite is set and only checkout-1 may be captured', async () => {
  const { driver, session } = await fresh('serve');
  const st = await driver.goto(`${shop.origin}/r`);
  assert.equal(st.offsite, new URL(shop.thirdParty).host);
  assert.equal(session.offsite, new URL(shop.thirdParty).host);
  await assert.rejects(driver.snapshot('cart-1'), refusal('refused-third-party-page'));
  await assert.rejects(driver.goto(`${shop.origin}/`), refusal('refused-third-party-page'));
});

test('an add-to-cart POST answered by a 303 to another site is caught the same way', async () => {
  const { driver, session } = await fresh('serve', {
    extra: { productUrls: [`${shop.origin}/products/tee`, `${shop.origin}/products/hat`] },
  });
  await driver.goto(`${shop.origin}/products/hat`);
  await driver.click({ role: 'button', name: 'Add to cart' }, 'add-to-cart');
  assert.equal(session.offsite, new URL(shop.thirdParty).host);
  await assert.rejects(driver.snapshot('cart-1'), refusal('refused-third-party-page'));
});

test('robots.txt applies to every navigation on the origin host, redirects included, never to other hosts', async () => {
  const groups = parseRobots('User-agent: *\nDisallow: /terms\nDisallow: /elsewhere\n');
  const { driver } = await fresh('serve', { robotsGroups: groups });
  const before = shop.log.length;
  await assert.rejects(driver.goto(`${shop.origin}/terms`), refusal('robots-disallow-path'));
  assert.ok(!shop.log.slice(before).some((r) => r.path === '/terms'));
  await assert.rejects(driver.goto(`${shop.origin}/r-terms`), refusal('robots-disallow-path'));
  // The shop's rules never apply to the third-party host (its /elsewhere loads).
  await driver.goto(`${shop.origin}/products/tee`);
  const st = await driver.click({ role: 'link', name: 'Partner store' });
  assert.equal(st.offsite, new URL(shop.thirdParty).host);
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

test('third-party checkout: the first page loads and is recorded, then nothing else', async () => {
  const { driver, session } = await fresh('serve');
  await driver.goto(`${shop.origin}/products/tee`);
  const st = await driver.click({ role: 'link', name: 'Partner store' });
  assert.equal(st.offsite, new URL(shop.thirdParty).host);
  assert.equal(session.offsite, new URL(shop.thirdParty).host);
  await assert.rejects(driver.goto(`${shop.origin}/cart`), refusal('refused-third-party-page'));
  await assert.rejects(driver.click({ role: 'link', name: 'Next' }), refusal('refused-third-party-page'));
  await assert.rejects(driver.snapshot('cart-1'), refusal('refused-third-party-page'));
  const snap = await driver.snapshot('checkout-1');
  assert.match(snap.manifestSha256, /^[0-9a-f]{64}$/);
  assert.ok(!shop.log.some((r) => r.site === 'third-party' && r.path === '/next'));
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
  const { driver } = await fresh('serve');
  const st = await driver.goto(`${shop.origin}/checkout`);
  assert.equal(st.stopped, null);
  await driver.click({ role: 'button', name: 'Continue as guest' }, 'continue-as-guest');
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
