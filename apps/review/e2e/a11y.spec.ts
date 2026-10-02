// Accessibility and CSP gate for the review app with a mocked backend (no Supabase needed): serves
// the production build with the API's exact security headers, stubs sign-in and the review API, and
// runs axe (WCAG 2.0/2.1 A and AA) on sign-in, the queue with a draft diff, the structured editor,
// the publish confirmation and a 180-card catalog v3 draft, at 1280 px and 390 px. It also fails on
// any CSP violation.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_V2, PILOT_CATALOG, type Catalog } from '../../../packages/rewards-core/src/index.ts';
import { largeCatalogV3 } from '../../../packages/rewards-core/large-catalog-fixture.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SUPABASE = 'https://mock-project.supabase.co';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const csp = `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${SUPABASE}; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`;
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

let server: Server, origin: string;
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    response.setHeader('Content-Security-Policy', csp);
    if (path === '/review/config.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ supabaseUrl: `${SUPABASE}/`, publishableKey: 'sb_publishable_axe_test' }),
      );
      return;
    }
    const relative = path === '/review/' ? 'index.html' : path.replace(/^\/review\//, '');
    const file = normalize(join(dist, relative));
    if (!file.startsWith(dist)) return void response.writeHead(404).end();
    try {
      const body = await readFile(file);
      response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const now = new Date();
const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * 86_400_000).toISOString();
const reviewerId = '10000000-0000-4000-8000-000000000001';
const draftId = '30000000-0000-4000-8000-000000000001';
/** The real v2 catalog, dated around today so it is publishable, with no source captured yet. */
function v2Catalog() {
  const day = now.toISOString().slice(0, 10);
  const catalog = structuredClone(CATALOG_V2);
  catalog.version = `${day}.real.2`;
  catalog.verifiedAt = `${day}T00:00:00Z`;
  catalog.expiresAt = new Date(Date.parse(catalog.verifiedAt) + 29 * 86_400_000)
    .toISOString()
    .replace('.000', '');
  for (const source of catalog.sources) source.checkedOn = day;
  return catalog;
}
const captureText = (title: string) => `Synthetic capture of ${title} for the accessibility test.`;
function detail(captured: boolean, catalog: Catalog = v2Catalog()) {
  const sources = captured
    ? catalog.sources.map((source, i) => ({
        id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        source_key: source.id,
        title: source.title,
        url: source.url,
        checked_on: source.checkedOn,
        body_chars: captureText(source.title).length,
        content_hash: 'a'.repeat(64),
        created_by: reviewerId,
        created_at: iso(0),
      }))
    : [];
  const published = { ...structuredClone(PILOT_CATALOG), version: 'published.1' };
  published.verifiedAt = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  published.expiresAt = catalog.expiresAt;
  for (const source of published.sources) source.checkedOn = now.toISOString().slice(0, 10);
  return {
    reviewerId,
    head: 1,
    published: {
      sequence: 1,
      catalog: published,
      version: 'published.1',
      catalog_hash: 'c'.repeat(64),
      published_at: published.verifiedAt,
    },
    sources,
    draft: {
      id: draftId,
      catalog,
      catalog_hash: 'b'.repeat(64),
      source_document_ids: sources.map((s) => s.id),
      base_sequence: 1,
      revision: 2,
      status: 'draft',
      created_by: reviewerId,
      created_at: iso(-1),
      updated_at: iso(0),
    },
  };
}

async function stubBackend(
  page: Page,
  captured: boolean,
  { empty = false, catalog }: { empty?: boolean; catalog?: Catalog } = {},
) {
  const payload = Buffer.from(
    JSON.stringify({ sub: reviewerId, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`;
  await page.route(`${SUPABASE}/auth/v1/**`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: token,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-token',
        user: { id: reviewerId, aud: 'authenticated', role: 'authenticated', email: 'reviewer@example.test' },
      }),
    }),
  );
  const data = detail(captured, catalog);
  // An empty queue until the app creates a draft with POST /drafts; then that draft is the queue.
  let created = !empty;
  await page.route(`${origin}/v1/review/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && path === '/v1/review/drafts') {
      const body = route.request().postDataJSON() as { catalog: typeof data.draft.catalog };
      data.draft.catalog = body.catalog;
      data.draft.revision = 1;
      data.sources = [];
      data.draft.source_document_ids = [];
      created = true;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data.draft) });
    }
    const source = /^\/v1\/review\/drafts\/[^/]+\/sources\/([^/]+)$/.exec(path);
    if (source) {
      const doc: Record<string, unknown> = { ...data.sources.find((item) => item.id === source[1])! };
      delete doc.body_chars;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ...doc, body: captureText(String(doc.title)) }),
      });
    }
    const body =
      path === '/v1/review/'
        ? {
            reviewerId,
            head: 1,
            drafts: !created
              ? []
              : [
                  {
                    id: draftId,
                    revision: 2,
                    status: 'draft',
                    updated_at: data.draft.updated_at,
                    base_sequence: 1,
                    version: data.draft.catalog.version,
                  },
                ],
          }
        : data;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function check(page: Page, state: string) {
  const info = test.info();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      `${state} at ${width}px`,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${state}-${width}.png`) });
  }
}

async function signIn(page: Page, captured: boolean, options?: { empty?: boolean; catalog?: Catalog }) {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (value: string) => violations.push(value));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      (window as unknown as { reportViolation: (v: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
      ),
    ),
  );
  await stubBackend(page, captured, options);
  await page.goto(`${origin}/review/`);
  await expect(page.getByRole('heading', { name: 'Review the terms behind every estimate.' })).toBeVisible();
  return violations;
}

test('sign-in, queue with draft diff, structured editor: axe-clean, no CSP violations', async ({ page }) => {
  const violations = await signIn(page, false);
  await check(page, 'sign-in');
  await page.getByLabel('Email', { exact: true }).fill('reviewer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /\.real\.2$/, level: 1 })).toBeVisible();
  // The v2 draft against a v1 release changes hundreds of fields: one collapsed section per card.
  await page.getByText(/^Citi Double Cash \(\d+ changed fields\)$/).click();
  await expect(
    page.getByRole('table', { name: /Published and proposed catalog changes: Citi/ }),
  ).toBeVisible();
  await expect(page.getByText('Matching evidence needed').first()).toBeVisible();
  await check(page, 'queue-and-diff');

  await page.getByText('Capture all missing sources', { exact: true }).click();
  await expect(page.getByLabel('Load capture files')).toBeVisible();
  await page.getByText('Correct draft data', { exact: true }).click();
  await page
    .locator('summary')
    .filter({ hasText: /^Citi Double Cash$/ })
    .click();
  await expect(page.getByLabel('Rate (bps)').first()).toBeVisible();
  await page.getByLabel('Paid when balance is paid (bps)').first().fill('900');
  await expect(page.getByText(/paid-on-payment portion cannot exceed the rate/).first()).toBeVisible();
  await check(page, 'structured-editor-with-errors');
  expect(violations).toEqual([]);
});

test('publish confirmation dialog: axe-clean, focus on Cancel, Esc closes', async ({ page }) => {
  const violations = await signIn(page, true);
  await page.getByLabel('Email', { exact: true }).fill('reviewer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Matching evidence captured').first()).toBeVisible();
  await page.locator('.source-card summary').first().click();
  await expect(page.getByText(/^Synthetic capture of .* for the accessibility test\.$/)).toBeVisible();
  await page.getByRole('checkbox', { name: /I checked the full source terms/ }).check();
  await page
    .getByLabel('Review note', { exact: true })
    .fill('Checked every source and rule for the axe test.');
  await page.getByRole('button', { name: 'Publish reviewed terms' }).click();
  const dialog = page.getByRole('dialog', { name: /^Publish / });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await check(page, 'publish-confirmation');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Publish reviewed terms' })).toBeFocused();
  expect(violations).toEqual([]);
});

test('empty queue: start a draft from the bundled catalog, confirm, and land on it', async ({ page }) => {
  // The app bundles CATALOG_V2 with fixed dates; pin the page clock inside its validity window.
  await page.clock.setFixedTime(new Date(Date.parse(CATALOG_V2.verifiedAt) + 86_400_000));
  const violations = await signIn(page, false, { empty: true });
  await page.getByLabel('Email', { exact: true }).fill('reviewer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Start a new draft' })).toBeVisible();
  await expect(page.getByText(CATALOG_V2.version, { exact: true })).toBeVisible();
  await expect(page.getByText('Valid now')).toBeVisible();
  await check(page, 'start-draft');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Create a draft of ${CATALOG_V2.version}?` });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await check(page, 'start-draft-confirmation');
  await dialog.getByRole('button', { name: 'Create the draft' }).click();
  const heading = page.getByRole('heading', { level: 1, name: CATALOG_V2.version });
  await expect(heading).toBeFocused();
  await expect(page.getByText(/Attach its source evidence with Capture all missing sources/)).toBeVisible();
  await expect(page.getByText('Matching evidence needed').first()).toBeVisible();
  await check(page, 'new-draft');
  expect(violations).toEqual([]);
});

test('180-card catalog v3 draft: grouped changes, source search, bulk capture and editor are axe-clean', async ({
  page,
}) => {
  const catalog = largeCatalogV3();
  const violations = await signIn(page, false, { catalog });
  await page.getByLabel('Email', { exact: true }).fill('reviewer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: catalog.version })).toBeVisible();
  await expect(page.getByText(/changed fields in \d+ sections/)).toBeVisible();
  await page.getByLabel('Find a card or section').fill('Synthetic Card 042');
  await page.getByText(/^Synthetic Card 042 \(\d+ changed fields\)$/).click();
  await expect(page.getByRole('table', { name: /Synthetic Card 042$/ })).toBeVisible();
  await page.getByLabel('Find a source').fill('large-source-01');
  await expect(page.getByText('10 of 340 sources match.')).toBeVisible();
  await page.getByText('Capture all missing sources', { exact: true }).click();
  await expect(page.getByLabel('Load a capture folder')).toBeVisible();
  await check(page, 'large-v3-draft');

  await page.getByText('Correct draft data', { exact: true }).click();
  await page.getByText(/^Reward programs and point values/).click();
  await page.getByLabel('Find a card', { exact: true }).fill('Card 007');
  await page
    .locator('summary')
    .filter({ hasText: /^Synthetic Card 007$/ })
    .click();
  await page
    .getByLabel('Only at brands (IDs, comma-separated; blank: any merchant)')
    .first()
    .fill('no-such-brand');
  await expect(page.getByText('Rule references an absent brand.').first()).toBeVisible();
  await check(page, 'large-v3-editor-with-errors');
  expect(violations).toEqual([]);
});
