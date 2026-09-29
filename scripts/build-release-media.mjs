import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

if (!process.env.npm_execpath) throw new Error('Run through npm run release:media.');
const root = resolve(import.meta.dirname, '..');
for (const tool of ['ffmpeg', 'ffprobe']) execFileSync(tool, ['-version'], { stdio: 'ignore' });
const script = (name) =>
  execFileSync(process.execPath, [resolve(root, 'extension/scripts', name)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
const npm = (args, extra = {}) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extra },
  });
script('render-brand.mjs');
npm(['run', 'build', '--workspace', 'extension']);
npm(['run', 'package', '--workspace', 'extension']);
npm(['run', 'test:browser', '--workspace', 'extension', '--', 'e2e/release-assets.spec.ts'], {
  RELEASE_ASSETS: '1',
  RELEASE_ASSETS_ONLY: '',
});
script('render-release-assets.mjs');
script('verify-release-assets.mjs');
