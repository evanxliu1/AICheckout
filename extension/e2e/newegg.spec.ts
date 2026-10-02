import { chromium, expect, test } from '@playwright/test';
import { closeOnboarding } from './onboarding';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openNativePopup } from './native-popup';
import { startNativePopup } from './vault';
import { BADGE_ORIGINS } from './hosts';

test('Newegg native capture distinguishes subtotal, follows quantity changes and clears switched-merchant inputs', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const extension = resolve('dist-e2e');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-unsafe-extension-debugging',
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await closeOnboarding(context);
    const id = new URL(worker.url()).host;
    const merchant = await context.newPage();
    await merchant.route('https://secure.newegg.com/shop/cart', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: readFileSync('tests/fixtures/newegg-observed-subtotal.html', 'utf8'),
      }),
    );
    await merchant.goto('https://secure.newegg.com/shop/cart');
    let popup = await openNativePopup(context, merchant, id);
    await startNativePopup(popup);
    await popup.evaluate(
      "document.querySelectorAll('fieldset input[type=checkbox]').forEach(box => box.click())",
    );
    await expect.poll(popup.text).toContain('online retail spend in');
    await popup.fill('spend-bce-online-retail', '0');
    await popup.click('Save cards');
    await expect.poll(popup.text).toContain('Read cart amount');
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $249.99 as a subtotal before tax and shipping');
    expect(await popup.evaluate("document.getElementById('purchase-merchant').value")).toBe('newegg-us');
    await popup.evaluate("document.getElementById('purchase-heading').scrollIntoView()");
    writeFileSync(testInfo.outputPath('newegg-subtotal-input.png'), await popup.screenshot());
    const eligible = async () => {
      await popup.evaluate(`{ const select = document.getElementById('online-eligibility');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'eligible');
        select.dispatchEvent(new Event('change', { bubbles: true })); }`);
      await popup.evaluate(
        "{ const box = document.querySelector('input[type=checkbox]'); if (!box.checked) box.click(); }",
      );
    };
    await eligible();
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('Saved estimate for a $249.99 Newegg US subtotal.');
    await expect.poll(popup.text).toContain('$7.49');
    await expect.poll(popup.text).toContain('$3.74');
    writeFileSync(testInfo.outputPath('newegg-subtotal-result.png'), await popup.screenshot());
    await popup.close();
    popup = await openNativePopup(context, merchant, id);
    await expect.poll(popup.text).toContain('Saved estimate for a $249.99 Newegg US subtotal.');
    expect(await popup.evaluate("document.querySelector('input[type=checkbox]').checked")).toBe(false);
    await merchant.locator('body').evaluate(
      (el, html) => {
        el.innerHTML = html;
      },
      readFileSync('tests/fixtures/newegg-observed-quantity.html', 'utf8'),
    );
    await eligible();
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('cart or page changed');
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $499.98 as a subtotal before tax and shipping');
    await eligible();
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('$14.99');
    await popup.evaluate(`{ const select = document.getElementById('purchase-merchant');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'best-buy-us');
      select.dispatchEvent(new Event('change', { bubbles: true })); }`);
    expect(await popup.evaluate("document.getElementById('purchase-amount').value")).toBe('');
    expect(await popup.evaluate("document.querySelector('input[type=checkbox]').checked")).toBe(false);
    expect(await popup.text()).not.toContain('Saved estimate for');
    await popup.fill('purchase-amount', '100');
    await eligible();
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('Saved estimate for a $100.00 Best Buy US purchase.');
    await popup.close();
    // Tab previews inspect the same fixed-width popup at two viewport sizes, with manual state.
    const preview = await context.newPage();
    await preview.goto(`chrome-extension://${id}/src/popup/index.html`);
    await expect(preview.getByText('Saved estimate for a $100.00 Best Buy US purchase.')).toBeVisible();
    for (const width of [360, 480]) {
      await preview.setViewportSize({ width, height: 800 });
      await preview.locator('main').evaluate((el) => {
        el.style.maxHeight = 'none';
      });
      expect(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await preview.screenshot({ path: testInfo.outputPath(`merchant-form-${width}.png`), fullPage: true });
    }
    expect((await worker.evaluate(() => chrome.permissions.getAll())).origins?.sort()).toEqual(BADGE_ORIGINS);
  } finally {
    await context.close();
  }
});
