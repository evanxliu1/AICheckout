// Which catalog and store list an inspected upload ZIP bundles (Phase 15.7). The worker chunk carries
// `CATALOG_V3` and `MERCHANTS_V1` as minified object literals whose first keys keep their source order, so the
// release headers can be read from the archive itself rather than trusted from the checkout that built it:
//   {schemaVersion:3,version:"2026-10-05.renewal.1",verifiedAt:"2026-10-05T00:00:00Z",expiresAt:"2026-11-04T00:00:00Z",…
//   {schemaVersion:1,version:"2026-10-11.mcc.3",verifiedAt:"2026-10-11T00:00:00Z",sources:[…
// The patterns also accept quoted keys, any quote style and whitespace (an unminified or JSON.parse-wrapped
// literal), and every `.js` entry is searched, so a moved chunk is still found. Anything else fails loudly:
// no header, more than one, or a timestamp that does not parse. The CLI is check-release-bundles.mjs; this
// module holds the pure parts so they can be tested.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const key = (name) => String.raw`["']?${name}["']?\s*:\s*`;
const text = String.raw`["'\x60]([^"'\x60\\]+)["'\x60]`;
const CATALOG_HEADER = new RegExp(
  String.raw`\{\s*${key('schemaVersion')}3\s*,\s*${key('version')}${text}\s*,\s*${key('verifiedAt')}${text}\s*,\s*${key('expiresAt')}${text}`,
  'g',
);
const MERCHANTS_HEADER = new RegExp(
  String.raw`\{\s*${key('schemaVersion')}1\s*,\s*${key('version')}${text}\s*,\s*${key('verifiedAt')}${text}\s*,\s*${key('sources')}\[`,
  'g',
);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Every ZIP entry name, as `unzip -Z1` lists them. */
export function zipEntries(zip) {
  return execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

/** The text of one ZIP entry, without extracting the archive. */
export function zipEntryText(zip, path) {
  return execFileSync('unzip', ['-p', zip, path], { encoding: 'utf8', maxBuffer: 8_000_000 });
}

function headers(files, pattern, name, pick) {
  const found = [];
  for (const [file, text] of files)
    for (const match of text.matchAll(pattern)) found.push({ file, ...pick(match) });
  if (found.length !== 1)
    throw new Error(
      found.length === 0
        ? `No bundled ${name} header found; the minified shape this check relies on may have changed.`
        : `${found.length} bundled ${name} headers found (${found.map((item) => item.file).join(', ')}); expected one.`,
    );
  for (const field of ['verifiedAt', 'expiresAt'])
    if (
      field in found[0] &&
      !(TIMESTAMP.test(found[0][field]) && Number.isFinite(Date.parse(found[0][field])))
    )
      throw new Error(`The bundled ${name} ${field} "${found[0][field]}" is not an ISO timestamp.`);
  return found[0];
}

/** The catalog and store-list release headers in the given bundle texts (`Map<path, text>`); exactly one each. */
export function findBundledReleases(files) {
  return {
    catalog: headers(files, CATALOG_HEADER, 'catalog', ([, version, verifiedAt, expiresAt]) => ({
      version,
      verifiedAt,
      expiresAt,
    })),
    merchants: headers(files, MERCHANTS_HEADER, 'store list', ([, version, verifiedAt]) => ({
      version,
      verifiedAt,
    })),
  };
}

/** The releases bundled in an upload ZIP, read from every `.js` entry (the worker chunk under `assets/` today). */
export function readZipBundles(zip) {
  const files = new Map(
    zipEntries(zip)
      .filter((path) => path.endsWith('.js'))
      .map((path) => [path, zipEntryText(zip, path)]),
  );
  if (files.size === 0) throw new Error('The ZIP has no .js entries.');
  return findBundledReleases(files);
}

/** Differences between the bundled headers and the expected releases (`[]` when they agree). */
export function compareBundles(bundled, expected) {
  const differences = [];
  for (const [kind, keys] of [
    ['catalog', ['version', 'verifiedAt', 'expiresAt']],
    ['merchants', ['version', 'verifiedAt']],
  ])
    for (const key of keys)
      if (bundled[kind][key] !== expected[kind][key])
        differences.push(`${kind} ${key}: bundled ${bundled[kind][key]}, expected ${expected[kind][key]}`);
  return differences;
}

async function hostedRelease(url, fetchImpl, describe) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(90_000), redirect: 'error' });
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { status: response.status, error: 'not JSON' };
  }
  if (!response.ok) return { status: response.status, error: body?.error ?? response.statusText };
  if (!body?.release) return { status: response.status, error: 'no release published' };
  return { status: response.status, sequence: body.release.sequence, ...describe(body.release) };
}

/** What the API serves at `/v1/catalog` and `/v1/merchants` on `origin` (an unreachable or 503 answer is
 * reported, never thrown). Render's free instance can take a minute to wake, hence the long timeout. */
export async function hostedReleases(origin, fetchImpl = fetch) {
  return {
    catalog: await hostedRelease(`${origin}/v1/catalog`, fetchImpl, (release) => ({
      version: release.version,
      verifiedAt: release.catalog?.verifiedAt,
      expiresAt: release.catalog?.expiresAt,
    })),
    merchants: await hostedRelease(`${origin}/v1/merchants`, fetchImpl, (release) => ({
      version: release.version,
      verifiedAt: release.release?.verifiedAt,
    })),
  };
}

/** Differences between the bundled headers and the hosted releases; an unavailable release is a difference. */
export function compareHosted(bundled, hosted) {
  const differences = [];
  for (const [kind, keys] of [
    ['catalog', ['version', 'verifiedAt', 'expiresAt']],
    ['merchants', ['version', 'verifiedAt']],
  ]) {
    if (hosted[kind].error) {
      differences.push(`hosted ${kind}: unavailable (${hosted[kind].status} ${hosted[kind].error})`);
      continue;
    }
    for (const key of keys)
      if (bundled[kind][key] !== hosted[kind][key])
        differences.push(`${kind} ${key}: bundled ${bundled[kind][key]}, hosted ${hosted[kind][key]}`);
  }
  return differences;
}

/** The bundled catalog's expiry as the extension judges it (expired from `expiresAt` on, like
 * `catalogExpired`), with whole days left or, once expired, whole days since. */
export function catalogExpiry(bundled, now = Date.now()) {
  const left = Date.parse(bundled.catalog.expiresAt) - now;
  return left > 0
    ? { expired: false, daysLeft: Math.floor(left / 86_400_000) }
    : { expired: true, daysAgo: Math.floor((now - Date.parse(bundled.catalog.expiresAt)) / 86_400_000) };
}

/** The CLI's options; an unknown option or a missing value is an error, so a typo never skips a check. */
export function parseCheckArgs(args) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { zip: { type: 'string' }, hosted: { type: 'boolean' }, json: { type: 'boolean' } },
  }).values;
}
