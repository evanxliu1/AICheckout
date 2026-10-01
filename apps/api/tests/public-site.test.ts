import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.ts';
import { SITE_CSP } from '../src/public-site.ts';

const config = {
  supabaseUrl: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_synthetic_test_key',
};
const instances: ReturnType<typeof createApp>[] = [],
  directories: string[] = [];

/** A synthetic site build whose files would shadow every reserved route if precedence were wrong. */
async function app({ withReview = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'checkout-public-site-'));
  directories.push(directory);
  const site = join(directory, 'site'),
    review = join(directory, 'review');
  await Promise.all(
    [
      site,
      join(site, 'results'),
      join(site, 'assets'),
      join(site, 'v1'),
      join(site, 'review'),
      join(site, 'health'),
      review,
    ].map((path) => mkdir(path, { recursive: true })),
  );
  await Promise.all([
    writeFile(join(site, 'index.html'), '<!doctype html><title>Synthetic public site</title>'),
    writeFile(join(site, 'results', 'index.html'), '<!doctype html><title>Synthetic results</title>'),
    writeFile(join(site, 'assets', 'site-abc123.css'), 'body{}'),
    writeFile(join(site, 'v1', 'catalog'), 'SITE_SHADOW'),
    writeFile(join(site, 'v1', 'index.html'), 'SITE_SHADOW'),
    writeFile(join(site, 'review', 'index.html'), 'SITE_SHADOW'),
    writeFile(join(site, 'health', 'index.html'), 'SITE_SHADOW'),
    writeFile(join(site, '.env'), 'PRIVATE_SENTINEL'),
    writeFile(join(directory, 'outside.txt'), 'PRIVATE_SENTINEL'),
    writeFile(join(review, 'index.html'), '<!doctype html><title>Synthetic review site</title>'),
  ]);
  const instance = createApp({
    readCatalog: async () => null,
    siteRoot: site,
    ...(withReview ? { reviewRoot: review, reviewConfig: config } : {}),
  });
  instances.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.close()));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('serves the site pages and assets at / with the site security headers', async () => {
  const site = await app();
  for (const [path, body] of [
    ['/', 'Synthetic public site'],
    ['/results/', 'Synthetic results'],
    ['/assets/site-abc123.css', 'body{}'],
  ]) {
    const response = await site.inject(path);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(body);
    expect(response.headers['content-security-policy']).toBe(SITE_CSP);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
  }
  expect(SITE_CSP).not.toMatch(/supabase|unsafe|\*/);
  expect((await site.inject('/')).headers['cache-control']).toBe('no-cache');
  expect((await site.inject('/assets/site-abc123.css')).headers['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
  const redirect = await site.inject('/results');
  expect(redirect.statusCode).toBe(301);
  expect(redirect.headers.location).toBe('/results/');
});

it('never shadows the health check, the catalog API or the review app', async () => {
  const site = await app();
  expect((await site.inject('/health')).json()).toEqual({ status: 'ok' });
  const catalog = await site.inject('/v1/catalog');
  expect(catalog.json()).toEqual({ release: null });
  expect(catalog.headers['content-security-policy']).toBeUndefined();
  const review = await site.inject('/review/');
  expect(review.body).toContain('Synthetic review site');
  expect(review.headers['content-security-policy']).toContain('https://example.supabase.co');
  for (const path of ['/v1/', '/v1/unknown', '/v1/review/not-a-route', '/health/', '/V1/catalog']) {
    const response = await site.inject(path);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('SITE_SHADOW');
    expect(response.body).not.toContain('<!doctype');
  }
});

it('keeps reserved prefixes unreachable even when the review app is not configured', async () => {
  const site = await app({ withReview: false });
  for (const path of ['/review/', '/review/index.html', '/v1/catalog/', '/health/index.html']) {
    const response = await site.inject(path);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('SITE_SHADOW');
  }
});

it('never serves dotfiles or files outside the site build', async () => {
  const site = await app();
  for (const path of [
    '/.env',
    '/%2eenv',
    '/../outside.txt',
    '/%2e%2e/outside.txt',
    '/%2e%2e%2foutside.txt',
  ]) {
    const response = await site.inject(path);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain('PRIVATE_SENTINEL');
  }
  expect((await site.inject('/missing/')).statusCode).toBe(404);
});
