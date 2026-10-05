#!/usr/bin/env node
// Seeded, deterministic selections over the frozen retail frame (evals/merchants/retail-frame.json), pre-registered
// in docs/evals/generic-reader-protocol.md. No network, no randomness: every order is the ascending hex SHA-256 of
// "<SEED>|<purpose>|<domain>".
//
//   node evals/merchants/tools/seeded-selection.mjs pipeline-heldout [--check]   write or check the held-out domains
//   node evals/merchants/tools/seeded-selection.mjs reader-candidates           print the Phase 12.3 visit order
//   node evals/merchants/tools/seeded-selection.mjs split <captured.json>       print the split of captured sites
//   node evals/merchants/tools/seeded-selection.mjs check-frame <tranco.csv>    check the frame's ranks and bands
//
// <captured.json>: [{ "domain": "x.com", "band": "1k-10k", "platform": "shopify" }, ...]; probe sites are read from
// the frame. Output of `split`: [{ domain, band, platform, split }] in assignment order.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED = 'ai-checkout/phase-12/2026-10-06';
export const BANDS = ['top-1k', '1k-10k', '10k-100k'];
export const PLATFORMS = ['shopify', 'sfcc', 'adobe-commerce', 'sap-commerce', 'bigcommerce', 'other-detected', 'none-detected'];
export const PIPELINE_HELDOUT_PER_BAND = { 'top-1k': 6, '1k-10k': 27, '10k-100k': 27 };
export const READER_CANDIDATES = 300;
const SPLITS_TIE_ORDER = ['heldout-a', 'heldout-b', 'development'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const framePath = join(root, 'retail-frame.json');
const heldoutPath = join(root, 'pipeline-heldout-domains.json');

export const key = (purpose, domain) => createHash('sha256').update(`${SEED}|${purpose}|${domain}`).digest('hex');
const byKey = (purpose) => (a, b) => (key(purpose, a.domain) < key(purpose, b.domain) ? -1 : 1);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function loadFrame() {
  const text = readFileSync(framePath, 'utf8');
  return { frame: JSON.parse(text), frameSha256: sha256(text) };
}

function pipelineHeldout() {
  const { frame, frameSha256 } = loadFrame();
  const domains = [];
  for (const band of BANDS) {
    const pool = frame.domains.filter((d) => d.eligible && d.band === band).sort(byKey('pipeline-heldout'));
    for (const d of pool.slice(0, PIPELINE_HELDOUT_PER_BAND[band])) {
      domains.push({ domain: d.domain, trancoRank: d.trancoRank, band, key: key('pipeline-heldout', d.domain) });
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

function readerCandidates() {
  const { frame } = loadFrame();
  const eligible = frame.domains.filter((d) => d.eligible);
  const order = [];
  for (const band of BANDS) order.push(...eligible.filter((d) => d.band === band).sort(byKey('reader-candidates')));
  const fixed = order.filter((d) => d.band !== '10k-100k' || d.probeSite);
  const room = READER_CANDIDATES - fixed.length;
  const drawn = new Set(order.filter((d) => d.band === '10k-100k' && !d.probeSite).slice(0, room).map((d) => d.domain));
  return order
    .filter((d) => d.band !== '10k-100k' || d.probeSite || drawn.has(d.domain))
    .map((d, i) => ({ visit: i + 1, domain: d.domain, trancoRank: d.trancoRank, band: d.band, probeSite: d.probeSite }));
}

function split(captured) {
  const { frame } = loadFrame();
  const probe = new Set(frame.domains.filter((d) => d.probeSite).map((d) => d.domain));
  const count = new Map();
  const bump = (k) => count.set(k, (count.get(k) ?? 0) + 1);
  const get = (k) => count.get(k) ?? 0;
  const out = [];
  const assign = (site, s) => {
    out.push({ ...site, split: s });
    bump(`${s}|${site.band}|${site.platform}`);
    bump(`${s}|${site.band}`);
    bump(s);
  };
  for (const site of captured) {
    if (!BANDS.includes(site.band) || !PLATFORMS.includes(site.platform)) throw new Error(`bad site ${JSON.stringify(site)}`);
  }
  for (const site of captured.filter((s) => probe.has(s.domain))) assign(site, 'development');
  for (const band of BANDS) {
    for (const platform of PLATFORMS) {
      const stratum = captured
        .filter((s) => !probe.has(s.domain) && s.band === band && s.platform === platform)
        .sort(byKey('reader-split'));
      for (const site of stratum) {
        const rank = (s) => [get(`${s}|${band}|${platform}`), get(`${s}|${band}`), get(s), SPLITS_TIE_ORDER.indexOf(s)];
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
  return out;
}

const [command, arg] = process.argv.slice(2);
if (command === 'pipeline-heldout') {
  const text = `${JSON.stringify(pipelineHeldout(), null, 1)}\n`;
  if (arg === '--check') {
    const same = readFileSync(heldoutPath, 'utf8') === text;
    console.log(same ? `ok ${sha256(text)}` : 'MISMATCH: pipeline-heldout-domains.json differs from the procedure');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(heldoutPath, text);
  console.log(`wrote ${heldoutPath} sha256 ${sha256(text)}`);
} else if (command === 'reader-candidates') {
  console.log(JSON.stringify(readerCandidates(), null, 1));
} else if (command === 'check-frame' && arg) {
  const ranks = new Map();
  for (const line of readFileSync(arg, 'utf8').split('\n')) {
    const i = line.indexOf(',');
    if (i > 0) ranks.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
  }
  const band = (r) => (r == null ? 'unranked' : r <= 1000 ? 'top-1k' : r <= 10000 ? '1k-10k' : r <= 100000 ? '10k-100k' : 'beyond-100k');
  const bad = loadFrame().frame.domains.filter((d) => (ranks.get(d.domain) ?? null) !== d.trancoRank || band(d.trancoRank) !== d.band);
  console.log(bad.length === 0 ? 'ok: every rank and band matches' : `MISMATCH: ${bad.map((d) => d.domain).join(' ')}`);
  process.exit(bad.length === 0 ? 0 : 1);
} else if (command === 'split' && arg) {
  console.log(JSON.stringify(split(JSON.parse(readFileSync(arg, 'utf8'))), null, 1));
} else {
  console.error('usage: seeded-selection.mjs pipeline-heldout [--check] | reader-candidates | split <captured.json> | check-frame <tranco.csv>');
  process.exit(2);
}
