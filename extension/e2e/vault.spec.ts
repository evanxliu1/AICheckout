import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { createVault, unlockVault, deleteVault } from './vault';
import { emptyState } from '../src/state/contracts';

test('protection setup, cross-window lock, wrong phrase, migration and reset use the packaged UI', async ({
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
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    async function capture(name: string) {
      await page.setViewportSize({ width: 360, height: 600 });
      await page.screenshot({ path: testInfo.outputPath(`${name}-360.png`) });
      for (const width of [360, 480]) {
        await page.setViewportSize({ width, height: 800 });
        await page.locator('main').evaluate((el) => {
          el.style.maxHeight = 'none';
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${name}-full-${width}.png`), fullPage: true });
      }
      await page.locator('main').evaluate((el) => {
        el.style.maxHeight = '';
        el.scrollTop = 0;
      });
      await page.setViewportSize({ width: 360, height: 600 });
    }
    await expect(page.getByLabel('New local passphrase', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    await capture('setup');
    await page.getByText('Data and protection details', { exact: true }).click();
    await expect(page.getByText(/After you choose a passphrase and accept setup/)).toBeVisible();
    await capture('setup-details');
    await page.getByText('Data and protection details', { exact: true }).click();
    await createVault(page);
    await page.getByRole('checkbox', { name: 'Capital One Quicksilver', exact: true }).check();
    await page.getByRole('button', { name: 'Save cards' }).click();
    await page.getByLabel('Purchase amount (USD)').fill('123.45');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByText('$1.85', { exact: true })).toBeVisible();
    const disk = await page.evaluate(() => chrome.storage.local.get(null));
    expect(Object.keys(disk)).toEqual(['checkoutStateV1']);
    expect(disk.checkoutStateV1).toMatchObject({
      kind: 'encrypted-vault',
      version: 1,
      cipher: 'AES-GCM-256',
      iterations: 600000,
    });
    expect(JSON.stringify(disk)).not.toMatch(/capital-one|12345|amountCents|wallet|purchase|test-only/);
    expect(Object.keys(await page.evaluate(() => chrome.storage.session.get(null)))).toEqual([
      'checkoutVaultSessionV1',
    ]);

    const other = await context.newPage();
    await other.goto(url);
    await expect(other.getByText('$1.85', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lock saved inputs' }).click();
    for (const view of [page, other]) {
      await expect(view.getByLabel('Local passphrase', { exact: true })).toBeVisible();
      await expect(view.getByText('$1.85', { exact: true })).toHaveCount(0);
      await expect(view.getByLabel('Purchase amount (USD)')).toHaveCount(0);
    }
    expect(await page.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual(disk);
    await capture('locked');
    await page.getByLabel('Local passphrase', { exact: true }).fill('wrong unrelated test phrase');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not unlock');
    await expect(page.getByLabel('Local passphrase', { exact: true })).toHaveValue('');
    expect(await page.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    await capture('wrong-phrase');
    await unlockVault(page);
    await expect(other.getByText('$1.85', { exact: true })).toBeVisible();
    await page.getByText('Data and protection details', { exact: true }).click();
    await expect(page.getByText(/Freshness limits stop stale comparisons/)).toBeVisible();
    await capture('unlocked-details');
    await page.getByText('Delete saved data', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete all local data' })).toBeDisabled();
    await capture('unlocked-delete');
    await page.getByText('Delete saved data', { exact: true }).click();
    await deleteVault(page);
    await expect(other.getByLabel('New local passphrase', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    expect(await page.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    await other.close();

    // A previous-version fixture is migrated by the real setup UI, without loading
    // its financial state into the comparison component first.
    const legacy = {
      ...emptyState(),
      wallet: {
        defaultCardId: 'capital-one-quicksilver',
        cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
      },
    };
    await page.evaluate((value) => chrome.storage.local.set({ checkoutStateV1: value }), legacy);
    await page.reload();
    await expect(page.getByText(/Your earlier inputs are not encrypted yet/)).toBeVisible();
    await capture('migration');
    await page.getByText('Data and protection details', { exact: true }).click();
    await expect(page.getByText(/Your earlier saved inputs are still unencrypted/)).toBeVisible();
    await capture('migration-details');
    await createVault(page);
    await expect(page.getByText('Quicksilver', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lock saved inputs' }).click();
    await page.getByText('Delete saved data', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete all local data' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I want to permanently delete/ }).check();
    await capture('reset');
    await page.getByRole('button', { name: 'Delete all local data' }).click();
    await expect(page.getByLabel('New local passphrase', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    expect(await page.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
