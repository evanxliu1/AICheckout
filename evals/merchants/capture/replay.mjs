// The reader's replay hook (Phase 13 uses it; nothing in the capture tool calls it). It checks a snapshot folder
// against its manifest, then loads page.mhtml in a fresh page of a Playwright browser with every network request
// blocked. Scripts do not run in an MHTML document; stylesheets and open shadow roots are restored, so a reader reads
// computed styles lazily from the live layout. This file contains no reader logic.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './snapshot.mjs';

/** Verify every file hash in manifest.json. Returns { manifest, manifestSha256 }; throws on any mismatch. */
export async function verifySnapshot(dir) {
  const raw = await readFile(path.join(dir, 'manifest.json'));
  const manifest = JSON.parse(raw.toString('utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (name.includes('/') || name.includes('\\')) throw new Error(`bad file name in manifest: ${name}`);
    const actual = sha256(await readFile(path.join(dir, name)));
    if (actual !== expected) throw new Error(`hash mismatch for ${name} in ${dir}`);
  }
  return { manifest, manifestSha256: sha256(raw) };
}

/**
 * Open a verified snapshot for reading. `browser` is a Playwright Browser (Chromium). Pass `expectedManifestSha256`
 * (from sites.json or the frozen labels) to refuse a snapshot that differs from the one labelled.
 * Returns { page, context, manifest }; the caller closes the context.
 */
export async function openReplay(browser, dir, { expectedManifestSha256, viewport } = {}) {
  const { manifest, manifestSha256 } = await verifySnapshot(dir);
  if (expectedManifestSha256 && expectedManifestSha256 !== manifestSha256)
    throw new Error(`snapshot manifest ${manifestSha256} is not the expected ${expectedManifestSha256}`);
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  const context = await browser.newContext({
    viewport: viewport ?? meta.viewport ?? undefined,
    javaScriptEnabled: true,
    serviceWorkers: 'block',
  });
  const fileUrl = pathToFileURL(path.join(dir, 'page.mhtml')).href;
  await context.route('**/*', (route) =>
    route.request().url() === fileUrl ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(fileUrl, { waitUntil: 'load' });
  return { page, context, manifest };
}
