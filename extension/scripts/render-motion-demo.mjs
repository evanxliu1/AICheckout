/* global window, document */
// Renders the shopper demo motion graphic (docs/release/assets/motion/composition.html) frame by frame.
// Each frame is a pure function of t: the page's renderFrame(t) is called for t = frame / fps and the
// page is screenshotted; ffmpeg encodes the 1920×1080 master and the 1280×720 web copy from the same frames.
// The demo is an illustration, independent of the extension ZIP. See docs/release/assets/motion/script.md.
//
//   node extension/scripts/render-motion-demo.mjs            full render, poster, captions, manifest
//   node extension/scripts/render-motion-demo.mjs --stills   key-moment stills only (MOTION_STILLS_DIR)
//   node extension/scripts/render-motion-demo.mjs --at 3,9.5 stills at the given seconds
//   node extension/scripts/render-motion-demo.mjs --check    re-render the key frames, compare with the manifest
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..'),
  assets = resolve(root, 'docs/release/assets'),
  motionDir = resolve(assets, 'motion'),
  manifestPath = resolve(motionDir, 'motion-manifest.json');
const stillsDir = resolve(process.env.MOTION_STILLS_DIR ?? '/tmp/aicheckout-motion-stills');
const inspection = resolve(process.env.MEDIA_INSPECTION_DIR ?? '/tmp/aicheckout-release-media-inspection');
const args = process.argv.slice(2);
const mode = args.includes('--check')
  ? 'check'
  : args.includes('--stills') || args.includes('--at')
    ? 'stills'
    : 'full';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const outputs = {
  master: resolve(motionDir, 'shopper-demo-1920x1080.mp4'),
  web: resolve(assets, 'shopper-demo.mp4'),
  poster: resolve(assets, 'shopper-demo-poster.png'),
  captions: resolve(assets, 'shopper-demo.vtt'),
};
for (const tool of ['ffmpeg', 'ffprobe']) execFileSync(tool, ['-version'], { stdio: 'ignore' });

// The page loads the repository's own fonts and cart mark; serve only those folders on loopback.
const served = [
  motionDir,
  resolve(root, 'node_modules/@fontsource-variable'),
  resolve(root, 'extension/assets'),
].map((dir) => realpathSync(dir) + sep);
const mime = { '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  try {
    const path = realpathSync(
      resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://x').pathname)}`),
    );
    if (!served.some((dir) => path.startsWith(dir))) throw new Error('Not served');
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
const url = `http://127.0.0.1:${server.address().port}/${relative(root, resolve(motionDir, 'composition.html'))}`;

const probe = (file) =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    ),
  );
const ffmpeg = (ffArgs, input) =>
  new Promise((done, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...ffArgs], {
      stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', (data) => (errors += data));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? done() : reject(new Error(`ffmpeg failed: ${errors}`))));
    if (input) input(child.stdin);
  });

let browser;
try {
  // GPU rasterization left an occasional one-pixel difference in otherwise identical frames (2026-10-22 review:
  // a key frame failed --check about one run in three); software rasterization is repeatable.
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--disable-gpu-rasterization'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => window.motionReady);
  const fontsLoaded = await page.evaluate(() =>
    ['700 84px Bricolage', '400 32px Figtree'].every((font) => document.fonts.check(font)),
  );
  if (!fontsLoaded) throw new Error('Repository fonts did not load');
  const motion = await page.evaluate(() => window.MOTION);
  const frames = Math.round(motion.duration * motion.fps);
  const frameAt = async (t) => {
    await page.evaluate((time) => window.renderFrame(time), t);
    return page.screenshot({ type: 'png' });
  };
  const frameIndex = (seconds) => Math.round(seconds * motion.fps);

  if (mode === 'stills') {
    const at = args.includes('--at') ? args[args.indexOf('--at') + 1].split(',').map(Number) : motion.stills;
    mkdirSync(stillsDir, { recursive: true });
    for (const seconds of at) {
      const file = resolve(stillsDir, `still-${seconds.toFixed(2).padStart(5, '0')}s.png`);
      writeFileSync(file, await frameAt(frameIndex(seconds) / motion.fps));
      console.log(file);
    }
  } else if (mode === 'check') {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.compositionSha256 !== hash(readFileSync(resolve(motionDir, 'composition.html'))))
      throw new Error('composition.html changed since the last render; run npm run release:motion');
    for (const key of manifest.keyFrames) {
      const actual = hash(await frameAt(key.frame / motion.fps));
      if (actual !== key.sha256)
        throw new Error(`Frame ${key.frame} (${key.seconds} s) differs from the manifest`);
    }
    console.log(`Re-rendered ${manifest.keyFrames.length} key frames; each matches the manifest.`);
  } else {
    const keyIndexes = new Map(motion.stills.map((seconds) => [frameIndex(seconds), seconds]));
    const keyFrames = [],
      frameHashes = [];
    let posterFrame;
    // One pass: the 1920×1080 master and the 1280×720 web copy, both BT.709 limited range, no audio.
    const scale = (size) =>
      `scale=${size}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1`;
    const tags = [
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
    ];
    const x264 = (crf) => [
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-tune',
      'animation',
      '-crf',
      String(crf),
      '-profile:v',
      'high',
      '-r',
      String(motion.fps),
      ...tags,
      '-movflags',
      '+faststart',
    ];
    await ffmpeg(
      [
        '-f',
        'image2pipe',
        '-framerate',
        String(motion.fps),
        '-c:v',
        'png',
        '-i',
        '-',
        '-filter_complex',
        `[0:v]split=2[a][b];[a]${scale('1920:1080')}[m];[b]${scale('1280:720')}[w]`,
        '-map',
        '[m]',
        ...x264(18),
        outputs.master,
        '-map',
        '[w]',
        ...x264(20),
        outputs.web,
      ],
      async (stdin) => {
        for (let index = 0; index < frames; index++) {
          const png = await frameAt(index / motion.fps);
          const sha256 = hash(png);
          frameHashes.push(sha256);
          if (keyIndexes.has(index)) keyFrames.push({ seconds: keyIndexes.get(index), frame: index, sha256 });
          if (index === frameIndex(motion.poster)) posterFrame = png;
          if (!stdin.write(png)) await new Promise((done) => stdin.once('drain', done));
          if (index % 150 === 0) console.log(`frame ${index}/${frames}`);
        }
        stdin.end();
      },
    );
    if (errors.length) throw new Error(`Composition errors: ${errors.join(', ')}`);
    // Poster: the master frame at the poster time, scaled to the web copy's size as opaque RGB.
    mkdirSync(stillsDir, { recursive: true });
    const posterSource = resolve(stillsDir, 'poster-source.png');
    writeFileSync(posterSource, posterFrame);
    await ffmpeg([
      '-i',
      posterSource,
      '-vf',
      'scale=1280:720:flags=lanczos',
      '-pix_fmt',
      'rgb24',
      outputs.poster,
    ]);
    const timestamp = (seconds) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
    writeFileSync(
      outputs.captions,
      `WEBVTT\n\n${motion.scenes.map((scene, index) => `${index + 1}\n${timestamp(scene.start)} --> ${timestamp(scene.end)}\n${scene.caption}`).join('\n\n')}\n`,
    );
    const describe = (file, width, height) => {
      const info = probe(file),
        video = info.streams.filter((stream) => stream.codec_type === 'video');
      const ok =
        video.length === 1 &&
        info.streams.length === 1 &&
        video[0].codec_name === 'h264' &&
        video[0].pix_fmt === 'yuv420p' &&
        video[0].width === width &&
        video[0].height === height &&
        video[0].r_frame_rate === `${motion.fps}/1` &&
        Math.abs(Number(info.format.duration) - motion.duration) < 0.05;
      if (!ok) throw new Error(`Encoded video validation failed: ${file}`);
      return {
        file: relative(assets, file),
        sha256: hash(readFileSync(file)),
        bytes: statSync(file).size,
        width,
        height,
        fps: motion.fps,
        durationSeconds: Number(info.format.duration),
        codec: 'h264',
        pixelFormat: 'yuv420p',
        audioStreams: 0,
      };
    };
    const fileEntry = (file) => ({
      file: relative(assets, file),
      sha256: hash(readFileSync(file)),
      bytes: statSync(file).size,
    });
    const fontFile = (pkg, file) => resolve(root, 'node_modules/@fontsource-variable', pkg, 'files', file);
    const manifest = {
      generatedAt: new Date().toISOString(),
      kind: 'Motion graphic illustrating the product: the interface recreated in HTML/CSS with sample cards and a fictional store. Not a capture of the extension; the store screenshots are the real extension. Independent of the extension ZIP.',
      script: 'motion/script.md',
      composition: 'motion/composition.html',
      compositionSha256: hash(readFileSync(resolve(motionDir, 'composition.html'))),
      inputs: {
        figtree: hash(readFileSync(fontFile('figtree', 'figtree-latin-wght-normal.woff2'))),
        bricolageGrotesque: hash(
          readFileSync(fontFile('bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2')),
        ),
        cartMark: hash(readFileSync(resolve(root, 'extension/assets/cart-mark.svg'))),
      },
      renderer: {
        script: 'extension/scripts/render-motion-demo.mjs',
        browser: `Chromium ${browser.version()} (Playwright, headless, software rasterization, 1920×1080, device scale 1)`,
        ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
      },
      frames: { count: frames, fps: motion.fps, sha256OfFrameHashes: hash(frameHashes.join('\n')) },
      keyFrames,
      scenes: motion.scenes,
      outputs: {
        master: describe(outputs.master, 1920, 1080),
        web: describe(outputs.web, 1280, 720),
        poster: { ...fileEntry(outputs.poster), width: 1280, height: 720, seconds: motion.poster },
        captions: { ...fileEntry(outputs.captions), cues: motion.scenes.length },
      },
      limits: [
        'Illustration, not a recording: simplified recreations of the 2.1.0 badge and panels.',
        'Sample cards; Sample Kitchen (sample-kitchen.example) and shop.example.com are fictional stores.',
        'Amounts are conditional estimates from published terms, not earned rewards.',
        'Same inputs give the same frames on the same machine and browser build; byte parity across operating systems, font rasterizers or encoders is not claimed.',
      ],
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    // Contact sheet for inspection (not committed): one frame every 2 s from the web copy.
    mkdirSync(inspection, { recursive: true });
    await ffmpeg([
      '-i',
      outputs.web,
      '-vf',
      'fps=1/2,scale=320:-1,tile=6x5',
      '-frames:v',
      '1',
      resolve(inspection, 'motion-contact-sheet.png'),
    ]);
    console.log(
      `Rendered ${frames} frames: ${manifest.outputs.master.file} (${manifest.outputs.master.bytes} bytes), ${manifest.outputs.web.file} (${manifest.outputs.web.bytes} bytes), poster, ${motion.scenes.length} caption cues. Contact sheet: ${resolve(inspection, 'motion-contact-sheet.png')}`,
    );
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
