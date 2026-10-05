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

async function fresh(mode = 'serve') {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  open.push(context);
  const page = await context.newPage();
  const sessionDir = await mkdtemp(path.join(tmp, 's-'));
  const { driver, session } = await createDriver({
    context,
    page,
    recipe: fixtureRecipe(shop.origin),
    sessionDir,
    paceMs: 20,
    mode,
    browserVersion: 'test',
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

test('refuses add-to-cart purpose on a promo or sign-in form, and an unlisted purpose in run mode', async () => {
  const { driver } = await fresh('serve');
  shop.cart.push({ id: 'tee', size: 'M', qty: 1 });
  await driver.goto(`${shop.origin}/cart`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Apply' }, 'add-to-cart'),
    refusal('refused-input-form'),
  );
  await driver.goto(`${shop.origin}/checkout`);
  await assert.rejects(
    driver.click({ role: 'button', name: 'Sign in' }, 'add-to-cart'),
    refusal('refused-input-form'),
  );
  shop.cart.length = 0;
  const run = await fresh('run');
  await run.driver.goto(`${shop.origin}/products/tee`);
  await assert.rejects(
    run.driver.click({ role: 'button', name: 'Subscribe' }, 'add-to-cart'),
    refusal('refused-not-allowlisted'),
  );
  assert.deepEqual(posts(), []);
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
