import { chromium, expect, test } from '@playwright/test';
import { closeOnboarding } from './onboarding';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openNativePopup } from './native-popup';
import {
  deleteNativeVault,
  deleteVault,
  protectNativeVault,
  protectVault,
  startNativePopup,
  startPopup,
} from './vault';
import { CATALOG_V2 } from '../../packages/rewards-core/src/catalog-v2';
import { addCard } from './wallet';

test('capture real release UI and record the staged offline shopper walkthrough', async ({
  browserName,
}, testInfo) => {
  test.skip(process.env.RELEASE_ASSETS !== '1', 'Explicit release-media generation only.');
  test.setTimeout(120_000);
  expect(browserName).toBe('chromium');
  const output = resolve('../docs/release/assets'),
    captures = resolve(output, 'captures');
  mkdirSync(captures, { recursive: true });
  const extension = resolve('dist');
  const inventory = JSON.parse(readFileSync('artifacts/ai-checkout-2.0.0.inventory.json', 'utf8')) as {
    sha256: string;
    files: { path: string; sha256: string }[];
  };
  const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  expect(hash(readFileSync('artifacts/ai-checkout-2.0.0.zip'))).toBe(inventory.sha256);
  for (const file of inventory.files)
    expect(hash(readFileSync(resolve(extension, file.path)))).toBe(file.sha256);
  const context = await chromium.launchPersistentContext(testInfo.outputPath('native-profile'), {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-unsafe-extension-debugging',
    ],
  });
  const frames: {
    name: string;
    sha256: string;
    width: number;
    height: number;
    text: string;
    viewport: unknown;
  }[] = [];
  try {
    // All HTTP traffic is blocked except this exact in-memory merchant fixture.
    // (Only http(s) is intercepted: the badge iframe's own extension resources are not network traffic.)
    await context.route(/^https?:\/\//, (route) => route.abort());
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await closeOnboarding(context);
    const id = new URL(worker.url()).host,
      merchant = await context.newPage();
    await merchant.route('https://secure.newegg.com/shop/cart', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: readFileSync('tests/fixtures/newegg-observed-subtotal.html', 'utf8'),
      }),
    );
    await merchant.goto('https://secure.newegg.com/shop/cart');
    let popup = await openNativePopup(context, merchant, id);
    async function capture(name: string, expected: string[]) {
      for (const text of expected) await expect.poll(popup.text).toContain(text);
      const data = await popup.screenshot();
      writeFileSync(resolve(captures, `${name}.png`), data);
      frames.push({
        name,
        sha256: hash(data),
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
        text: await popup.text(),
        viewport: await popup.evaluate(
          '({width:innerWidth,height:innerHeight,scale:devicePixelRatio,scroll:document.querySelector("main").scrollTop})',
        ),
      });
    }
    await startNativePopup(popup);
    // Add every bundled card through the search field, as a shopper would.
    await popup.addCards(CATALOG_V2.cards.map((card) => card.name));
    await expect.poll(popup.text).toContain('online retail spend in');
    await popup.fill('spend-bce-online-retail', '0');
    await popup.evaluate(
      "document.querySelector('[aria-labelledby=wallet-heading]').scrollIntoView({block:'start'})",
    );
    await capture('wallet', ['Citi', 'Capital One Quicksilver', 'American Express Blue Cash Everyday']);
    await popup.click('Save cards');
    await expect.poll(popup.text).toContain('Read cart amount');
    await popup.fill('purchase-amount', '100');
    async function confirm() {
      await popup.evaluate(`{ const select=document.getElementById('online-eligibility');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'eligible');
        select.dispatchEvent(new Event('change',{bubbles:true}));
        const box=document.querySelector('form input[type=checkbox]'); if(!box.checked) box.click(); }`);
      await popup.click('Compare my cards');
    }
    await confirm();
    await capture('comparison', ['Saved estimate for a $100.00 Best Buy US purchase.', '$3.00', '$1.50']);
    // The automatic badge on a neutral sample cart (no retailer branding), at store-image scale.
    // Another tab takes focus, which closes the native popup; it is reopened afterwards.
    await popup.close();
    const mock = await context.newPage();
    await mock.setViewportSize({ width: 360, height: 400 });
    await mock.route('https://www.bestbuy.com/cart', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: readFileSync('tests/fixtures/mock-cart.html', 'utf8'),
      }),
    );
    await mock.goto('https://www.bestbuy.com/cart');
    await expect
      .poll(() => mock.frames().some((f) => f.url().includes('/src/badge/index.html')), { timeout: 10_000 })
      .toBe(true);
    const badgeFrame = mock.frames().find((f) => f.url().includes('/src/badge/index.html'))!;
    await expect(
      badgeFrame.getByRole('button', { name: /Use Blue Cash Everyday · \$3\.00 back/ }),
    ).toBeVisible();
    await mock.waitForTimeout(300);
    const badgeShot = await mock.screenshot();
    writeFileSync(resolve(captures, 'badge.png'), badgeShot);
    frames.push({
      name: 'badge',
      sha256: hash(badgeShot),
      width: badgeShot.readUInt32BE(16),
      height: badgeShot.readUInt32BE(20),
      text: await badgeFrame.evaluate(() => document.body.innerText),
      viewport: await mock.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
        scroll: 0,
      })),
    });
    await mock.close();
    popup = await openNativePopup(context, merchant, id);
    await expect.poll(popup.text).toContain('Edit cards');
    await popup.click('Edit cards');
    await expect.poll(popup.text).toContain('online retail spend in');
    await popup.fill('spend-bce-online-retail', '');
    await popup.click('Save cards');
    await expect.poll(popup.text).toContain('Read cart amount');
    await confirm();
    await capture('uncertainty', [
      'Compare the conditions',
      '$1.00–$3.00',
      'Your online retail spend toward this year’s bonus limit is unknown.',
    ]);
    await popup.click('Edit cards');
    await expect.poll(popup.text).toContain('online retail spend in');
    await popup.fill('spend-bce-online-retail', '0');
    await popup.click('Save cards');
    await expect.poll(popup.text).toContain('Read cart amount');
    await popup.click('Read cart amount');
    await expect.poll(popup.text).toContain('Read $249.99 as a subtotal before tax and shipping');
    await confirm();
    await capture('subtotal', [
      'Saved estimate for a $249.99 Newegg US subtotal.',
      'Subtotal only; tax and shipping are not included.',
      '$7.49',
      '$3.74',
    ]);
    await protectNativeVault(popup);
    await popup.click('Lock saved inputs');
    await capture('locked', ['Unlock your saved inputs', 'Local passphrase']);
    expect(await popup.text()).not.toContain('$7.49');
    await deleteNativeVault(popup);
    await startNativePopup(popup);
    expect(await worker.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    expect(await worker.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    writeFileSync(
      resolve(output, 'capture-manifest.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          browser: context.browser()?.version(),
          artifactSha256: inventory.sha256,
          extensionVersion: '2.0.0',
          catalogVersion: CATALOG_V2.version,
          catalogExpiresAt: CATALOG_V2.expiresAt,
          source:
            'Actual native toolbar popup; all seven card products selected as a sample; intercepted Newegg summary fixture.',
          liveMerchant: false,
          network: 'HTTP blocked except the in-memory route fixture; no model requests.',
          amountsAre: 'Conditional estimates using sample inputs, not customer savings or earned rewards.',
          frames,
        },
        null,
        2,
      ) + '\n',
    );
    await popup.close();
  } finally {
    await context.close();
  }

  if (process.env.RELEASE_ASSETS_ONLY === 'screenshots') {
    // A visual-only recapture can reuse a completed recording of these exact
    // packaged bytes; never mix an old video with a changed artifact.
    const previous = JSON.parse(readFileSync(resolve(output, 'demo-chapters.json'), 'utf8'));
    expect(previous.artifactSha256).toBe(inventory.sha256);
    expect(readFileSync(resolve(output, 'shopper-demo.webm')).length).toBeGreaterThan(0);
    return;
  }

  // Actual interactive screen recording of the packaged extension page. This is
  // deliberately labeled separately from native-toolbar and live-merchant evidence.
  const demo = await chromium.launchPersistentContext(testInfo.outputPath('demo-profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 360, height: 600 },
    recordVideo: { dir: testInfo.outputPath('video'), size: { width: 360, height: 600 } },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const chapters: { atSeconds: number; caption: string }[] = [];
  try {
    await demo.setOffline(true);
    const worker = demo.serviceWorkers()[0] ?? (await demo.waitForEvent('serviceworker'));
    await closeOnboarding(demo);
    const page = await demo.newPage(),
      video = page.video();
    if (!video) throw new Error('Demo recording was not created');
    const started = Date.now();
    const pause = async (caption: string, seconds = 3) => {
      chapters.push({ atSeconds: Math.round((Date.now() - started) / 100) / 10, caption });
      // Deliberate presentation dwell for the recording, never a readiness check.
      await page.waitForTimeout(seconds * 1000);
    };
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/index.html`);
    await startPopup(page);
    await pause(
      'Staged offline demo. Actual extension page; sample inputs; no live retailer or model call.',
      4,
    );
    await addCard(page, 'Capital One Quicksilver');
    await addCard(page, 'American Express Blue Cash Everyday');
    await page.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
    await pause('Choose two card products. Reported annual online-retail spend is $0 for this example.');
    await page.getByRole('button', { name: 'Save cards' }).click();
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByLabel('Online retail bonus eligibility').selectOption('eligible');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await pause('Enter a $100 eligible Best Buy US purchase and explicitly confirm its exclusions.');
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByRole('heading', { name: 'Use Blue Cash Everyday' })).toBeVisible();
    await expect(page.getByText('$3.00', { exact: true })).toBeVisible();
    await pause(
      'The rules engine estimates $3.00 and $1.50. These are conditional estimates, not earned rewards.',
      5,
    );
    await page.getByText('Card terms and sources', { exact: true }).click();
    await pause('The result includes source links, a terms expiry and eligibility limitations.', 4);
    await page.getByRole('button', { name: 'Edit cards' }).click();
    await page.getByLabel(/Blue Cash Everyday online retail spend/).fill('');
    await page.getByRole('button', { name: 'Save cards' }).click();
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByText('$1.00–$3.00', { exact: true })).toBeVisible();
    await pause('Unknown annual usage produces a $1.00–$3.00 range; the best card may change.', 5);
    await protectVault(page);
    await page.getByRole('button', { name: 'Lock saved inputs' }).click();
    await expect(page.getByLabel('Local passphrase', { exact: true })).toBeVisible();
    await pause('Lock hides private inputs and clears the session key. The local record stays encrypted.', 4);
    await page.getByText('Delete saved data', { exact: true }).click();
    await page.getByRole('checkbox', { name: /I want to permanently delete/ }).scrollIntoViewIfNeeded();
    await pause('Deletion requires explicit confirmation and can be done without the forgotten phrase.', 4);
    await page.getByText('Delete saved data', { exact: true }).click();
    await deleteVault(page);
    await startPopup(page);
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    expect(await page.evaluate(() => chrome.storage.session.get(null))).toEqual({});
    await pause(
      'Local data is cleared. This offline demo is not deployment, live LLM evaluation or store approval.',
      4,
    );
    writeFileSync(
      resolve(output, 'demo-chapters.json'),
      JSON.stringify(
        {
          artifactSha256: inventory.sha256,
          kind: 'Actual extension-page interaction recording; synthetic inputs; offline.',
          viewport: { width: 360, height: 600 },
          chapters,
        },
        null,
        2,
      ) + '\n',
    );
    // Finish the page recording while its persistent browser transport is still
    // connected; closing the whole context first invalidates the artifact handle.
    await page.close();
    await video.saveAs(resolve(output, 'shopper-demo.webm'));
  } finally {
    await demo.close();
  }
});
