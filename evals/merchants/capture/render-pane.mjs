#!/usr/bin/env node
// Labeller screenshots of pane captures (generic-reader-protocol.9 M10, Workflow 3). For each page-state export
// `data/pane/<domain>/<state>/dom.json` it checks the export's SHA-256 against the collector's `meta.json`, rebuilds
// it with rebuild.mjs, loads the rebuilt file in Playwright Chromium with JavaScript disabled and every request
// except the file itself aborted, and writes next to the export:
//   rebuilt.html   the rebuilt page that was loaded
//   viewport.png   the first 1280 x 900 CSS pixels
//   full.png       the full page, capped at 12,000 px tall (render.json says when the cap applied)
//   render.json    `pane-render.1`: SHA-256 of dom.json, rebuilt.html and both images, Chromium version, viewport,
//                  page height, blocked request count, SHA-256 of rebuild.mjs and render-pane.mjs, UTC time
// The SHA-256 of render.json is the page-state's snapshot manifest hash (`snapshotSha256` in reader-labels.2), so a
// state is never re-rendered after labelling: one with a render.json for the same dom SHA-256 is skipped unless
// --force. Only the six pane states are rendered; evidence exports are not.
//
//   node evals/merchants/capture/render-pane.mjs <data/pane> [domain ...] [--force]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STATES } from './collect-pane-exports.mjs';
import { rebuildFile } from './rebuild.mjs';

export const RENDER_FORMAT = 'pane-render.1';
export const VIEWPORT = { width: 1280, height: 900 };
export const MAX_FULL_HEIGHT = 12000;
const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
/** SHA-256 of the two scripts that produce a render, recorded in render.json. */
const TOOL_SHA256 = {
  rebuildScriptSha256: sha256(readFileSync(path.join(here, 'rebuild.mjs'))),
  rendererSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
};

/** Render one state folder. Returns {state, status: 'rendered' | 'skipped', render?}. */
export async function renderState(browser, dir, { force = false, maxHeight = MAX_FULL_HEIGHT } = {}) {
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  if (typeof meta.sha256 !== 'string') throw new Error(`${dir}: meta.json has no sha256`);
  const renderPath = path.join(dir, 'render.json');
  if (!force && existsSync(renderPath)) {
    const old = JSON.parse(await readFile(renderPath, 'utf8'));
    if (old.domSha256 === meta.sha256) return { status: 'skipped' };
  }
  const { html } = await rebuildFile(path.join(dir, 'dom.json'), meta.sha256);
  const htmlPath = path.join(dir, 'rebuilt.html');
  await writeFile(htmlPath, html);
  const fileUrl = pathToFileURL(htmlPath).href;
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
  });
  let blocked = 0;
  try {
    await context.route('**/*', (route) => {
      if (route.request().url() === fileUrl) return route.continue();
      blocked += 1;
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: 'load' });
    const height = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    );
    const shot = { animations: 'disabled', caret: 'hide' };
    const viewport = await page.screenshot(shot);
    const capped = height > maxHeight;
    const full = await page.screenshot({
      ...shot,
      fullPage: true,
      ...(capped ? { clip: { x: 0, y: 0, width: VIEWPORT.width, height: maxHeight } } : {}),
    });
    await writeFile(path.join(dir, 'viewport.png'), viewport);
    await writeFile(path.join(dir, 'full.png'), full);
    const render = {
      format: RENDER_FORMAT,
      renderer: 'render-pane.mjs',
      ...TOOL_SHA256,
      state: meta.state ?? path.basename(dir),
      domSha256: meta.sha256,
      rebuiltSha256: sha256(html),
      viewportSha256: sha256(viewport),
      fullSha256: sha256(full),
      chromium: browser.version(),
      viewport: VIEWPORT,
      javaScript: false,
      network: 'blocked',
      blockedRequests: blocked,
      pageHeight: height,
      fullHeight: capped ? maxHeight : height,
      fullCapped: capped,
      utc: new Date().toISOString(),
    };
    await writeFile(renderPath, JSON.stringify(render, null, 2) + '\n');
    return { status: 'rendered', render };
  } finally {
    await context.close();
  }
}

/** Render every pane state of the given domains (all domains under root when none given). */
export async function renderPane(browser, root, domains = [], opts = {}) {
  const list = domains.length ? domains : (await readdir(root)).filter((d) => !d.startsWith('.'));
  const report = [];
  for (const domain of list) {
    const states = await readdir(path.join(root, domain)).catch(() => []);
    for (const state of states.filter((s) => STATES.has(s)).sort()) {
      const dir = path.join(root, domain, state);
      if (!existsSync(path.join(dir, 'dom.json'))) continue;
      try {
        const r = await renderState(browser, dir, opts);
        report.push({ domain, state, status: r.status, fullCapped: r.render?.fullCapped });
      } catch (e) {
        report.push({ domain, state, status: 'error', error: String(e?.message ?? e) });
      }
    }
  }
  return report;
}

async function main(argv) {
  const force = argv.includes('--force');
  const [root, ...domains] = argv.filter((a) => a !== '--force');
  if (!root) {
    console.error('usage: render-pane.mjs <data/pane> [domain ...] [--force]');
    return 2;
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const report = await renderPane(browser, root, domains, { force });
    console.log(JSON.stringify(report, null, 1));
    return report.some((r) => r.status === 'error') ? 1 : 0;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exitCode = 1;
    },
  );
