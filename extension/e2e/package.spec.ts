import { chromium, expect, test } from '@playwright/test';
import { closeOnboarding } from './onboarding';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openNativePopup, REAL_CARD_NAMES } from './native-popup';
import { deleteNativeVault, startNativePopup } from './vault';
import { BADGE_ORIGINS } from './hosts';
import { CATALOG_V3 } from '../../packages/rewards-core/src/catalog-v3';

test('the inspected upload ZIP installs and completes a native comparison', async ({
  browserName,
}, testInfo) => {
  test.skip(
    process.env.RELEASE_ZIP_E2E !== '1',
    'Run npm run test:package:browser to build an inspected ZIP first.',
  );
  expect(browserName).toBe('chromium');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const zip = resolve(`artifacts/ai-checkout-${pkg.version}.zip`);
  const inventory = JSON.parse(
    readFileSync(`artifacts/ai-checkout-${pkg.version}.inventory.json`, 'utf8'),
  ) as {
    version: string;
    sha256: string;
    bytes: number;
    catalogOrigin: string | null;
    files: { path: string; sha256: string; bytes: number }[];
  };
  const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  const zipBytes = readFileSync(zip);
  expect(inventory.version).toBe(pkg.version);
  expect(hash(zipBytes)).toBe(inventory.sha256);
  expect(zipBytes.length).toBe(inventory.bytes);
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
  expect(entries).toEqual(inventory.files.map((file) => file.path));
  expect(new Set(entries).size).toBe(entries.length);
  expect(entries).toContain('manifest.json');
  for (const path of entries)
    expect(path).toMatch(/^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/);
  const extension = testInfo.outputPath('extracted');
  mkdirSync(extension, { recursive: true });
  execFileSync('unzip', ['-q', zip, '-d', extension]);
  for (const file of inventory.files) {
    const data = readFileSync(resolve(extension, file.path));
    expect(hash(data)).toBe(file.sha256);
    expect(data.length).toBe(file.bytes);
  }
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
    const popup = await openNativePopup(context, merchant, id);
    await startNativePopup(popup);
    writeFileSync(testInfo.outputPath('zip-setup.png'), await popup.screenshot());
    await popup.checkCards(REAL_CARD_NAMES);
    await expect.poll(popup.text).toContain('online retail spend this year');
    await popup.fill('spend-bce-online-retail-v2', '0');
    await popup.click('Save cards');
    await expect
      .poll(popup.text)
      .toContain(
        'Double Cash · Active Cash · Quicksilver · Savor · Freedom Unlimited · Blue Cash Everyday · Blue Cash Preferred',
      );
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $27.23 as the order total');
    await popup.evaluate(`const select = document.getElementById('online-eligibility');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'eligible');
      select.dispatchEvent(new Event('change', { bubbles: true }));`);
    await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
    await popup.click('Compare my cards');
    // This is the real release artifact, so its bundled catalog is not re-dated: before expiry it
    // must compare; afterwards it must refuse with the expiry notice. Either way it never time-bombs.
    if (Date.now() < Date.parse(CATALOG_V3.expiresAt)) {
      await expect.poll(popup.text).toContain('$0.81');
      await expect.poll(popup.text).toContain('$0.40');
    } else await expect.poll(popup.text).toContain('These card terms have expired');
    const permissions = await worker.evaluate(() => chrome.permissions.getAll());
    expect(permissions.permissions?.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(permissions.origins?.sort()).toEqual(
      [...BADGE_ORIGINS, ...(inventory.catalogOrigin ? [`${inventory.catalogOrigin}/*`] : [])].sort(),
    );
    writeFileSync(testInfo.outputPath('zip-comparison.png'), await popup.screenshot());
    await deleteNativeVault(popup);
    await startNativePopup(popup);
    expect(await worker.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    expect(await worker.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    writeFileSync(
      testInfo.outputPath('zip-verification.json'),
      JSON.stringify(
        {
          version: pkg.version,
          sha256: inventory.sha256,
          browser: context.browser()?.version(),
          evidence:
            'extracted upload ZIP; native action; sanitized merchant fixture; two-card comparison; deletion',
          liveMerchant: false,
        },
        null,
        2,
      ),
    );
    await popup.close();
  } finally {
    await context.close();
  }
});
