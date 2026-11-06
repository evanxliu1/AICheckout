import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  compareBundles,
  compareHosted,
  daysUntilExpiry,
  findBundledReleases,
  hostedReleases,
  readZipBundles,
} from './release-bundles.mjs';

const CATALOG =
  '{schemaVersion:3,version:"2026-11-10.renewal.2",verifiedAt:"2026-11-10T00:00:00Z",expiresAt:"2026-12-10T00:00:00Z",programs:[{id:"cash-back"}]}';
const MERCHANTS =
  '{schemaVersion:1,version:"2026-10-11.mcc.3",verifiedAt:"2026-10-11T00:00:00Z",sources:[{id:"a"}]}';
// What else a minified worker chunk holds near those keys: the Zod schemas and other versioned objects.
const NOISE =
  'const S={schemaVersion:Z.literal(3),version:Z.string()};const T={schemaVersion:1,consentVersion:1,installId:null};';
const BUNDLED = {
  catalog: {
    version: '2026-11-10.renewal.2',
    verifiedAt: '2026-11-10T00:00:00Z',
    expiresAt: '2026-12-10T00:00:00Z',
  },
  merchants: { version: '2026-10-11.mcc.3', verifiedAt: '2026-10-11T00:00:00Z' },
};

function zipWith(t, entries) {
  const root = mkdtempSync(join(tmpdir(), 'aicheckout-bundles-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const staging = join(root, 'contents');
  for (const [path, text] of Object.entries(entries)) {
    mkdirSync(join(staging, path, '..'), { recursive: true });
    writeFileSync(join(staging, path), text);
  }
  const zip = join(root, 'fixture.zip');
  execFileSync('zip', ['-Xqr', zip, '.'], { cwd: staging });
  return zip;
}

test('finds exactly one catalog and one store-list header among the bundle texts', () => {
  const found = findBundledReleases(
    new Map([
      ['assets/popup-x.js', NOISE],
      ['assets/merchants-y.js', `${NOISE}const q=${CATALOG};const y=${MERCHANTS};`],
    ]),
  );
  assert.deepEqual(found, {
    catalog: { file: 'assets/merchants-y.js', ...BUNDLED.catalog },
    merchants: { file: 'assets/merchants-y.js', ...BUNDLED.merchants },
  });
});

test('refuses bundles with no header or more than one', () => {
  assert.throws(
    () => findBundledReleases(new Map([['assets/a.js', `${NOISE}${CATALOG}`]])),
    /No bundled store list header/,
  );
  assert.throws(
    () =>
      findBundledReleases(
        new Map([
          ['assets/a.js', `${CATALOG}${MERCHANTS}`],
          ['assets/b.js', CATALOG],
        ]),
      ),
    /2 bundled catalog headers found \(assets\/a\.js, assets\/b\.js\)/,
  );
});

test('reads the headers from the assets/*.js entries of a ZIP', (t) => {
  const zip = zipWith(t, {
    'manifest.json': '{"name":"AI Checkout"}',
    'assets/worker-abc.js': `${NOISE}const q=${CATALOG};const y=${MERCHANTS};`,
    'assets/popup-def.js': NOISE,
    'src/badge/content.js': CATALOG, // not an assets/ chunk; never read
  });
  const found = readZipBundles(zip);
  assert.equal(found.catalog.file, 'assets/worker-abc.js');
  assert.equal(found.catalog.version, '2026-11-10.renewal.2');
  assert.equal(found.merchants.version, '2026-10-11.mcc.3');
  assert.throws(() => readZipBundles(zipWith(t, { 'manifest.json': '{}' })), /no assets\/\*\.js entries/);
});

test('compares the bundled headers with the expected releases', () => {
  assert.deepEqual(compareBundles(BUNDLED, BUNDLED), []);
  assert.deepEqual(
    compareBundles(BUNDLED, {
      catalog: { ...BUNDLED.catalog, version: '2026-10-05.renewal.1', expiresAt: '2026-11-04T00:00:00Z' },
      merchants: BUNDLED.merchants,
    }),
    [
      'catalog version: bundled 2026-11-10.renewal.2, expected 2026-10-05.renewal.1',
      'catalog expiresAt: bundled 2026-12-10T00:00:00Z, expected 2026-11-04T00:00:00Z',
    ],
  );
});

test('reads the hosted releases and reports unavailable ones instead of throwing', async () => {
  const answers = {
    'https://api.example/v1/catalog': {
      status: 200,
      body: {
        release: {
          sequence: 4,
          version: '2026-11-10.renewal.2',
          catalog: { verifiedAt: '2026-11-10T00:00:00Z', expiresAt: '2026-12-10T00:00:00Z' },
        },
      },
    },
    'https://api.example/v1/merchants': {
      status: 200,
      body: {
        release: {
          sequence: 1,
          version: '2026-10-11.mcc.3',
          release: { verifiedAt: '2026-10-11T00:00:00Z' },
        },
      },
    },
  };
  const fetchStub = async (url) => {
    const answer = answers[url];
    return { ok: answer.status < 400, status: answer.status, statusText: 'x', json: async () => answer.body };
  };
  const hosted = await hostedReleases('https://api.example', fetchStub);
  assert.deepEqual(hosted, {
    catalog: { status: 200, sequence: 4, ...BUNDLED.catalog },
    merchants: { status: 200, sequence: 1, ...BUNDLED.merchants },
  });
  assert.deepEqual(compareHosted(BUNDLED, hosted), []);

  answers['https://api.example/v1/catalog'] = { status: 503, body: { error: 'catalog_unavailable' } };
  answers['https://api.example/v1/merchants'] = { status: 200, body: { release: null } };
  const down = await hostedReleases('https://api.example', fetchStub);
  assert.deepEqual(down.catalog, { status: 503, error: 'catalog_unavailable' });
  assert.deepEqual(down.merchants, { status: 200, error: 'no release published' });
  assert.deepEqual(compareHosted(BUNDLED, down), [
    'hosted catalog: unavailable (503 catalog_unavailable)',
    'hosted merchants: unavailable (200 no release published)',
  ]);

  const offline = await hostedReleases('https://api.example', async () => {
    throw new Error('fetch failed');
  });
  assert.deepEqual(offline.catalog, { status: 0, error: 'fetch failed' });
});

test('counts whole days until the bundled catalog expires', () => {
  assert.equal(daysUntilExpiry(BUNDLED, Date.parse('2026-11-20T12:00:00Z')), 19);
  assert.equal(daysUntilExpiry(BUNDLED, Date.parse('2026-12-10T00:00:00Z')), 0);
  assert.equal(daysUntilExpiry(BUNDLED, Date.parse('2026-12-12T00:00:00Z')), -2);
});
