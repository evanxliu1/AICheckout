// Accessibility gate for the popup: axe (WCAG 2.0/2.1 A and AA) on every main state at the
import { closeOnboarding } from './onboarding';
// popup's 360 px default width and at 480 px, plus a screenshot of each state for review.
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test, type Page, type TestInfo } from '@playwright/test';
import { resolve } from 'node:path';
import { mutateVaultState, protectVault, startPopup, writeCatalogCache } from './vault';
import { PILOT_CATALOG } from '../../packages/rewards-core/src/catalog';
import { redateCatalog } from '../../packages/rewards-core/src/catalog-helpers';
import { addCard, cacheCatalogV3Fixture } from './wallet';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Axe at the popup's default and widest widths, no horizontal scroll, and a screenshot. */
async function axeCheck(target: Page, state: string, testInfo: TestInfo) {
  for (const width of [360, 480]) {
    await target.setViewportSize({ width, height: 900 });
    const { violations } = await new AxeBuilder({ page: target }).withTags(TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      `${state} at ${width}px`,
    ).toEqual([]);
    expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await target.screenshot({ path: testInfo.outputPath(`${state}-${width}.png`), fullPage: true });
  }
}

test('every main popup state is axe-clean at 360 and 480 px', async ({ browserName }, testInfo) => {
  test.setTimeout(120_000);
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
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const check = (state: string, target: Page = page) => axeCheck(target, state, testInfo);

    await page.goto(url);
    await startPopup(page);
    await check('wallet-setup');

    for (const name of ['Citi Double Cash', 'Capital One Quicksilver', 'American Express Blue Cash Everyday'])
      await addCard(page, name);
    await page.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
    await check('wallet-limits');
    await page.getByRole('button', { name: 'Save cards' }).click();
    await expect(page.getByLabel('Purchase amount (USD)')).toBeVisible();
    await check('purchase-form');

    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByLabel('Online retail bonus eligibility').selectOption('eligible');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByRole('heading', { name: 'Use Blue Cash Everyday' })).toBeVisible();
    await expect(page.getByText('2% if the balance is paid (1% at purchase).')).toBeVisible();
    await check('comparison');
    for (const summary of await page.locator('summary').all()) await summary.click();
    await expect(page.getByText(/Not at this merchant/).first()).toBeVisible();
    await check('comparison-details');

    // Payment path: buy now, pay later excludes BCE's online retail bonus (Amex terms).
    await page.getByLabel('How you will pay').selectOption('bnpl');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByRole('heading', { name: 'Use Double Cash' })).toBeVisible();
    await check('comparison-bnpl');

    // Error: reading a cart from a page that is not a supported cart.
    await page.getByRole('button', { name: 'Read cart amount' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await check('cart-error');

    // An expired cached release gives way to the valid bundled terms (newest valid catalog wins).
    const day = 86_400_000;
    const expired = redateCatalog(PILOT_CATALOG, new Date(Date.now() - 2 * day).toISOString().slice(0, 10));
    expired.expiresAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    await writeCatalogCache(page, {
      lastCheckedAt: null,
      release: {
        sequence: 1,
        version: 'expired.1',
        catalog: { ...expired, version: 'expired.1' },
        catalog_hash: '1'.repeat(64),
        published_at: expired.verifiedAt,
      },
    });
    await mutateVaultState(page, (state) => {
      state.wallet = { defaultCardId: null, cards: [{ cardId: 'capital-one-quicksilver', usage: [] }] };
      state.revision += 1;
    });
    await page.reload();
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByRole('heading', { name: 'Your card estimate' })).toBeVisible();
    await expect(page.getByText(/These card terms have expired/)).toHaveCount(0);

    // An unavailable comparison: a saved card the catalog in effect lacks.
    await mutateVaultState(page, (state) => {
      state.wallet = {
        defaultCardId: null,
        cards: [
          { cardId: 'capital-one-quicksilver', usage: [] },
          { cardId: 'retired-test-card', usage: [] },
        ],
      };
      // Keep the earlier saved comparison: the unavailable alert must still stay on screen.
      state.revision += 1;
    });
    await page.reload();
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    const missing = /A saved card is missing from this catalog/;
    await expect(page.getByRole('alert').filter({ hasText: missing })).toBeVisible();
    // Regression: the stale-result timer must not clear an unavailable result.
    await page.waitForTimeout(1500);
    await expect(page.getByRole('alert').filter({ hasText: missing })).toBeVisible();
    await check('comparison-unavailable');

    // Settings (badge sites, optional protection), then protected and locked.
    await page.getByText('Settings', { exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Best Buy US' })).toBeChecked();
    await check('settings');
    await page.getByText('Settings', { exact: true }).click();
    await protectVault(page);
    await page.getByRole('button', { name: 'Lock saved inputs' }).click();
    await expect(page.getByLabel('Local passphrase', { exact: true })).toBeVisible();
    await check('vault-locked');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('catalog v3 popup and onboarding states are axe-clean at 360 and 480 px', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(120_000);
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
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/src/popup/index.html`);
    await startPopup(page);
    await cacheCatalogV3Fixture(page);
    await startPopup(page);

    // The card search open with grouped matches.
    await page.getByRole('combobox', { name: 'Add a card' }).fill('test');
    await expect(page.getByRole('listbox', { name: 'Matching cards' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Test Bank' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await axeCheck(page, 'v3-card-search', testInfo);
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Add a card' }).fill('zzz');
    await expect(page.getByText('No cards match. Try fewer letters or the bank’s name.')).toBeVisible();
    await page.getByRole('combobox', { name: 'Add a card' }).fill('');

    for (const name of [
      'Test Cash Plus',
      'Test Prime Visa',
      'Test Amazon Store Card',
      'Test Points Card',
      'Test Automatic Top Category',
      'Test Store Mastercard',
    ])
      await addCard(page, name);
    await expect(page.getByRole('heading', { name: 'Card options' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Point values' })).toBeVisible();
    await expect(page.getByText('No published value')).toBeVisible();
    await axeCheck(page, 'v3-wallet-options', testInfo);
    await page.getByRole('button', { name: 'Save cards' }).click();
    await expect(page.getByText(/No published value for Test Airline Miles/)).toBeVisible();
    await axeCheck(page, 'v3-purchase-form', testInfo);

    await page.getByLabel('Merchant').selectOption('amazon-us');
    await expect(page.getByLabel('How you will pay').locator('option', { hasText: 'Venmo' })).toHaveCount(1);
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByRole('heading', { name: 'Compare the conditions' })).toBeVisible();
    await expect(page.getByText('Estimate', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(/Depends on your answer to “Do you have an eligible Amazon Prime membership\?”/).first(),
    ).toBeVisible();
    await axeCheck(page, 'v3-comparison', testInfo);
    for (const summary of await page.locator('summary').all()) await summary.click();
    await axeCheck(page, 'v3-comparison-details', testInfo);

    // Every owned card is a store card for another store.
    await page.getByRole('button', { name: 'Edit cards' }).click();
    for (const name of [
      'Test Cash Plus',
      'Test Prime Visa',
      'Test Points Card',
      'Test Automatic Top Category',
      'Test Store Mastercard',
    ])
      await page.getByRole('button', { name: `Remove ${name}` }).click();
    await page.getByRole('button', { name: 'Save cards' }).click();
    await page.getByLabel('Merchant').selectOption('best-buy-us');
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /None of your cards can be used at this store/ }),
    ).toBeVisible();
    await axeCheck(page, 'v3-no-accepted-card', testInfo);

    // Onboarding renders the same editor.
    const onboarding = await context.newPage();
    await onboarding.goto(`${origin}/src/onboarding/index.html`);
    await expect(onboarding.getByRole('heading', { name: 'Welcome to AI Checkout' })).toBeVisible();
    await addCard(onboarding, 'Test Cash Plus');
    await addCard(onboarding, 'Test Automatic Top Category');
    await expect(onboarding.getByRole('heading', { name: 'Point values' })).toBeVisible();
    await axeCheck(onboarding, 'v3-onboarding', testInfo);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
