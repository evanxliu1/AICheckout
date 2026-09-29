import { execFileSync } from 'node:child_process';

if (!process.env.npm_execpath) throw new Error('Run through npm run test:catalog:browser.');
const run = (args, env) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit', env });
run(['run', 'build', '--workspace=ai-checkout-extension', '--', '--outDir', 'dist-catalog-test'], {
  ...process.env,
  VITE_CATALOG_API_URL: 'https://127.0.0.1:9443/v1/catalog',
});
run(['run', 'test:browser', '--workspace=ai-checkout-extension', '--', 'e2e/catalog.spec.ts'], {
  ...process.env,
  CATALOG_E2E: '1',
});
