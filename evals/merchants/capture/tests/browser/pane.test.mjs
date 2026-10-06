// Round trip of the pane export (pane-export.js, format pane-dom.1) and its offline rebuild (rebuild.mjs): the rebuilt
// page, loaded with all network blocked, shows the same visible text and amounts as the source page, keeps hidden
// amounts hidden, keeps strikethrough, and runs no script. 127.0.0.1 only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { rebuildFile } from '../../rebuild.mjs';
import { startShop } from '../fixture-shop.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let browser;
let shop;
let tmp;
before(async () => {
  browser = await chromium.launch({ headless: true });
  shop = await startShop();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'capture-pane-'));
});
after(async () => {
  await browser?.close();
  await shop?.close();
  await rm(tmp, { recursive: true, force: true });
});

// Visible text, piercing open shadow roots, in document order.
const visibleText = () => {
  const out = [];
  const walk = (root) => {
    for (const n of root.childNodes) {
      if (n.nodeType === 3) {
        const t = n.nodeValue.trim();
        const p = n.parentElement;
        if (t && p && !['SCRIPT', 'STYLE', 'TITLE'].includes(p.tagName)
          && p.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
          out.push(t);
      } else if (n.nodeType === 1) {
        if (n.shadowRoot) walk(n.shadowRoot);
        walk(n);
      }
    }
  };
  walk(document.body);
  return out.join(' ').replace(/\s+/g, ' ');
};

test('pane-dom.1: export in page, rebuild offline, same visible text and amounts; hidden stays hidden', async () => {
  const exportScript = await readFile(path.join(here, '..', '..', 'pane-export.js'), 'utf8');
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  await page.goto(`${shop.origin}/pane-fixture?session=abc`);
  const summary = await page.evaluate(exportScript);
  assert.equal(summary.format, 'pane-dom.1');
  assert.equal(summary.url, `${shop.origin}/pane-fixture`);
  assert.equal(summary.shadowRoots, 1);
  assert.equal(summary.iframes, 1);
  assert.equal(summary.truncated, false);
  const parts = [];
  for (let i = 0; i < summary.chunks; i += 1)
    parts.push(await page.evaluate((k) => window.__aiCheckoutPaneExport.chunk(k), i));
  const file = path.join(tmp, 'dom.json');
  await writeFile(file, parts.join(''));
  // The SHA-256 computed in the page is the file's.
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), summary.sha256);
  const sourceText = await page.evaluate(visibleText);
  await context.close();

  const { html } = await rebuildFile(file, summary.sha256);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/onclick/i.test(html));
  assert.match(html, /<template shadowrootmode="open">/);
  const out = path.join(tmp, 'rebuilt.html');
  await writeFile(out, html);

  const replay = await browser.newContext({ viewport: { width: 1024, height: 768 }, javaScriptEnabled: false });
  const requests = [];
  await replay.route('**/*', (route) => {
    if (route.request().url().startsWith('file:')) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  const rp = await replay.newPage();
  await rp.goto(pathToFileURL(out).href);
  const rebuiltText = await rp.evaluate(visibleText);
  const amounts = (t) => t.match(/£\d+\.\d\d/g);
  assert.equal(rebuiltText, sourceText);
  assert.deepEqual(amounts(rebuiltText), amounts(sourceText));
  assert.deepEqual(amounts(sourceText), ['£25.00', '£20.00', '£20.00', '£24.00', '£4.00']);
  assert.ok(!rebuiltText.includes('£99.00') && !rebuiltText.includes('£77.00'));
  assert.match(sourceText, /Price & tax <estimated> "quoted"/);
  assert.equal(
    await rp.evaluate(() => getComputedStyle(document.querySelector('.was')).textDecorationLine),
    'line-through',
  );
  assert.ok(await rp.evaluate(() => Boolean(document.getElementById('summary').shadowRoot)));
  // Nothing was fetched: the iframe is a stub, external resources never load.
  assert.equal(await rp.evaluate(() => document.querySelector('iframe').getAttribute('src')), null);
  await replay.close();
});
