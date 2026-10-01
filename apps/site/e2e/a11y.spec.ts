// Accessibility and CSP gate for the public site: the production build is served by the built API
// server (apps/api/dist, SITE_DIST_DIR), so the pages load under the exact headers they ship with.
// Run `npm run build` for @ai-checkout/api and @ai-checkout/site first.
// Every page is checked with axe (WCAG 2.0/2.1 A and AA) at 1280 px and 390 px, for horizontal
// scrolling, broken images and CSP violations.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGES } from '../src/Layout.tsx';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const server = fileURLToPath(new URL('../../api/dist/index.js', import.meta.url));
let api: ChildProcess, origin: string;

test.beforeAll(async () => {
  // Synthetic Supabase settings: the site never calls Supabase, and the catalog route is not used.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_site_axe_test',
    HOST: '127.0.0.1',
    PORT: '0',
    SITE_DIST_DIR: dist,
  };
  api = fork(server, [], {
    env,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  origin = await new Promise<string>((resolve, reject) => {
    api.once('message', (message: { type?: string; address?: string }) =>
      message.type === 'listening' && message.address
        ? resolve(message.address)
        : reject(new Error('API did not start')),
    );
    api.once('exit', (code) => reject(new Error(`API exited with ${code}`)));
  });
});
test.afterAll(() => {
  api.kill();
});

async function watchViolations(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (value: string) => violations.push(value));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      (window as unknown as { reportViolation: (v: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      ),
    ),
  );
  return violations;
}

for (const entry of PAGES) {
  test(`${entry.label} (${entry.path}): axe-clean at 1280 and 390 px, no CSP violations`, async ({
    page,
  }) => {
    const violations = await watchViolations(page);
    const failed: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}${entry.path}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: entry.label }),
      ).toHaveAttribute('aria-current', 'page');
      // Lazy screenshots load once scrolled into view; scroll through so every image is checked.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((done) => setTimeout(done, 30));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle');
      const { violations: axe } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(
        axe.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        `${entry.path} at ${width}px`,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(
        await page.evaluate(() =>
          [...document.images]
            .filter((image) => !image.complete || image.naturalWidth === 0)
            .map((i) => i.src),
        ),
      ).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`${entry.id}-${width}.png`),
        fullPage: true,
      });
    }
    expect(violations).toEqual([]);
    expect(failed.filter((line) => !line.endsWith('/favicon.ico'))).toEqual([]);
  });
}

test('wide result tables scroll inside a focusable, labelled region on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${origin}/results/`);
  const region = page.getByRole('region', { name: 'Dev results by model, prompt and source selection' });
  await expect(region).toHaveAttribute('tabindex', '0');
  await region.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
});
