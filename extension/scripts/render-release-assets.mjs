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
// Store screenshots: 1280×800, one image pixel per CSS pixel. The left 400 px are presentation; the right
// 880×800 are the untouched capture (a window capture fills them; the 360×600 popup page sits centred).
const IMAGE = { width: 1280, height: 800 },
  PANEL = 400;
const POPUP_NOTE = 'Actual popup page at its 360×600 size.';
const WINDOW_NOTE = 'Actual extension in an 880×800 window.';
const scenes = [
  {
    name: 'wallet',
    kind: 'popup',
    title: 'Your cards. Your choice.',
    copy: 'Search 178 cards by name or bank and add the ones you own. No card numbers or bank login.',
    alt: 'Actual card editor in the popup: the search field reads “Savor” with three matches listed under Capital One (Savor, Savor Rewards for Students, SavorOne Rewards), above “Cards you own (4)”: Citi Double Cash, Capital One Quicksilver, Chase Freedom Unlimited and American Express Blue Cash Everyday, each with a Remove link.',
    note: POPUP_NOTE,
  },
  {
    name: 'badge',
    kind: 'window',
    title: 'Your best card, on your cart.',
    copy: 'On a cart page the badge names the card that earns the most, and says why the store’s category applies.',
    alt: 'Actual badge panel “Best card for this cart” over a neutral sample cart page (“Your cart”, “Sample cart · 2 items”, Sample item Qty 1, Another sample item Qty 2): “Based on $100.00 cart estimated total at Lidl. Treated as a supermarket (its own pages; fits Bank of America, Chase, Discover and U.S. Bank’s supermarket definition).” An amount field reads 100.00, the payment method is “Card entered at checkout”, then Blue Cash Everyday $3.00 (3%): 3% on “U.S. online retail purchases”; otherwise 1% on “all other eligible purchases”, U.S. merchants only, up to $6,000.00 per year then 1%, “Activation is not mentioned on the issuer’s pages”, “Rules that don’t apply here (1)”; below it Double Cash, $1.00 less, $2.00: 2% on “every purchase”, 2% if the balance is paid (1% at purchase), and a “Rules that don’t apply here (1)” disclosure half hidden by the panel’s own scroll edge above the Dismiss for this tab and Not on this site buttons.',
    note: WINDOW_NOTE,
  },
  {
    name: 'rates',
    kind: 'window',
    title: 'No guess when the amount isn’t certain.',
    copy: 'A gift card is applied here, so the cart amount isn’t read. The badge ranks your cards by rate instead.',
    alt: 'Actual badge panel “Best card for this cart” over a neutral sample cart page (“Your cart”, “Sample cart · 2 items”, two sample items and the top of an “Order summary” box): “The cart amount wasn’t read on this page. Each card’s rate doesn’t depend on it, so the best card is the same at any amount, unless a condition below applies. A spend cap on one of these cards could change the order at your cart’s amount.” Then the cards by rate: Blue Cash Everyday 3% back, Double Cash 2% back, Quicksilver 1.5% back, Freedom Unlimited 1.5% back; an optional amount field, the payment method, the line “A tap sends only this store’s domain (for example example.com) so it can be added”, a “Store not recognised? Suggest it” link, and the Dismiss for this tab and Not on this site buttons.',
    note: WINDOW_NOTE,
  },
  {
    name: 'comparison',
    kind: 'popup',
    title: 'The rule in the issuer’s words.',
    copy: 'Compare any amount at any store. Each estimate quotes the issuer’s rule and shows its conditions.',
    alt: 'Actual popup result “Use Blue Cash Everyday. Saved estimate for a $100.00 Another U.S. online store purchase.” Blue Cash Everyday $3.00 (3%): 3% on “U.S. online retail purchases”; otherwise 1% on “all other eligible purchases”, with the conditions U.S. merchants only and up to $6,000.00 per year then 1%, “Activation is not mentioned on the issuer’s pages” and “Rules that don’t apply here (2)”; below it Double Cash, $1.00 less, $2.00: 2% on “every purchase”, 2% if the balance is paid (1% at purchase), “Rules that don’t apply here (1)”.',
    note: POPUP_NOTE,
  },
  {
    name: 'consent',
    kind: 'window',
    title: 'Usage reports only if you say so.',
    copy: 'One question after setup. The extension works the same either way, and nothing is sent before you choose Share.',
    alt: 'Actual onboarding screen “Help improve AI Checkout” under the heading “Welcome to AI Checkout. The best card you already own, shown right on your cart.” It says “Share usage reports so the reader, the store list and the recommendations get better. The extension works the same either way.”, lists what is sent after you choose Share (how you use it, each recommendation, the cards you picked as catalog names, error codes, a random identifier with no name, email or browsing history), says no store name, web address or page text is sent and that a store’s domain is sent only when you tap Suggest this store or Report a problem, that reports are kept for 90 days with a Privacy policy link, and ends with two equal buttons, Share and Not now.',
    note: WINDOW_NOTE,
  },
];
// Ocean theme presentation type: the same self-hosted fonts the extension bundles (SIL OFL 1.1).
const font = (pkg, file) =>
  `data:font/woff2;base64,${readFileSync(resolve(root, 'node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64')}`;
const fonts = `@font-face{font-family:Figtree;font-weight:300 900;src:url(${font('figtree', 'figtree-latin-wght-normal.woff2')}) format("woff2")}@font-face{font-family:Bricolage;font-weight:200 800;src:url(${font('bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2')}) format("woff2")}`;
const icon = `data:image/png;base64,${readFileSync(resolve(root, 'extension/public/icons/icon128.png')).toString('base64')}`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: IMAGE, deviceScaleFactor: 1 });
  for (const [index, scene] of scenes.entries()) {
    const frame = capture.frames.find((frame) => frame.name === scene.name);
    if (!frame) throw new Error(`Missing actual capture: ${scene.name}`);
    const bytes = readFileSync(resolve(output, `captures/${scene.name}.png`));
    if (hash(bytes) !== frame.sha256) throw new Error(`Capture hash changed: ${scene.name}`);
    const expected = scene.kind === 'popup' ? { width: 360, height: 600 } : { width: 880, height: 800 };
    if (frame.width !== expected.width || frame.height !== expected.height || frame.viewport.scale !== 1)
      throw new Error(`Unexpected capture size: ${scene.name}`);
    const img = `data:image/png;base64,${bytes.toString('base64')}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(scene.title)} — AI Checkout</title><style>
${fonts}*{box-sizing:border-box}html,body{margin:0;width:${IMAGE.width}px;height:${IMAGE.height}px;font-family:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{display:grid;grid-template-columns:${PANEL}px ${IMAGE.width - PANEL}px;width:${IMAGE.width}px;height:${IMAGE.height}px;background:#0c2a4d;color:#fff}.copy{position:relative;padding:40px 36px}header{display:flex;align-items:center;gap:10px;font-family:Bricolage,Figtree,sans-serif;font-size:22px;font-weight:700}header img{width:40px;height:40px}.story{margin-top:56px}h1{margin:0;font-family:Bricolage,Figtree,sans-serif;font-size:38px;line-height:1.12;letter-spacing:-.02em;font-weight:700}p{margin:20px 0 0;font-size:19px;line-height:1.5;color:#a9c6ea}.note{position:absolute;left:36px;right:36px;bottom:36px;margin:0;font-size:14px;line-height:1.5;color:#a9c6ea}.actual{width:${IMAGE.width - PANEL}px;height:${IMAGE.height}px;overflow:hidden;background:#eef4fb;display:flex;justify-content:center;align-items:center}.actual img{display:block;max-width:none}.actual img.popup{width:360px;height:600px;box-shadow:0 8px 32px rgba(12,42,77,.18)}.actual img.window{width:880px;height:800px}</style></head>
<body><!-- THESIS: show one actual feature with its conditions and honest sample data. OWN-WORLD: Ocean navy, white, Bricolage and Figtree type and real extension pixels at 1:1. STORY: understand the capability and inspect it. FIRST VIEWPORT: navy explanatory column beside an untouched capture. FORM: existing brand and interface, not a redesign. -->
<main><section class="copy"><header><img src="${icon}" alt="">AI Checkout</header><div class="story"><h1>${escape(scene.title)}</h1><p>${escape(scene.copy)}</p></div><p class="note">${escape(scene.note)}<br>Sample inputs; not earned rewards.</p></section><div class="actual"><img class="${scene.kind}" src="${img}" alt="${escape(scene.alt)}"></div></main></body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('img').evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
    const fits = await page.evaluate(() => {
      const story = document.querySelector('.story').getBoundingClientRect(),
        note = document.querySelector('.note').getBoundingClientRect();
      return story.bottom + 16 <= note.top && document.documentElement.scrollWidth === 1280;
    });
    if (!fits) throw new Error(`Asset copy overflows: ${scene.name}`);
    const file = `${index + 1}-${scene.name}-1280x800.png`;
    writeFileSync(resolve(output, `${scene.name}.html`), html);
    await page.screenshot({ path: resolve(output, file) });
    const rendered = readFileSync(resolve(output, file));
    if (rendered.readUInt32BE(16) !== IMAGE.width || rendered.readUInt32BE(20) !== IMAGE.height)
      throw new Error('Wrong screenshot dimensions');
    results.push({
      file,
      sha256: hash(rendered),
      bytes: rendered.length,
      width: IMAGE.width,
      height: IMAGE.height,
      capture: `captures/${scene.name}.png`,
      captureSha256: frame.sha256,
      composition:
        scene.kind === 'popup'
          ? 'Actual popup page captured at its 360×600 popup size (1 CSS pixel per image pixel), placed whole and centred in the right 880×800; the popup was scrolled (never the pixels) so no line or control is cut at its edges. Explanatory left panel is presentation, not application UI.'
          : 'Actual extension in an 880×800 window (1 CSS pixel per image pixel), filling the right 880×800 untouched. Explanatory left panel is presentation, not application UI.',
      alt: scene.alt,
    });
  }
  const chapters = JSON.parse(readFileSync(resolve(output, 'demo-chapters.json'), 'utf8'));
  if (chapters.artifactSha256 !== capture.artifactSha256)
    throw new Error('Recording and captures come from different artifacts');
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
  // The composed video: 1280×720, a caption column on the left, the 880×660 recording at its size on the right.
  const VIDEO = { width: 1280, height: 720 },
    recording = chapters.viewport,
    overlay = { x: VIDEO.width - recording.width - 20, y: (VIDEO.height - recording.height) / 2 };
  if (probe.streams[0].width !== recording.width || probe.streams[0].height !== recording.height)
    throw new Error('Recording size differs from its chapters file');
  const captionDir = resolve(output, 'video-captions');
  mkdirSync(captionDir, { recursive: true });
  const videoPage = await browser.newPage({ viewport: VIDEO, deviceScaleFactor: 1 });
  const concat = ['ffconcat version 1.0'];
  for (const [index, chapter] of chapters.chapters.entries()) {
    const start = index === 0 ? 0 : chapter.atSeconds,
      end = chapters.chapters[index + 1]?.atSeconds ?? duration;
    const captionHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Demo caption</title><style>${fonts}*{box-sizing:border-box}html,body{margin:0;width:${VIDEO.width}px;height:${VIDEO.height}px;background:#0c2a4d;color:#fff;font-family:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:36px 32px;width:${overlay.x}px}header{font-family:Bricolage,Figtree,sans-serif;font-size:20px;font-weight:700}h1{font-family:Bricolage,Figtree,sans-serif;font-size:28px;font-weight:700;line-height:1.15;margin:32px 0 20px;letter-spacing:-.02em}p{font-size:18px;line-height:1.5;margin:0;color:#a9c6ea}.scope{position:absolute;bottom:32px;left:32px;width:${overlay.x - 64}px;font-size:13px;line-height:1.5;color:#a9c6ea}</style><body><main><header>AI Checkout</header><h1>Staged shopper demo</h1><p>${escape(chapter.caption)}</p><p class="scope">Synthetic inputs · no live store, model call or report sent.<br>Actual extension at its original size.</p></main></body></html>`;
    await videoPage.setContent(captionHtml);
    await videoPage.evaluate(() => document.fonts.ready);
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
      `[0:v]fps=25[bg];[bg][1:v]overlay=${overlay.x}:${overlay.y}:shortest=1,format=yuv420p[v]`,
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
    composedProbe.streams[0].width !== VIDEO.width ||
    composedProbe.streams[0].height !== VIDEO.height ||
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
*{box-sizing:border-box}body{margin:0;background:#f9fafb;color:#111827;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:960px;margin:auto;padding:32px 24px}h1{font-size:32px;line-height:1.2}h2{font-size:22px;margin:40px 0 12px}p{max-width:72ch}a{color:#1d4ed8}figure{margin:0}figure img{display:block;width:100%;max-width:960px;height:auto}figcaption{margin:8px 0 24px;font-size:14px;color:#4b5563}.promo{max-width:440px}video{width:960px;max-width:100%;height:auto;background:#fff}.transcript{max-width:72ch}.transcript li{margin-bottom:12px}code{overflow-wrap:anywhere}a:focus-visible,video:focus-visible{outline:2px solid #1d4ed8;outline-offset:3px}@media(max-width:700px){main{padding:20px 16px}h1{font-size:28px}}</style></head><body><main>
<h1>AI Checkout release media</h1><p>Reviewable assets for extension 2.1.0 (the hosted build). These use the actual packaged interface, a neutral fictional sample cart and synthetic inputs. The one store the merchant release names (Lidl) appears only as the name the extension renders. Nothing here establishes customer savings, a live store check, model accuracy or store approval.</p><p>Artifact SHA-256: <code>${capture.artifactSha256}</code>. The bundled catalog ${escape(capture.catalogVersion)} expires ${new Date(capture.catalogExpiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })} UTC; reverify terms and recapture before publishing an updated build.</p>
${results.map((result, index) => `<section><h2>${escape(scenes[index].title)}</h2><figure><a href="${result.file}"><img src="${result.file}" alt="${escape(result.alt)}"></a><figcaption>1280 × 800. Actual extension UI at 1 CSS pixel per image pixel with a presentation caption. <a href="${result.capture}">Original capture</a>.</figcaption></figure></section>`).join('')}
<section><h2>Promotional image</h2><figure class="promo"><a href="promo-440x280.png"><img src="promo-440x280.png" alt="AI Checkout cart mark and name on the blue brand background"></a><figcaption>440 × 280; a brand image, not a product screenshot.</figcaption></figure><p><a href="icon-inspection.png">Inspect 16, 48 and 128px icons on light and dark backgrounds</a>.</p></section>
<section><h2>Staged shopper walkthrough</h2><p>Actual ${recording.width} × ${recording.height} recording of one tab, placed at its original size beside explanatory captions in a ${VIDEO.width} × ${VIDEO.height} video: the first run with the consent question, the badge on a sample cart at a store the release names, the rates view where a gift card makes the amount uncertain, and the popup comparison. There is no audio narration; visible captions and the transcript identify each step.</p><div class="demo"><video controls preload="metadata"><source src="shopper-demo.mp4" type="video/mp4"><track default kind="captions" src="shopper-demo.vtt" srclang="en" label="English"></video><ol class="transcript">${chapters.chapters.map((chapter) => `<li><strong>${timestamp(chapter.atSeconds).slice(3, 8)}</strong> ${escape(chapter.caption)}</li>`).join('')}</ol></div><p><a href="shopper-demo.mp4">MP4 recording</a> · <a href="shopper-demo.vtt">Captions</a> · <a href="assets-manifest.json">Asset provenance</a></p></section>
<p>The separate <a href="full-stack-demo.md">full-stack recording and transcript</a> (2026-10-03, extension 2.0.0 era) show the local review/API/database flow with simulated model responses; the curation side is unchanged by this release. See <a href="../README.md">remaining release requirements</a>.</p></main></body></html>`;
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
            width: VIDEO.width,
            height: VIDEO.height,
            durationSeconds: Number(composedProbe.format.duration),
            codec: 'h264',
            layout: `Unscaled ${recording.width}×${recording.height} one-tab recording plus persistent scope label and timed explanation.`,
          },
        },
        limits: [
          'Synthetic inputs, not observed users or savings.',
          'Captures use a neutral fictional sample cart; the named store (Lidl) is only the name the extension renders.',
          'The popup is captured as the popup page in a tab at the popup size, not from the toolbar.',
          'The badge panel in an 800-pixel window scrolls; rows below the fold are not shown.',
          'No live store request, model call, report sent, deployment or store submission.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Rendered five 1280×800 store screenshots, captions, gallery and asset provenance.');
} finally {
  await browser.close();
}
