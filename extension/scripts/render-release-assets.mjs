/* global document */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
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
    alt: 'Actual badge panel “Best card for this cart” beside a neutral sample cart page (“Your cart”, “Sample cart · 2 items”, Sample item Qty 1, Another sample item Qty 2, an order summary: subtotal $92.59, estimated tax $7.41, total $100.00): “Based on $100.00 cart estimated total at Sample Kitchen. Treated as a restaurant (its own pages; fits Chase’s restaurant definition).” Sample Kitchen is a fictional store. An amount field reads 100.00, the payment method is “Card entered at checkout”, then Freedom Unlimited $3.00 (3%): 3% on “dining at restaurants, including takeout and eligible delivery services”; otherwise 1.5% on “all other purchases”, “Activation is not mentioned on the issuer’s pages”, “Rules that don’t apply here (2)”; below it Double Cash, $1.00 less, $2.00: 2% on “every purchase”, 2% if the balance is paid (1% at purchase), “Rules that don’t apply here (1)”; the remaining cards are below the panel’s scroll edge, above the Dismiss for this tab and Not on this site buttons.',
    note: 'Actual extension in an 880×800 window, on a fictional store’s sample cart.',
  },
  {
    name: 'rates',
    kind: 'window',
    title: 'No guess when the amount isn’t certain.',
    copy: 'A gift card is applied here, so the cart amount isn’t read. The badge ranks your cards by rate instead.',
    alt: 'Actual badge panel “Best card for this cart” beside a neutral sample cart page (“Your cart”, “Sample cart · 2 items”, two sample items, an order summary: subtotal $92.59, estimated tax $7.41, gift card −$25.00, total $75.00): “The cart amount wasn’t read on this page. Each card’s rate doesn’t depend on it, so the best card is the same at any amount, unless a condition below applies. A spend cap on one of these cards could change the order at your cart’s amount.” Then the cards by rate: Blue Cash Everyday 3% back, Double Cash 2% back, Quicksilver 1.5% back, Freedom Unlimited 1.5% back; an optional amount field, the payment method, the line “A tap sends only this store’s domain (for example example.com) so it can be added”, a “Store not recognised? Suggest it” link, and the Dismiss for this tab and Not on this site buttons.',
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
    copy: 'One question after setup. The extension works the same either way, and no usage reports are sent before you choose Share.',
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
      // The whole image: the presentation column's text, then the capture.
      alt: `Presentation panel: “${scene.title}” ${scene.copy} ${scene.note} Sample inputs; not earned rewards. ${scene.alt}`,
    });
  }
  // The shopper demo is a motion graphic rendered separately (npm run release:motion), independent of the
  // ZIP; the gallery and manifest point at its own manifest.
  const motion = JSON.parse(readFileSync(resolve(output, 'motion/motion-manifest.json'), 'utf8'));
  for (const media of Object.values(motion.outputs))
    if (hash(readFileSync(resolve(output, media.file))) !== media.sha256)
      throw new Error(`Motion demo changed since its manifest: ${media.file}; run npm run release:motion`);
  const timestamp = (seconds) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Checkout release media</title><style>
*{box-sizing:border-box}body{margin:0;background:#f9fafb;color:#111827;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:960px;margin:auto;padding:32px 24px}h1{font-size:32px;line-height:1.2}h2{font-size:22px;margin:40px 0 12px}p{max-width:72ch}a{color:#1d4ed8}figure{margin:0}figure img{display:block;width:100%;max-width:960px;height:auto}figcaption{margin:8px 0 24px;font-size:14px;color:#4b5563}.promo{max-width:440px}video{width:960px;max-width:100%;height:auto;background:#fff}.transcript{max-width:72ch}.transcript li{margin-bottom:12px}code{overflow-wrap:anywhere}a:focus-visible,video:focus-visible{outline:2px solid #1d4ed8;outline-offset:3px}@media(max-width:700px){main{padding:20px 16px}h1{font-size:28px}}</style></head><body><main>
<h1>AI Checkout release media</h1><p>Reviewable assets for extension 2.1.0 (the hosted build). The screenshots use the actual packaged interface, a neutral fictional sample cart and synthetic inputs; the shopper demo is a motion graphic illustrating the product. No real store is shown or named: the named store, Sample Kitchen, is fictional and exists only in a test copy of the store list used for the capture. Nothing here establishes customer savings, a live store check, model accuracy or store approval.</p><p>Artifact SHA-256: <code>${capture.artifactSha256}</code>. The bundled catalog ${escape(capture.catalogVersion)} expires ${new Date(capture.catalogExpiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })} UTC; reverify terms and recapture before publishing an updated build.</p>
${results.map((result, index) => `<section><h2>${escape(scenes[index].title)}</h2><figure><a href="${result.file}"><img src="${result.file}" alt="${escape(result.alt)}"></a><figcaption>1280 × 800. Actual extension UI at 1 CSS pixel per image pixel with a presentation caption. <a href="${result.capture}">Original capture</a>.</figcaption></figure></section>`).join('')}
<section><h2>Promotional image</h2><figure class="promo"><a href="promo-440x280.png"><img src="promo-440x280.png" alt="AI Checkout cart mark and name on the blue brand background"></a><figcaption>440 × 280; a brand image, not a product screenshot.</figcaption></figure><p><a href="icon-inspection.png">Inspect 16, 48 and 128px icons on light and dark backgrounds</a>.</p></section>
<section><h2>Shopper demo (motion graphic)</h2><p>A ${motion.outputs.web.durationSeconds.toFixed(1)}-second motion graphic illustrating the product: the badge and its panels recreated in HTML/CSS and animated, with sample cards and fictional stores (Sample Kitchen and shop.example.com). It is an illustration, not a recording; the screenshots above are the real extension. There is no audio; every frame reads without sound, and the scene descriptions below are also a caption track. <a href="motion/script.md">Script</a> and <a href="motion/composition.html">composition</a>.</p><div class="demo"><video controls preload="metadata" poster="${motion.outputs.poster.file}"><source src="${motion.outputs.web.file}" type="video/mp4"><track default kind="captions" src="${motion.outputs.captions.file}" srclang="en" label="English (scene descriptions)"></video><ol class="transcript">${motion.scenes.map((scene) => `<li><strong>${timestamp(scene.start).slice(3, 8)}</strong> ${escape(scene.caption)}</li>`).join('')}</ol></div><p><a href="${motion.outputs.web.file}">MP4, 1280 × 720</a> · <a href="${motion.outputs.master.file}">Master, 1920 × 1080</a> · <a href="${motion.outputs.captions.file}">Scene captions</a> · <a href="motion/motion-manifest.json">Render provenance</a></p></section>
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
        motionDemo: {
          kind: motion.kind,
          manifest: 'motion/motion-manifest.json',
          web: motion.outputs.web,
          master: motion.outputs.master,
          poster: motion.outputs.poster,
          captions: motion.outputs.captions,
        },
        limits: [
          'Synthetic inputs, not observed users or savings.',
          'Captures use a neutral fictional sample cart; the named store (Sample Kitchen, on a reserved .example host) is fictional and was added to a test copy of the store list in the capture profile; it is not in the shipped store list.',
          'The popup is captured as the popup page in a tab at the popup size, not from the toolbar.',
          'The badge panel in an 800-pixel window scrolls; rows below the fold are not shown.',
          'No live store request, model call, report sent, deployment or store submission.',
          'The shopper demo is a motion graphic illustrating the product, not a capture; it is not bound to the ZIP.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Rendered five 1280×800 store screenshots, gallery and asset provenance.');
} finally {
  await browser.close();
}
