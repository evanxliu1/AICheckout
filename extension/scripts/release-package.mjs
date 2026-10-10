import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const invariant = (value, message) => {
  if (!value) throw new Error(message);
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
/** The automatic badge's reach (Phase 13c, decision 2026-10-09-badge-on-all-sites): every https site, so the
 * badge can recognise a cart at any store. It must match `vite.config.ts`. */
export const BADGE_HOST_PERMISSIONS = ['https://*/*'];
export const BADGE_MATCHES = ['https://*/*'];
const PAGES = ['src/popup/index.html', 'src/badge/index.html', 'src/onboarding/index.html'];
const manifestKeys = [
  'manifest_version',
  'name',
  'version',
  'description',
  'permissions',
  'minimum_chrome_version',
  'host_permissions',
  'background',
  'action',
  'icons',
  'web_accessible_resources',
  'content_scripts',
];
const ignored = (path) =>
  path === '.vite/manifest.json' ||
  path === 'vite.svg' ||
  /(^|\/)\.DS_Store$/.test(path) ||
  /^icons\/icon(16|48|128)\.png$/.test(path);
const runtime = (path) =>
  [
    'manifest.json',
    'service-worker-loader.js',
    'src/checkout/content.js',
    'src/badge/content.js',
    ...PAGES,
  ].includes(path) ||
  // Self-hosted theme fonts (packages/ui/src/theme.css) are bundled as woff2 assets.
  /^assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2)$/.test(path) ||
  /^public\/icons\/icon(16|48|128)\.png$/.test(path);

function collect(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix + entry.name;
      invariant(!entry.isSymbolicLink(), `Symlink in build: ${path}`);
      if (entry.isDirectory()) return collect(join(directory, entry.name), `${path}/`);
      invariant(entry.isFile(), `Non-file in build: ${path}`);
      if (ignored(path)) return [];
      invariant(runtime(path), `Unexpected packaged file: ${path}`);
      return [path];
    })
    .sort();
}

export function inspectBuild(directory, expectedVersion) {
  invariant(
    lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
    'Build must be a real directory.',
  );
  const paths = collect(directory);
  const files = new Map(paths.map((path) => [path, readFileSync(join(directory, path))]));
  const manifest = JSON.parse(files.get('manifest.json')?.toString() ?? 'null');
  invariant(
    manifest && Object.keys(manifest).every((key) => manifestKeys.includes(key)),
    'Unexpected manifest field. Review changes before packaging.',
  );
  invariant(manifest.manifest_version === 3, 'Manifest V3 is required.');
  invariant(
    manifest.name === 'AI Checkout' &&
      typeof manifest.description === 'string' &&
      manifest.description.length > 0 &&
      manifest.description.length <= 132,
    'Invalid release name/description.',
  );
  invariant(
    manifest.version === expectedVersion &&
      /^\d+(\.\d+){1,3}$/.test(manifest.version) &&
      manifest.version.split('.').every((part) => String(Number(part)) === part && Number(part) <= 65535) &&
      manifest.version.split('.').some((part) => Number(part) > 0),
    'Invalid or mismatched release version.',
  );
  invariant(
    manifest.minimum_chrome_version === '120',
    'Review minimum Chrome version changes before packaging.',
  );
  invariant(
    Array.isArray(manifest.permissions) &&
      same([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage']),
    'Unexpected extension permissions.',
  );
  // Exactly every https site, plus at most one catalog origin (hosted builds).
  invariant(
    Array.isArray(manifest.host_permissions) &&
      same(manifest.host_permissions.slice(0, BADGE_HOST_PERMISSIONS.length), BADGE_HOST_PERMISSIONS) &&
      manifest.host_permissions.length <= BADGE_HOST_PERMISSIONS.length + 1,
    'Unexpected host permissions.',
  );
  let catalogOrigin = null;
  if (manifest.host_permissions.length > BADGE_HOST_PERMISSIONS.length) {
    const permission = manifest.host_permissions[BADGE_HOST_PERMISSIONS.length];
    const url = new URL(permission);
    invariant(
      url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !url.hostname.includes('*') &&
        permission === `${url.origin}/*`,
      'Catalog permission must be one exact HTTPS origin.',
    );
    invariant(!BADGE_HOST_PERMISSIONS.includes(permission), 'Unexpected host permissions.');
    catalogOrigin = url.origin;
  }
  invariant(
    same(manifest.background, { service_worker: 'service-worker-loader.js', type: 'module' }),
    'Unexpected background entry.',
  );
  invariant(
    manifest.action?.default_popup === 'src/popup/index.html' &&
      same(Object.keys(manifest.action).sort(), ['default_icon', 'default_popup']),
    'Unexpected popup entry.',
  );
  const expectedIcons = {
    16: 'public/icons/icon16.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  };
  invariant(
    same(manifest.icons, expectedIcons) && same(manifest.action.default_icon, expectedIcons),
    'Unexpected icon references.',
  );
  invariant(
    same(manifest.web_accessible_resources, [
      { matches: BADGE_HOST_PERMISSIONS, resources: ['src/badge/index.html'], use_dynamic_url: false },
    ]),
    'Unexpected web-accessible resources.',
  );
  invariant(
    same(manifest.content_scripts, [
      { matches: BADGE_MATCHES, js: ['src/badge/content.js'], run_at: 'document_idle', all_frames: false },
    ]),
    'Unexpected content scripts.',
  );
  for (const path of [
    'service-worker-loader.js',
    'src/checkout/content.js',
    'src/badge/content.js',
    ...PAGES,
    ...Object.values(expectedIcons),
  ]) {
    invariant(files.get(path)?.length, `Missing packaged entry: ${path}`);
  }
  for (const [size, path] of Object.entries(expectedIcons)) {
    const png = files.get(path);
    invariant(
      png.length >= 33 &&
        png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        png.toString('ascii', 12, 16) === 'IHDR' &&
        png.readUInt32BE(16) === Number(size) &&
        png.readUInt32BE(20) === Number(size),
      `Invalid ${size}px PNG icon.`,
    );
  }
  for (const [path, data] of files) {
    invariant(data.length <= 2_000_000, `Unexpected file size: ${path}`);
    if (!/\.(js|css|html|json)$/.test(path)) continue;
    const text = data.toString();
    // A conservative tripwire, not a general secret scanner or remote-code proof.
    invariant(
      !/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|\bsb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
        text,
      ),
      `Possible private credential in ${path}`,
    );
    invariant(
      !/@vite\/client|localhost:5173|sourceMappingURL=/.test(text),
      `Development reference in ${path}`,
    );
  }
  for (const page of PAGES) {
    const html = files.get(page).toString();
    for (const [, reference] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      invariant(
        reference.startsWith('/assets/') && files.has(reference.slice(1)),
        `Unexpected/missing page asset: ${reference}`,
      );
    }
  }
  return { manifest, catalogOrigin, files };
}

export function packageExtension(directory, packagePath, output) {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const { manifest, catalogOrigin, files } = inspectBuild(directory, pkg.version);
  mkdirSync(output, { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), 'aicheckout-package-'));
  const name = `ai-checkout-${manifest.version}`;
  const artifact = join(output, `${name}.zip`);
  const inventory = join(output, `${name}.inventory.json`);
  try {
    const staging = join(temporary, 'contents');
    mkdirSync(staging);
    const fixedTime = new Date('2000-01-01T00:00:00.000Z');
    for (const [path, data] of files) {
      const target = join(staging, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      chmodSync(target, 0o644);
      utimesSync(target, fixedTime, fixedTime);
    }
    const zip = join(temporary, `${name}.zip`);
    // Sorted names, fixed timestamps/modes and no extra OS metadata. Never run a shell.
    execFileSync('zip', ['-Xq', zip, '-@'], {
      cwd: staging,
      input: [...files.keys()].join('\n') + '\n',
      env: { ...process.env, TZ: 'UTC' },
    });
    execFileSync('unzip', ['-tqq', zip]);
    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    invariant(same(entries, [...files.keys()]), 'Archive contents differ from inspected files.');
    // Verify actual compressed bytes, not just the files we intended to include.
    for (const [path, data] of files) {
      invariant(
        execFileSync('unzip', ['-p', zip, path], { maxBuffer: 2_100_000 }).equals(data),
        `Archive content mismatch: ${path}`,
      );
    }
    const bytes = readFileSync(zip);
    const digest = sha256(bytes);
    const report = {
      schemaVersion: 1,
      artifact: `${name}.zip`,
      version: manifest.version,
      sha256: digest,
      bytes: bytes.length,
      catalogOrigin,
      permissions: manifest.permissions,
      hostPermissions: manifest.host_permissions,
      files: [...files].map(([path, data]) => ({ path, bytes: data.length, sha256: sha256(data) })),
    };
    // Stage on the output filesystem so final renames are atomic even when /tmp is on another volume.
    const staged = mkdtempSync(join(output, '.package-'));
    try {
      writeFileSync(join(staged, 'artifact.zip'), bytes);
      writeFileSync(join(staged, 'inventory.json'), JSON.stringify(report, null, 2) + '\n');
      renameSync(join(staged, 'artifact.zip'), artifact);
      renameSync(join(staged, 'inventory.json'), inventory);
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
    return { artifact, inventory, sha256: digest };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
