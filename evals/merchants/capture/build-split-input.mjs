#!/usr/bin/env node
// Split input of Phase 12.3 (docs/evals/generic-reader-protocol.md#platform-detection, "Split input"): one row per
// captured domain, `{domain, platform}`, from two sources, plus the capture method of each row.
//   Pane: a store whose record `records/<domain>.pane.json` has `outcome.status` `captured` and whose collector
//         stamp (`collected.exports`) has at least one cart-state export (protocol .9: captured when any real
//         cart-state export with the operator's item exists). The platform is pane-platform.mjs's over
//         `data/pane/<domain>/`, and each export it reads must have the SHA-256 the collector recorded.
//   Robot: a standing robot capture in sites.json, by its latest `statusUnderProtocolN` with N >= 8:
//         `captured-stands` or `captured-pending-review`. The platform is the latest `protocolN.platform` group in
//         its site record, else its top-level `platform`.
// A domain with both is refused (a domain has one row: its standing capture). Writes captured.json
// ([{domain, platform}], what `seeded-selection.mjs split` takes) and captured-methods.json ([{domain, method}]),
// and prints a text-free report with the stores that were not taken and why.
//
//   node evals/merchants/capture/build-split-input.mjs [--data <capture/data/pane>] [--records <capture/records>]
//        [--sites <sites.json>] [--out-dir <dir>]
// then (protocol .10, frozen candidate list .8):
//   node evals/merchants/tools/seeded-selection.mjs split evals/merchants/captured.json \
//        --extra-us 225 --extra-non-us 800 --weights-protocol-10 > evals/merchants/splits.json
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PANE_CART_STATES, storePlatform } from './pane-platform.mjs';
import { PLATFORMS } from '../tools/seeded-selection.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MERCHANTS = path.join(here, '..');
const ROBOT_CAPTURED = ['captured-stands', 'captured-pending-review'];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The site's latest `<prefix>N` value for N >= min: [N, value] or null. */
function latest(site, prefix, min = 0) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const hits = Object.entries(site)
    .map(([k, v]) => [Number(k.match(re)?.[1]), v])
    .filter(([n, v]) => n >= min && v != null)
    .sort((a, b) => b[0] - a[0]);
  return hits[0] ?? null;
}

/** Standing robot captures: [{domain, platform}] and skipped [{domain, reason}]. */
export function robotRows(sites) {
  const rows = [];
  const skipped = [];
  for (const site of sites.sites ?? []) {
    const status = latest(site, 'statusUnderProtocol', 8)?.[1]?.status;
    if (!ROBOT_CAPTURED.includes(status)) continue;
    const platforms = Object.entries(site)
      .map(([k, v]) => [Number(k.match(/^protocol(\d+)$/)?.[1]), v?.platform?.group])
      .filter(([n, g]) => n >= 0 && g)
      .sort((a, b) => b[0] - a[0]);
    const platform = platforms[0]?.[1] ?? site.platform?.group;
    if (!PLATFORMS.includes(platform))
      skipped.push({ domain: site.domain, reason: 'robot-without-platform' });
    else rows.push({ domain: site.domain, platform });
  }
  return { rows, skipped };
}

/** Captured pane stores: [{domain, platform}] and skipped [{domain, reason}]. */
export async function paneRows(recordsDir, dataDir) {
  const rows = [];
  const skipped = [];
  const files = existsSync(recordsDir)
    ? readdirSync(recordsDir)
        .filter((f) => f.endsWith('.pane.json'))
        .sort()
    : [];
  for (const f of files) {
    const record = JSON.parse(readFileSync(path.join(recordsDir, f), 'utf8'));
    const domain = record.domain;
    if (`${domain}.pane.json` !== f)
      throw new Error(`${f}: record domain ${domain} doesn't match its file name`);
    if (record.outcome?.status !== 'captured') continue;
    const collected = new Map(
      (record.collected?.exports ?? []).filter((e) => e.kind === 'state').map((e) => [e.target, e.sha256]),
    );
    if (!PANE_CART_STATES.some((s) => collected.has(s))) {
      skipped.push({ domain, reason: 'captured-without-collected-cart-export' });
      continue;
    }
    const p = await storePlatform(dataDir, domain);
    if (!p.states.some((s) => PANE_CART_STATES.includes(s))) {
      skipped.push({ domain, reason: 'cart-export-missing-in-data' });
      continue;
    }
    const stale = p.states.filter(
      (s) => collected.get(s) !== sha256(readFileSync(path.join(dataDir, domain, s, 'dom.json'))),
    );
    if (stale.length)
      throw new Error(`${domain}: ${stale.join(', ')} export is not the one the collector recorded`);
    rows.push({ domain, platform: p.group });
  }
  return { rows, skipped };
}

/** Build both files' contents: { captured, methods, skipped }. */
export async function buildSplitInput({ dataDir, recordsDir, sitesFile }) {
  const pane = await paneRows(recordsDir, dataDir);
  const robot = robotRows(JSON.parse(readFileSync(sitesFile, 'utf8')));
  const paneDomains = new Set(pane.rows.map((r) => r.domain));
  const both = robot.rows.filter((r) => paneDomains.has(r.domain)).map((r) => r.domain);
  if (both.length)
    throw new Error(`captured by both pane and robot (one row per domain): ${both.join(', ')}`);
  const tagged = [
    ...pane.rows.map((r) => ({ ...r, method: 'pane' })),
    ...robot.rows.map((r) => ({ ...r, method: 'robot' })),
  ].sort((a, b) => (a.domain < b.domain ? -1 : 1));
  return {
    captured: tagged.map(({ domain, platform }) => ({ domain, platform })),
    methods: tagged.map(({ domain, method }) => ({ domain, method })),
    skipped: [...pane.skipped, ...robot.skipped],
  };
}

async function main(argv) {
  const opt = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const outDir = opt('--out-dir', MERCHANTS);
  const r = await buildSplitInput({
    dataDir: opt('--data', path.join(here, 'data', 'pane')),
    recordsDir: opt('--records', path.join(here, 'records')),
    sitesFile: opt('--sites', path.join(MERCHANTS, 'sites.json')),
  });
  writeFileSync(path.join(outDir, 'captured.json'), JSON.stringify(r.captured, null, 1) + '\n');
  writeFileSync(path.join(outDir, 'captured-methods.json'), JSON.stringify(r.methods, null, 1) + '\n');
  const perMethod = {};
  r.captured.forEach((c, i) => {
    const m = (perMethod[r.methods[i].method] ??= {});
    m[c.platform] = (m[c.platform] ?? 0) + 1;
  });
  console.log(
    JSON.stringify({ rows: r.captured.length, platformsPerMethod: perMethod, skipped: r.skipped }, null, 1),
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exitCode = 1;
    },
  );
