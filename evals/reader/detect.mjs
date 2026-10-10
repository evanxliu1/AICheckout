#!/usr/bin/env node
// Cart page detector harness (Phase 13c, wiki/product/phase-13c-cart-detection.md, Measurement). Runs
// `detectCartPage` and `readCart` from the same bundle as run.mjs (same loaders, attribute stripping and bundle
// tripwire) over one split's real page-states and reports whether the badge would show:
//   show = detector says cart or checkout AND NOT (readCart shown with a zero amount).
// Expected per state: cart-1, cart-qty2, cart-2items and cart-other show (positives); minicart-1 and empty-cart stay
// hidden (negatives). Reported: badge recall on positives, false shows per negative state (with bounds), the amount
// view (reader shown) against the rates view (reader withheld) on shown positives, and the detector's p95 and maximum
// time apart for unhinted pages (no URL or title hint) and hinted ones. Each page's URL is the one in its meta.json.
//
//   node evals/reader/detect.mjs [--concurrency 8] [--only <substring>] [--json <out>]   quick loop, development only,
//                                                                                        nothing logged
//   node evals/reader/detect.mjs --scored --split development                             logged in runs.json as a
//   node evals/reader/detect.mjs --scored --split heldout-a --confirm-heldout-run 1       `detector` run (held-out: one
//                                                                                        run in total; text-free output)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleReader } from './bundle.mjs';
import { pageDetectionSchema, cartReadingSchema } from './contract.mjs';
import { DEFAULTS, REPO_ROOT, appendRun, checkRunAllowed, isHeldout, loadFrozen, parseId, readRuns, updateRun } from './lib.mjs';
import { GENERIC, installReader, locate, openPane, openRobot, stripPaneAttributes } from './run.mjs';
import { clopperPearsonUpper, percentile, proportion } from './stats.mjs';

export const POSITIVE_STATES = ['cart-1', 'cart-qty2', 'cart-2items', 'cart-other'];
export const NEGATIVE_STATES = ['minicart-1', 'empty-cart'];
const TIMED_DETECTS = 3;
const READER_DIR = 'packages/cart-reader';
const HARNESS_PATHS = ['evals/reader', 'evals/merchants/capture/rebuild.mjs', 'evals/merchants/capture/replay.mjs'];
const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const gitState = (paths) => ({
  commit: git(['rev-parse', 'HEAD']),
  dirty: git(['status', '--porcelain', '--', ...paths]) !== '',
});
const compactUtc = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const round = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

/** One detection: `detectCartPage` timed in the page, then `readCart` (not timed together), and the hint. */
export async function detectOnce(page, url, name = GENERIC) {
  const r = await page.evaluate(
    ({ name, url }) => {
      const reader = globalThis[name];
      let detection = null;
      let reading = null;
      let error = null;
      let hinted = null;
      const t0 = performance.now();
      try {
        detection = reader.detectCartPage(document, { url });
      } catch {
        error = 'throw';
      }
      const ms = performance.now() - t0;
      try {
        hinted = reader.cartUrlHint(url, document.title) !== null;
        reading = reader.readCart(document, { url });
      } catch {
        error = error ?? 'read-throw';
      }
      let json = null;
      if (!error)
        try {
          json = JSON.stringify({ detection, reading });
        } catch {
          error = 'unserializable';
        }
      return { ms, error, json, hinted };
    },
    { name, url },
  );
  if (r.error) return { ms: r.ms, hinted: r.hinted, error: r.error };
  const parsed = JSON.parse(r.json);
  const d = pageDetectionSchema.safeParse(parsed.detection);
  const c = cartReadingSchema.safeParse(parsed.reading);
  if (!d.success || !c.success) return { ms: r.ms, hinted: r.hinted, error: 'invalid-output' };
  return { ms: r.ms, hinted: r.hinted, detection: d.data, reading: c.data };
}

/** Whether the badge would show for a detection and a reading. */
export const badgeShows = (detection, reading) =>
  detection.page !== 'none' && !(reading.shown && reading.amountMinor === 0);

/** The URL of a page-state as its meta.json records it (pane captures), else the loaded page's. */
function metaUrl(where, fallback) {
  if (where.kind !== 'pane') return fallback;
  const file = path.join(path.dirname(where.domFile), 'meta.json');
  if (!existsSync(file)) return fallback;
  const meta = JSON.parse(readFileSync(file, 'utf8'));
  return typeof meta.url === 'string' ? meta.url : fallback;
}

/**
 * Detect every real page-state of a split. Quick loop (`scored: false`): development only, one warm-up and one
 * timed detection per page, nothing logged. Scored: the run is logged in runs.json (kind `detector`) before any page
 * is read, a held-out split needs `--confirm-heldout-run <n>` and committed reader and harness code, and every page
 * gets a warm-up and three timed detections (the last one is scored; `consistent` says whether all agreed).
 */
export async function detectRun({
  split = 'development',
  scored = false,
  confirmHeldoutRun = null,
  concurrency = 8,
  only = null,
  root = REPO_ROOT,
  freezeFile = DEFAULTS.freeze,
  data = DEFAULTS.data,
  variantData = DEFAULTS.variantData,
  sitesFile = DEFAULTS.sites,
  runsFile = DEFAULTS.runs,
  runsDir = DEFAULTS.runsDir,
  browser: givenBrowser = null,
  testOnlyReaderCommit = null,
  now = () => new Date(),
} = {}) {
  const heldout = isHeldout(split);
  if (!scored && heldout) throw new Error('the quick loop runs development only; a held-out split needs --scored');
  const runsPath = path.resolve(root, runsFile);
  const heldoutRun = scored ? checkRunAllowed(readRuns(runsPath), split, confirmHeldoutRun, 'detector') : null;
  const dataRoot = path.resolve(root, data);
  const frozen = loadFrozen({ root, freezeFile, paneData: path.join(dataRoot, 'pane'), variantData: path.resolve(root, variantData) });
  const entries = frozen.snapshots(split);
  const labels = frozen.labels(split);
  const reader = testOnlyReaderCommit ? { commit: testOnlyReaderCommit, dirty: false } : gitState([READER_DIR]);
  const harness = testOnlyReaderCommit ? { commit: testOnlyReaderCommit, dirty: false } : gitState(HARNESS_PATHS);
  if (scored && heldout && (reader.dirty || harness.dirty))
    throw new Error('the reader or the harness has uncommitted changes; a held-out run must name commits');
  const bundle = await bundleReader({
    root,
    frameDomains: frozen.frameDomains(),
    splitDomains: [...new Set([...frozen.splitDomains(split), ...frozen.nonDevelopmentDomains()])],
  });
  if (scored && !testOnlyReaderCommit) git(['ls-files', '--error-unmatch', '--', ...bundle.inputs]);
  const sites = entries.some((e) => e.method === 'robot')
    ? JSON.parse(readFileSync(path.resolve(root, sitesFile), 'utf8')).sites
    : [];
  const say = (id, i) => (heldout ? `held-out page-state #${i + 1}` : id);
  const targets = entries.map((e, i) => {
    try {
      return { id: e.id, method: e.method, where: locate(e, { dataRoot, sites }) };
    } catch (err) {
      throw new Error(`${say(e.id, i)}: ${err.message}`);
    }
  });
  const todo = only ? targets.filter((t) => t.id.includes(only)) : targets;
  const { chromium } = givenBrowser ? {} : await import('playwright');
  const browser = givenBrowser ?? (await chromium.launch({ headless: true }));
  const startedAt = now().toISOString();
  const runId = `${compactUtc(startedAt)}-${split}-${randomBytes(3).toString('hex')}`;
  const runDir = path.resolve(root, runsDir, runId);
  const outputsFile = path.join(runDir, 'outputs.jsonl');
  const rows = [];
  let logged = false;
  let status = 'failed';
  const worker = async () => {
    for (let i = rows.length; rows.length < todo.length; i = rows.length) {
      const t = todo[i];
      const row = { id: t.id, state: parseId(t.id).state, method: t.method };
      rows.push(row);
      let opened = null;
      try {
        opened = t.where.kind === 'pane' ? await openPane(browser, t.where) : await openRobot(browser, t.where);
        row.url = metaUrl(t.where, opened.url);
        await stripPaneAttributes(opened.page);
        await installReader(opened.page, bundle.code, GENERIC);
        await detectOnce(opened.page, row.url, GENERIC);
        const reads = [];
        for (let k = 0; k < (scored ? TIMED_DETECTS : 1); k += 1) reads.push(await detectOnce(opened.page, row.url, GENERIC));
        const last = reads.at(-1);
        row.ms = reads.map((r) => Math.round(r.ms * 1000) / 1000);
        row.hinted = last.hinted;
        if (last.error) {
          row.error = last.error;
          row.detection = { page: 'none', reason: 'crash' };
          row.reading = { shown: false, reason: 'crash' };
        } else {
          row.detection = last.detection;
          row.reading = last.reading;
        }
        row.consistent = reads.every((r) => JSON.stringify(r.detection ?? null) === JSON.stringify(last.detection ?? null));
      } catch (e) {
        row.error = String(e?.message ?? e).slice(0, 200);
        row.detection = { page: 'none', reason: 'harness-error' };
        row.reading = { shown: false, reason: 'harness-error' };
      } finally {
        await opened?.close();
      }
      row.show = badgeShows(row.detection, row.reading);
      if (scored) appendFileSync(outputsFile, JSON.stringify(row) + '\n');
    }
  };
  try {
    if (scored) {
      appendRun(
        runsPath,
        {
          runId,
          utc: startedAt,
          readerCommit: reader.commit,
          readerDirty: reader.dirty,
          split,
          heldoutRun,
          frozenLabelSha256: labels.sha256,
          frozenVariantLabelSha256: frozen.variants(split).sha256,
          freezeSha256: frozen.freezeSha256,
          readerBundleSha256: bundle.sha256,
          chromium: browser.version(),
          pageStates: todo.length,
          variants: 0,
          status: 'started',
          kind: 'detector',
        },
        { confirm: confirmHeldoutRun },
      );
      logged = true;
      mkdirSync(runDir, { recursive: true });
      writeFileSync(outputsFile, '');
      writeFileSync(
        path.join(runDir, 'run.json'),
        JSON.stringify(
          {
            runId,
            kind: 'detector',
            split,
            reader: { ...reader, bundleSha256: bundle.sha256, inputs: bundle.inputs },
            harness: { ...harness, paths: HARNESS_PATHS },
            chromium: browser.version(),
            machine: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? null, node: process.version },
            startedAt,
          },
          null,
          1,
        ) + '\n',
      );
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, todo.length)) }, worker));
    status = 'complete';
  } finally {
    if (!givenBrowser) await browser.close();
    if (logged) {
      const s = summarizeDetection(rows);
      updateRun(runsPath, runId, { status, endedUtc: now().toISOString(), metrics: metricsOf(s) });
    }
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { runId: scored ? runId : null, rows, heldout };
}

/** The report of a set of rows: recall, false shows per negative state, amount vs rates, times, by page and store. */
export function summarizeDetection(rows) {
  const positives = rows.filter((r) => POSITIVE_STATES.includes(r.state));
  const shown = positives.filter((r) => r.show);
  const stores = (rs) => [...new Set(rs.map((r) => parseId(r.id).domain))];
  const storeAll = (rs, ok) => stores(rs).filter((d) => rs.filter((r) => parseId(r.id).domain === d).every(ok)).length;
  const byState = {};
  for (const s of POSITIVE_STATES) {
    const rs = positives.filter((r) => r.state === s);
    if (rs.length) byState[s] = { n: rs.length, shown: rs.filter((r) => r.show).length };
  }
  const falseShows = {};
  for (const s of NEGATIVE_STATES) {
    const rs = rows.filter((r) => r.state === s);
    const k = rs.filter((r) => r.show).length;
    const storesWith = stores(rs).length;
    falseShows[s] = {
      ...proportion(k, rs.length),
      clopperPearsonUpper95: round(clopperPearsonUpper(k, rs.length)),
      stores: { n: storesWith, withFalseShow: storesWith - storeAll(rs, (r) => !r.show) },
    };
  }
  const times = (rs) => {
    const ms = rs.flatMap((r) => r.ms ?? []);
    return { n: rs.length, p95: round(percentile(ms)), max: round(ms.length ? Math.max(...ms) : null) };
  };
  const missesAtPage = positives.length - shown.length;
  return {
    pages: rows.length,
    recall: {
      ...proportion(shown.length, positives.length),
      missUpper95: round(clopperPearsonUpper(missesAtPage, positives.length)),
      stores: { n: stores(positives).length, allShown: storeAll(positives, (r) => r.show) },
      byState,
    },
    falseShows,
    shownPositives: {
      amountView: shown.filter((r) => r.reading.shown).length,
      ratesView: shown.filter((r) => !r.reading.shown).length,
    },
    detectMs: { unhinted: times(rows.filter((r) => r.hinted === false)), hinted: times(rows.filter((r) => r.hinted === true)) },
    inconsistent: rows.filter((r) => r.consistent === false).length,
    errors: rows.filter((r) => r.error).length,
  };
}

/** The flat, text-free metrics stored in runs.json. */
export function metricsOf(s) {
  return {
    positives: s.recall.n,
    positivesShown: s.recall.k,
    recall: s.recall.rate,
    minicartN: s.falseShows['minicart-1']?.n ?? 0,
    minicartFalseShows: s.falseShows['minicart-1']?.k ?? 0,
    emptyCartN: s.falseShows['empty-cart']?.n ?? 0,
    emptyCartFalseShows: s.falseShows['empty-cart']?.k ?? 0,
    amountView: s.shownPositives.amountView,
    ratesView: s.shownPositives.ratesView,
    detectMsP95Unhinted: s.detectMs.unhinted.p95,
    detectMsMaxUnhinted: s.detectMs.unhinted.max,
    detectMsP95Hinted: s.detectMs.hinted.p95,
    detectMsMaxHinted: s.detectMs.hinted.max,
    inconsistent: s.inconsistent,
    errors: s.errors,
  };
}

async function main(argv) {
  const opt = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const r = await detectRun({
    split: opt('--split') ?? 'development',
    scored: argv.includes('--scored'),
    confirmHeldoutRun: opt('--confirm-heldout-run') ?? null,
    concurrency: Number(opt('--concurrency') ?? 8),
    only: opt('--only') ?? null,
  });
  const s = summarizeDetection(r.rows);
  console.log(JSON.stringify({ runId: r.runId, ...s }, null, 1));
  // Held-out output is text-free: no page is named.
  if (!r.heldout) {
    const line = (tag, x) =>
      console.log(`${tag} ${x.id} | ${x.state} | ${x.url ?? ''} | ${x.detection.page} | ${x.detection.reason}${x.error ? ` | ${x.error}` : ''}`);
    for (const x of r.rows.filter((x) => POSITIVE_STATES.includes(x.state) && !x.show)) line('MISS ', x);
    for (const x of r.rows.filter((x) => NEGATIVE_STATES.includes(x.state) && x.show)) line('FALSE', x);
    if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(r.rows, null, 1));
  }
  return s.errors ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exitCode = 1;
    },
  );
