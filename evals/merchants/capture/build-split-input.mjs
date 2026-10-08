#!/usr/bin/env node
// Split input of Phase 12.3 (docs/evals/generic-reader-protocol.md#platform-detection, "Split input"): one row per
// captured domain, `{domain, platform}`, from two sources, plus the capture method of each row. A site's standing
// status is its latest `statusUnderProtocolN` with N >= 8 in sites.json.
//   Pane: the latest status has N >= 10, `method` `pane` and `status` `captured`. Its record
//         `records/<domain>.pane.json` must agree: `outcome.status` `captured`, and the status's `states` equal to
//         the collector's state targets (`collected.exports`, kind `state`), at least one of them a cart state
//         (protocol .9: captured when any real cart-state export with the operator's item exists). Every collected
//         state export must be at `data/pane/<domain>/<state>/dom.json` with the collected SHA-256, and no pane state
//         folder may lack a collected entry. A record that says captured while sites.json doesn't is refused too.
//         States in the record's `droppedStates` (capture review, 2026-10-08) are left out of the states and
//         allowed as folders; platform detection still reads the folders, so a drop never moves another store.
//         The platform is pane-platform.mjs's over `data/pane/<domain>/`.
//   Robot: the latest status has a `method` other than `pane` and is `captured-stands` or `captured-pending-review`.
//         The platform is that of the standing capture (the latest `protocolN` block of the site record with
//         `states`), else the top-level `platform`.
// Any disagreement throws; nothing is guessed. A domain listed twice in sites.json is refused. Writes captured.json
// ([{domain, platform}], what `seeded-selection.mjs split` takes) and captured-methods.json ([{domain, method}]),
// and prints a text-free report (platform groups per method, robot rows without a platform).
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
import { STATES as PANE_STATES } from './collect-pane-exports.mjs';
import { PANE_CART_STATES, storePlatform } from './pane-platform.mjs';
import { PLATFORMS } from '../tools/seeded-selection.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MERCHANTS = path.join(here, '..');
const ROBOT_CAPTURED = ['captured-stands', 'captured-pending-review'];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The site's latest `<prefix>N` value for N >= min (with a predicate): [N, value] or null. */
function latest(site, prefix, min = 0, ok = (v) => v != null) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const hits = Object.entries(site)
    .map(([k, v]) => [Number(k.match(re)?.[1]), v])
    .filter(([n, v]) => n >= min && ok(v))
    .sort((a, b) => b[0] - a[0]);
  return hits[0] ?? null;
}

/** The site's standing status: its latest `statusUnderProtocolN` with N >= 8, as [N, status], or null. */
export const standingStatus = (site) => latest(site, 'statusUnderProtocol', 8);

/** Whether the standing status is a pane capture (N >= 10, method pane, captured). */
export function isPaneCaptured(site) {
  const s = standingStatus(site);
  return Boolean(s && s[0] >= 10 && s[1].method === 'pane' && s[1].status === 'captured');
}

/** Whether the standing status is a standing robot capture. */
export function isRobotCaptured(site) {
  const s = standingStatus(site)?.[1];
  return Boolean(s && s.method !== 'pane' && ROBOT_CAPTURED.includes(s.status));
}

/** The standing robot capture: the latest `protocolN` block with `states` (else the top level). */
export function standingRobotCapture(site) {
  return latest(site, 'protocol', 0, (v) => Array.isArray(v?.states))?.[1] ?? site;
}

/**
 * States the coordinator dropped after the capture review (`droppedStates: [{state, reason, utc}]` in the record,
 * 2026-10-08): their exports stay recorded and on disk, but they are not page-states of the evaluation set.
 */
export const droppedStates = (record) => new Set((record.droppedStates ?? []).map((d) => d.state));

/** Collected state exports of a pane record, without dropped states: Map(state -> sha256). */
export const collectedStates = (record) => {
  const dropped = droppedStates(record);
  return new Map(
    (record.collected?.exports ?? [])
      .filter((e) => e.kind === 'state' && !dropped.has(e.target))
      .map((e) => [e.target, e.sha256]),
  );
};

const stateNames = (states) => (states ?? []).map((s) => (typeof s === 'string' ? s : s.state));

/** Refuse duplicate domains in sites.json. */
export function checkUniqueSites(sites) {
  const seen = new Set();
  for (const s of sites.sites ?? []) {
    if (seen.has(s.domain)) throw new Error(`duplicate domain in sites.json: ${s.domain}`);
    seen.add(s.domain);
  }
}

/** Standing robot captures: [{domain, platform}] and skipped [{domain, reason}]. */
export function robotRows(sites) {
  const rows = [];
  const skipped = [];
  for (const site of sites.sites ?? []) {
    if (!isRobotCaptured(site)) continue;
    const platform = standingRobotCapture(site).platform?.group ?? site.platform?.group;
    if (!PLATFORMS.includes(platform))
      skipped.push({ domain: site.domain, reason: 'robot-without-platform' });
    else rows.push({ domain: site.domain, platform });
  }
  return { rows, skipped };
}

/** Check one captured pane store's record and data against its sites.json status; returns the collected map. */
export function checkPaneStore(site, recordsDir, dataDir) {
  const domain = site.domain;
  const recordPath = path.join(recordsDir, `${domain}.pane.json`);
  if (!existsSync(recordPath)) throw new Error(`${domain}: sites.json says captured, no pane record`);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (record.domain !== domain) throw new Error(`${domain}: record domain ${record.domain} doesn't match`);
  if (record.outcome?.status !== 'captured')
    throw new Error(`${domain}: sites.json says captured, the record says ${record.outcome?.status}`);
  const collected = collectedStates(record);
  const listed = stateNames(standingStatus(site)[1].states).sort();
  if (listed.join() !== [...collected.keys()].sort().join())
    throw new Error(`${domain}: sites.json states [${listed.join(', ')}] are not the collected states`);
  if (!PANE_CART_STATES.some((s) => collected.has(s)))
    throw new Error(`${domain}: captured without a cart-state export`);
  for (const [state, sha] of collected) {
    const file = path.join(dataDir, domain, state, 'dom.json');
    if (!existsSync(file)) throw new Error(`${domain}: ${state} export is missing in the data`);
    if (sha256(readFileSync(file)) !== sha)
      throw new Error(`${domain}: ${state} export is not the one the collector recorded`);
  }
  const dir = path.join(dataDir, domain);
  for (const state of existsSync(dir) ? readdirSync(dir) : [])
    if (PANE_STATES.has(state) && !collected.has(state) && !droppedStates(record).has(state))
      throw new Error(`${domain}: state folder ${state} has no collected export`);
  return collected;
}

/** Captured pane stores: [{domain, platform}]. Throws on any disagreement between sites.json, records and data. */
export async function paneRows(sites, recordsDir, dataDir) {
  const captured = (sites.sites ?? []).filter(isPaneCaptured);
  const domains = new Set(captured.map((s) => s.domain));
  const files = existsSync(recordsDir) ? readdirSync(recordsDir).filter((f) => f.endsWith('.pane.json')) : [];
  for (const f of files.sort()) {
    const record = JSON.parse(readFileSync(path.join(recordsDir, f), 'utf8'));
    if (`${record.domain}.pane.json` !== f)
      throw new Error(`${f}: record domain ${record.domain} doesn't match its file name`);
    if (record.outcome?.status === 'captured' && !domains.has(record.domain))
      throw new Error(`${record.domain}: the record says captured, sites.json doesn't`);
  }
  const rows = [];
  for (const site of captured) {
    checkPaneStore(site, recordsDir, dataDir);
    rows.push({ domain: site.domain, platform: (await storePlatform(dataDir, site.domain)).group });
  }
  return { rows };
}

/** Build both files' contents: { captured, methods, skipped }. */
export async function buildSplitInput({ dataDir, recordsDir, sitesFile }) {
  const sites = JSON.parse(readFileSync(sitesFile, 'utf8'));
  checkUniqueSites(sites);
  const pane = await paneRows(sites, recordsDir, dataDir);
  const robot = robotRows(sites);
  const tagged = [
    ...pane.rows.map((r) => ({ ...r, method: 'pane' })),
    ...robot.rows.map((r) => ({ ...r, method: 'robot' })),
  ].sort((a, b) => (a.domain < b.domain ? -1 : 1));
  return {
    captured: tagged.map(({ domain, platform }) => ({ domain, platform })),
    methods: tagged.map(({ domain, method }) => ({ domain, method })),
    skipped: robot.skipped,
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
