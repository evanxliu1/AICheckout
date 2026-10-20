// Phase 15.3: consented usage reporting in the isolated build with VITE_TELEMETRY (dist-catalog-test, built by
// `npm run test:catalog:browser` with the stub API origin). A local HTTPS stub answers /v1/events and
// /v1/events/delete (the worker's fetches do not pass through context.route). Share → the install events with
// the contract's shape; a cart at a synthetic store → recommendation_shown without the host; the two taps carry
// the registrable domain; Stop sharing and Delete my data; Not now → no request until a tap, which carries no
// id; axe on the consent screen at 360 and 480 px.
import AxeBuilder from '@axe-core/playwright';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { eventBatchSchema } from '../../packages/catalog-review/src/telemetry';
import type { TelemetryEvent } from '../../packages/catalog-review/src/telemetry';
import { openNativePopup } from './native-popup';
import { addCard } from './wallet';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BADGE = '/src/badge/index.html';
const TELEMETRY_KEY = 'checkoutTelemetryV1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const row = (label: string, amount: string) => `<div><span>${label}</span><span>${amount}</span></div>`;
const CART = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Your cart</title></head><body><main><h1>Your cart</h1><section class="summary">${row('Subtotal', '$90.00') + row('Shipping', '$10.00') + row('Order total', '$100.00')}<button type="button">Checkout</button></section></main></body></html>`;

type Hit = { url: string; origin?: string; cookie?: string; referer?: string; body: unknown };
/** The stub API on the catalog origin the build was made with: no published releases, events accepted. */
async function stubApi(testInfo: TestInfo) {
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
  const hits: Hit[] = [];
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, reply) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      hits.push({
        url: request.url ?? '',
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        referer: request.headers.referer,
        body,
      });
      reply.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (request.url === '/v1/events')
        reply.end(JSON.stringify({ accepted: (body as { events: unknown[] }).events.length, dropped: 0 }));
      else if (request.url === '/v1/events/delete') reply.end(JSON.stringify({ deleted: 3 }));
      else reply.end(JSON.stringify({ release: null }));
    });
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(9443, '127.0.0.1', done);
  });
  const events = () =>
    hits
      .filter((hit) => hit.url === '/v1/events')
      .flatMap((hit) => (hit.body as { events: TelemetryEvent[] }).events);
  return {
    hits,
    events,
    close: () =>
      new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done()))),
  };
}
async function launch(testInfo: TestInfo) {
  const extension = resolve('dist-catalog-test');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--ignore-certificate-errors',
      '--enable-unsafe-extension-debugging',
    ],
  });
  await context.route(/^https:\/\/shop\.example\.com\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: CART }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  return { context, worker, id, popupUrl: `chrome-extension://${id}/src/popup/index.html` };
}
/** Onboarding up to the consent screen: cards picked and saved. */
async function onboardToConsent(context: BrowserContext, id: string) {
  await expect
    .poll(() => context.pages().some((p) => p.url() === `chrome-extension://${id}/src/onboarding/index.html`))
    .toBe(true);
  const page = context.pages().find((p) => p.url().endsWith('/src/onboarding/index.html'))!;
  await expect(page.getByRole('heading', { name: 'Welcome to AI Checkout' })).toBeVisible();
  await addCard(page, 'Citi Double Cash');
  await addCard(page, 'American Express Blue Cash Everyday');
  await page.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
  await page.getByRole('button', { name: 'Save cards' }).click();
  await expect(page.getByRole('heading', { name: 'Help improve AI Checkout' })).toBeVisible();
  return page;
}
async function badgeFrame(p: Page): Promise<Frame> {
  await expect.poll(() => p.frames().some((f) => f.url().includes(BADGE)), { timeout: 10_000 }).toBe(true);
  return p.frames().find((f) => f.url().includes(BADGE))!;
}
const telemetryState = (worker: { evaluate: Page['evaluate'] }) =>
  worker.evaluate(
    async (key) =>
      (await chrome.storage.local.get(key))[key] as
        { installId: string | null; consent: string | null; queue: { type: string }[] } | undefined,
    TELEMETRY_KEY,
  );
async function axe(page: Page, label: string, testInfo: TestInfo) {
  for (const width of [360, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      `${label} at ${width}px`,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${label}-${width}.png`), fullPage: true });
  }
}

test('Share: the install events, a recommendation at a synthetic store without its host, the taps, Delete my data and Stop sharing', async ({
  browserName,
}, testInfo) => {
  test.skip(!process.env.CATALOG_E2E, 'Requires the isolated catalog-enabled build with VITE_TELEMETRY.');
  test.setTimeout(150_000);
  expect(browserName).toBe('chromium');
  const api = await stubApi(testInfo);
  const { context, worker, id, popupUrl } = await launch(testInfo);
  try {
    const onboarding = await onboardToConsent(context, id);
    // Nothing has left the device: no state, no request.
    expect(await telemetryState(worker)).toBeUndefined();
    expect(api.hits.filter((h) => h.url.startsWith('/v1/events'))).toEqual([]);
    const share = onboarding.getByRole('button', { name: 'Share' });
    const notNow = onboarding.getByRole('button', { name: 'Not now' });
    await expect(share).toBeVisible();
    await expect(notNow).toBeVisible();
    // Equally prominent: the same component, size and colour.
    expect(await share.getAttribute('class')).toBe(await notNow.getAttribute('class'));
    const copy = (await onboarding.locator('main').innerText()).toLowerCase();
    expect(copy).toContain('a random identifier');
    expect(copy).toContain('no name, email or browsing history');
    expect(copy).not.toContain('anonymous');
    await axe(onboarding, 'consent', testInfo);
    await onboarding.setViewportSize({ width: 1280, height: 800 });

    await share.click();
    await expect(onboarding.getByRole('heading', { name: 'You’re set' })).toBeVisible();
    await expect.poll(() => api.events().length, { timeout: 15_000 }).toBe(3);
    const first = api.hits.find((h) => h.url === '/v1/events')!;
    expect(eventBatchSchema.safeParse(first.body).success).toBe(true);
    expect(first.origin).toBe(`chrome-extension://${id}`);
    expect(first.cookie).toBeUndefined();
    expect(first.referer).toBeUndefined();
    const [consent, completed, changed] = api.events();
    expect([consent!.type, completed!.type, changed!.type]).toEqual([
      'consent_granted',
      'onboarding_completed',
      'wallet_changed',
    ]);
    const installId = consent!.install_id!;
    expect(installId).toMatch(UUID);
    expect(completed).toMatchObject({ install_id: installId, cards_count: 2, days_since_install: '0' });
    expect(changed).toMatchObject({ card_ids: ['citi-double-cash', 'amex-blue-cash-everyday'] });
    expect((await telemetryState(worker))?.installId).toBe(installId);
    await onboarding.close();

    // A cart at a synthetic store: the badge's recommendation is queued without the host.
    const cart = await context.newPage();
    await cart.goto('https://shop.example.com/cart');
    const badge = await badgeFrame(cart);
    const pill = badge.getByRole('button', { name: /Use Blue Cash Everyday · \$3\.00 back on this cart/ });
    await expect(pill).toBeVisible();
    await expect
      .poll(async () => (await telemetryState(worker))?.queue.map((e) => e.type))
      .toEqual(['recommendation_shown']);
    const queued = JSON.stringify((await telemetryState(worker))?.queue);
    expect(queued).not.toMatch(/example|shop|https/);
    // "Store not recognised? Suggest it" sends the registrable domain and flushes what waited.
    await pill.click();
    await badge.getByRole('button', { name: 'Store not recognised? Suggest it' }).click();
    await expect(badge.getByRole('status').filter({ hasText: 'address was sent' })).toBeVisible();
    await expect.poll(() => api.events().length, { timeout: 15_000 }).toBe(6);
    // Queued in order: the recommendation (at the first view), the expansion, then the tap flushed them.
    const [, , , shown, expanded, suggested] = api.events();
    expect(expanded).toMatchObject({ type: 'badge_expanded', view: 'amount', install_id: installId });
    expect(shown).toMatchObject({
      type: 'recommendation_shown',
      surface: 'badge',
      view: 'amount',
      withheld_reason: null,
      page: 'cart',
      store_kind: 'generic',
      evidence_basis: 'none',
      category: 'general-merchandise',
      amount_cents: 10000,
      amount_kind: 'estimated-total',
      top_card_id: 'amex-blue-cash-everyday',
      cards_count: 2,
      install_id: installId,
    });
    expect(JSON.stringify(shown)).not.toMatch(/example|shop/);
    expect(suggested).toMatchObject({
      type: 'store_suggested',
      domain: 'example.com',
      page: 'cart',
      install_id: installId,
    });
    for (const hit of api.hits.filter((h) => h.url === '/v1/events'))
      expect(eventBatchSchema.safeParse(hit.body).success).toBe(true);

    // The popup opened from the store tab: Suggest this store at the generic store, Report a problem.
    const popup = await openNativePopup(context, cart, id);
    await expect.poll(popup.text).toContain('Suggest this store');
    await popup.click('Suggest this store');
    await expect.poll(popup.text).toContain('address was sent');
    await popup.evaluate("document.querySelector('#report-problem summary').click()");
    await popup.evaluate(
      "(() => { const s = document.getElementById('problem-reason'); s.value = 'no-badge'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
    );
    await popup.click('Send report');
    await expect.poll(popup.text).toContain('Your report was sent');
    await expect.poll(() => api.events().length, { timeout: 15_000 }).toBeGreaterThanOrEqual(9);
    const types = api.events().map((e) => e.type);
    expect(types).toContain('popup_opened');
    expect(types.filter((t) => t === 'store_suggested')).toHaveLength(2);
    const report = api.events().find((e) => e.type === 'problem_reported')!;
    expect(report).toMatchObject({
      domain: 'example.com',
      reason: 'no-badge',
      view: 'amount',
      withheld_reason: null,
      install_id: installId,
    });
    expect(JSON.stringify(report)).not.toContain('shop.example.com');
    await popup.close();

    // Settings: Delete my data posts the id and stops sharing; sharing again mints a new id; off clears it.
    const settings = await context.newPage();
    await settings.setViewportSize({ width: 360, height: 900 });
    await settings.goto(popupUrl);
    await settings.getByText('Settings', { exact: true }).click();
    const toggle = settings.getByRole('switch', { name: 'Sharing usage data' });
    await expect(toggle).toBeChecked();
    await settings.screenshot({ path: testInfo.outputPath('settings-sharing.png'), fullPage: true });
    await settings.getByRole('button', { name: 'Delete my data' }).click();
    await expect(
      settings.getByRole('status').filter({ hasText: 'deleted and sharing stopped' }),
    ).toBeVisible();
    expect(api.hits.filter((h) => h.url === '/v1/events/delete').map((h) => h.body)).toEqual([
      { install_id: installId },
    ]);
    await expect(toggle).not.toBeChecked();
    expect(await telemetryState(worker)).toMatchObject({ consent: 'declined', installId: null, queue: [] });
    const sent = api.events().length;
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect.poll(() => api.events().length, { timeout: 15_000 }).toBe(sent + 2);
    const again = api.events().slice(sent);
    expect(again.map((e) => e.type)).toEqual(['consent_granted', 'wallet_changed']);
    expect(again[0]!.install_id).toMatch(UUID);
    expect(again[0]!.install_id).not.toBe(installId);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await telemetryState(worker)).toMatchObject({ consent: 'declined', installId: null, queue: [] });
    // Nothing more is sent after Stop sharing: another cart view queues nothing.
    const after = api.events().length;
    await cart.reload();
    await badgeFrame(cart);
    await cart.waitForTimeout(1500);
    expect((await telemetryState(worker))?.queue).toEqual([]);
    expect(api.events().length).toBe(after);
    // Every request went to the fixed routes with the extension's origin and no cookie or referrer.
    for (const hit of api.hits) {
      expect(['/v1/events', '/v1/events/delete', '/v1/catalog', '/v1/merchants']).toContain(hit.url);
      expect(hit.cookie).toBeUndefined();
      expect(hit.referer).toBeUndefined();
      if (hit.url.startsWith('/v1/events')) expect(hit.origin).toBe(`chrome-extension://${id}`);
    }
  } finally {
    await context.close();
    await api.close();
  }
});

test('Not now: no request ever until a tap, which carries no identifier', async ({
  browserName,
}, testInfo) => {
  test.skip(!process.env.CATALOG_E2E, 'Requires the isolated catalog-enabled build with VITE_TELEMETRY.');
  test.setTimeout(90_000);
  expect(browserName).toBe('chromium');
  const api = await stubApi(testInfo);
  const { context, worker, id, popupUrl } = await launch(testInfo);
  try {
    const onboarding = await onboardToConsent(context, id);
    await onboarding.getByRole('button', { name: 'Not now' }).click();
    await expect(onboarding.getByRole('heading', { name: 'You’re set' })).toBeVisible();
    await onboarding.close();
    expect(await telemetryState(worker)).toMatchObject({ consent: 'declined', installId: null, queue: [] });

    const cart = await context.newPage();
    await cart.goto('https://shop.example.com/cart');
    const badge = await badgeFrame(cart);
    await badge.getByRole('button', { name: /Show details/ }).click();
    await expect(badge.getByRole('heading', { name: 'Best card for this cart' })).toBeVisible();
    await badge.getByRole('button', { name: 'Dismiss for this tab' }).click();
    const popup = await context.newPage();
    await popup.goto(popupUrl);
    await popup.getByText('Settings', { exact: true }).click();
    await expect(popup.getByRole('switch', { name: 'Sharing usage data' })).not.toBeChecked();
    await popup.waitForTimeout(1500);
    expect(api.hits.filter((h) => h.url.startsWith('/v1/events'))).toEqual([]);
    expect((await telemetryState(worker))?.queue).toEqual([]);

    // The tap works without sharing: the domain travels, the identifier is null.
    const again = await context.newPage();
    await again.goto('https://shop.example.com/cart');
    const frame = await badgeFrame(again);
    await frame.getByRole('button', { name: /Show details/ }).click();
    await frame.getByRole('button', { name: 'Store not recognised? Suggest it' }).click();
    await expect.poll(() => api.events().length, { timeout: 15_000 }).toBe(1);
    expect(api.events()[0]).toMatchObject({
      type: 'store_suggested',
      domain: 'example.com',
      install_id: null,
    });
    expect(eventBatchSchema.safeParse(api.hits.find((h) => h.url === '/v1/events')!.body).success).toBe(true);
  } finally {
    await context.close();
    await api.close();
  }
});
