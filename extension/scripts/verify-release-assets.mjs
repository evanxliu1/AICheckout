/* global document, innerWidth */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..'),
  assets = resolve(root, 'docs/release/assets');
const inspection = resolve(process.env.MEDIA_INSPECTION_DIR ?? '/tmp/aicheckout-release-media-inspection');
mkdirSync(inspection, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(assets, 'assets-manifest.json'), 'utf8'));
const inventory = JSON.parse(
  readFileSync(resolve(root, 'extension/artifacts/ai-checkout-2.0.0.inventory.json'), 'utf8'),
);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
assert(manifest.artifactSha256 === inventory.sha256, 'Media and ZIP versions differ');
assert(
  hash(readFileSync(resolve(root, 'extension/artifacts/ai-checkout-2.0.0.zip'))) === inventory.sha256,
  'ZIP hash differs',
);
for (const entry of inventory.files)
  assert(
    hash(readFileSync(resolve(root, 'extension/dist', entry.path))) === entry.sha256,
    `Build changed: ${entry.path}`,
  );
assert(manifest.frames.length === 6, 'Expected six store screenshots');
for (const item of [...manifest.frames, manifest.promotional]) {
  const data = readFileSync(resolve(assets, item.file));
  assert(hash(data) === item.sha256, `Changed image: ${item.file}`);
  assert(
    data.readUInt32BE(16) === item.width && data.readUInt32BE(20) === item.height,
    `Wrong dimensions: ${item.file}`,
  );
  assert(data[24] === 8 && data[25] === 2, `Expected opaque 24-bit RGB PNG: ${item.file}`);
  if (item.capture)
    assert(
      hash(readFileSync(resolve(assets, item.capture))) === item.captureSha256,
      'Changed native capture',
    );
}
for (const media of [manifest.recording, manifest.recording.composed])
  assert(hash(readFileSync(resolve(assets, media.file))) === media.sha256, 'Changed recording');
const mime = {
  '.html': 'text/html',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
  '.md': 'text/plain',
};
const server = createServer((request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = realpathSync(resolve(assets, `.${requested === '/' ? '/index.html' : requested}`));
    if (!path.startsWith(realpathSync(assets) + sep)) throw new Error('Outside asset directory');
    response.writeHead(200, {
      'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Gallery horizontal overflow',
    );
    await page.screenshot({ path: resolve(inspection, `gallery-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const video = page.locator('video');
  const playback = await video.evaluate(async (video) => {
    if (video.readyState < 1)
      await new Promise((done, reject) => {
        video.addEventListener('loadedmetadata', done, { once: true });
        video.addEventListener('error', reject, { once: true });
      });
    await video.play();
    await new Promise((done) => {
      const check = () => (video.currentTime > 0.25 ? done() : setTimeout(check, 50));
      check();
    });
    video.pause();
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      time: video.currentTime,
    };
  });
  assert(playback.width === 960 && playback.height === 720 && playback.time > 0, 'MP4 cannot play');
  assert(
    Math.abs(playback.duration - manifest.recording.composed.durationSeconds) < 0.2,
    'Video duration changed',
  );
  const cues = await video.evaluate(async (video) => {
    const track = video.querySelector('track');
    if (track.readyState !== 2)
      await new Promise((done, reject) => {
        track.addEventListener('load', done, { once: true });
        track.addEventListener('error', reject, { once: true });
      });
    return track.track.cues?.length ?? 0;
  });
  assert(
    cues === JSON.parse(readFileSync(resolve(assets, 'demo-chapters.json'), 'utf8')).chapters.length,
    'Caption cues missing',
  );
  assert(errors.length === 0, `Gallery page errors: ${errors.join(', ')}`);
  for (const second of [1, 14, 25, 35])
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(second),
      '-i',
      resolve(assets, 'shopper-demo.mp4'),
      '-frames:v',
      '1',
      resolve(inspection, `video-${second}.png`),
    ]);
  writeFileSync(
    resolve(assets, 'verification.json'),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        browser: browser.version(),
        artifactSha256: inventory.sha256,
        screenshots: 'Five opaque RGB PNGs, 640×400; source hashes match native captures.',
        promotion: 'Opaque RGB PNG, 440×280.',
        gallery: { widths: [1280, 390], horizontalOverflow: false, pageErrors: errors },
        video: { ...playback, captionCues: cues },
        scope:
          'Local static gallery/playback and artifact checks. This does not validate store submission or live retailer/model behavior.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Verified image formats, artifact hashes, desktop/mobile gallery, MP4 playback and ${cues} caption cues.`,
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
