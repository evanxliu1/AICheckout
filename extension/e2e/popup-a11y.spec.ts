// Accessibility gate for the popup: axe (WCAG 2.0/2.1 A and AA) on every main state at the
import { closeOnboarding } from './onboarding';
// popup's 360 px default width and at 480 px, plus a screenshot of each state for review.
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mutateVaultState, protectVault, startPopup } from './vault';
import { PILOT_CATALOG } from '../../packages/rewards-core/src/catalog';
import { redateCatalog } from '../../packages/rewards-core/src/catalog-helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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

    async function check(state: string, target: Page = page) {
      for (const width of [360, 480]) {
        await target.setViewportSize({ width, height: 900 });
        const { violations } = await new AxeBuilder({ page: target }).withTags(TAGS).analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
          `${state} at ${width}px`,
        ).toEqual([]);
        expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        // The popup scrolls itself, so overflow inside it never widens the document.
        expect(
          await target.evaluate(() =>
            Array.from(document.querySelectorAll('.checkout-popup, .badge-panel__body')).every(
              (el) => el.scrollWidth <= el.clientWidth,
            ),
          ),
        ).toBe(true);
        await target.screenshot({ path: testInfo.outputPath(`${state}-${width}.png`), fullPage: true });
      }
    }

    await page.goto(url);
    await startPopup(page);
    await check('wallet-setup');

    for (const name of ['Citi Double Cash', 'Capital One Quicksilver', 'American Express Blue Cash Everyday'])
      await page.getByRole('checkbox', { name, exact: true }).check();
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

    // Expired terms: a cached published release past its expiry.
    const day = 86_400_000;
    const expired = redateCatalog(PILOT_CATALOG, new Date(Date.now() - 2 * day).toISOString().slice(0, 10));
    expired.expiresAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    await mutateVaultState(page, (state) => {
      state.catalog.release = {
        sequence: 1,
        version: 'expired.1',
        catalog: { ...expired, version: 'expired.1' },
        catalog_hash: '1'.repeat(64),
        published_at: expired.verifiedAt,
      };
      state.wallet = { defaultCardId: null, cards: [{ cardId: 'capital-one-quicksilver', usage: [] }] };
      // Keep the earlier saved comparison: the expired-terms alert must still stay on screen.
      state.revision += 1;
    });
    await page.reload();
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByText(/These card terms have expired/)).toBeVisible();
    // Regression: the stale-result timer must not clear an unavailable result.
    await page.waitForTimeout(1500);
    await expect(page.getByRole('alert').filter({ hasText: /These card terms have expired/ })).toBeVisible();
    await check('catalog-expired');

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
