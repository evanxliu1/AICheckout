import { execFileSync } from 'node:child_process';

/** Builds dist-e2e: the extension with its bundled catalog re-dated to yesterday (UTC), so browser
 * tests exercise a currently valid catalog on any date instead of expiring with the real terms.
 * The release build in dist/ (package and release-media specs) is never re-dated. */
export default function globalSetup() {
  if (process.env.RELEASE_ZIP_E2E === '1' || process.env.RELEASE_ASSETS === '1') return;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  execFileSync('npx', ['vite', 'build', '--logLevel', 'warn'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_E2E_CATALOG_DATE: yesterday },
  });
}
