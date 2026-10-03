import { chromium, expect, test } from '@playwright/test';
import { closeOnboarding } from './onboarding';
import { resolve } from 'node:path';
import {
  deleteVault,
  protectVault,
  readVaultState,
  startPopup,
  unlockVault,
  mutateVaultState,
} from './vault';
import { BADGE_ORIGINS } from './hosts';
import { addCard, cacheCatalogV3Fixture } from './wallet';

test('packaged wallet: offline comparison, browser restart, expiry, and deletion', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const extension = resolve('dist-e2e');
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
    await closeOnboarding(context);
    const id = new URL(worker.url()).host;
    const url = `chrome-extension://${id}/src/popup/index.html`;
    const popup = await context.newPage();
    const errors: string[] = [];
    popup.on('pageerror', (error) => errors.push(error.message));
    await popup.goto(url);
    await startPopup(popup);
    // This test covers the optional passphrase vault across a browser restart.
    await protectVault(popup);
    await addCard(popup, 'Capital One Quicksilver');
    await addCard(popup, 'American Express Blue Cash Everyday');
    await popup.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
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
    await startPopup(reopened);
    expect(await reopened.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    const permissions = await reopened.evaluate(() => chrome.permissions.getAll());
    expect(permissions.permissions?.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(permissions.origins?.sort()).toEqual(BADGE_ORIGINS);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a second popup invalidates a changed wallet and observes deletion', async ({
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
    const first = await context.newPage();
    await first.goto(url);
    await startPopup(first);
    await addCard(first, 'Capital One Quicksilver');
    await first.getByRole('button', { name: 'Save cards' }).click();
    await first.getByLabel('Purchase amount (USD)').fill('100');
    await first.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await first.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(first.getByText('$1.50', { exact: true })).toBeVisible();
    const second = await context.newPage();
    await second.goto(url);
    await expect(second.getByText('$1.50', { exact: true })).toBeVisible();
    await first.getByRole('button', { name: 'Edit cards' }).click();
    await addCard(first, 'American Express Blue Cash Everyday');
    await first.getByRole('button', { name: 'Save cards' }).click();
    await expect(second.getByText('$1.50', { exact: true })).toHaveCount(0);
    await expect(second.getByRole('status')).toContainText('Saved inputs changed');
    await deleteVault(first);
    await startPopup(second);
    await expect(second.getByText('No cards yet. Add each card you might pay with.')).toBeVisible();
    await expect(second.getByRole('button', { name: 'Remove Capital One Quicksilver' })).toHaveCount(0);
    expect(await second.evaluate(() => chrome.storage.session.get(null))).toEqual({});
  } finally {
    await context.close();
  }
});

test('catalog v3: the ranking follows chosen categories, point values and membership answers', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
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
    const popup = await context.newPage();
    const errors: string[] = [];
    popup.on('pageerror', (error) => errors.push(error.message));
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/index.html`);
    await startPopup(popup);
    await cacheCatalogV3Fixture(popup);
    await startPopup(popup);
    // Synthetic fixture cards: Points earns 3 points per $1 online at 1.2¢ (estimate); Cash Plus
    // earns 5% in two chosen categories (electronics at Best Buy); Prime Visa 5% at Amazon with
    // Prime, 3% without.
    await addCard(popup, 'Test Points Card');
    await addCard(popup, 'Test Cash Plus');
    await popup.getByRole('button', { name: 'Save cards' }).click();
    const first = () => popup.locator('.estimate-list h3').first();
    async function compare(merchant = 'best-buy-us') {
      await popup.getByLabel('Merchant').selectOption(merchant);
      await popup.getByLabel('Purchase amount (USD)').fill('100');
      await popup.getByLabel('Online retail bonus eligibility').selectOption('eligible');
      await popup.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
      await popup.getByRole('button', { name: 'Compare my cards' }).click();
      await expect(popup.locator('.estimate-list')).toBeVisible();
    }
    async function edit(change: () => Promise<void>) {
      await popup.getByRole('button', { name: 'Edit cards' }).click();
      await change();
      await popup.getByRole('button', { name: 'Save cards' }).click();
      await expect(popup.getByRole('button', { name: 'Edit cards' })).toBeVisible();
    }

    // 1. Cash Plus's categories unknown: Points ($3.60) is sure to earn more than Cash Plus ($1.00).
    await compare();
    await expect(popup.getByRole('heading', { name: 'Compare the conditions' })).toBeVisible();
    await expect(first()).toHaveText('Points');
    await expect(popup.getByText('$3.60', { exact: true })).toBeVisible();
    await expect(popup.getByText('$1.00–$5.00', { exact: true })).toBeVisible();

    // 2. Choose electronics for Cash Plus, with its limit and activation known: $5.00 beats $3.60.
    await edit(async () => {
      await popup.getByRole('checkbox', { name: 'Electronics stores' }).check();
      await popup.getByLabel(/Cash Plus electronics store bonus activation/).selectOption('active');
      await popup.getByLabel(/Cash Plus combined electronics store spend/).fill('0');
    });
    await compare();
    await expect(popup.getByRole('heading', { name: 'Use Cash Plus' })).toBeVisible();
    await expect(first()).toHaveText('Cash Plus');

    // 3. Value Test Membership Points at 2¢: 300 points are worth $6.00, above $5.00.
    await edit(async () => {
      await popup.getByLabel('Your value for Test Membership Points, in cents each').fill('2');
    });
    await compare();
    await expect(popup.getByRole('heading', { name: 'Use Points' })).toBeVisible();
    await expect(popup.getByText('$6.00', { exact: true })).toBeVisible();
    await expect(popup.getByText('Your value', { exact: true })).toBeVisible();

    // 4. At Amazon with Prime Visa and the Points value reset: Prime unknown keeps Points ($3.60)
    // ahead of Prime Visa's guaranteed 3%; answering "Prime member" makes Prime Visa first ($5.00).
    await edit(async () => {
      await addCard(popup, 'Test Prime Visa');
      await popup.getByRole('button', { name: 'Reset to default: Test Membership Points' }).click();
    });
    await compare('amazon-us');
    await expect(first()).toHaveText('Points');
    await expect(popup.getByText('$3.00–$5.00', { exact: true })).toBeVisible();
    await edit(async () => {
      await popup
        .getByRole('group', { name: 'Do you have an eligible Amazon Prime membership?' })
        .getByRole('radio', { name: 'Prime member', exact: true })
        .check();
    });
    await compare('amazon-us');
    await expect(popup.getByRole('heading', { name: 'Use Prime Visa' })).toBeVisible();
    await expect(first()).toHaveText('Prime Visa');
    const state = await readVaultState(popup);
    expect(state.wallet.gates).toEqual([{ gateId: 'amazon-prime', optionId: 'member' }]);
    expect(state.wallet.valueOverrides).toEqual([]);
    expect(state.wallet.cards.find((c) => c.cardId === 'test-cash-plus')?.choices).toEqual([
      { choiceId: 'five-percent', optionIds: ['electronics'] },
    ]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
