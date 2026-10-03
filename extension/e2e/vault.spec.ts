import { chromium, expect, test } from '@playwright/test';
import { closeOnboarding } from './onboarding';
import { resolve } from 'node:path';
import { deleteVault, protectVault, startPopup, unlockVault, TEST_PASSPHRASE } from './vault';
import { emptyState } from '../src/state/contracts';

test('optional protection: plain by default, protect, cross-window lock, wrong phrase, turn off and reset', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const extension = resolve('dist-e2e');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 360, height: 600 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await closeOnboarding(context);
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
    // Default: no passphrase; cards are saved in plain local storage (trusted contexts only).
    await startPopup(page);
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    await capture('setup');
    await page.getByRole('checkbox', { name: 'Capital One Quicksilver', exact: true }).check();
    await page.getByRole('button', { name: 'Save cards' }).click();
    await page.getByLabel('Purchase amount (USD)').fill('123.45');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByText('$1.85', { exact: true })).toBeVisible();
    const plain = await page.evaluate(() => chrome.storage.local.get(null));
    expect(plain.checkoutStateV1).toMatchObject({ schemaVersion: 3 });
    expect(JSON.stringify(plain)).toContain('capital-one-quicksilver');

    await protectVault(page);
    await expect(page.getByText('$1.85', { exact: true })).toBeVisible();
    const disk = await page.evaluate(() => chrome.storage.local.get(null));
    expect(disk.checkoutStateV1).toMatchObject({
      kind: 'encrypted-vault',
      version: 1,
      cipher: 'AES-GCM-256',
      iterations: 600000,
    });
    expect(JSON.stringify(disk)).not.toMatch(/capital-one|12345|amountCents|wallet|purchase|test-only/);
    expect(Object.keys(await page.evaluate(() => chrome.storage.session.get(null)))).toContain(
      'checkoutVaultSessionV1',
    );

    const other = await context.newPage();
    await other.goto(url);
    await expect(other.getByText('$1.85', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lock saved inputs' }).click();
    for (const view of [page, other]) {
      await expect(view.getByLabel('Local passphrase', { exact: true })).toBeVisible();
      await expect(view.getByText('$1.85', { exact: true })).toHaveCount(0);
      await expect(view.getByLabel('Purchase amount (USD)')).toHaveCount(0);
    }
    expect(await page.evaluate(() => chrome.storage.session.get(null))).not.toHaveProperty(
      'checkoutVaultSessionV1',
    );
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual(disk);
    await capture('locked');
    await page.getByLabel('Local passphrase', { exact: true }).fill('wrong unrelated test phrase');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not unlock');
    await expect(page.getByLabel('Local passphrase', { exact: true })).toHaveValue('');
    await capture('wrong-phrase');
    await unlockVault(page);
    await expect(other.getByText('$1.85', { exact: true })).toBeVisible();
    await page.getByText('Data and protection details', { exact: true }).click();
    await expect(page.getByText(/are encrypted with your passphrase in this Chrome profile/)).toBeVisible();
    await capture('unlocked-details');

    // Turning protection off keeps the data and stores it plainly again.
    await page.getByText('Settings', { exact: true }).click();
    await page.getByLabel('Current passphrase', { exact: true }).fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Turn off passphrase protection' }).click();
    await expect(page.getByRole('button', { name: 'Lock saved inputs' })).toHaveCount(0);
    await expect(page.getByText('Quicksilver', { exact: true }).first()).toBeVisible();
    expect((await page.evaluate(() => chrome.storage.local.get(null))).checkoutStateV1).toMatchObject({
      schemaVersion: 3,
    });
    expect(await page.evaluate(() => chrome.storage.session.get(null))).not.toHaveProperty(
      'checkoutVaultSessionV1',
    );

    await page.getByText('Delete saved data', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete all local data' })).toBeDisabled();
    await capture('unlocked-delete');
    await page.getByText('Delete saved data', { exact: true }).click();
    await deleteVault(page);
    await startPopup(other);
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    await other.close();

    // Earlier plain state opens directly (no migration step) and can be protected later.
    const legacy = {
      ...emptyState(),
      wallet: {
        defaultCardId: 'capital-one-quicksilver',
        cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
      },
    };
    await page.evaluate((value) => chrome.storage.local.set({ checkoutStateV1: value }), legacy);
    await page.reload();
    await expect(page.getByText('Quicksilver', { exact: true }).first()).toBeVisible();
    await protectVault(page);
    await page.getByRole('button', { name: 'Lock saved inputs' }).click();
    await page.getByText('Delete saved data', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete all local data' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I want to permanently delete/ }).check();
    await capture('reset');
    await page.getByRole('button', { name: 'Delete all local data' }).click();
    await startPopup(page);
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    expect(await page.evaluate(() => chrome.storage.session.get(null))).not.toHaveProperty(
      'checkoutVaultSessionV1',
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
