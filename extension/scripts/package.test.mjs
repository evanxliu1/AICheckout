import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { BADGE_HOST_PERMISSIONS, BADGE_MATCHES, inspectBuild, packageExtension } from './release-package.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aicheckout-package-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  const put = (path, data) => {
    const target = join(dist, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  };
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  manifest.background.service_worker = 'service-worker-loader.js';
  manifest.host_permissions = [...BADGE_HOST_PERMISSIONS];
  manifest.web_accessible_resources = [
    { matches: [...BADGE_HOST_PERMISSIONS], resources: ['src/badge/index.html'], use_dynamic_url: false },
  ];
  manifest.content_scripts = [
    { matches: [...BADGE_MATCHES], js: ['src/badge/content.js'], run_at: 'document_idle', all_frames: false },
  ];
  const save = () => put('manifest.json', JSON.stringify(manifest));
  save();
  put('service-worker-loader.js', "import './assets/worker-test.js';");
  put('assets/worker-test.js', 'export const ready = true;');
  put('assets/popup-test.js', 'document.body.textContent = "fixture";');
  put('src/checkout/content.js', 'globalThis.reader = true;');
  put('src/badge/content.js', 'globalThis.badge = true;');
  for (const page of ['src/popup/index.html', 'src/badge/index.html', 'src/onboarding/index.html'])
    put(page, '<script type="module" src="/assets/popup-test.js"></script>');
  for (const size of [16, 48, 128])
    put(
      `public/icons/icon${size}.png`,
      readFileSync(new URL(`../public/icons/icon${size}.png`, import.meta.url)),
    );
  const pkg = join(root, 'package.json');
  writeFileSync(pkg, JSON.stringify({ version: '2.0.0' }));
  return {
    root,
    dist,
    put,
    manifest,
    save,
    package: () => packageExtension(dist, pkg, join(root, 'artifacts')),
  };
}

test('ZIP is byte reproducible despite source timestamps/modes; inventory matches extracted bytes', (t) => {
  const f = fixture(t);
  f.put('vite.svg', 'excluded build scaffold');
  f.put('.vite/manifest.json', '{}');
  const first = f.package();
  const bytes = readFileSync(first.artifact);
  utimesSync(join(f.dist, 'assets/popup-test.js'), new Date(), new Date());
  chmodSync(join(f.dist, 'assets/popup-test.js'), 0o755);
  const second = f.package();
  assert.deepEqual(readFileSync(second.artifact), bytes);
  const inventory = JSON.parse(readFileSync(second.inventory, 'utf8'));
  assert.equal(inventory.sha256, createHash('sha256').update(bytes).digest('hex'));
  const entries = execFileSync('unzip', ['-Z1', second.artifact], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(
    entries,
    inventory.files.map((file) => file.path),
  );
  assert.ok(entries.includes('manifest.json'));
  assert.ok(!entries.includes('vite.svg') && !entries.some((path) => path.startsWith('.vite/')));
  for (const file of inventory.files) {
    const extracted = execFileSync('unzip', ['-p', second.artifact, file.path]);
    assert.equal(file.bytes, extracted.length);
    assert.equal(file.sha256, createHash('sha256').update(extracted).digest('hex'));
  }
});

test('unexpected permissions, entry paths and manifest capabilities cannot replace an existing artifact', (t) => {
  const f = fixture(t);
  const first = f.package();
  const original = readFileSync(first.artifact);
  const baseline = structuredClone(f.manifest);
  for (const change of [
    (m) => {
      m.permissions.push('tabs');
    },
    (m) => {
      m.host_permissions = [...BADGE_HOST_PERMISSIONS, 'https://*.example.com/*'];
    },
    (m) => {
      m.host_permissions = [...BADGE_HOST_PERMISSIONS, 'http://catalog.example/*'];
    },
    (m) => {
      m.host_permissions = [...BADGE_HOST_PERMISSIONS, 'https://user:password@catalog.example/*'];
    },
    (m) => {
      // Nothing is added beyond every https site and one catalog origin.
      m.host_permissions = [
        ...BADGE_HOST_PERMISSIONS,
        'https://www.walmart.com/*',
        'https://catalog.example/*',
      ];
    },
    (m) => {
      m.host_permissions = BADGE_HOST_PERMISSIONS.slice(1);
    },
    (m) => {
      m.content_scripts[0].matches.push('https://*/*');
    },
    (m) => {
      m.content_scripts[0].all_frames = true;
    },
    (m) => {
      m.web_accessible_resources[0].matches = ['<all_urls>'];
    },
    (m) => {
      m.background.service_worker = '../outside.js';
    },
    (m) => {
      m.action.default_popup = 'https://example.com';
    },
    (m) => {
      m.content_scripts = [{ matches: ['<all_urls>'], js: ['assets/popup-test.js'] }];
    },
    (m) => {
      delete m.content_scripts;
    },
    (m) => {
      m.version = '2.0.1';
    },
  ]) {
    Object.keys(f.manifest).forEach((key) => delete f.manifest[key]);
    Object.assign(f.manifest, structuredClone(baseline));
    change(f.manifest);
    f.save();
    assert.throws(f.package);
    assert.deepEqual(readFileSync(first.artifact), original);
  }
});

test('one configured HTTPS catalog origin is recorded explicitly', (t) => {
  const f = fixture(t);
  f.manifest.host_permissions = [...BADGE_HOST_PERMISSIONS, 'https://catalog.example:8443/*'];
  f.save();
  const result = f.package();
  assert.equal(JSON.parse(readFileSync(result.inventory)).catalogOrigin, 'https://catalog.example:8443');
});

test('extra files and symlinks fail closed, including symlinks under ignored names', (t) => {
  const f = fixture(t);
  for (const path of [
    '.env',
    'credentials.json',
    'assets/popup-test.js.map',
    'assets/debug.txt',
    '.vite/private.json',
  ]) {
    f.put(path, 'must not ship');
    assert.throws(() => inspectBuild(f.dist, '2.0.0'), /Unexpected packaged file/);
    rmSync(join(f.dist, path));
  }
  for (const path of ['assets/linked.js', 'vite.svg']) {
    symlinkSync(join(f.root, 'package.json'), join(f.dist, path));
    assert.throws(() => inspectBuild(f.dist, '2.0.0'), /Symlink/);
    rmSync(join(f.dist, path));
  }
});

test('bundled woff2 theme fonts are packaged; other font formats are not', (t) => {
  const f = fixture(t);
  f.put('assets/figtree-latin-wght-normal-Ab12.woff2', 'wOF2');
  assert.doesNotThrow(() => inspectBuild(f.dist, '2.0.0'));
  f.put('assets/figtree-latin-wght-normal-Ab12.ttf', 'ttf');
  assert.throws(() => inspectBuild(f.dist, '2.0.0'), /Unexpected packaged file/);
});

test('missing references, private-key tripwires, dev clients and wrongly sized icons fail inspection', (t) => {
  const f = fixture(t);
  const asset = readFileSync(join(f.dist, 'assets/popup-test.js'));
  rmSync(join(f.dist, 'assets/popup-test.js'));
  assert.throws(() => inspectBuild(f.dist, '2.0.0'), /missing page asset/);
  for (const text of [
    'sk-proj-' + 'x'.repeat(40),
    'sb_secret_' + 'x'.repeat(40),
    'import "/@vite/client"',
    '//# sourceMappingURL=test.js.map',
  ]) {
    f.put('assets/popup-test.js', text);
    assert.throws(() => inspectBuild(f.dist, '2.0.0'), /credential|Development reference/);
  }
  f.put('assets/popup-test.js', asset);
  f.put('public/icons/icon16.png', readFileSync(join(f.dist, 'public/icons/icon128.png')));
  assert.throws(() => inspectBuild(f.dist, '2.0.0'), /Invalid 16px PNG/);
});

test('the badge reach is exactly every https site (Phase 13c; changing it must change this test)', () => {
  assert.deepEqual(BADGE_HOST_PERMISSIONS, ['https://*/*']);
  assert.deepEqual(BADGE_MATCHES, ['https://*/*']);
});
