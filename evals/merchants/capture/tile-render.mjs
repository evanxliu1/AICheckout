#!/usr/bin/env node
// Labeller tiles of a rendered pane page-state (Phase 12.4 labelling aid). render-pane.mjs writes `full.png` up to
// 12,000 px tall, which an image viewer shrinks past reading, so this cuts it into `tiles/tile-NN.png` slices of
// 1280 x 1600 px (the last one shorter) next to it. Tiles are derived from `full.png` only and decide nothing; the
// label's snapshotSha256 stays the SHA-256 of render.json. Uses Playwright Chromium on a local data: page; no network.
//
//   node evals/merchants/capture/tile-render.mjs <data/pane> [domain ...]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STATES } from './collect-pane-exports.mjs';

export const TILE_HEIGHT = 1600;

async function tileState(page, dir) {
  const render = JSON.parse(readFileSync(path.join(dir, 'render.json'), 'utf8'));
  const width = render.viewport.width;
  const height = render.fullHeight;
  const out = path.join(dir, 'tiles');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  const png = readFileSync(path.join(dir, 'full.png')).toString('base64');
  await page.setViewportSize({ width, height: TILE_HEIGHT });
  await page.setContent(
    `<html><body style="margin:0"><img id="i" src="data:image/png;base64,${png}" style="display:block"></body></html>`,
  );
  await page.waitForFunction(() => document.getElementById('i').complete);
  const n = Math.ceil(height / TILE_HEIGHT);
  for (let i = 0; i < n; i++) {
    const y = i * TILE_HEIGHT;
    await page.screenshot({
      path: path.join(out, `tile-${String(i + 1).padStart(2, '0')}.png`),
      clip: { x: 0, y, width, height: Math.min(TILE_HEIGHT, height - y) },
      fullPage: true,
    });
  }
  return n;
}

async function main(argv) {
  const [dataDir, ...domains] = argv;
  if (!dataDir) throw new Error('usage: tile-render.mjs <data/pane> [domain ...]');
  const list = domains.length ? domains : readdirSync(dataDir).filter((d) => !d.startsWith('.')).sort();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: true });
  await context.route('**/*', (route) =>
    route.request().url().startsWith('data:') ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  let states = 0;
  let tiles = 0;
  try {
    for (const d of list)
      for (const s of STATES) {
        const dir = path.join(dataDir, d, s);
        if (!existsSync(path.join(dir, 'render.json'))) continue;
        tiles += await tileState(page, dir);
        states++;
      }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ states, tiles }));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exitCode = 1;
    },
  );
