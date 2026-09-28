/* global Image, document */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Render newly authored vector geometry. No existing screenshot or artwork is edited.
const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'docs/release/assets');
mkdirSync(output, { recursive: true });
const svg = readFileSync(resolve(root, 'extension/assets/cart-mark.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
  for (const size of [16, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body></html>`,
    );
    await page.screenshot({
      path: resolve(root, `extension/public/icons/icon${size}.png`),
      omitBackground: true,
    });
  }
  const mark = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const promo = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI Checkout promotional image</title>
<style>html,body{margin:0;width:440px;height:280px;background:#2563eb;color:white;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}img{width:180px;height:180px}h1{margin:0;font-size:32px;line-height:40px;font-weight:600;letter-spacing:-.02em}</style></head>
<body><!-- THESIS: show the cart identity clearly at store thumbnail size. OWN-WORLD: existing action blue, white cart geometry and system type. STORY: recognize AI Checkout as a shopping tool. FIRST VIEWPORT: full blue field, centered cart, single product name. FORM: incumbent brand asset extension; no replacement visual world. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<main><img src="${mark}" alt=""><h1>AI Checkout</h1></main></body></html>`;
  writeFileSync(resolve(output, 'promo.html'), promo);
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(promo);
  await page.locator('img').evaluate((image) => image.decode());
  await page.screenshot({ path: resolve(output, 'promo-440x280.png') });
  const inspection = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Icon contrast inspection</title><style>body{margin:0;font:16px system-ui}.row{display:flex;gap:48px;align-items:center;min-height:180px;padding:24px;background:#fff}.dark{background:#111827;color:#fff}img{display:block}.sample{text-align:center;min-width:128px}</style><body>${['row', 'row dark'].map((cls) => `<div class="${cls}">${[16, 48, 128].map((size) => `<div class="sample"><img style="margin:auto;width:${size}px;height:${size}px" src="data:image/png;base64,${readFileSync(resolve(root, `extension/public/icons/icon${size}.png`)).toString('base64')}" alt="Cart mark"><p>${size} × ${size}</p></div>`).join('')}</div>`).join('')}</body></html>`;
  await page.setViewportSize({ width: 560, height: 456 });
  await page.setContent(inspection);
  await page.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page.screenshot({ path: resolve(output, 'icon-inspection.png'), fullPage: true });
  // Verify the 128px export has the specified transparent border using browser
  // pixel inspection; no transformations are applied to the resulting bitmap.
  const icon = readFileSync(resolve(root, 'extension/public/icons/icon128.png'));
  const bounds = await page.evaluate(
    async (data) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, 128, 128).data;
      let left = 128,
        top = 128,
        right = -1,
        bottom = -1;
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++)
          if (pixels[(y * 128 + x) * 4 + 3]) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
      return { left, top, right, bottom };
    },
    `data:image/png;base64,${icon.toString('base64')}`,
  );
  if (JSON.stringify(bounds) !== JSON.stringify({ left: 16, top: 16, right: 111, bottom: 111 }))
    throw new Error('Unexpected icon artwork bounds');
  writeFileSync(
    resolve(output, 'brand-evidence.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        browser: browser.version(),
        source: 'extension/assets/cart-mark.svg',
        sourceSha256: createHash('sha256').update(svg).digest('hex'),
        icon128AlphaBounds: bounds,
        note: 'New vector cart geometry; transparent square-icon padding; no text in toolbar icon. Review artwork before submission.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Rendered three icon sizes, 440×280 promotion and light/dark inspection. Icon bounds verified.',
  );
} finally {
  await browser.close();
}
