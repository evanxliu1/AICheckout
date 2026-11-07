// The public site's sample cart (`/sample-cart/`, linked from the Chrome Web Store test instructions) at
// the reviewer's path: the built site page, served by the built API under its production headers (CSP
// included), is answered at https://ai-checkout-api.onrender.com/sample-cart/ through context.route, so the
// hosted service is never contacted. With the two cards of the test instructions saved, the badge must
// recognize the page as a cart and read its $100.00 total. Run `npm run build` (API and site) first.
import { chromium, expect, test } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { addCard } from './wallet';

const extension = resolve('dist-e2e');
const site = resolve('../apps/site/dist');
const server = resolve('../apps/api/dist/index.js');
const SAMPLE_CART = 'https://ai-checkout-api.onrender.com/sample-cart/';
const BADGE = '/src/badge/index.html';
let api: ChildProcess, origin: string;

test.beforeAll(async () => {
  for (const built of [resolve(site, 'sample-cart/index.html'), server])
    if (!existsSync(built)) throw new Error(`${built} is missing: run npm run build first.`);
  // Synthetic Supabase settings, as in the site's browser test: only the static site is served.
  api = fork(server, [], {
    env: {
      PATH: process.env.PATH,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_sample_cart_test',
      HOST: '127.0.0.1',
      PORT: '0',
      SITE_DIST_DIR: site,
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  origin = await new Promise<string>((done, fail) => {
    api.once('message', (message: { type?: string; address?: string }) =>
      message.type === 'listening' && message.address
        ? done(message.address)
        : fail(new Error('API did not start')),
    );
    api.once('exit', (code) => fail(new Error(`API exited with ${code}`)));
  });
});
test.afterAll(() => {
  api?.kill();
});

test('the site’s sample cart shows the badge with a $3.00 estimate on its $100.00 total', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  expect(browserName).toBe('chromium');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    // Every request to the hosted origin goes to the local API instead, headers and all.
    await context.route(/^https:\/\/ai-checkout-api\.onrender\.com\//, async (route) => {
      const { pathname, search } = new URL(route.request().url());
      route.fulfill({ response: await route.fetch({ url: `${origin}${pathname}${search}` }) });
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;

    // The test instructions' setup: Quicksilver and Blue Cash Everyday, $0 of online retail spend so far.
    await expect
      .poll(() =>
        context.pages().some((p) => p.url() === `chrome-extension://${id}/src/onboarding/index.html`),
      )
      .toBe(true);
    const onboarding = context.pages().find((p) => p.url().endsWith('/src/onboarding/index.html'))!;
    await addCard(onboarding, 'Capital One Quicksilver');
    await addCard(onboarding, 'American Express Blue Cash Everyday');
    await onboarding.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
    await onboarding.getByRole('button', { name: 'Save cards' }).click();
    await expect(onboarding.getByRole('heading', { name: 'You’re set' })).toBeVisible();
    await onboarding.close();

    const cart = await context.newPage();
    const violations: string[] = [];
    await cart.exposeFunction('reportViolation', (value: string) => violations.push(value));
    // The site's own document only: init scripts run in every frame, and the badge's extension frame
    // has its own policy (zod's caught `new Function` probe is reported there).
    await cart.addInitScript(() => {
      if (location.protocol !== 'https:') return;
      document.addEventListener('securitypolicyviolation', (event) =>
        (window as unknown as { reportViolation: (v: string) => void }).reportViolation(
          `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
        ),
      );
    });
    const response = await cart.goto(SAMPLE_CART);
    expect(response?.status()).toBe(200);
    // The site's production policy is on the page the badge runs in.
    expect(response?.headers()['content-security-policy']).toContain("style-src 'self'");
    await expect(cart.getByRole('heading', { level: 1, name: 'Your cart' })).toBeVisible();
    await expect(cart.getByText('Sample cart for testing AI Checkout')).toBeVisible();

    await expect
      .poll(() => cart.frames().some((f) => f.url().includes(BADGE)), { timeout: 10_000 })
      .toBe(true);
    const badge = cart.frames().find((f) => f.url().includes(BADGE))!;
    // An unlisted store is the generic online-retail profile: Blue Cash Everyday's 3% of $100.00.
    const pill = badge.getByRole('button', { name: /Use Blue Cash Everyday · \$3\.00 back on this cart/ });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(
      badge.getByText('Based on $100.00 cart estimated total at Another U.S. online store.'),
    ).toBeVisible();
    await cart.screenshot({ path: testInfo.outputPath('sample-cart-badge.png') });
    expect(violations).toEqual([]);
  } finally {
    await context.close();
  }
});
