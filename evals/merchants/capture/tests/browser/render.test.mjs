// render-pane.mjs on a pane-dom.2 export of the fixture shop's pane page: SHA-256 checked against meta.json, the
// rebuilt page rendered with JavaScript off and every other request aborted, viewport.png 1280 x 900, full.png
// capped, render.json hashes, skip unless --force, refusal on a changed export. 127.0.0.1 only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { renderPane, renderState } from '../../render-pane.mjs';
import { startShop } from '../fixture-shop.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
// Width and height from a PNG's IHDR chunk.
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

let browser;
let shop;
let tmp;
let root;
let domSha;
before(async () => {
  browser = await chromium.launch({ headless: true });
  shop = await startShop();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'capture-render-'));
  root = path.join(tmp, 'pane');
  // A pane-dom.2 export of the fixture page, saved the way the collector saves one.
  const exportScript = await readFile(path.join(here, '..', '..', 'pane-export.js'), 'utf8');
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  await page.goto(`${shop.origin}/pane-fixture`);
  const summary = await page.evaluate(exportScript);
  const parts = [];
  for (let i = 0; i < summary.chunks; i += 1)
    parts.push(await page.evaluate((k) => window.__aiCheckoutPaneExport.chunk(k), i));
  await context.close();
  const dir = path.join(root, 'fixture.test', 'cart-1');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'dom.json'), parts.join(''));
  domSha = summary.sha256;
  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({ format: 'pane-dom.2', state: 'cart-1', sha256: summary.sha256, collectedBy: 'test' }),
  );
  // A folder that isn't a pane state is never rendered.
  await mkdir(path.join(root, 'fixture.test', 'evidence', 'evidence-1'), { recursive: true });
});
after(async () => {
  await browser?.close();
  await shop?.close();
  await rm(tmp, { recursive: true, force: true });
});

test('render-pane: screenshots and render.json for each pane state, nothing fetched', async () => {
  const before = shop.log.length;
  const report = await renderPane(browser, root);
  assert.deepEqual(report, [
    { domain: 'fixture.test', state: 'cart-1', status: 'rendered', fullCapped: false },
  ]);
  assert.equal(shop.log.length, before, 'the shop received no request');
  const dir = path.join(root, 'fixture.test', 'cart-1');
  const render = JSON.parse(await readFile(path.join(dir, 'render.json'), 'utf8'));
  const viewport = await readFile(path.join(dir, 'viewport.png'));
  const full = await readFile(path.join(dir, 'full.png'));
  const html = await readFile(path.join(dir, 'rebuilt.html'), 'utf8');
  assert.equal(render.format, 'pane-render.1');
  assert.equal(render.domSha256, domSha);
  assert.equal(render.viewportSha256, sha(viewport));
  assert.equal(render.fullSha256, sha(full));
  assert.equal(render.rebuiltSha256, sha(html));
  assert.deepEqual(render.viewport, { width: 1280, height: 900 });
  assert.equal(render.javaScript, false);
  assert.match(render.chromium, /^\d+\./);
  // The iframe stub and stylesheet-free page ask for nothing; whatever was asked for was aborted.
  assert.ok(render.blockedRequests >= 0);
  assert.deepEqual(pngSize(viewport), { width: 1280, height: 900 });
  assert.equal(pngSize(full).width, 1280);
  assert.equal(pngSize(full).height, render.fullHeight);
  assert.ok(!/<script/i.test(html));
});

test('render-pane: already rendered is skipped unless --force; full page capped', async () => {
  assert.equal((await renderPane(browser, root, ['fixture.test']))[0].status, 'skipped');
  const dir = path.join(root, 'fixture.test', 'cart-1');
  const r = await renderState(browser, dir, { force: true, maxHeight: 300 });
  assert.equal(r.status, 'rendered');
  assert.equal(r.render.fullCapped, true);
  assert.equal(r.render.fullHeight, 300);
  assert.deepEqual(pngSize(await readFile(path.join(dir, 'full.png'))), { width: 1280, height: 300 });
});

test('render-pane: refuses an export whose SHA-256 is not the one in meta.json', async () => {
  const dir = path.join(root, 'tampered.test', 'cart-1');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'dom.json'), '{"format":"pane-dom.2","root":{"t":"html"}}');
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ state: 'cart-1', sha256: '0'.repeat(64) }));
  const report = await renderPane(browser, root, ['tampered.test']);
  assert.equal(report[0].status, 'error');
  assert.match(report[0].error, /SHA-256/);
});
