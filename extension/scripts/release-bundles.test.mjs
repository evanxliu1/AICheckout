import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  catalogExpiry,
  compareBundles,
  compareHosted,
  findBundledReleases,
  hostedReleases,
  parseCheckArgs,
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

test('accepts quoted keys, other quotes and whitespace, and refuses an unparsable timestamp', () => {
  const json = JSON.stringify({ schemaVersion: 3, ...BUNDLED.catalog }).slice(0, -1);
  const loose =
    "{ schemaVersion: 1, version: '2026-10-11.mcc.3', verifiedAt: '2026-10-11T00:00:00Z', sources: [";
  assert.deepEqual(findBundledReleases(new Map([['a.js', `JSON.parse('${json},"cards":[]}');${loose}`]])), {
    catalog: { file: 'a.js', ...BUNDLED.catalog },
    merchants: { file: 'a.js', ...BUNDLED.merchants },
  });
  assert.throws(
    () =>
      findBundledReleases(new Map([['a.js', CATALOG.replace('2026-12-10T00:00:00Z', 'soon') + MERCHANTS]])),
    /catalog expiresAt "soon" is not an ISO timestamp/,
  );
});

test('reads the headers from every .js entry of a ZIP, so a second copy anywhere fails', (t) => {
  const zip = zipWith(t, {
    'manifest.json': '{"name":"AI Checkout"}',
    'assets/worker-abc.js': `${NOISE}const q=${CATALOG};const y=${MERCHANTS};`,
    'assets/popup-def.js': NOISE,
    'src/badge/content.js': NOISE,
  });
  const found = readZipBundles(zip);
  assert.equal(found.catalog.file, 'assets/worker-abc.js');
  assert.equal(found.catalog.version, '2026-11-10.renewal.2');
  assert.equal(found.merchants.version, '2026-10-11.mcc.3');
  const twice = zipWith(t, {
    'assets/worker-abc.js': `const q=${CATALOG};const y=${MERCHANTS};`,
    'src/badge/content.js': CATALOG,
  });
  assert.throws(
    () => readZipBundles(twice),
    /2 bundled catalog headers found \(assets\/worker-abc\.js, src\/badge\/content\.js\)/,
  );
  assert.throws(() => readZipBundles(zipWith(t, { 'manifest.json': '{}' })), /no \.js entries/);
});

test('refuses unknown options and an option without its value', () => {
  assert.deepEqual(
    { ...parseCheckArgs(['--zip', 'x.zip', '--hosted', '--json']) },
    { zip: 'x.zip', hosted: true, json: true },
  );
  assert.deepEqual({ ...parseCheckArgs([]) }, {});
  assert.throws(() => parseCheckArgs(['--host']), /Unknown option '--host'/);
  assert.throws(() => parseCheckArgs(['--zip']), /argument missing/);
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

test('judges expiry as the extension does: expired from expiresAt on', () => {
  const at = (iso) => catalogExpiry(BUNDLED, Date.parse(iso));
  assert.deepEqual(at('2026-11-20T12:00:00Z'), { expired: false, daysLeft: 19 });
  assert.deepEqual(at('2026-12-09T23:00:00Z'), { expired: false, daysLeft: 0 });
  assert.deepEqual(at('2026-12-10T00:00:00Z'), { expired: true, daysAgo: 0 });
  assert.deepEqual(at('2026-12-12T20:00:00Z'), { expired: true, daysAgo: 2 });
});
