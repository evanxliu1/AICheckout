// Records the structure of a logged-out Amazon US cart for the bounded cart reader's fixtures.
//
//   node scripts/observe-amazon-cart.mjs <output-dir>
//
// Never signs in and never proceeds to checkout. It opens the empty cart, adds the first search
// result for a generic office item to the anonymous cart, increases its quantity once, and writes
// only the order-summary regions (outerHTML) plus screenshots to <output-dir>. Fixtures in
// tests/fixtures/amazon-observed-*.html are redacted by hand from that output: item titles,
// images, links, scripts and tracking attributes are removed. The output itself is not committed.
/* global document, location -- page.evaluate callbacks run in the browser */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('Usage: node scripts/observe-amazon-cart.mjs <output-dir>');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
const summary = () =>
  page.evaluate(() => ({
    url: location.href,
    subtotals: [...document.querySelectorAll('[data-name="Subtotals"]')].map((e) => e.outerHTML),
    empty: [...document.querySelectorAll('.sc-your-amazon-cart-is-empty')].map((e) => e.outerHTML),
    busy: [...document.querySelectorAll('[aria-busy="true"]')].map((e) => e.tagName),
    visibleSpinners: [...document.querySelectorAll('.a-spinner')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => e.parentElement?.closest('[class]')?.className ?? ''),
  }));
const record = async (name) => {
  writeFileSync(`${out}/${name}.json`, JSON.stringify(await summary(), null, 2));
  await page.screenshot({ path: `${out}/${name}.png` });
};
try {
  await page.goto('https://www.amazon.com/gp/cart/view.html');
  if (/captcha|robot/i.test(await page.title())) throw new Error('Amazon showed a bot check; stop.');
  await record('empty');
  await page.goto('https://www.amazon.com/s?k=pencil+eraser');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.waitForTimeout(3000);
  await page.goto('https://www.amazon.com/gp/cart/view.html');
  await page.waitForTimeout(3000);
  await record('one-item');
  await page.locator('[data-a-selector="increment"]').first().click();
  await record('updating');
  await page.waitForTimeout(4000);
  await record('two-items');
} finally {
  await browser.close();
}
