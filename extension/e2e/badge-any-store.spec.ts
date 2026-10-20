// Phase 13c: the automatic badge at any store. Synthetic fixture pages are served at https hosts through
// context.route (no real store is contacted): the amount view, the rates view when the reader withholds,
// no badge on a product page with an open cart drawer, an empty cart or a non-USD cart, single-page
// navigation into and out of a cart, the badge toggle and the per-site switch, and axe on the badge.
// Phase 14.2: a store named from the bundled merchant release, and no badge on a payment processor's
// page. Phase 15.1: the former adapter stores are ordinary release stores (the toggle covers them too).
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { addCard } from './wallet';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const extension = resolve('dist-e2e');
const BADGE = '/src/badge/index.html';

const row = (label: string, amount: string) => `<div><span>${label}</span><span>${amount}</span></div>`;
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const summary = (rows: string) =>
  `<section class="summary">${rows}<button type="button">Checkout</button></section>`;
const USD_ROWS = row('Subtotal', '$90.00') + row('Shipping', '$10.00') + row('Order total', '$100.00');
const cartBody = (rows: string, heading = 'Your cart') => `<main><h1>${heading}</h1>${summary(rows)}</main>`;
/** A single-page store: the home page renders the cart on history.pushState, and the home page again. */
const SPA = page(
  'Shop',
  `<main id="app"><h1>Welcome</h1><p><a id="to-cart" href="/cart">Cart</a></p></main>
<script>
  const app = document.getElementById('app');
  const home = () => { app.innerHTML = '<h1>Welcome</h1><p><a id="to-cart" href="/cart">Cart</a></p>'; document.title = 'Shop'; };
  const cart = () => {
    app.innerHTML = '<h1>Your cart</h1>' + ${JSON.stringify(summary(USD_ROWS))} + '<p><a id="to-home" href="/">Keep shopping</a></p>';
    document.title = 'Your cart';
  };
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    history.pushState({}, '', link.getAttribute('href'));
    if (link.id === 'to-cart') cart(); else home();
  });
</script>`,
);
const fixtures: Record<string, string> = {
  'https://shop.example.com/cart': page('Your cart', cartBody(USD_ROWS)),
  'https://shop.example.com/cart?view=uncertain': page(
    'Your cart',
    cartBody(row('Total', '$100.00') + row('Total', '$120.00')),
  ),
  // A product page (its title and heading name the product, not the cart) with the cart drawer open.
  'https://shop.example.com/products/leather-wallet': page(
    'Leather wallet',
    `<main><h1>Leather wallet</h1><p>$120.00</p><button type="button">Add to cart</button></main>
<aside class="drawer" aria-label="Cart"><h2>Cart</h2>${summary(USD_ROWS)}</aside>`,
  ),
  'https://shop.example.com/cart?view=empty': page(
    'Your cart',
    cartBody(row('Subtotal', '$0.00') + row('Total', '$0.00'), 'Your cart is empty'),
  ),
  'https://shop.example.com/cart?view=eur': page(
    'Your cart',
    cartBody(row('Subtotal', '€90.00') + row('Total', '€100.00')),
  ),
  'https://shop.example.com/': SPA,
  'https://other.example.com/cart': page('Basket', cartBody(USD_ROWS, 'Your basket')),
  // A release store (amazon.com) on a subdomain: the generic reader at the store's own id, named by the
  // release. A processor (pay.amazon.com, paypal.com): a cart-like page that is never read.
  'https://smile.amazon.com/cart': page('Your cart', cartBody(USD_ROWS)),
  'https://pay.amazon.com/checkout/x': page('Checkout', cartBody(USD_ROWS, 'Review your order')),
  'https://www.paypal.com/checkoutnow': page('Checkout', cartBody(USD_ROWS, 'Pay with PayPal')),
};

async function launch(testInfo: { outputPath: (name: string) => string }) {
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(
    /^https:\/\/((shop|other)\.example\.com|smile\.amazon\.com|pay\.amazon\.com|www\.paypal\.com)\//,
    (route) => {
      const body = fixtures[route.request().url()];
      return body
        ? route.fulfill({ contentType: 'text/html', body })
        : route.fulfill({ status: 404, body: 'not found' });
    },
  );
  await context.route(/^https:\/\/www\.bestbuy\.com\//, (route) =>
    route.request().url() === 'https://www.bestbuy.com/cart'
      ? route.fulfill({
          contentType: 'text/html',
          body: readFileSync('tests/fixtures/bestbuy-observed-summary.html', 'utf8'),
        })
      : route.fulfill({ status: 404, body: 'not found' }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  return { context, worker, id, popupUrl: `chrome-extension://${id}/src/popup/index.html` };
}
const hasBadge = (p: Page) => p.frames().some((f) => f.url().includes(BADGE));
async function badgeFrame(p: Page): Promise<Frame> {
  await expect.poll(() => hasBadge(p), { timeout: 10_000 }).toBe(true);
  return p.frames().find((f) => f.url().includes(BADGE))!;
}
/** No badge: the content script had its chance (document_idle, then one debounce) and read nothing worth showing. */
async function expectNoBadge(p: Page) {
  await p.waitForTimeout(1500);
  expect(hasBadge(p)).toBe(false);
}
async function onboard(context: BrowserContext, id: string) {
  await expect
    .poll(() => context.pages().some((p) => p.url() === `chrome-extension://${id}/src/onboarding/index.html`))
    .toBe(true);
  const onboarding = context.pages().find((p) => p.url().endsWith('/src/onboarding/index.html'))!;
  await expect(onboarding.getByRole('heading', { name: 'Welcome to AI Checkout' })).toBeVisible();
  await addCard(onboarding, 'Citi Double Cash');
  await addCard(onboarding, 'American Express Blue Cash Everyday');
  await onboarding.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
  await onboarding.getByRole('button', { name: 'Save cards' }).click();
  await expect(onboarding.getByRole('heading', { name: 'You’re set' })).toBeVisible();
  await onboarding.close();
}
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
async function axeBadge(frame: Frame, label: string) {
  await frame.evaluate(axeSource);
  const violations = await frame.evaluate(async (tags) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ...args: unknown[]
          ) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  }, TAGS);
  expect(violations, label).toEqual([]);
}
async function axePage(p: Page, label: string) {
  const { violations } = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

test('badge at any store: amount view, rates view, drawer, empty and non-USD carts hidden, single-page navigation, toggles', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(browserName).toBe('chromium');
  const { context, worker, id, popupUrl } = await launch(testInfo);
  try {
    await onboard(context, id);
    // The install asked for every https site, once; no site adds permissions later.
    const permissions = await worker.evaluate(() => chrome.permissions.getAll());
    expect(permissions.origins?.sort()).toEqual(['https://*/*']);

    // Amount view: a certain $100.00 at the generic profile (online retail): Blue Cash Everyday 3%.
    const cart = await context.newPage();
    await cart.goto('https://shop.example.com/cart');
    let badge = await badgeFrame(cart);
    const amountPill = badge.getByRole('button', {
      name: /Use Blue Cash Everyday · \$3\.00 back on this cart/,
    });
    await expect(amountPill).toBeVisible();
    await cart.screenshot({ path: testInfo.outputPath('any-store-amount.png') });
    await axeBadge(badge, 'amount pill');
    await amountPill.click();
    await expect(
      badge.getByText('Based on $100.00 cart estimated total at Another U.S. online store.'),
    ).toBeVisible();
    // Nothing about the page reached the extension's storage: no URL path, no page text.
    const stored = JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null)));
    expect(stored).toContain('shop.example.com');
    expect(stored).not.toMatch(/\/cart|Order total|Widget|Checkout/);
    await badge.getByRole('button', { name: 'Collapse' }).click();

    // Rates view: two different totals, so the reader withholds; the badge shows the best card's rate.
    const uncertain = await context.newPage();
    await uncertain.goto('https://shop.example.com/cart?view=uncertain');
    badge = await badgeFrame(uncertain);
    const ratePill = badge.getByRole('button', { name: /Use Blue Cash Everyday · 3% back at this store/ });
    await expect(ratePill).toBeVisible();
    await expect(ratePill).toContainText('Use Blue Cash Everyday · 3% back');
    await uncertain.screenshot({ path: testInfo.outputPath('any-store-rates.png') });
    await ratePill.click();
    await expect(badge.getByRole('heading', { name: 'Best card for this cart' })).toBeFocused();
    await expect(badge.getByText(/The cart amount wasn’t read on this page/)).toBeVisible();
    const rows = badge.getByRole('list', { name: 'Your cards by rate, best first' }).getByRole('listitem');
    await expect(rows).toHaveText(['Blue Cash Everyday3% back', 'Double Cash2% back']);
    // The amount edit is optional; nothing asks for it.
    await expect(badge.getByLabel('Amount (USD, optional)')).toHaveValue('');
    expect(await badge.locator('body').innerText()).not.toMatch(/enter the amount/i);
    await uncertain.screenshot({ path: testInfo.outputPath('any-store-rates-panel.png') });
    await axeBadge(badge, 'rates panel');
    // A typed amount turns the panel into a dollar estimate.
    await badge.getByLabel('Amount (USD, optional)').fill('50');
    await badge.getByRole('button', { name: 'Update' }).click();
    await expect(badge.getByText('Based on $50.00 you entered, at Another U.S. online store.')).toBeVisible();
    await badge.getByRole('button', { name: 'Collapse' }).click();
    await expect(badge.getByRole('button', { name: /Use Blue Cash Everyday · \$1\.50 back/ })).toBeVisible();

    // No badge: a product page with an open cart drawer, an empty cart, a cart in euros.
    for (const url of [
      'https://shop.example.com/products/leather-wallet',
      'https://shop.example.com/cart?view=empty',
      'https://shop.example.com/cart?view=eur',
    ]) {
      const p = await context.newPage();
      await p.goto(url);
      await expectNoBadge(p);
      await p.close();
    }

    // A store from the merchant release (Phase 14.2): named in the panel, its id and host on the tab.
    const named = await context.newPage();
    await named.goto('https://smile.amazon.com/cart');
    badge = await badgeFrame(named);
    await badge.getByRole('button', { name: /\$3\.00 back on this cart/ }).click();
    await expect(badge.getByText('Based on $100.00 cart estimated total at Amazon.')).toBeVisible();
    const namedTabs = JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null)));
    expect(namedTabs).toContain('"merchantId":"amazon-us"');
    expect(namedTabs).toContain('smile.amazon.com');
    await named.close();
    // No badge on a payment processor's page, cart-like or not (Amazon Pay's host beats amazon.com).
    for (const url of ['https://pay.amazon.com/checkout/x', 'https://www.paypal.com/checkoutnow']) {
      const p = await context.newPage();
      await p.goto(url);
      await expectNoBadge(p);
      await p.close();
    }

    // Single-page navigation: the home page has no hint (nothing read); pushing /cart shows the badge,
    // pushing / again hides it.
    const spa = await context.newPage();
    await spa.goto('https://shop.example.com/');
    await expectNoBadge(spa);
    await spa.getByRole('link', { name: 'Cart' }).click();
    badge = await badgeFrame(spa);
    await expect(badge.getByRole('button', { name: /\$3\.00 back on this cart/ })).toBeVisible();
    await spa.getByRole('link', { name: 'Keep shopping' }).click();
    await expect.poll(() => hasBadge(spa), { timeout: 5000 }).toBe(false);
    await spa.getByRole('link', { name: 'Cart' }).click();
    await badgeFrame(spa);
    await spa.close();

    // "Not on this site" at another store records its host: gone there, still shown elsewhere.
    await uncertain.close();
    await cart.reload();
    badge = await badgeFrame(cart);
    await badge.getByRole('button', { name: /Show details/ }).click();
    await badge.getByRole('button', { name: 'Not on this site' }).click();
    await expect.poll(() => hasBadge(cart)).toBe(false);
    await cart.reload();
    await expectNoBadge(cart);
    const other = await context.newPage();
    await other.goto('https://other.example.com/cart');
    await badgeFrame(other);
    // Settings lists the site; switching it back on brings the badge back there.
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 900 });
    await popup.goto(popupUrl);
    await popup.getByText('Settings', { exact: true }).click();
    const site = popup.getByRole('switch', { name: 'shop.example.com' });
    await expect(site).not.toBeChecked();
    await popup.screenshot({ path: testInfo.outputPath('any-store-settings.png'), fullPage: true });
    await axePage(popup, 'settings with a disabled site');
    await site.click();
    await expect(popup.getByRole('switch', { name: 'shop.example.com' })).toHaveCount(0);
    await cart.reload();
    await badgeFrame(cart);

    // The badge toggle hides every store, a former adapter store (Best Buy, Phase 15.1) included.
    const toggle = popup.getByRole('switch', { name: 'Show the cart badge at stores' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await cart.reload();
    await expectNoBadge(cart);
    await other.reload();
    await expectNoBadge(other);
    const bestBuy = await context.newPage();
    await bestBuy.goto('https://www.bestbuy.com/cart');
    await expectNoBadge(bestBuy);
    await toggle.click();
    await expect(toggle).toBeChecked();
    await cart.reload();
    await badgeFrame(cart);
    await bestBuy.reload();
    const bestBuyBadge = await badgeFrame(bestBuy);
    await expect(
      bestBuyBadge.getByRole('button', { name: /Use Blue Cash Everyday · \$0\.81 back on this cart/ }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

// Phase 15.4: before any card is picked, the pill at a generic store is the way back to onboarding (the
// install's onboarding tab is closed first, as a shopper who dismissed it would have). It opens setup and
// expands nothing, so the per-tab "Dismiss" lives only in the expanded panel of a comparison.
test('no cards at a generic store: the pill opens onboarding', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  const { context, id } = await launch(testInfo);
  try {
    await expect
      .poll(() =>
        context.pages().some((p) => p.url() === `chrome-extension://${id}/src/onboarding/index.html`),
      )
      .toBe(true);
    await context
      .pages()
      .find((p) => p.url().endsWith('/src/onboarding/index.html'))!
      .close();
    const cart = await context.newPage();
    await cart.goto('https://shop.example.com/cart');
    const badge = await badgeFrame(cart);
    const pick = badge.getByRole('button', { name: /Pick your cards to see your best card/ });
    await expect(pick).toBeVisible();
    await axeBadge(badge, 'no cards at a generic store');
    const pages = context.pages().length;
    await pick.click();
    await expect.poll(() => context.pages().length).toBe(pages + 1);
    expect(context.pages().at(-1)!.url()).toBe(`chrome-extension://${id}/src/onboarding/index.html`);
  } finally {
    await context.close();
  }
});
