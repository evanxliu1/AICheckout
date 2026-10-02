import { chromium, expect, test } from '@playwright/test';
import { closeOnboarding } from './onboarding';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openNativePopup } from './native-popup';
import { startNativePopup } from './vault';
import { BADGE_ORIGINS } from './hosts';

test('native action grants temporary access, reads a cart and rejects changed totals', async ({
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
    await merchant.route('https://www.bestbuy.com/cart', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: readFileSync('tests/fixtures/bestbuy-observed-summary.html', 'utf8'),
      }),
    );
    await merchant.goto('https://www.bestbuy.com/cart');
    // Host permissions cover only the supported carts (for the automatic badge).
    expect((await worker.evaluate(() => chrome.permissions.getAll())).origins?.sort()).toEqual(BADGE_ORIGINS);

    const popup = await openNativePopup(context, merchant, id);
    await startNativePopup(popup);
    // Actual isolated page scripts cannot retrieve either disk state or the
    // in-memory unlock key, even with activeTab access to read this merchant.
    const storageAccess = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: async () => {
          const denied: boolean[] = [];
          for (const area of ['local', 'session'] as const) {
            try {
              await chrome.storage[area].get(null);
              denied.push(false);
            } catch {
              denied.push(true);
            }
          }
          return denied;
        },
      });
      return result.result;
    });
    expect(storageAccess).toEqual([true, true]);
    // The first card in catalog v2 is Citi Double Cash (2%).
    await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
    await popup.click('Save cards');
    await expect.poll(popup.text).toContain('Read cart amount');
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $27.23 as the order total');
    expect(await popup.evaluate("document.getElementById('purchase-amount').value")).toBe('27.23');
    await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('Your card estimate');
    await expect.poll(popup.text).toContain('$0.54');
    writeFileSync(testInfo.outputPath('native-cart-result.png'), await popup.screenshot());

    // A script updates the summary without navigating; the next comparison must reject it.
    await merchant.locator('table tr:last-child td').evaluate((el) => {
      el.textContent = '$40.00';
    });
    await popup.evaluate(
      "const box = document.querySelector('input[type=checkbox]'); if (!box.checked) box.click()",
    );
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('cart or page changed');
    await popup.click('Use manual entry instead');
    await popup.fill('purchase-amount', '40.00');
    await popup.evaluate(
      "const box2 = document.querySelector('input[type=checkbox]'); if (!box2.checked) box2.click()",
    );
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('$0.80');
    const permissions = await worker.evaluate(() => chrome.permissions.getAll());
    expect(permissions.origins?.sort()).toEqual(BADGE_ORIGINS);
    await popup.close();
  } finally {
    await context.close();
  }
});
