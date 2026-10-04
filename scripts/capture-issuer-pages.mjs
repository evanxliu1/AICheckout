// Capture issuer pages as plain text for the extraction corpus.
//
//   node scripts/capture-issuer-pages.mjs [--dir evals/curation/real] [--only id,id]
//     [--sources sources.json] [--captures captures] [--manifest manifest.json]
//     [--delay-ms 0] [--hints hints.json] [--report report.json] [--protect id,id] [--renderer renderer.json]
//
// Reads <dir>/sources.json, saves each page's rendered text to <dir>/captures/<id>.txt (gitignored: issuer
// text is copyrighted), and records URL, date, SHA-256, and length in <dir>/manifest.json (committed).
// The merchant MCC pages the catalog cites are captured the same way into separate files, so the eval
// corpus (sources.json and manifest.json are bound into its hash) is untouched:
//
//   node scripts/capture-issuer-pages.mjs --sources merchant-sources.json \
//     --captures merchant-captures --manifest merchant-manifest.json
// HTML pages are rendered in headless Chromium with collapsed sections expanded; PDFs go through Ghostscript
// (also when a URL without a .pdf extension turns out to be a download).
//
// `--delay-ms` waits between pages. `--hints` names a JSON file of per-source capture hints,
// `{ "<sourceId>": { "waitFor": "text", "click": ["button text", ...], "pdf": true, "request": true } }`:
// `click` expands controls whose accessible name matches (never links, never forms), `waitFor` waits until
// that text is on the page, `request` fetches the HTML without the browser (for hosts that block headless
// Chromium but serve static HTML) and renders it with scripts and subresources off. `--report` writes each source's status and flags as JSON. `--protect` lists
// sources whose existing capture must never be overwritten with other text (the pipeline's capture gate): a changed
// page is reported as failed (`changed-capture-kept`) and the old capture and manifest entry stay. `--renderer` writes
// the Playwright and Chromium versions as JSON (`pipeline freshness` records them). `--sources`, `--captures`,
// `--manifest`, `--report` and `--renderer` are relative to `--dir` unless absolute (scripts/lib/capture-paths.mjs).
// Defaults change nothing for the existing corpus.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { CHANGED_CAPTURE_KEPT, keepExistingCapture } from './lib/capture-guard.mjs';
import { capturePaths } from './lib/capture-paths.mjs';
import { revealStaticHtml } from './lib/static-html.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/real' },
    only: { type: 'string' },
    sources: { type: 'string', default: 'sources.json' },
    captures: { type: 'string', default: 'captures' },
    manifest: { type: 'string', default: 'manifest.json' },
    'delay-ms': { type: 'string', default: '0' },
    hints: { type: 'string' },
    report: { type: 'string' },
    protect: { type: 'string' },
    renderer: { type: 'string' },
  },
});
const protectedIds = new Set(values.protect ? values.protect.split(',') : []);
const delayMs = Number(values['delay-ms']);
const paths = capturePaths(root, values);
const hints = paths.hints ? JSON.parse(await readFile(paths.hints, 'utf8')) : {};
const { sources } = JSON.parse(await readFile(paths.sources, 'utf8'));
const captures = paths.captures;
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

/** Thrown when navigation starts a download (a PDF served without a .pdf URL). */
class DownloadStarted extends Error {}

async function pageText(context, source, hint = {}) {
  const page = await context.newPage();
  try {
    let response;
    try {
      response = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (error) {
      if (error instanceof Error && /download is starting/i.test(error.message)) throw new DownloadStarted();
      throw error;
    }
    if (/application\/pdf/i.test(response?.headers()['content-type'] ?? '')) throw new DownloadStarted();
    const status = response?.status() ?? 0;
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    if (hint.waitFor)
      await page
        .getByText(hint.waitFor)
        .first()
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
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
    // Hinted controls last, so the generic expansion above cannot toggle what they opened.
    for (const name of hint.click ?? []) {
      // A button with that name, or an element whose whole text is that name; never a link.
      const control = page
        .getByRole('button', { name })
        .or(page.getByText(name, { exact: true }).locator('xpath=self::*[not(self::a)]'))
        .first();
      await control.click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    }
    await page.waitForTimeout(800);
    return { text: await page.locator('body').innerText(), status };
  } finally {
    await page.close();
  }
}

/** Fetch static HTML outside the browser and take its rendered text with scripts and subresources disabled. */
async function requestText(browser, context, url) {
  const response = await context.request.get(url, {
    timeout: 60_000,
    headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
  });
  const html = revealStaticHtml(await response.text());
  const offline = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await offline.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return { text: await page.locator('body').innerText(), status: response.status() };
  } finally {
    await offline.close();
  }
}

await mkdir(captures, { recursive: true });
const manifestPath = paths.manifest;
const previous = await readFile(manifestPath, 'utf8')
  .then((text) => JSON.parse(text).sources)
  .catch(() => []);
const byId = new Map(previous.map((entry) => [entry.id, entry]));

const browser = await chromium.launch({ headless: true });
if (paths.renderer)
  await writeFile(
    paths.renderer,
    JSON.stringify({
      playwright: createRequire(import.meta.url)('@playwright/test/package.json').version,
      chromium: browser.version(),
    }) + '\n',
  );
const context = await browser.newContext({
  viewport: { width: 1280, height: 1600 },
  locale: 'en-US',
  bypassCSP: true,
  timezoneId: 'America/New_York',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});
const rows = [];
const report = [];
let first = true;
try {
  for (const source of sources) {
    if (only && !only.has(source.id)) continue;
    if (!first && delayMs > 0) await new Promise((done) => setTimeout(done, delayMs));
    first = false;
    const flags = [];
    const hint = hints[source.id] ?? {};
    try {
      const pdf = hint.pdf === true || /\.pdf($|\?)/i.test(source.url);
      const result = pdf
        ? { text: await pdfText(context, source.url), status: 200 }
        : hint.request === true
          ? await requestText(browser, context, source.url)
          : await pageText(context, source, hint).catch(async (error) => {
              if (!(error instanceof DownloadStarted)) throw error;
              flags.push('pdf download');
              return { text: await pdfText(context, source.url), status: 200 };
            });
      const text = normalize(result.text);
      if (result.status >= 400) flags.push(`HTTP ${result.status}`);
      if (text.length < 2000) flags.push('short');
      if (BOT_WALL.test(text.slice(0, 3000))) flags.push('bot-wall?');
      const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      const old = byId.get(source.id);
      if (old && old.sha256 !== sha256) flags.push('CHANGED since last capture');
      const existingBody = await readFile(join(captures, `${source.id}.txt`), 'utf8').catch(() => null);
      if (keepExistingCapture({ protectedIds, id: source.id, existingBody, newSha256: sha256 })) {
        if (!flags.includes('CHANGED since last capture')) flags.push('CHANGED since last capture');
        rows.push(`${source.id.padEnd(36)} KEPT: the page changed; the existing capture is not overwritten`);
        report.push({ id: source.id, ok: false, error: CHANGED_CAPTURE_KEPT, status: result.status, flags });
        process.exitCode = 1;
        continue;
      }
      await writeFile(join(captures, `${source.id}.txt`), text);
      byId.set(source.id, {
        ...source,
        capturedOn: old?.sha256 === sha256 ? old.capturedOn : today,
        sha256,
        length: text.length,
      });
      rows.push(`${source.id.padEnd(36)} ${String(text.length).padStart(7)} chars ${flags.join('; ')}`);
      report.push({ id: source.id, ok: true, status: result.status, length: text.length, flags });
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      rows.push(`${source.id.padEnd(36)} FAILED: ${message}`);
      report.push({ id: source.id, ok: false, error: message, flags });
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
if (paths.report) await writeFile(paths.report, JSON.stringify(report, null, 2) + '\n');
console.log(rows.join('\n'));
