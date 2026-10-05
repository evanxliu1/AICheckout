#!/usr/bin/env node
// Seeded, deterministic selections pre-registered in docs/evals/generic-reader-protocol.md. No network, no randomness,
// no exact ranks: every selection depends only on each domain's band, eligibility, region group and probe status in a
// frozen frame and on the ascending hex SHA-256 of "<SEED>|<purpose>|<domain>".
//
// generic-reader-protocol.2 (2026-10-05) moved the reader evaluation to retail-frame.2 (worldwide, retail-frame-2.json).
// The merchant-pipeline held-out list stays on retail-frame.1 (retail-frame.json) and its procedure is unchanged.
//
//   node evals/merchants/tools/seeded-selection.mjs pipeline-heldout [--check]        write or check the held-out list
//   node evals/merchants/tools/seeded-selection.mjs reader-candidates [extras]        print both streams' visit orders
//   node evals/merchants/tools/seeded-selection.mjs split <captured.json> [extras]    print the split of captured sites
//   node evals/merchants/tools/seeded-selection.mjs check-frame <tranco.csv> [--frame 1|2]   check a frame's bands
//
// [extras]: --extra-us N and --extra-non-us N extend a stream's 200 candidates by its next N 10k-100k domains (only with
// Evan's approval, protocol "Candidate sampling" step 4).
// <captured.json>: [{ "domain": "x.com", "platform": "shopify" }, ...]. Nothing else: band, region group and probe
// status come from the frame, and the split never sees anything seen in a page except the platform group the
// committed marker script detected.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SEED = 'ai-checkout/phase-12/2026-10-06';
export const BANDS = ['top-1k', '1k-10k', '10k-100k'];
export const REGION_GROUPS = ['us', 'canada-latam', 'europe', 'asia-pacific', 'middle-east-africa'];
export const STREAMS = ['us', 'non-us'];
export const PLATFORMS = ['shopify', 'sfcc', 'adobe-commerce', 'sap-commerce', 'bigcommerce', 'other-detected', 'none-detected'];
export const PIPELINE_HELDOUT_PER_BAND = { 'top-1k': 6, '1k-10k': 27, '10k-100k': 27 };
export const CANDIDATES_PER_STREAM = 200;
const SPLITS_TIE_ORDER = ['heldout-a', 'heldout-b', 'development'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const framePaths = { 1: join(root, 'retail-frame.json'), 2: join(root, 'retail-frame-2.json') };
const heldoutPath = join(root, 'pipeline-heldout-domains.json');

export const key = (purpose, domain) => createHash('sha256').update(`${SEED}|${purpose}|${domain}`).digest('hex');
const byKey = (purpose) => (a, b) => (key(purpose, a.domain) < key(purpose, b.domain) ? -1 : 1);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const streamOf = (d) => (d.regionGroup === 'us' ? 'us' : 'non-us');

export function loadFrame(version = 1) {
  const text = readFileSync(framePaths[version], 'utf8');
  return { frame: JSON.parse(text), frameSha256: sha256(text) };
}

// retail-frame.1 only; unchanged since generic-reader-protocol.1.
export function pipelineHeldout(frame, frameSha256) {
  const domains = [];
  for (const band of BANDS) {
    const pool = frame.domains.filter((d) => d.eligible && d.band === band).sort(byKey('pipeline-heldout'));
    for (const d of pool.slice(0, PIPELINE_HELDOUT_PER_BAND[band])) {
      domains.push({ domain: d.domain, band, key: key('pipeline-heldout', d.domain) });
    }
  }
  return {
    list: 'merchant-pipeline-heldout.1',
    frozenOn: '2026-10-06',
    frame: frame.frame,
    frameSha256,
    seed: SEED,
    procedure:
      'Per band, eligible frame domains in ascending SHA-256("<seed>|pipeline-heldout|<domain>"); the first 6 / 27 / 27. See docs/evals/generic-reader-protocol.md#merchant-pipeline-held-out-domains',
    perBand: PIPELINE_HELDOUT_PER_BAND,
    domains,
  };
}

function requireFrame2(frame) {
  if (frame.frame !== 'retail-frame.2') throw new Error(`reader selections need retail-frame.2, got ${frame.frame}`);
}

// Per stream: every eligible top-1k and 1k-10k domain, every probe site, then 10k-100k domains in key order up to
// 200 (+ extra). Visit order: bands top-first, key order within a band.
export function readerCandidates(frame, extra = {}) {
  requireFrame2(frame);
  const out = [];
  for (const stream of STREAMS) {
    const eligible = frame.domains.filter((d) => d.eligible && streamOf(d) === stream);
    const order = [];
    for (const band of BANDS) order.push(...eligible.filter((d) => d.band === band).sort(byKey('reader-candidates')));
    const fixed = order.filter((d) => d.band !== '10k-100k' || d.probeSite);
    const room = CANDIDATES_PER_STREAM + (extra[stream] ?? 0) - fixed.length;
    const drawn = new Set(
      order
        .filter((d) => d.band === '10k-100k' && !d.probeSite)
        .slice(0, Math.max(0, room))
        .map((d) => d.domain),
    );
    order
      .filter((d) => d.band !== '10k-100k' || d.probeSite || drawn.has(d.domain))
      .forEach((d, i) =>
        out.push({
          stream,
          visit: i + 1,
          domain: d.domain,
          band: d.band,
          regionGroup: d.regionGroup,
          region: d.region,
          currency: d.currency,
          probeSite: d.probeSite,
        }),
      );
  }
  return out;
}

export function split(frame, captured, extra = {}) {
  const candidates = new Map(readerCandidates(frame, extra).map((c) => [c.domain, c]));
  const seen = new Set();
  const sites = captured.map((site) => {
    const extraKeys = Object.keys(site).filter((k) => k !== 'domain' && k !== 'platform');
    if (extraKeys.length > 0) throw new Error(`split takes domain and platform only, got ${extraKeys.join(', ')}`);
    const c = candidates.get(site.domain);
    if (!c) throw new Error(`not a reader candidate: ${site.domain}`);
    if (seen.has(site.domain)) throw new Error(`duplicate site: ${site.domain}`);
    if (!PLATFORMS.includes(site.platform)) throw new Error(`unknown platform for ${site.domain}: ${site.platform}`);
    seen.add(site.domain);
    return {
      domain: site.domain,
      band: c.band,
      regionGroup: c.regionGroup,
      platform: site.platform,
      probeSite: c.probeSite,
    };
  });
  const count = new Map();
  const bump = (k) => count.set(k, (count.get(k) ?? 0) + 1);
  const get = (k) => count.get(k) ?? 0;
  const out = [];
  const assign = (site, s) => {
    out.push({
      domain: site.domain,
      band: site.band,
      regionGroup: site.regionGroup,
      platform: site.platform,
      split: s,
    });
    bump(`${s}|${site.band}|${site.regionGroup}|${site.platform}`);
    bump(`${s}|${site.band}|${site.regionGroup}`);
    bump(`${s}|${site.regionGroup}`);
    bump(`${s}|${site.band}`);
    bump(s);
  };
  for (const site of sites.filter((s) => s.probeSite)) assign(site, 'development');
  for (const band of BANDS) {
    for (const group of REGION_GROUPS) {
      for (const platform of PLATFORMS) {
        const stratum = sites
          .filter((s) => !s.probeSite && s.band === band && s.regionGroup === group && s.platform === platform)
          .sort(byKey('reader-split'));
        for (const site of stratum) {
          const rank = (s) => [
            get(`${s}|${band}|${group}|${platform}`),
            get(`${s}|${band}|${group}`),
            get(`${s}|${group}`),
            get(`${s}|${band}`),
            get(s),
            SPLITS_TIE_ORDER.indexOf(s),
          ];
          const best = [...SPLITS_TIE_ORDER].sort((a, b) => {
            const ra = rank(a);
            const rb = rank(b);
            for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
            return 0;
          })[0];
          assign(site, best);
        }
      }
    }
  }
  return out;
}

export const bandOf = (r) =>
  r == null ? 'unranked' : r <= 1000 ? 'top-1k' : r <= 10000 ? '1k-10k' : r <= 100000 ? '10k-100k' : 'beyond-100k';

function main(argv) {
  const [command, arg] = argv;
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const extra = { us: Number(flag('--extra-us') ?? 0), 'non-us': Number(flag('--extra-non-us') ?? 0) };
  if (command === 'pipeline-heldout') {
    const { frame, frameSha256 } = loadFrame(1);
    const text = `${JSON.stringify(pipelineHeldout(frame, frameSha256), null, 1)}\n`;
    if (arg === '--check') {
      const same = readFileSync(heldoutPath, 'utf8') === text;
      console.log(same ? `ok ${sha256(text)}` : 'MISMATCH: pipeline-heldout-domains.json differs from the procedure');
      return same ? 0 : 1;
    }
    writeFileSync(heldoutPath, text);
    console.log(`wrote ${heldoutPath} sha256 ${sha256(text)}`);
    return 0;
  }
  if (command === 'check-frame' && arg) {
    const { frame } = loadFrame(Number(flag('--frame') ?? 2));
    const ranks = new Map();
    for (const line of readFileSync(arg, 'utf8').split('\n')) {
      const i = line.indexOf(',');
      if (i > 0) ranks.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
    }
    const bad = frame.domains.filter((d) => bandOf(ranks.get(d.domain) ?? null) !== d.band);
    console.log(
      bad.length === 0 ? `ok: every band in ${frame.frame} matches` : `MISMATCH: ${bad.map((d) => d.domain).join(' ')}`,
    );
    return bad.length === 0 ? 0 : 1;
  }
  const { frame } = loadFrame(2);
  if (command === 'reader-candidates') {
    console.log(JSON.stringify(readerCandidates(frame, extra), null, 1));
    return 0;
  }
  if (command === 'split' && arg) {
    console.log(JSON.stringify(split(frame, JSON.parse(readFileSync(arg, 'utf8')), extra), null, 1));
    return 0;
  }
  console.error(
    'usage: seeded-selection.mjs pipeline-heldout [--check] | reader-candidates | split <captured.json> | check-frame <tranco.csv> [--frame 1|2]; [--extra-us N] [--extra-non-us N]',
  );
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
