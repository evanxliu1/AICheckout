// The automatic cart badge in the packaged extension: onboarding on install, the badge on each
// supported cart (fixtures served at the real hosts), live updates, isolation from page scripts,
// dismiss, per-site off, the URL-only order question and savings, the no-cards and locked prompts,
// and axe on the badge and panel. Screenshots of each state are saved for review.
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { protectVault, startPopup } from './vault';
import { addCard, cacheCatalogV3Fixture } from './wallet';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const extension = resolve('dist-e2e');
const fixtures = {
  'https://www.bestbuy.com/cart': 'tests/fixtures/bestbuy-observed-summary.html',
  'https://secure.newegg.com/shop/cart': 'tests/fixtures/newegg-observed-subtotal.html',
  'https://www.amazon.com/gp/cart/view.html': 'tests/fixtures/amazon-observed-subtotal.html',
};
/** A neutral stand-in: only the URL matters, the order page is never read. */
const ORDER_PAGE = 'https://www.bestbuy.com/checkout/r/thank-you';

async function launch(testInfo: { outputPath: (name: string) => string }) {
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https:\/\/(www\.bestbuy\.com|secure\.newegg\.com|www\.amazon\.com)\//, (route) => {
    const url = route.request().url().split('?')[0] as keyof typeof fixtures;
    if (fixtures[url])
      return route.fulfill({ contentType: 'text/html', body: readFileSync(fixtures[url], 'utf8') });
    if ((url as string) === ORDER_PAGE)
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><title>Order placed</title><main><h1>Thank you</h1></main></html>',
      });
    return route.fulfill({ status: 404, body: 'not found' });
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  return { context, worker, id, popupUrl: `chrome-extension://${id}/src/popup/index.html` };
}
async function badgeFrame(page: Page): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(
      () => (frame = page.frames().find((f) => f.url().includes('/src/badge/index.html'))) !== undefined,
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  return frame!;
}
const hasBadge = (page: Page) => page.frames().some((f) => f.url().includes('/src/badge/index.html'));
async function onboard(context: BrowserContext, id: string) {
  // The install opened onboarding in a tab.
  await expect
    .poll(() => context.pages().some((p) => p.url() === `chrome-extension://${id}/src/onboarding/index.html`))
    .toBe(true);
  const page = context.pages().find((p) => p.url().endsWith('/src/onboarding/index.html'))!;
  await expect(page.getByRole('heading', { name: 'Welcome to AI Checkout' })).toBeVisible();
  await addCard(page, 'Citi Double Cash');
  await addCard(page, 'American Express Blue Cash Everyday');
  await page.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
  return page;
}
async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
/** Axe inside the badge's own frame (the merchant fixtures are not ours to audit). */
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

test('badge: onboarding, every supported cart, live updates, isolation, dismiss, per-site off, order savings', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  expect(browserName).toBe('chromium');
  const { context, popupUrl, id } = await launch(testInfo);
  try {
    const onboarding = await onboard(context, id);
    await onboarding.screenshot({ path: testInfo.outputPath('onboarding.png'), fullPage: true });
    await axe(onboarding, 'onboarding');
    await onboarding.getByRole('button', { name: 'Save cards' }).click();
    await expect(onboarding.getByRole('heading', { name: 'You’re set' })).toBeVisible();
    expect(await onboarding.evaluate(() => document.activeElement?.id)).toBe('onboarding-done');
    await onboarding.screenshot({ path: testInfo.outputPath('onboarding-done.png'), fullPage: true });

    // Best Buy: $27.23 total; Blue Cash Everyday's 3% online retail beats Double Cash's 2%.
    const cart = await context.newPage();
    await cart.goto('https://www.bestbuy.com/cart');
    let badge = await badgeFrame(cart);
    let pill = badge.getByRole('button', { name: /Use Blue Cash Everyday · \$0\.81 back on this cart/ });
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Use Blue Cash Everyday · $0.81 back');
    await cart.screenshot({ path: testInfo.outputPath('bestbuy-collapsed.png') });
    await axeBadge(badge, 'collapsed badge');

    // Page scripts cannot reach the badge: a closed shadow root around a cross-origin frame.
    const exposure = await cart.evaluate(() => {
      const host = document.querySelector('ai-checkout-badge');
      let frameReadable = false;
      try {
        frameReadable = !!window.frames[0]?.document;
      } catch {
        frameReadable = false;
      }
      return {
        host: !!host,
        shadowRoot: host ? (host as HTMLElement).shadowRoot !== null : true,
        iframeInDom: document.querySelectorAll('iframe').length,
        frameReadable,
        text: document.documentElement.innerText,
      };
    });
    expect(exposure).toMatchObject({ host: true, shadowRoot: false, iframeInDom: 0, frameReadable: false });
    expect(exposure.text).not.toMatch(/Blue Cash|Double Cash/);
    // A page-made copy of the badge page (it is web-accessible on these hosts) gets nothing:
    // it lacks the nonce the content script gave its own frame.
    await cart.evaluate((src) => {
      for (const hash of ['', '#' + 'a'.repeat(32)]) {
        const copy = document.createElement('iframe');
        copy.src = src + hash;
        copy.className = 'page-copy';
        document.body.append(copy);
      }
    }, `chrome-extension://${id}/src/badge/index.html`);
    await expect
      .poll(() => cart.frames().filter((f) => f.url().includes('/src/badge/index.html')).length)
      .toBe(3);
    await cart.waitForTimeout(1000);
    for (const copy of cart
      .frames()
      .filter((f) => f.url().includes('/src/badge/index.html') && f !== badge)) {
      expect(await copy.evaluate(() => document.body.innerText.trim())).toBe('');
      expect(await copy.getByRole('button').count()).toBe(0);
    }
    await cart.evaluate(() => document.querySelectorAll('iframe.page-copy').forEach((f) => f.remove()));
    // A page that removes the badge host gets a new badge promptly (no body change needed).
    await cart.evaluate(() => document.querySelector('ai-checkout-badge')?.remove());
    await expect.poll(() => hasBadge(cart)).toBe(false);
    badge = await badgeFrame(cart);
    pill = badge.getByRole('button', { name: /Use Blue Cash Everyday · \$0\.81 back on this cart/ });
    await expect(pill).toBeVisible({ timeout: 3000 });
    // Clickjacking guard: while the page makes the badge (nearly) invisible, pointer clicks on it are
    // ignored (IntersectionObserver v2); once it is fully visible again they work.
    await cart.evaluate(() => document.documentElement.style.setProperty('opacity', '0.05'));
    await cart.waitForTimeout(400);
    await pill.click({ force: true });
    await cart.waitForTimeout(300);
    await expect(badge.getByRole('heading', { name: 'Best card for this cart' })).toHaveCount(0);
    await expect(badge.getByRole('status').filter({ hasText: 'Click ignored' })).toBeAttached();
    // The status region stays in place; only its text appears and clears (after about 4 s).
    await expect(badge.getByRole('status').filter({ hasText: 'Click ignored' })).toHaveCount(0, {
      timeout: 6000,
    });
    await expect(badge.locator('p[role="status"]').first()).toBeAttached();
    await cart.evaluate(() => document.documentElement.style.removeProperty('opacity'));
    await cart.waitForTimeout(400);

    await pill.click();
    await expect(badge.getByRole('heading', { name: 'Best card for this cart' })).toBeFocused();
    await expect(badge.getByText('Based on $27.23 cart order total at Best Buy US.')).toBeVisible();
    await expect(badge.getByText('2% if the balance is paid (1% at purchase).')).toBeVisible();
    await expect(
      badge.getByRole('list', { name: 'Your cards, best first' }).getByRole('listitem'),
    ).toHaveCount(2);
    await cart.screenshot({ path: testInfo.outputPath('bestbuy-expanded.png') });
    await axeBadge(badge, 'expanded panel');
    await cart.keyboard.press('Escape');
    await expect(pill).toBeFocused();
    // A covered panel (e.g. a site's floating chat button over it) still collapses from its close button.
    await pill.click();
    await cart.evaluate(() => document.documentElement.style.setProperty('opacity', '0.05'));
    await cart.waitForTimeout(400);
    await badge.getByRole('button', { name: 'Collapse' }).click({ force: true });
    await expect(badge.getByRole('heading', { name: 'Best card for this cart' })).toHaveCount(0);
    await expect(pill).toBeVisible();
    await cart.evaluate(() => document.documentElement.style.removeProperty('opacity'));
    await cart.waitForTimeout(400);

    // The cart changes without navigation (quantity 2): the badge follows the summary.
    await cart.locator('table tr:last-child td').evaluate((el) => {
      el.textContent = '$54.46';
    });
    await expect(badge.getByRole('button', { name: /\$1\.63 back on this cart/ })).toBeVisible();

    // Payment path and typed amount from the panel.
    await badge.getByRole('button', { name: /Show details/ }).click();
    await badge.getByLabel('Payment method').selectOption('bnpl');
    await expect(badge.getByRole('heading', { name: 'Best card for this cart' })).toBeVisible();
    await badge.getByRole('button', { name: 'Collapse' }).click();
    // Buy now, pay later excludes Amex online retail, so Double Cash leads.
    await expect(badge.getByRole('button', { name: /Use Double Cash · \$1\.08 back/ })).toBeVisible();
    await badge.getByRole('button', { name: /Show details/ }).click();
    await badge.getByLabel('Payment method').selectOption('card');
    await badge.getByLabel('Amount (USD)').fill('100');
    await badge.getByRole('button', { name: 'Update' }).click();
    await expect(badge.getByText('Based on $100.00 you entered, at Best Buy US.')).toBeVisible();
    await badge.getByRole('button', { name: 'Use cart amount' }).click();
    await expect(badge.getByText('Based on $54.46 cart order total at Best Buy US.')).toBeVisible();
    await badge.getByRole('button', { name: 'Collapse' }).click();

    // Newegg (subtotal) and Amazon (subtotal).
    for (const [url, name, amount] of [
      ['https://secure.newegg.com/shop/cart', 'newegg', '$7.49'],
      ['https://www.amazon.com/gp/cart/view.html', 'amazon', '$0.20'],
    ]) {
      const page = await context.newPage();
      await page.goto(url);
      const frame = await badgeFrame(page);
      const button = frame.getByRole('button', { name: new RegExp(`${amount.replace('$', '\\$')} back`) });
      await expect(button).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${name}-collapsed.png`) });
      await button.click();
      await expect(frame.getByText(/cart subtotal at/)).toBeVisible();
      await expect(frame.getByText('Tax and shipping are not included.', { exact: false })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${name}-expanded.png`) });
      await axeBadge(frame, `${name} panel`);
      await page.close();
    }

    // Dismiss lasts for this tab, even after a reload; other tabs still show the badge.
    const dismissed = await context.newPage();
    await dismissed.goto('https://www.bestbuy.com/cart');
    const dismissFrame = await badgeFrame(dismissed);
    await dismissFrame.getByRole('button', { name: /Show details/ }).click();
    await dismissFrame.getByRole('button', { name: 'Dismiss for this tab' }).click();
    await expect.poll(() => hasBadge(dismissed)).toBe(false);
    await dismissed.reload();
    await dismissed.waitForTimeout(1500);
    expect(hasBadge(dismissed)).toBe(false);

    // The order page (URL only) in the tab where the badge recommended a card: one question.
    await cart.goto(ORDER_PAGE);
    badge = await badgeFrame(cart);
    await expect(badge.getByRole('heading', { name: 'Did you pay with Blue Cash Everyday?' })).toBeVisible();
    await cart.screenshot({ path: testInfo.outputPath('order-prompt.png') });
    await axeBadge(badge, 'order prompt');
    await badge.getByRole('button', { name: 'Yes', exact: true }).click();
    // $54.46: Blue Cash Everyday $1.63 vs default Double Cash $1.08 → $0.55 more.
    await expect(badge.getByText(/About \$0\.55 more cash back than Double Cash/)).toBeVisible();
    await cart.screenshot({ path: testInfo.outputPath('order-recorded.png') });
    await badge.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => hasBadge(cart)).toBe(false);
    await cart.reload();
    await cart.waitForTimeout(1500);
    expect(hasBadge(cart)).toBe(false);

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 900 });
    await popup.goto(popupUrl);
    await expect(popup.getByRole('heading', { name: 'All-time: $0.55 extra in rewards' })).toBeVisible();
    await popup.getByText('Order history (1)').click();
    await expect(popup.getByText(/Best Buy US · \$54\.46 cart/)).toBeVisible();
    await popup.screenshot({ path: testInfo.outputPath('savings.png'), fullPage: true });

    // Per-site off from the panel, visible in Settings, and back on from Settings.
    const off = await context.newPage();
    await off.goto('https://www.bestbuy.com/cart');
    const offFrame = await badgeFrame(off);
    await offFrame.getByRole('button', { name: /Show details/ }).click();
    await offFrame.getByRole('button', { name: 'Not on this site' }).click();
    await expect.poll(() => hasBadge(off)).toBe(false);
    const another = await context.newPage();
    await another.goto('https://www.bestbuy.com/cart');
    await another.waitForTimeout(1500);
    expect(hasBadge(another)).toBe(false);
    await popup.reload();
    await popup.getByText('Settings', { exact: true }).click();
    const toggle = popup.getByRole('switch', { name: 'Best Buy US' });
    await expect(toggle).not.toBeChecked();
    // The switch saves first, then reflects the saved setting.
    await toggle.click();
    await expect(toggle).toBeChecked();
    await another.reload();
    await badgeFrame(another);
  } finally {
    await context.close();
  }
});

test('badge prompts: no cards opens onboarding; a locked vault asks to unlock', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const { context, popupUrl } = await launch(testInfo);
  try {
    const cart = await context.newPage();
    await cart.goto('https://www.bestbuy.com/cart');
    let badge = await badgeFrame(cart);
    const pick = badge.getByRole('button', { name: /Pick your cards to see your best card/ });
    await expect(pick).toBeVisible();
    await cart.screenshot({ path: testInfo.outputPath('no-cards.png') });
    await axeBadge(badge, 'no cards');
    const pages = context.pages().length;
    await pick.click();
    await expect.poll(() => context.pages().length).toBe(pages + 1);

    const popup = await context.newPage();
    await popup.goto(popupUrl);
    await startPopup(popup);
    await addCard(popup, 'Capital One Quicksilver');
    await popup.getByRole('button', { name: 'Save cards' }).click();
    await protectVault(popup);
    await popup.getByRole('button', { name: 'Lock saved inputs' }).click();
    await cart.reload();
    badge = await badgeFrame(cart);
    await expect(badge.getByRole('button', { name: /Unlock to see your best card/ })).toBeVisible();
    await cart.screenshot({ path: testInfo.outputPath('locked.png') });
    expect(await cart.evaluate(() => document.documentElement.innerText)).not.toMatch(/Quicksilver/);
  } finally {
    await context.close();
  }
});

test('badge on catalog v3: points with their value basis, a store card not accepted, Venmo, axe', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  expect(browserName).toBe('chromium');
  const { context, popupUrl } = await launch(testInfo);
  try {
    const popup = await context.newPage();
    await popup.goto(popupUrl);
    await startPopup(popup);
    await cacheCatalogV3Fixture(popup);
    await startPopup(popup);
    // Synthetic fixture cards. At Best Buy ($27.23): Points earns 3 points per $1 online (81 points
    // at the 1.2¢ estimate, $0.98); Auto Top's miles have no value; the Amazon Store Card works only
    // at Amazon.
    for (const name of ['Test Points Card', 'Test Automatic Top Category', 'Test Amazon Store Card'])
      await addCard(popup, name);
    await popup.getByRole('button', { name: 'Save cards' }).click();
    await expect(popup.getByRole('button', { name: 'Edit cards' })).toBeVisible();

    const cart = await context.newPage();
    await cart.goto('https://www.bestbuy.com/cart');
    const badge = await badgeFrame(cart);
    const pill = badge.getByRole('button', {
      name: 'Use Points · estimated $0.98 in points on this cart (AI Checkout). Show details',
    });
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Use Points · est. $0.98 in points');
    await axeBadge(badge, 'v3 collapsed badge');
    await cart.screenshot({ path: testInfo.outputPath('v3-collapsed.png') });
    await pill.click();
    await expect(badge.getByRole('heading', { name: 'Best card for this cart' })).toBeFocused();
    const ranking = badge.getByRole('list', { name: 'Your cards, best first' });
    await expect(ranking.getByRole('listitem')).toHaveCount(2);
    await expect(ranking.getByRole('listitem').first()).toContainText('81 points at 1.2¢ each.');
    await expect(ranking.getByRole('listitem').first()).toContainText('Estimate');
    await expect(ranking.getByRole('listitem').nth(1)).toContainText(
      'Test Airline Miles has no published value',
    );
    await expect(
      badge.getByText('Amazon Store works only at Amazon, so it is not compared here.'),
    ).toBeVisible();
    await expect(badge.getByText(/Cards whose points have no value are listed last/)).toBeVisible();
    await axeBadge(badge, 'v3 panel');
    // CSP `style-src 'self'`: the badge page uses no inline styles.
    expect(
      await badge.evaluate(() => document.querySelectorAll('[style]:not([style=""]), style').length),
    ).toBe(0);
    await cart.screenshot({ path: testInfo.outputPath('v3-expanded.png') });

    // Venmo is offered with catalog v3 terms; the fixture's online bonus excludes it.
    await badge.getByLabel('Payment method').selectOption('venmo');
    await expect(badge.getByLabel('Payment method')).toHaveValue('venmo');
    await expect(ranking.getByRole('listitem').first()).toContainText('27 points at 1.2¢ each.');
    await axeBadge(badge, 'v3 panel with Venmo');
    // The widest amounts (largest purchase, a range in units) stay inside the 360 px panel.
    await badge.getByLabel('Amount (USD)').fill('99999.99');
    await badge.getByRole('button', { name: 'Update' }).click();
    await expect(ranking.getByRole('listitem').nth(1)).toContainText(/\d{2},\d{3}.* miles/);
    expect(
      await badge.evaluate(() => {
        const body = document.querySelector('.badge-panel__body')!;
        return body.scrollWidth <= body.clientWidth;
      }),
    ).toBe(true);
    await cart.screenshot({ path: testInfo.outputPath('v3-expanded-max.png') });
    await badge.getByLabel('Amount (USD)').fill('27.23');
    await badge.getByRole('button', { name: 'Update' }).click();
    await expect(ranking.getByRole('listitem').first()).toContainText('27 points at 1.2¢ each.');
    await badge.getByRole('button', { name: 'Collapse' }).click();
    await expect(
      badge.getByRole('button', { name: /Use Points · estimated \$0\.32 in points/ }),
    ).toBeVisible();

    // The order line names points as rewards with the value they were counted at, not cash back.
    await cart.goto(ORDER_PAGE);
    const order = await badgeFrame(cart);
    await expect(order.getByText(/all-time rewards total/)).toBeVisible();
    await order.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(
      order.getByText(
        /^About \$0\.00 more in rewards than Points, your default card \(estimated\)\. Counts .+ at 1\.2¢ each \(estimate\)\./,
      ),
    ).toBeVisible();
    await axeBadge(order, 'v3 order recorded');
  } finally {
    await context.close();
  }
});
