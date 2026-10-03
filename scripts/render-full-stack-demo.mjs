/* global document */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { demoAssets, demoRoot, digest, fileEvidence, fullStackEvidence } from './lib/demo-evidence.mjs';

const capturePath = join(demoAssets, 'full-stack-capture.json');
const capture = JSON.parse(readFileSync(capturePath, 'utf8'));
assert.deepEqual(
  fullStackEvidence(),
  { sourceFiles: capture.sourceFiles, buildFiles: capture.buildFiles },
  'Source or compiled build changed since recording',
);
for (const entry of [capture.recording, ...capture.frames])
  assert.equal(
    fileEvidence(join(demoRoot, entry.path)).sha256,
    entry.sha256,
    `Recording evidence changed: ${entry.path}`,
  );
assert.equal(capture.cleanup.previousHeadRestored, true);
assert.equal(capture.cleanup.previousPolicyRestored, true);
assert.deepEqual(
  [capture.cleanup.users, capture.cleanup.drafts, capture.cleanup.sources, capture.cleanup.runs],
  [0, 0, 0, 0],
);
const probe = (path) =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', path],
      { encoding: 'utf8' },
    ),
  );
const rawPath = join(demoAssets, 'full-stack-demo.webm'),
  raw = probe(rawPath),
  duration = Number(raw.format.duration);
assert.equal(raw.streams[0].width, 1280);
assert.equal(raw.streams[0].height, 800);
assert.ok(duration > capture.chapters.at(-1).seconds + 4, 'Final chapter is incomplete');
const scratch = join(demoAssets, 'full-stack-captions');
mkdirSync(scratch, { recursive: true });
const inspection = '/tmp/aicheckout-full-stack-demo-inspection';
mkdirSync(inspection, { recursive: true });
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const stamp = (seconds) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
const chapters = capture.chapters.map((chapter, index) => ({
  ...chapter,
  seconds: index === 0 ? 0 : chapter.seconds,
}));
// Ocean theme caption type: the self-hosted fonts the extension and review app bundle (SIL OFL 1.1).
const font = (pkg, file) =>
  `data:font/woff2;base64,${readFileSync(resolve(import.meta.dirname, '../node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64')}`;
const fonts = `@font-face{font-family:Figtree;font-weight:300 900;src:url(${font('figtree', 'figtree-latin-wght-normal.woff2')}) format("woff2")}@font-face{font-family:Bricolage;font-weight:200 800;src:url(${font('bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2')}) format("woff2")}`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
let server;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
  const concat = ['ffconcat version 1.0'];
  for (const [index, chapter] of chapters.entries()) {
    const end = chapters[index + 1]?.seconds ?? duration;
    assert.ok(end > chapter.seconds);
    await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Full-stack demo caption</title><style>
      ${fonts}*{box-sizing:border-box}html,body{margin:0;width:1280px;height:960px;background:white;font-family:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      footer{position:absolute;top:800px;left:0;width:1280px;height:160px;background:#0c2a4d;color:white;padding:16px 28px}
      h1{font-family:Bricolage,Figtree,sans-serif;font-size:28px;line-height:34px;margin:0 0 6px;font-weight:700;letter-spacing:-.01em}p{font-size:20px;line-height:27px;margin:0;max-width:1200px}.explanation{color:#fff}.scope{font-size:15px;line-height:20px;color:#a9c6ea;margin-top:9px}
      </style><body><footer><h1>${escape(chapter.title)}</h1><p class="explanation">${escape(chapter.text)}</p><p class="scope">AI Checkout · Actual local app · Synthetic terms and model response · No live model or provider charge</p></footer></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const fits = await page.evaluate(
      () => document.querySelector('.scope').getBoundingClientRect().bottom <= 956,
    );
    assert.ok(fits, `Caption overflow at chapter ${index + 1}`);
    const file = `caption-${String(index).padStart(2, '0')}.png`;
    await page.screenshot({ path: join(scratch, file) });
    concat.push(`file '${file}'`, `duration ${(end - chapter.seconds).toFixed(3)}`);
  }
  concat.push(`file 'caption-${String(chapters.length - 1).padStart(2, '0')}.png'`);
  writeFileSync(join(scratch, 'timeline.ffconcat'), concat.join('\n') + '\n');
  const mp4 = join(demoAssets, 'full-stack-demo.mp4');
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
      join(scratch, 'timeline.ffconcat'),
      '-i',
      rawPath,
      '-filter_complex',
      '[0:v]fps=25[bg];[bg][1:v]overlay=0:0:shortest=1,format=yuv420p[v]',
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
      mp4,
    ],
    { stdio: 'pipe' },
  );
  const encoded = probe(mp4);
  assert.equal(encoded.streams[0].codec_name, 'h264');
  assert.equal(encoded.streams[0].width, 1280);
  assert.equal(encoded.streams[0].height, 960);
  assert.ok(Math.abs(Number(encoded.format.duration) - duration) < 0.2);
  const cues = chapters.map(
    (chapter, index) =>
      `${index + 1}\n${stamp(chapter.seconds)} --> ${stamp(chapters[index + 1]?.seconds ?? duration)}\n${chapter.title}. ${chapter.text}`,
  );
  writeFileSync(join(demoAssets, 'full-stack-demo.vtt'), `WEBVTT\n\n${cues.join('\n\n')}\n`);

  // Serve only this recording and captions, never the repository or environment.
  const media = {
    '/full-stack-demo.mp4': ['video/mp4', readFileSync(mp4)],
    '/full-stack-demo.vtt': ['text/vtt', readFileSync(join(demoAssets, 'full-stack-demo.vtt'))],
  };
  const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local playback check</title><style>body{margin:0}video{display:block;width:100%;max-width:1280px;height:auto}</style><video controls preload="metadata"><source src="/full-stack-demo.mp4" type="video/mp4"><track default kind="captions" srclang="en" label="English" src="/full-stack-demo.vtt"></video></html>';
  server = createServer((request, response) => {
    const item = request.url === '/' ? ['text/html', html] : media[request.url];
    response.writeHead(item ? 200 : 404, {
      'Content-Type': item?.[0] ?? 'text/plain',
      'Cache-Control': 'no-store',
    });
    response.end(item?.[1] ?? 'Not found');
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const video = page.locator('video');
  await page.waitForFunction(() => document.querySelector('video').readyState >= 1);
  await video.evaluate((video) => video.play());
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25);
  const playback = await video.evaluate((video) => {
    video.pause();
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      currentTime: video.currentTime,
    };
  });
  await page.waitForFunction(() => document.querySelector('track').readyState === 2);
  const cueCount = await video.evaluate((video) => video.textTracks[0].cues.length);
  assert.equal(cueCount, chapters.length);
  assert.equal(playback.width, 1280);
  assert.equal(playback.height, 960);
  assert.deepEqual(errors, []);
  const selected = [0, 3, 5, 8, 10];
  for (const index of selected) {
    const second = Math.min(chapters[index].seconds + 3, duration - 1);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      second.toFixed(3),
      '-i',
      mp4,
      '-frames:v',
      '1',
      join(inspection, `chapter-${index + 1}.png`),
    ]);
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    captureManifest: fileEvidence(capturePath),
    generator: fileEvidence(join(demoRoot, 'scripts/render-full-stack-demo.mjs')),
    recording: fileEvidence(mp4),
    captions: fileEvidence(join(demoAssets, 'full-stack-demo.vtt')),
    width: 1280,
    height: 960,
    durationSeconds: Number(encoded.format.duration),
    codec: 'h264',
    composition:
      'Actual unscaled 1280×800 browser recording, with a separate 160px explanatory footer; no recreated or retouched application UI.',
    verified: {
      playback,
      captionCues: cueCount,
      pageErrors: errors,
      sourceAndBuildHashesMatch: true,
      cleanup: capture.cleanup,
    },
    evidenceFingerprint: digest(
      JSON.stringify({ sourceFiles: capture.sourceFiles, buildFiles: capture.buildFiles }),
    ),
    limits: [
      'Local synthetic fixture, not hosted deployment.',
      'No live model call, accuracy measurement or actual provider billing.',
      'Invented 2.5% terms are not current issuer terms.',
      'Controlled review actions are scripted, not independent human annotation.',
    ],
  };
  writeFileSync(join(demoAssets, 'full-stack-media.json'), JSON.stringify(manifest, null, 2) + '\n');
  const transcript =
    `# Full-stack portfolio recording\n\n[Watch the captioned MP4](full-stack-demo.mp4) · [Captions](full-stack-demo.vtt) · [Capture and verification evidence](full-stack-capture.json) · [Media provenance](full-stack-media.json)\n\n` +
    `Recorded ${capture.recordedAt.slice(0, 10)}. Duration: ${Number(encoded.format.duration).toFixed(1)} seconds. Actual 1280×800 review interface, unscaled inside a 1280×960 H.264 video with an explanatory footer. No audio narration. The [underlying WebM](full-stack-demo.webm) is retained for provenance and lacks the persistent presentation labels; use the MP4 for public demonstration.\n\n` +
    `This connects the built React interface to the compiled Node/Fastify API, real local Supabase Auth and PostgreSQL. The model response is intercepted and synthetic. The 2.5% example is invented, not issuer terms or measured model accuracy. Its source identifier retains the registered issuer URL so the existing source-pack guard runs; no issuer website is fetched. All accounts, sources, runs and draft publications are disposable local fixtures. No live provider call, actual charge or hosted publication occurred.\n\n` +
    `## Transcript\n\n| Time | Step | Explanation |\n| --- | --- | --- |\n` +
    chapters
      .map((chapter) => `| ${stamp(chapter.seconds).slice(3, 8)} | ${chapter.title} | ${chapter.text} |`)
      .join('\n') +
    '\n\n' +
    `## Verified boundaries\n\n- Unauthenticated/ordinary accounts are rejected with 401/403 before recording.\n- Extraction returns an evidence-checked proposal; application requires condition decisions, a note and acknowledgement.\n- Applying creates exactly one new draft revision while the public head stays unchanged.\n- Refreshing reads the saved run; the run count remains one.\n- Separate publication changes the local public endpoint to the reviewed synthetic catalog.\n- The browser persists no authentication data in localStorage, sessionStorage or cookies; no page errors or external browser requests occurred.\n- Cleanup removes both disposable accounts and their sources/drafts/runs, restores the prior public head and restores the prior curation policy.\n\n` +
    `Source/build fingerprint: \`${manifest.evidenceFingerprint}\`. The capture manifest records all ${capture.sourceFiles.length} source/input files and ${capture.buildFiles.length} compiled files by hash; this identifies the dirty worktree content without claiming a commit or remote CI run. The renderer refuses changed inputs. Recorded token/cost fields exercise accounting with simulated prices; they are not provider billing.\n\n` +
    `## Reproduce\n\nWith Node 24, workspace dependencies, the disposable local Supabase stack, Playwright Chromium and ffmpeg/ffprobe available:\n\n\`\`\`sh\nPLAYWRIGHT_BROWSERS_PATH=/tmp/aicheckout-playwright npm run release:portfolio\n\`\`\`\n\nUse your own installed Playwright browser path. The command builds both apps, records the explicitly gated local fixture, composes the video and verifies playback, captions, hashes and cleanup. It does not reset the database or deploy. The normal browser suite skips this recording. Regenerate when source/build inputs change; no cross-platform byte parity is claimed.\n\nThe first capture attempt used an unregistered example URL and was correctly rejected before extraction. The fixture was corrected to retain the registered identity; the production guard was not weakened.\n\nStill required: independent source/label review, funded live model evaluation with failure/latency/cost results, hosted deployment, and final installed-Chrome/testing evidence. See the [portfolio plan](../portfolio-demo.md) and [release requirements](../README.md).\n`;
  writeFileSync(join(demoAssets, 'full-stack-demo.md'), transcript);
  console.log(
    `Composed and verified ${chapters.length} chapters, ${Number(encoded.format.duration).toFixed(1)}s MP4, original-size UI and full-stack provenance.`,
  );
} finally {
  await browser.close();
  if (server?.listening) await new Promise((done) => server.close(done));
}
