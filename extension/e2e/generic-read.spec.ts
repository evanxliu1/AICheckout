import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';
import { closeOnboarding } from './onboarding';
import { openNativePopup } from './native-popup';
import { startNativePopup } from './vault';
import { BADGE_ORIGINS } from './hosts';

// Phase 13b: "Read cart amount" at a store with no adapter runs the generic reader (readCart) in
// the injected manual reader. Shown USD fills the amount; another currency and a withheld read
// leave it to the shopper; a legacy cart page is still the adapter's.
const row = (label: string, amount: string) => `<div><span>${label}</span><span>${amount}</span></div>`;
const summary = (inner: string) =>
  `<!doctype html><meta charset="utf-8"><title>Checkout</title><h1>Checkout</h1><section>${inner}<button>Checkout</button></section>`;

async function withStore(
  testInfo: { outputPath: (name: string) => string },
  url: string,
  body: string,
  run: (popup: Awaited<ReturnType<typeof openNativePopup>>, context: BrowserContext) => Promise<void>,
) {
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
    const store = await context.newPage();
    await store.route(url, (route) => route.fulfill({ contentType: 'text/html', body }));
    await store.goto(url);
    const popup = await openNativePopup(context, store, new URL(worker.url()).host);
    await startNativePopup(popup);
    await popup.checkCards(['Citi Double Cash']);
    await popup.click('Save cards');
    await expect.poll(popup.text).toContain('Read cart amount');
    await run(popup, context);
    // The reader ran through activeTab: no new host access.
    expect((await worker.evaluate(() => chrome.permissions.getAll())).origins?.sort()).toEqual(BADGE_ORIGINS);
    await popup.close();
  } finally {
    await context.close();
  }
}

test('reads a generic store’s cart total and compares it', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  await withStore(
    testInfo,
    'https://shop.example.com/checkout',
    summary(row('Subtotal', '$90.00') + row('Shipping', '$10.00') + row('Order total', '$100.00')),
    async (popup) => {
      expect(await popup.evaluate("document.getElementById('purchase-merchant').value")).toBe(
        'generic-us-online',
      );
      await popup.click('Read cart amount');
      await expect.poll(popup.text).toContain('Read $100.00 as an estimated total');
      expect(await popup.evaluate("document.getElementById('purchase-amount').value")).toBe('100.00');
      expect(await popup.evaluate("document.getElementById('online-eligibility').value")).toBe('eligible');
      await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
      await popup.click('Compare my cards');
      await expect.poll(popup.text).toContain('$100.00 Another U.S. online store purchase');
      expect(await popup.text()).toContain('$2.00');
    },
  );
});

test('asks for a typed amount when the reader withholds', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  // Two different totals in the summary: the reader is not certain and withholds.
  await withStore(
    testInfo,
    'https://shop.example.com/cart',
    summary(row('Total', '$100.00') + row('Total', '$120.00')),
    async (popup) => {
      await popup.click('Read cart amount');
      await expect.poll(popup.text).toContain('Enter the amount you will pay');
      expect(await popup.evaluate("document.getElementById('purchase-amount').value")).toBe('');
      await popup.fill('purchase-amount', '120');
      await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
      await popup.click('Compare my cards');
      await expect.poll(popup.text).toContain('$120.00 Another U.S. online store purchase');
    },
  );
});

test('fills nothing from a cart shown in another currency', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  await withStore(
    testInfo,
    'https://shop.example.com/checkout',
    summary(row('Subtotal', '€90.00') + row('Total', '€100.00')),
    async (popup) => {
      await popup.click('Read cart amount');
      await expect.poll(popup.text).toContain('This comparison supports USD only');
      expect(await popup.evaluate("document.getElementById('purchase-amount').value")).toBe('');
    },
  );
});

test('a legacy cart page is still read by its adapter, not the generic reader', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  // A summary the generic reader would show, on Best Buy's cart URL: the adapter runs first and
  // finds no Best Buy order summary. (checkout.spec.ts reads the real fixture through the adapter.)
  await withStore(
    testInfo,
    'https://www.bestbuy.com/cart',
    summary(row('Subtotal', '$90.00') + row('Order total', '$100.00')),
    async (popup) => {
      expect(await popup.evaluate("document.getElementById('purchase-merchant').value")).toBe('best-buy-us');
      await popup.click('Read cart amount');
      await expect.poll(popup.text).toContain('No readable order summary was found');
      expect(await popup.evaluate("document.getElementById('purchase-amount').value")).toBe('');
    },
  );
});
