/* global document, location, getComputedStyle -- page.evaluate callbacks run in the browser */
// Records the structure of a logged-out Amazon US cart for the bounded cart reader's fixtures.
//
//   node scripts/observe-amazon-cart.mjs <output-dir>
//
// Never signs in and never proceeds to checkout. It opens the empty cart, adds the first search
// result for a generic office item to the anonymous cart, increases its quantity once (recording
// the update while it is in progress), and writes only structure to <output-dir>: tag, id, class
// and data-name chains for the order-summary regions, spinners, and every other element that shows
// a "subtotal" label. Text is kept only for those labels and their amounts (no item titles). Fixtures
// in tests/fixtures/amazon-observed-*.html are redacted by hand from that output and screenshots.
// The output itself is not committed.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('Usage: node scripts/observe-amazon-cart.mjs <output-dir>');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
const structure = () =>
  page.evaluate(() => {
    const describe = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        typeof el.className === 'string' && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).slice(0, 6).join('.')}`
          : ''
      }${el.dataset?.name ? `[data-name="${el.dataset.name}"]` : ''}${el.getAttribute('aria-busy') ? `[aria-busy="${el.getAttribute('aria-busy')}"]` : ''}`;
    const chain = (el) => {
      const parts = [];
      for (let node = el; node && node !== document.body && parts.length < 12; node = node.parentElement)
        parts.push(describe(node));
      return parts.join(' < ');
    };
    const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const short = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 40);
    // Leaf-ish elements whose own text is a subtotal label, plus the amount next to them.
    const labels = [...document.querySelectorAll('body *')]
      .filter(
        (el) =>
          /subtotal/i.test(el.textContent ?? '') && el.children.length <= 3 && el.textContent.length < 80,
      )
      .map((el) => ({
        chain: chain(el),
        visible: visible(el),
        label: short(el.textContent ?? ''),
        nextSibling: el.nextElementSibling
          ? { tag: describe(el.nextElementSibling), text: short(el.nextElementSibling.textContent ?? '') }
          : null,
      }));
    return {
      url: location.href,
      title: document.title,
      subtotals: [...document.querySelectorAll('[data-name="Subtotals"]')].map((el) => ({
        chain: chain(el),
        visible: visible(el),
        children: [...el.children].map((child) => ({
          tag: describe(child),
          text: short(child.textContent ?? ''),
        })),
      })),
      emptyHeading: [...document.querySelectorAll('.sc-your-amazon-cart-is-empty')].map((el) => ({
        chain: chain(el),
        text: short(el.textContent ?? ''),
      })),
      subtotalLabels: labels,
      busy: [...document.querySelectorAll('[aria-busy="true"]')].map(chain),
      spinners: [...document.querySelectorAll('.a-spinner, [class*="spinner"]')].map((el) => ({
        chain: chain(el),
        visible: visible(el),
      })),
      iframes: [...document.querySelectorAll('iframe')].map((el) => ({
        chain: chain(el),
        src: (el.src || '').split('?')[0],
      })),
    };
  });
const record = async (name) => {
  writeFileSync(`${out}/${name}.json`, JSON.stringify(await structure(), null, 2));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
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
