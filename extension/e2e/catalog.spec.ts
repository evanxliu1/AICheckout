import { chromium, expect, test } from '@playwright/test';
import { closeOnboarding } from './onboarding';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteVault, readCatalogCache, startPopup } from './vault';
import { BADGE_ORIGINS } from './hosts';
import { PILOT_CATALOG } from '../../packages/rewards-core/src/catalog';
import { redateCatalog } from '../../packages/rewards-core/src/catalog-helpers';
import type { PublishedRelease } from '../../packages/rewards-core/src/schema';

test('published catalog: HTTPS refresh, changed rules, rollback rejection, offline restart', async ({
  browserName,
}, testInfo) => {
  test.skip(!process.env.CATALOG_E2E, 'Requires the isolated catalog-enabled build.');
  expect(browserName).toBe('chromium');
  const key = testInfo.outputPath('test.key'),
    cert = testInfo.outputPath('test.crt');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const release: PublishedRelease = {
    sequence: 2,
    version: 'synthetic.browser.2',
    // Re-dated to yesterday so the published release is valid whenever the test runs.
    catalog: {
      ...redateCatalog(PILOT_CATALOG, new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)),
      version: 'synthetic.browser.2',
    },
    catalog_hash: '1'.repeat(64),
    published_at: new Date().toISOString(),
  };
  // Fixture values are not claims about real issuer offers.
  release.catalog.cards[0].shortName = 'Updated test card';
  release.catalog.cards[0].rules[0].rateBps = 200;
  let response: unknown = { release },
    responseStatus = 200;
  const requests: { url?: string; cookie?: string; authorization?: string; referer?: string }[] = [];
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, reply) => {
    requests.push({
      url: request.url,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
      referer: request.headers.referer,
    });
    reply.writeHead(responseStatus, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    reply.end(JSON.stringify(response));
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(9443, '127.0.0.1', done);
  });
  const extension = resolve('dist-catalog-test');
  const launch = () =>
    chromium.launchPersistentContext(testInfo.outputPath('profile'), {
      channel: 'chromium',
      headless: true,
      ignoreHTTPSErrors: true,
      viewport: { width: 360, height: 600 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--ignore-certificate-errors',
      ],
    });
  let context: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    context = await launch();
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await closeOnboarding(context);
    const popupUrl = `chrome-extension://${new URL(worker.url()).host}/src/popup/index.html`;
    const page = await context.newPage();
    await page.goto(popupUrl);
    await startPopup(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('checkbox', { name: 'Capital One Quicksilver', exact: true }).check();
    await page.getByRole('button', { name: 'Save cards' }).click();
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByText('$1.50', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check for updated terms' }).click();
    await expect(page.getByRole('status')).toContainText('Card terms updated');
    await expect(page.getByText('$1.50', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /I confirmed the amount/ })).not.toBeChecked();
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByText('$2.00', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Updated test card', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('published-catalog-360.png') });

    response = {
      release: {
        ...release,
        sequence: 1,
        version: 'synthetic.browser.1',
        catalog: { ...release.catalog, version: 'synthetic.browser.1' },
      },
    };
    await page.getByRole('button', { name: 'Check for updated terms' }).click();
    await expect(page.getByRole('alert')).toContainText('older release');
    responseStatus = 503;
    await page.getByRole('button', { name: 'Check for updated terms' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be checked');
    expect((await readCatalogCache(page))?.release?.sequence).toBe(2);
    expect(requests).toHaveLength(3);
    expect(
      requests.every(
        (request) =>
          request.url === '/v1/catalog' && !request.cookie && !request.authorization && !request.referer,
      ),
    ).toBe(true);

    await context.close();
    context = await launch();
    await context.setOffline(true);
    const reopened = await context.newPage();
    await reopened.goto(popupUrl);
    await expect(reopened.getByText('$2.00', { exact: true })).toBeVisible();
    const permissions = await reopened.evaluate(() => chrome.permissions.getAll());
    // The supported carts' hosts (automatic badge) and the one configured catalog origin.
    expect(permissions.origins?.sort()).toEqual([...BADGE_ORIGINS, 'https://127.0.0.1:9443/*'].sort());
    expect(errors).toEqual([]);
    await deleteVault(reopened);
    await startPopup(reopened);
    expect(await reopened.evaluate(() => chrome.storage.local.get(null))).toEqual({});
  } finally {
    await context?.close();
    await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
  }
});
