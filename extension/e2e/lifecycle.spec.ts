import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openNativePopup } from './native-popup';
import { createNativeVault, readVaultState } from './vault';
import { launchLifecycleBrowser } from './lifecycle-browser';

async function merchantFixture(context: BrowserContext) {
  const merchant = await context.newPage();
  await merchant.route('https://www.bestbuy.com/cart', route => route.fulfill({
    contentType: 'text/html', body: readFileSync('tests/fixtures/bestbuy-observed-summary.html', 'utf8'),
  }));
  await merchant.goto('https://www.bestbuy.com/cart');
  return merchant;
}
async function chooseCard(context: BrowserContext, merchant: Page, id: string) {
  const popup = await openNativePopup(context, merchant, id);
  await createNativeVault(popup);
  await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
  await popup.click('Save cards');
  await expect.poll(popup.text).toContain('Read cart amount');
  return popup;
}
async function compareCapture(popup: Awaited<ReturnType<typeof openNativePopup>>) {
  await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
  await popup.click('Compare my cards');
  await expect.poll(popup.text).toContain('Your card estimate');
  await expect.poll(popup.text).toContain('$0.40');
}

test('popup closure preserves an unconfirmed capture; navigation invalidates it and revokes temporary access', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-extension-debugging'],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host, merchant = await merchantFixture(context);
    let popup = await chooseCard(context, merchant, id);
    // Pause the actual packaged script at injection, proving the read is in flight
    // when the native popup is destroyed. No extension function is replaced.
    const pageCdp = await context.newCDPSession(merchant);
    await pageCdp.send('Debugger.enable');
    const { breakpointId } = await pageCdp.send('Debugger.setBreakpointByUrl', {
      url: `chrome-extension://${id}/src/checkout/content.js`, lineNumber: 0,
    });
    let paused = false;
    pageCdp.on('Debugger.paused', event => { if (event.hitBreakpoints?.includes(breakpointId)) paused = true; });
    await popup.click('Read cart amount');
    await expect.poll(() => paused).toBe(true);
    expect((await readVaultState(worker)).cart).toBeNull();
    await popup.close();
    await pageCdp.send('Debugger.removeBreakpoint', { breakpointId });
    await pageCdp.send('Debugger.resume');
    await pageCdp.send('Debugger.disable'); await pageCdp.detach();
    await expect.poll(async () => (await readVaultState(worker)).cart?.amountCents).toBe(2723);
    popup = await openNativePopup(context, merchant, id);
    await expect.poll(popup.text).toContain('Read $27.23 as the order total');
    expect(await popup.evaluate("document.getElementById('purchase-amount').value")).toBe('27.23');
    expect(await popup.evaluate("document.querySelector('input[type=checkbox]').checked")).toBe(false);
    expect(await popup.text()).not.toContain('Your card estimate');
    await compareCapture(popup); await popup.close();

    await merchant.reload();
    await expect.poll(async () => (await readVaultState(worker)).cart).toBeNull();
    popup = await openNativePopup(context, merchant, id);
    await expect.poll(popup.text).toContain('Read cart amount');
    expect(await popup.text()).not.toContain('Your card estimate');
    expect(await popup.text()).not.toContain('Read $27.23');
    expect(await popup.evaluate("document.querySelector('input[type=checkbox]').checked")).toBe(false);
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $27.23 as the order total');
    await compareCapture(popup); await popup.close();

    const cartTab = (await readVaultState(worker)).cart!.tabId;
    await merchant.route('https://other-merchant.example/', route => route.fulfill({ contentType: 'text/html', body: '<h1>Unrelated fixture site</h1>' }));
    await merchant.goto('https://other-merchant.example/');
    await expect.poll(async () => (await readVaultState(worker)).cart).toBeNull();
    const canRead = (tabId: number) => worker.evaluate(async target => {
      try { await chrome.scripting.executeScript({ target: { tabId: target }, func: () => document.title }); return true; }
      catch { return false; }
    }, tabId);
    expect(await canRead(cartTab)).toBe(false);
    await merchant.goto('https://www.bestbuy.com/cart');
    expect(await canRead(cartTab)).toBe(false); // Returning does not revive the old grant.
    popup = await openNativePopup(context, merchant, id);
    await expect.poll(popup.text).toContain('Read cart amount');
    expect(await popup.text()).not.toContain('Your card estimate');
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $27.23 as the order total');
    await compareCapture(popup); await popup.close();
  } finally { await context.close(); }
});

test('a real idle worker stop preserves saved comparison and revalidates the cart on wake', async ({ browserName }, testInfo) => {
  test.setTimeout(75_000);
  expect(browserName).toBe('chromium');
  const fixture = await launchLifecycleBrowser(testInfo.outputPath('profile'), resolve('dist'));
  let browser = await fixture.connect().catch(async error => { await fixture.close(); throw error; }), context = browser.contexts()[0];
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    let merchant = await merchantFixture(context);
    let popup = await chooseCard(context, merchant, id);
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $27.23 as the order total');
    await compareCapture(popup);
    const bootTime = await worker.evaluate(() => performance.timeOrigin);
    const observer = await fixture.observe(merchant.url(), id);
    await popup.close();
    await browser.close(); // CDP connection closes; the independently owned browser stays open.
    await expect.poll(async () => (await fixture.targets()).find(target => target.type === 'service_worker')?.attached ?? false).toBe(false);
    // Observe browser status only: polling extension APIs would reset its idle timer.
    // A timer elapsing alone is not proof that Chrome stopped the worker.
    await expect.poll(observer.status, { timeout: 50_000, intervals: [250, 500, 1000] }).toBe('stopped');
    const stoppedAt = Date.now();
    browser = await fixture.connect(); context = browser.contexts()[0];
    merchant = context.pages().find(page => page.url() === 'https://www.bestbuy.com/cart')!;
    expect(merchant).toBeDefined();
    popup = await openNativePopup(context, merchant, id);
    await expect.poll(popup.text).toContain('Your card estimate');
    await expect.poll(popup.text).toContain('$0.40');
    expect(await popup.evaluate("document.querySelector('input[type=checkbox]').checked")).toBe(false);
    const restarted = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const restartedAt = await restarted.evaluate(() => performance.timeOrigin);
    expect(restartedAt).toBeGreaterThan(bootTime);
    const evidencePath = testInfo.outputPath('worker-lifecycle.json');
    writeFileSync(evidencePath, JSON.stringify({ browser: browser.version(),
      bootTime, observedStoppedAt: stoppedAt, restartedAt, transitions: observer.transitions }, null, 2));
    await testInfo.attach('worker-lifecycle', { path: evidencePath, contentType: 'application/json' });
    // No navigation event: restored comparisons must independently re-read the DOM.
    await popup.close();
    await merchant.locator('table tr:last-child td').evaluate(el => { el.textContent = '$40.00'; });
    popup = await openNativePopup(context, merchant, id);
    await expect.poll(popup.text).toContain('saved cart changed or expired');
    expect(await popup.text()).not.toContain('Your card estimate');
    const permissions = await restarted.evaluate(() => chrome.permissions.getAll());
    expect(permissions.permissions?.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(permissions.origins ?? []).toEqual([]);
    await popup.close();
  } finally { try { await browser.close(); } finally { await fixture.close(); } }
});
