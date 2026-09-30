import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { deleteVault, createVault, unlockVault, mutateVaultState } from './vault';

test('packaged wallet: offline comparison, browser restart, expiry, and deletion', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const extension = resolve('dist');
  const launch = () =>
    chromium.launchPersistentContext(testInfo.outputPath('profile'), {
      channel: 'chromium',
      headless: true,
      viewport: { width: 360, height: 600 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
  let context = await launch();
  try {
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const url = `chrome-extension://${id}/src/popup/index.html`;
    const popup = await context.newPage();
    const errors: string[] = [];
    popup.on('pageerror', (error) => errors.push(error.message));
    await popup.goto(url);
    await createVault(popup);
    await popup.getByRole('checkbox', { name: 'Capital One Quicksilver', exact: true }).check();
    await popup.getByRole('checkbox', { name: 'American Express Blue Cash Everyday', exact: true }).check();
    await popup.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
    // The issuer terms don't state activation (catalog v2 `unstated`), so the shopper confirms it.
    await popup.getByLabel(/Blue Cash Everyday online retail bonus activation/).selectOption('active');
    await popup.screenshot({ path: testInfo.outputPath('wallet-360.png') });
    await popup.getByRole('button', { name: 'Save cards' }).click();
    await popup.getByLabel('Purchase amount (USD)').fill('100');
    await popup.getByLabel('Online retail bonus eligibility').selectOption('eligible');
    await popup.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await popup.getByRole('button', { name: 'Compare my cards' }).click();
    const heading = popup.getByRole('heading', { name: 'Use Blue Cash Everyday' });
    await expect(heading).toBeVisible();
    await expect(popup.getByText('$3.00', { exact: true })).toBeVisible();
    await expect(popup.getByText('$1.50', { exact: true })).toBeVisible();
    await expect(popup.getByText('$3.00', { exact: true })).toBeInViewport();
    await popup.screenshot({ path: testInfo.outputPath('comparison-360.png') });
    expect(await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Restart the entire browser with the same profile. This guarantees a new worker
    // instead of assuming that a DevTools stop command terminated a debugged worker.
    await context.close();
    context = await launch();
    await context.setOffline(true);
    const restartedWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    expect(restartedWorker).not.toBe(worker);
    expect(new URL(restartedWorker.url()).host).toBe(id);
    const reopened = await context.newPage();
    reopened.on('pageerror', (error) => errors.push(error.message));
    await reopened.goto(url);
    await expect(reopened.getByLabel('Purchase amount (USD)')).toHaveCount(0);
    expect(await reopened.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    await unlockVault(reopened);
    await expect(reopened.getByRole('heading', { name: 'Use Blue Cash Everyday' })).toBeVisible();
    await expect(reopened.getByRole('checkbox', { name: /I confirmed the amount/ })).not.toBeChecked();

    await reopened.getByRole('button', { name: 'Edit cards' }).click();
    await reopened.getByLabel(/Blue Cash Everyday online retail spend/).fill('');
    await reopened.getByRole('button', { name: 'Save cards' }).click();
    await expect(reopened.getByRole('heading', { name: 'Use Blue Cash Everyday' })).toHaveCount(0);
    await reopened.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await reopened.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(reopened.getByRole('heading', { name: 'Compare the conditions' })).toBeVisible();
    await expect(reopened.getByText('$1.00–$3.00', { exact: true })).toBeVisible();

    // Expire the stored estimate, then exercise packaged read/refresh behavior.
    await mutateVaultState(reopened, (state) => {
      state.comparison!.computedAt -= 16 * 60 * 1000;
    });
    await reopened.reload();
    await expect(reopened.getByRole('status')).toContainText('needs a refresh');
    await expect(reopened.getByText('$1.00–$3.00', { exact: true })).toHaveCount(0);

    await deleteVault(reopened);
    await expect(reopened.getByLabel('New local passphrase', { exact: true })).toBeVisible();
    expect(await reopened.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    const permissions = await reopened.evaluate(() => chrome.permissions.getAll());
    expect(permissions.permissions?.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(permissions.origins ?? []).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a second popup invalidates a changed wallet and observes deletion', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 360, height: 600 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const url = `chrome-extension://${new URL(worker.url()).host}/src/popup/index.html`;
    const first = await context.newPage();
    await first.goto(url);
    await createVault(first);
    await first.getByRole('checkbox', { name: 'Capital One Quicksilver', exact: true }).check();
    await first.getByRole('button', { name: 'Save cards' }).click();
    await first.getByLabel('Purchase amount (USD)').fill('100');
    await first.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await first.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(first.getByText('$1.50', { exact: true })).toBeVisible();
    const second = await context.newPage();
    await second.goto(url);
    await expect(second.getByText('$1.50', { exact: true })).toBeVisible();
    await first.getByRole('button', { name: 'Edit cards' }).click();
    await first.getByRole('checkbox', { name: 'American Express Blue Cash Everyday', exact: true }).check();
    await first.getByRole('button', { name: 'Save cards' }).click();
    await expect(second.getByText('$1.50', { exact: true })).toHaveCount(0);
    await expect(second.getByRole('status')).toContainText('Saved inputs changed');
    await deleteVault(first);
    await expect(second.getByLabel('New local passphrase', { exact: true })).toBeVisible();
    await expect(second.getByRole('checkbox', { name: 'Capital One Quicksilver', exact: true })).toHaveCount(
      0,
    );
    expect(await second.evaluate(() => chrome.storage.session.get(null))).toEqual({});
  } finally {
    await context.close();
  }
});
