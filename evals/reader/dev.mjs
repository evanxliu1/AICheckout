#!/usr/bin/env node
// Quick development loop for the reader developer (Phase 13): reads every development page-state and variant once
// (after one warm-up read), several pages in parallel, and scores them against the frozen labels. It is NOT a
// scored run: nothing is written to runs.json, there is no stability pair, and it refuses any split but development.
// Official numbers come from run.mjs + score.mjs only. Same loaders, attribute stripping and bundle tripwire as
// run.mjs.
//
//   node evals/reader/dev.mjs [--concurrency 8] [--only <substring>] [--real-only] [--json <out.json>]
// Prints counts (shown-correct, shown-wrong, withheld; coverage on cart-1; variants per transform; max read ms) and
// every shown-wrong and coverage miss as `id | expected | output`.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleReader } from './bundle.mjs';
import { DEFAULTS, REPO_ROOT, loadFrozen } from './lib.mjs';
import {
  GENERIC,
  installReader,
  locate,
  openPane,
  openRobot,
  openVariant,
  readOnce,
  stripPaneAttributes,
} from './run.mjs';
import { outcome } from './score.mjs';

const SPLIT = 'development';
const fmt = (x) => (x?.shown === false ? `withheld:${x.reason}` : x ? `${x.kind} ${x.amountMinor} ${x.currency}` : 'null');
const fmtLabel = (l) => (l.expected ? fmt(l.expected) : `null:${l.expectedReason}`);

export async function devRun({ concurrency = 8, only = null, realOnly = false, root = REPO_ROOT } = {}) {
  const dataRoot = path.resolve(root, DEFAULTS.data);
  const variantRoot = path.resolve(root, DEFAULTS.variantData);
  const frozen = loadFrozen({ root, paneData: path.join(dataRoot, 'pane'), variantData: variantRoot });
  const labels = new Map(frozen.labels(SPLIT).labels.map((l) => [l.id, l]));
  const variants = frozen.variants(SPLIT);
  for (const l of variants.labels) labels.set(l.id, l);
  const bundle = await bundleReader({
    root,
    frameDomains: frozen.frameDomains(),
    splitDomains: [...new Set([...frozen.splitDomains(SPLIT), ...frozen.nonDevelopmentDomains()])],
  });
  const sites = JSON.parse(readFileSync(path.resolve(root, DEFAULTS.sites), 'utf8')).sites;
  const targets = frozen.snapshots(SPLIT).map((e) => ({ id: e.id, where: locate(e, { dataRoot, sites }) }));
  if (!realOnly)
    for (const v of variants.manifest.variants ?? []) {
      const domFile = path.join(variantRoot, v.path);
      targets.push({
        id: v.id,
        variant: true,
        where: {
          kind: 'variant',
          domFile,
          metaFile: path.join(path.dirname(domFile), 'variant.json'),
          domSha256: v.domSha256,
          variantSha256: v.variantSha256,
          label: labels.get(v.id),
        },
      });
    }
  const todo = only ? targets.filter((t) => t.id.includes(only)) : targets;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++];
      let opened = null;
      const row = { id: t.id, variant: Boolean(t.variant) };
      try {
        if (t.where.kind === 'pane') opened = await openPane(browser, t.where);
        else if (t.where.kind === 'variant') opened = await openVariant(browser, t.where);
        else opened = await openRobot(browser, t.where);
        await stripPaneAttributes(opened.page);
        await installReader(opened.page, bundle.code, GENERIC);
        await readOnce(opened.page, opened.url, GENERIC);
        const r = await readOnce(opened.page, opened.url, GENERIC);
        row.ms = Math.round(r.ms * 10) / 10;
        row.output = r.error ? { shown: false, reason: 'crash' } : r.output;
        if (r.error) row.error = r.error;
      } catch (e) {
        row.output = { shown: false, reason: 'harness-error' };
        row.error = String(e?.message ?? e).slice(0, 200);
      } finally {
        await opened?.close();
      }
      rows.push(row);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  } finally {
    await browser.close();
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const r of rows) {
    r.label = labels.get(r.id);
    r.outcome = outcome(r.label, r.output);
  }
  return rows;
}

export function summarize(rows) {
  const count = (rs) => {
    const c = { 'shown-correct': 0, 'shown-wrong': 0, withheld: 0 };
    for (const r of rs) c[r.outcome] += 1;
    return c;
  };
  const real = rows.filter((r) => !r.variant);
  const cart1 = real.filter((r) => r.label.state === 'cart-1' && r.label.expected);
  const vt = {};
  for (const t of new Set(rows.filter((r) => r.variant).map((r) => r.id.split('/')[2])))
    vt[t] = count(rows.filter((r) => r.variant && r.id.split('/')[2] === t));
  const ms = real.map((r) => r.ms ?? 0).sort((a, b) => a - b);
  return {
    real: count(real),
    coverageCart1: cart1.length ? Math.round((cart1.filter((r) => r.outcome === 'shown-correct').length / cart1.length) * 1000) / 10 : null,
    variants: count(rows.filter((r) => r.variant)),
    variantsPerTransform: vt,
    readMsP95: ms.length ? ms[Math.ceil(ms.length * 0.95) - 1] : null,
    readMsMax: ms.at(-1) ?? null,
    errors: rows.filter((r) => r.error).length,
  };
}

async function main(argv) {
  const opt = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--split') && opt('--split') !== SPLIT) throw new Error('dev.mjs runs development only');
  const rows = await devRun({
    concurrency: Number(opt('--concurrency') ?? 8),
    only: opt('--only') ?? null,
    realOnly: argv.includes('--real-only'),
  });
  const s = summarize(rows);
  console.log(JSON.stringify(s, null, 1));
  for (const r of rows.filter((x) => x.outcome === 'shown-wrong'))
    console.log(`WRONG ${r.id} | ${fmtLabel(r.label)} | ${fmt(r.output)}`);
  for (const r of rows.filter((x) => !x.variant && x.outcome === 'withheld' && x.label.expected))
    console.log(`MISS  ${r.id} | ${fmtLabel(r.label)} | ${fmt(r.output)}${r.error ? ` | ${r.error}` : ''}`);
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(rows.map(({ label, ...r }) => ({ ...r, expected: label.expected, expectedReason: label.expectedReason })), null, 1));
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
