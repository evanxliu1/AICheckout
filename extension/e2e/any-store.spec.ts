import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeOnboarding } from './onboarding';
import { openNativePopup } from './native-popup';
import { startNativePopup } from './vault';
import { BADGE_ORIGINS } from './hosts';

// Phase 11: opened on a store with no adapter, the popup picks "Another U.S. online store" from the
// tab (activeTab) and recommends a card from a typed amount, with no new host permissions.
test('popup on an unsupported store recommends a card from a typed amount', async ({
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
    const store = await context.newPage();
    await store.route('https://shop.example.com/checkout', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Checkout</title><h1>Checkout</h1><p>Order total $100.00</p>',
      }),
    );
    await store.goto('https://shop.example.com/checkout');

    const popup = await openNativePopup(context, store, id);
    await startNativePopup(popup);
    await popup.checkCards(['Citi Double Cash', 'Capital One Quicksilver']);
    await popup.click('Save cards');
    await expect.poll(popup.text).toContain('Purchase amount (USD)');
    expect(await popup.evaluate("document.getElementById('purchase-merchant').value")).toBe(
      'generic-us-online',
    );
    expect(await popup.evaluate("document.getElementById('online-eligibility').value")).toBe('eligible');
    expect(await popup.text()).not.toContain('Read cart amount');
    await popup.fill('purchase-amount', '100');
    await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
    await popup.click('Compare my cards');
    await expect.poll(popup.text).toContain('Use Double Cash');
    await expect.poll(popup.text).toContain('$100.00 Another U.S. online store purchase');
    expect(await popup.text()).toContain('$2.00');

    // No new host access: the popup learned the store's URL through activeTab only.
    expect((await worker.evaluate(() => chrome.permissions.getAll())).origins?.sort()).toEqual(BADGE_ORIGINS);
    await popup.close();
  } finally {
    await context.close();
  }
});
