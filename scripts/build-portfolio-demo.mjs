import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.npm_execpath, 'Run through npm run release:portfolio');
for (const binary of ['ffmpeg', 'ffprobe']) execFileSync(binary, ['-version'], { stdio: 'ignore' });
// Reuse the existing disposable stack; never reset or migrate a hosted database.
const status = JSON.parse(
  execFileSync(`${cwd}node_modules/.bin/supabase`, ['status', '-o', 'json'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);
assert.equal(status.API_URL, 'http://127.0.0.1:54321', 'Start the project local Auth/Data stack first');
const npm = (args, extra = {}) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extra },
  });
npm(['run', 'build', '--workspace=@ai-checkout/api']);
npm(['run', 'build', '--workspace=@ai-checkout/review']);
npm(['run', 'test:browser', '--workspace=@ai-checkout/review', '--', 'e2e/portfolio-demo.spec.mjs'], {
  PORTFOLIO_DEMO: '1',
});
execFileSync(process.execPath, ['scripts/render-full-stack-demo.mjs'], { cwd, stdio: 'inherit' });
