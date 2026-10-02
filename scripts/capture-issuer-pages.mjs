// Capture issuer pages as plain text for the extraction corpus.
//
//   node scripts/capture-issuer-pages.mjs [--dir evals/curation/real] [--only id,id]
//     [--sources sources.json] [--captures captures] [--manifest manifest.json]
//
// Reads <dir>/sources.json, saves each page's rendered text to <dir>/captures/<id>.txt (gitignored: issuer
// text is copyrighted), and records URL, date, SHA-256, and length in <dir>/manifest.json (committed).
// The merchant MCC pages the catalog cites are captured the same way into separate files, so the eval
// corpus (sources.json and manifest.json are bound into its hash) is untouched:
//
//   node scripts/capture-issuer-pages.mjs --sources merchant-sources.json \
//     --captures merchant-captures --manifest merchant-manifest.json
// HTML pages are rendered in headless Chromium with collapsed sections expanded; PDFs go through Ghostscript.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/real' },
    only: { type: 'string' },
    sources: { type: 'string', default: 'sources.json' },
    captures: { type: 'string', default: 'captures' },
    manifest: { type: 'string', default: 'manifest.json' },
  },
});
const dir = resolve(root, values.dir);
const { sources } = JSON.parse(await readFile(join(dir, values.sources), 'utf8'));
const captures = join(dir, values.captures);
const only = values.only ? new Set(values.only.split(',')) : null;
const today = new Date().toISOString().slice(0, 10);
const BOT_WALL =
  /access denied|captcha|unusual (traffic|activity)|are you a robot|request (was )?blocked|verify you are human|enable javascript to/i;

/** Line endings to \n, trailing spaces dropped, runs of blank lines collapsed. Words are left exactly as rendered. */
const normalize = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';

async function pdfText(context, url) {
  const response = await context.request.get(url, { timeout: 60_000 });
  if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
  const temp = await mkdtemp(join(tmpdir(), 'capture-pdf-'));
  try {
    await writeFile(join(temp, 'in.pdf'), await response.body());
    const { stdout } = await promisify(execFile)(
      'gs',
      ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=txtwrite', '-sOutputFile=-', join(temp, 'in.pdf')],
      {
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    // txtwrite pads columns with spaces; keep words, collapse the padding.
    return stdout.replace(/[ \t]{2,}/g, ' ');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function pageText(context, source) {
  const page = await context.newPage();
  try {
    const response = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const status = response?.status() ?? 0;
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    // Scroll through the page so lazy sections render. Locators only: some issuer pages disable page.evaluate.
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(120);
    }
    const summaries = page.locator('details:not([open]) > summary');
    for (let i = Math.min(await summaries.count(), 100) - 1; i >= 0; i--)
      await summaries
        .nth(i)
        .click({ timeout: 2000 })
        .catch(() => {});
    // Expand accordions. Links are skipped so expansion never navigates away.
    const collapsed = page.locator('button[aria-expanded="false"], [role="button"][aria-expanded="false"]');
    const count = Math.min(await collapsed.count(), 300);
    for (let i = 0; i < count; i++) {
      const item = collapsed.nth(i);
      if (await item.isVisible().catch(() => false)) await item.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(800);
    return { text: await page.locator('body').innerText(), status };
  } finally {
    await page.close();
  }
}

await mkdir(captures, { recursive: true });
const manifestPath = join(dir, values.manifest);
const previous = await readFile(manifestPath, 'utf8')
  .then((text) => JSON.parse(text).sources)
  .catch(() => []);
const byId = new Map(previous.map((entry) => [entry.id, entry]));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1600 },
  locale: 'en-US',
  bypassCSP: true,
  timezoneId: 'America/New_York',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});
const rows = [];
try {
  for (const source of sources) {
    if (only && !only.has(source.id)) continue;
    const flags = [];
    try {
      const pdf = /\.pdf($|\?)/i.test(source.url);
      const result = pdf
        ? { text: await pdfText(context, source.url), status: 200 }
        : await pageText(context, source);
      const text = normalize(result.text);
      if (result.status >= 400) flags.push(`HTTP ${result.status}`);
      if (text.length < 2000) flags.push('short');
      if (BOT_WALL.test(text.slice(0, 3000))) flags.push('bot-wall?');
      const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      const old = byId.get(source.id);
      if (old && old.sha256 !== sha256) flags.push('CHANGED since last capture');
      await writeFile(join(captures, `${source.id}.txt`), text);
      byId.set(source.id, {
        ...source,
        capturedOn: old?.sha256 === sha256 ? old.capturedOn : today,
        sha256,
        length: text.length,
      });
      rows.push(`${source.id.padEnd(36)} ${String(text.length).padStart(7)} chars ${flags.join('; ')}`);
    } catch (error) {
      rows.push(
        `${source.id.padEnd(36)} FAILED: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      );
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
}
const order = sources.map((source) => source.id);
const manifest = {
  schemaVersion: 1,
  sources: [...byId.values()]
    .filter((entry) => order.includes(entry.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(rows.join('\n'));
