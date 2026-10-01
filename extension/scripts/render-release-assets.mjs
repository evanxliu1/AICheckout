/* global document */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..'),
  output = resolve(root, 'docs/release/assets');
const capture = JSON.parse(readFileSync(resolve(output, 'capture-manifest.json'), 'utf8'));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const scenes = [
  {
    name: 'wallet',
    title: 'Your cards. Your choice.',
    copy: 'Select the products you already own. No card numbers or bank connection.',
    alt: 'Actual wallet selection: seven card products grouped by issuer, all selected, with zero sample online retail spend.',
  },
  {
    name: 'comparison',
    title: 'Compare a $100 purchase.',
    copy: 'For this sample: eligible online goods and $0 annual spend. Actual rewards depend on issuer terms.',
    alt: 'Actual result for a sample $100 eligible Best Buy purchase: Blue Cash Everyday $3.00 on U.S. online retail purchases, then Double Cash and Active Cash $2.00.',
  },
  {
    name: 'uncertainty',
    title: 'Keep unknowns visible.',
    copy: 'Leave annual spend blank to see a reward range. Confirming the conditions can change which card comes first.',
    alt: 'Actual result with unknown annual spend: Blue Cash Everyday ranges from $1.00 to $3.00, so Double Cash leads at $2.00 and the order may change.',
  },
  {
    name: 'subtotal',
    title: 'Know what the amount includes.',
    copy: 'The sample cart has no final total. Its subtotal estimate excludes tax and shipping.',
    alt: 'Actual Newegg fixture result explicitly labels a $249.99 subtotal and excludes tax and shipping.',
  },
  {
    name: 'locked',
    title: 'Lock your saved inputs.',
    copy: 'A local passphrase protects saved inputs. Unlock after restarting Chrome, or delete and start again if you forget it.',
    alt: 'Actual locked popup asks for the local passphrase and exposes data details and deletion.',
  },
];
const icon = `data:image/png;base64,${readFileSync(resolve(root, 'extension/public/icons/icon128.png')).toString('base64')}`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
  for (const [index, scene] of scenes.entries()) {
    const frame = capture.frames.find((frame) => frame.name === scene.name);
    if (!frame) throw new Error(`Missing actual capture: ${scene.name}`);
    const bytes = readFileSync(resolve(output, `captures/${scene.name}.png`));
    if (hash(bytes) !== frame.sha256) throw new Error(`Capture hash changed: ${scene.name}`);
    const img = `data:image/png;base64,${bytes.toString('base64')}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(scene.title)} — AI Checkout</title><style>
*{box-sizing:border-box}html,body{margin:0;width:640px;height:400px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{display:grid;grid-template-columns:280px 360px;width:640px;height:400px;background:#1d4ed8;color:#fff}.copy{position:relative;padding:24px}header{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:600}header img{width:32px;height:32px}.story{margin-top:30px}h1{margin:0;font-size:28px;line-height:1.14;letter-spacing:-.025em;font-weight:650}p{margin:16px 0 0;font-size:15px;line-height:1.5;color:#dbeafe}.note{position:absolute;left:24px;right:24px;bottom:20px;margin:0;font-size:12px;line-height:1.4;color:#dbeafe}.actual{width:360px;height:400px;overflow:hidden;background:#f9fafb;}.actual img{display:block;width:360px;height:auto;max-width:none}</style></head>
<body><!-- THESIS: show one actual feature with its conditions and honest sample data. OWN-WORLD: incumbent blue, white, system type and real popup pixels. STORY: understand the capability and inspect it. FIRST VIEWPORT: blue explanatory column beside a 1:1 CSS-pixel native popup detail. FORM: existing brand and interface, not a redesign. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<main><section class="copy"><header><img src="${icon}" alt="">AI Checkout</header><div class="story"><h1>${escape(scene.title)}</h1><p>${escape(scene.copy)}</p></div><p class="note">Actual popup detail.<br>Sample inputs; not earned rewards.</p></section><div class="actual"><img src="${img}" alt="${escape(scene.alt)}"></div></main></body></html>`;
    await page.setContent(html);
    await page.locator('img').evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
    const fits = await page.evaluate(() => {
      const story = document.querySelector('.story').getBoundingClientRect(),
        note = document.querySelector('.note').getBoundingClientRect();
      return story.bottom + 12 <= note.top && document.documentElement.scrollWidth === 640;
    });
    if (!fits) throw new Error(`Asset copy overflows: ${scene.name}`);
    const file = `${index + 1}-${scene.name}-640x400.png`;
    writeFileSync(resolve(output, `${scene.name}.html`), html);
    await page.screenshot({ path: resolve(output, file) });
    const rendered = readFileSync(resolve(output, file));
    if (rendered.readUInt32BE(16) !== 640 || rendered.readUInt32BE(20) !== 400)
      throw new Error('Wrong screenshot dimensions');
    results.push({
      file,
      sha256: hash(rendered),
      bytes: rendered.length,
      width: 640,
      height: 400,
      capture: `captures/${scene.name}.png`,
      captureSha256: frame.sha256,
      composition:
        'Actual native capture at 360 CSS pixels wide; top 400 CSS pixels shown without text or geometry alteration. Explanatory left panel is presentation, not application UI.',
      alt: scene.alt,
    });
  }
  const chapters = JSON.parse(readFileSync(resolve(output, 'demo-chapters.json'), 'utf8'));
  const videoPath = resolve(output, 'shopper-demo.webm');
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,width,height',
        '-of',
        'json',
        videoPath,
      ],
      { encoding: 'utf8' },
    ),
  );
  const duration = Number(probe.format.duration);
  if (!Number.isFinite(duration) || duration < chapters.chapters.at(-1).atSeconds + 3)
    throw new Error('Recording ended before the final demonstration step');
  const captionDir = resolve(output, 'video-captions');
  mkdirSync(captionDir, { recursive: true });
  const videoPage = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const concat = ['ffconcat version 1.0'];
  for (const [index, chapter] of chapters.chapters.entries()) {
    const start = index === 0 ? 0 : chapter.atSeconds,
      end = chapters.chapters[index + 1]?.atSeconds ?? duration;
    const captionHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Demo caption</title><style>*{box-sizing:border-box}html,body{margin:0;width:960px;height:720px;background:#1d4ed8;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:48px;width:560px}header{font-size:24px;font-weight:600}h1{font-size:38px;line-height:1.15;margin:48px 0 32px;letter-spacing:-.02em}p{font-size:24px;line-height:1.5;margin:0;color:#dbeafe}.scope{position:absolute;bottom:44px;left:48px;width:460px;font-size:16px;line-height:1.5;color:#dbeafe}</style><body><main><header>AI Checkout</header><h1>Offline shopper demo</h1><p>${escape(chapter.caption)}</p><p class="scope">Synthetic inputs · no live retailer or model call.<br>Actual extension page at its original size.</p></main></body></html>`;
    await videoPage.setContent(captionHtml);
    const fits = await videoPage.evaluate(
      () =>
        document.querySelector('main > p:not(.scope)').getBoundingClientRect().bottom + 20 <=
        document.querySelector('.scope').getBoundingClientRect().top,
    );
    if (!fits) throw new Error(`Video caption overflow: ${index}`);
    const file = `caption-${String(index).padStart(2, '0')}.png`;
    await videoPage.screenshot({ path: resolve(captionDir, file) });
    concat.push(`file '${file}'`, `duration ${(end - start).toFixed(3)}`);
  }
  concat.push(`file 'caption-${String(chapters.chapters.length - 1).padStart(2, '0')}.png'`);
  writeFileSync(resolve(captionDir, 'timeline.ffconcat'), concat.join('\n') + '\n');
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      resolve(captionDir, 'timeline.ffconcat'),
      '-i',
      videoPath,
      '-filter_complex',
      '[0:v]fps=25[bg];[bg][1:v]overlay=576:60:shortest=1,format=yuv420p[v]',
      '-map',
      '[v]',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-r',
      '25',
      '-movflags',
      '+faststart',
      resolve(output, 'shopper-demo.mp4'),
    ],
    { stdio: 'pipe' },
  );
  const composedProbe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,width,height',
        '-of',
        'json',
        resolve(output, 'shopper-demo.mp4'),
      ],
      { encoding: 'utf8' },
    ),
  );
  if (
    composedProbe.streams[0].width !== 960 ||
    composedProbe.streams[0].height !== 720 ||
    composedProbe.streams[0].codec_name !== 'h264' ||
    Math.abs(Number(composedProbe.format.duration) - duration) > 0.2
  )
    throw new Error('Encoded video validation failed');
  const timestamp = (seconds) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  const captions = chapters.chapters
    .map(
      (chapter, index) =>
        `${index + 1}\n${timestamp(chapter.atSeconds)} --> ${timestamp(chapters.chapters[index + 1]?.atSeconds ?? chapter.atSeconds + 4)}\n${chapter.caption}`,
    )
    .join('\n\n');
  writeFileSync(resolve(output, 'shopper-demo.vtt'), `WEBVTT\n\n${captions}\n`);
  const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Checkout release media</title><style>
*{box-sizing:border-box}body{margin:0;background:#f9fafb;color:#111827;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:960px;margin:auto;padding:32px 24px}h1{font-size:32px;line-height:1.2}h2{font-size:22px;margin:40px 0 12px}p{max-width:72ch}a{color:#1d4ed8}figure{margin:0}figure img{display:block;width:100%;max-width:640px;height:auto}figcaption{margin:8px 0 24px;font-size:14px;color:#4b5563}.promo{max-width:440px}video{width:960px;max-width:100%;height:auto;background:#fff}.transcript{max-width:72ch}.transcript li{margin-bottom:12px}code{overflow-wrap:anywhere}a:focus-visible,video:focus-visible{outline:2px solid #1d4ed8;outline-offset:3px}@media(max-width:700px){main{padding:20px 16px}h1{font-size:28px}}</style></head><body><main>
<h1>AI Checkout release media</h1><p>Reviewable assets for extension 2.0.0. These use the actual packaged interface and synthetic inputs. The Newegg scene uses a controlled fixture. Nothing here establishes customer savings, a live retailer check, deployment, model accuracy or store approval.</p><p>Artifact SHA-256: <code>${capture.artifactSha256}</code>. The current catalog expires October 25, 2026 UTC; reverify terms and recapture before publishing an updated build.</p>
${results.map((result, index) => `<section><h2>${escape(scenes[index].title)}</h2><figure><a href="${result.file}"><img src="${result.file}" alt="${escape(result.alt)}"></a><figcaption>640 × 400. Actual popup detail with a presentation caption. <a href="${result.capture}">Full original native capture</a>.</figcaption></figure></section>`).join('')}
<section><h2>Promotional image</h2><figure class="promo"><a href="promo-440x280.png"><img src="promo-440x280.png" alt="AI Checkout cart mark and name on the blue brand background"></a><figcaption>440 × 280; a brand image, not a product screenshot.</figcaption></figure><p><a href="icon-inspection.png">Inspect 16, 48 and 128px icons on light and dark backgrounds</a>.</p></section>
<section><h2>Offline shopper walkthrough</h2><p>Actual 360 × 600 extension-page recording, placed at its original size beside explanatory captions in a 960 × 720 video. It demonstrates manual comparison, uncertainty, locking and deletion with sample inputs. It is separate from the native-toolbar captures above. There is no audio narration; visible captions and the transcript identify each step.</p><div class="demo"><video controls preload="metadata"><source src="shopper-demo.mp4" type="video/mp4"><track default kind="captions" src="shopper-demo.vtt" srclang="en" label="English"></video><ol class="transcript">${chapters.chapters.map((chapter) => `<li><strong>${timestamp(chapter.atSeconds).slice(3, 8)}</strong> ${escape(chapter.caption)}</li>`).join('')}</ol></div><p><a href="shopper-demo.mp4">MP4 recording</a> · <a href="shopper-demo.vtt">Captions</a> · <a href="assets-manifest.json">Asset provenance</a></p></section>
<p>The separate <a href="full-stack-demo.md">full-stack recording and transcript</a> show the actual local review/API/database flow with simulated model responses. Hosted deployment and live model evaluation remain pending. See <a href="../portfolio-demo.md">the portfolio evidence plan</a> and <a href="../README.md">remaining release requirements</a>.</p></main></body></html>`;
  writeFileSync(resolve(output, 'index.html'), gallery);
  const promo = readFileSync(resolve(output, 'promo-440x280.png'));
  writeFileSync(
    resolve(output, 'assets-manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        artifactSha256: capture.artifactSha256,
        sourceCaptureManifest: 'capture-manifest.json',
        frames: results,
        promotional: { file: 'promo-440x280.png', width: 440, height: 280, sha256: hash(promo) },
        recording: {
          file: 'shopper-demo.webm',
          sha256: hash(readFileSync(resolve(output, 'shopper-demo.webm'))),
          bytes: statSync(resolve(output, 'shopper-demo.webm')).size,
          kind: chapters.kind,
          chapters: 'demo-chapters.json',
          captions: 'shopper-demo.vtt',
          composed: {
            file: 'shopper-demo.mp4',
            sha256: hash(readFileSync(resolve(output, 'shopper-demo.mp4'))),
            bytes: statSync(resolve(output, 'shopper-demo.mp4')).size,
            width: 960,
            height: 720,
            durationSeconds: Number(composedProbe.format.duration),
            codec: 'h264',
            layout:
              'Unscaled 360×600 interaction recording plus persistent scope label and timed explanation.',
          },
        },
        limits: [
          'Synthetic inputs, not observed users or savings.',
          'Native captures use a controlled Newegg fixture.',
          'Screen recording uses the extension page, not a native toolbar popup.',
          'No live model call, deployment or store submission.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Rendered five 640×400 store screenshots, captions, gallery and asset provenance.');
} finally {
  await browser.close();
}
