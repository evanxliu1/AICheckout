import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app';

const config = {
  supabaseUrl: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_synthetic_test_key',
};
const instances: ReturnType<typeof createApp>[] = [],
  directories: string[] = [];
async function site() {
  const directory = await mkdtemp(join(tmpdir(), 'checkout-review-site-'));
  directories.push(directory);
  const root = join(directory, 'dist');
  await mkdir(root);
  await Promise.all([
    writeFile(join(root, 'index.html'), '<!doctype html><title>Synthetic review site</title>'),
    writeFile(join(root, 'app.js'), 'document.title = "Synthetic review";'),
    writeFile(join(root, '.env'), 'PRIVATE_SENTINEL'),
    writeFile(join(directory, 'outside.txt'), 'PRIVATE_SENTINEL'),
  ]);
  const app = createApp({ readCatalog: async () => null, reviewRoot: root, reviewConfig: config });
  instances.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
it('serves the built site and public configuration under a restrictive same-origin policy', async () => {
  const app = await site();
  for (const path of ['/review/', '/review/app.js', '/review/config.json']) {
    const response = await app.inject(path);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://example.supabase.co; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
  }
  expect((await app.inject('/review/config.json')).json()).toEqual(config);
  expect((await app.inject('/review/')).body).toContain('Synthetic review site');
});
it('never serves dotfiles or files outside the configured build directory', async () => {
  const app = await site();
  for (const path of [
    '/review/.env',
    '/review/%2eenv',
    '/review/../outside.txt',
    '/review/%2e%2e/outside.txt',
    '/review/%2e%2e%2foutside.txt',
    '/outside.txt',
    '/review/missing.js',
  ]) {
    const response = await app.inject(path);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain('PRIVATE_SENTINEL');
  }
});
it('does not turn unknown API routes into a successful HTML fallback', async () => {
  const app = await site();
  const response = await app.inject('/v1/review/not-a-route');
  expect(response.statusCode).toBe(404);
  expect(response.body).not.toContain('<!doctype');
  expect((await app.inject('/v1/catalog')).json()).toEqual({ release: null });
});
it('refuses a server-only secret in the browser configuration at startup', async () => {
  const app = createApp({
    readCatalog: async () => null,
    reviewRoot: tmpdir(),
    reviewConfig: { ...config, publishableKey: 'sb_secret_must_not_be_exposed' },
  });
  instances.push(app);
  await expect(app.ready()).rejects.toThrow();
});
