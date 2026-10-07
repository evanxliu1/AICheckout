#!/usr/bin/env node
// Reader run over one split's frozen real page-states (docs/evals/generic-reader-protocol.md, Reading time and Peek
// policy). In order, and refusing at the first failure:
//   1. freeze.json exists and freeze.mjs's check passes (every hash, pane snapshots re-hashed);
//   2. a held-out split is under its run limit (heldout-a: 2 in total) and `--confirm-heldout-run <n>` names this
//      run's number; a held-out run also needs packages/cart-reader committed (the run names a reader commit);
//   3. packages/cart-reader is bundled with esbuild and checked (bundle.mjs);
//   4. the run is appended to runs.json (text-free: run ID, UTC time, reader commit, split, frozen label hash) BEFORE
//      reader code executes on any page, so a crashed or partial run still counts;
//   5. each real page-state is loaded once in Playwright Chromium with every network request aborted: pane captures
//      rebuilt from dom.json (rebuild.mjs, checked against the frozen dom and rebuilt SHA-256) with JavaScript
//      disabled; robot captures from page.mhtml through replay.mjs (manifest checked against the frozen one). The
//      reader is injected, given one untimed warm-up read, three timed reads and a stability pair 500 ms apart (each
//      timed; the wait is not). Every read is checked against the reader's Zod contract.
// Per-page outputs go to runs/<runId>/outputs.jsonl (gitignored; never opened for a held-out split except by the
// class-only analyst). Variants are not run yet: their page format comes with the variant generator.
//
//   node evals/reader/run.mjs --split development
//   node evals/reader/run.mjs --split heldout-a --confirm-heldout-run 1
//   options: --freeze <freeze.json> --data <capture/data> --sites <sites.json> --runs <runs.json> --runs-dir <dir>
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { cartReadingSchema } from '../../packages/cart-reader/src/schema.ts';
import { rebuildHtml } from '../merchants/capture/rebuild.mjs';
import { VIEWPORT } from '../merchants/capture/render-pane.mjs';
import { openReplay } from '../merchants/capture/replay.mjs';
import { standingRobotCapture } from '../merchants/capture/build-split-input.mjs';
import { GLOBAL_NAME, bundleReader } from './bundle.mjs';
import {
  DEFAULTS,
  REPO_ROOT,
  appendRun,
  checkRunAllowed,
  isHeldout,
  loadFrozen,
  parseId,
  readRuns,
  sha256,
  updateRun,
} from './lib.mjs';

export const STABILITY_GAP_MS = 500;
export const TIMED_READS = 3;
const READER_DIR = 'packages/cart-reader';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** Load a pane page-state: rebuild dom.json, load it with JavaScript off and every other request aborted. */
export async function openPane(browser, { domFile, domSha256, rebuiltSha256 }) {
  const text = readFileSync(domFile, 'utf8');
  if (sha256(Buffer.from(text, 'utf8')) !== domSha256) throw new Error('dom.json is not the frozen export');
  const doc = JSON.parse(text);
  const html = rebuildHtml(doc);
  if (rebuiltSha256 && sha256(Buffer.from(html, 'utf8')) !== rebuiltSha256)
    throw new Error('the rebuild differs from the frozen rebuilt.html');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'reader-page-'));
  const htmlPath = path.join(tmp, 'page.html');
  writeFileSync(htmlPath, html);
  const fileUrl = pathToFileURL(htmlPath).href;
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
    serviceWorkers: 'block',
  });
  const net = watchNetwork(context, fileUrl);
  await context.route('**/*', (route) =>
    route.request().url() === fileUrl ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(fileUrl, { waitUntil: 'load' });
  return {
    page,
    url: typeof doc.url === 'string' ? doc.url : '',
    network: net,
    close: async () => {
      await context.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** Load a robot page-state through replay.mjs (manifest verified, every request aborted). */
export async function openRobot(browser, { dir, manifestSha256 }) {
  const { page, context, manifest } = await openReplay(browser, dir, { expectedManifestSha256: manifestSha256 });
  const net = watchNetwork(context, pathToFileURL(path.join(dir, 'page.mhtml')).href);
  return { page, url: manifest.url ?? '', network: net, close: () => context.close() };
}

/** Count requests other than the page itself; `mark()` starts counting from now. */
function watchNetwork(context, fileUrl) {
  let n = 0;
  context.on('request', (r) => {
    if (r.url() !== fileUrl) n += 1;
  });
  let base = 0;
  return { mark: () => (base = n), since: () => n - base };
}

/** Inject the bundled reader into the page (not a read; not timed). */
export async function installReader(page, code) {
  await page.evaluate(`${code}\nglobalThis.${GLOBAL_NAME} = ${GLOBAL_NAME}; undefined;`);
}

/** One read: the reader's page-reading function called once, wall time measured in the page. */
async function readOnce(page, url) {
  const r = await page.evaluate(
    ({ name, url }) => {
      const reader = globalThis[name];
      let out;
      let error = null;
      const t0 = performance.now();
      try {
        out = reader.readCart(document, { url });
      } catch {
        error = 'throw';
      }
      const ms = performance.now() - t0;
      let json = null;
      if (!error)
        try {
          json = JSON.stringify(out);
        } catch {
          error = 'unserializable';
        }
      return { ms, error, json };
    },
    { name: GLOBAL_NAME, url },
  );
  if (r.error) return { ms: r.ms, error: r.error };
  const parsed = cartReadingSchema.safeParse(r.json == null ? undefined : JSON.parse(r.json));
  return parsed.success ? { ms: r.ms, output: parsed.data } : { ms: r.ms, error: 'invalid-output' };
}

/**
 * The protocol's reads on a loaded page: one untimed warm-up, three timed reads, a stability pair 500 ms apart.
 * The scored output is the stability pair's when both reads agree, else withheld `unstable`; any thrown or invalid
 * read is a crash (scored as withheld `crash`).
 */
export async function readPage(page, url, { gapMs = STABILITY_GAP_MS } = {}) {
  const warm = await readOnce(page, url);
  const timed = [];
  for (let i = 0; i < TIMED_READS; i += 1) timed.push(await readOnce(page, url));
  const s1 = await readOnce(page, url);
  await sleep(gapMs);
  const s2 = await readOnce(page, url);
  const all = [warm, ...timed, s1, s2];
  const crash = all.find((r) => r.error)?.error ?? null;
  const stable = !s1.error && !s2.error && isDeepStrictEqual(s1.output, s2.output);
  let output;
  if (crash) output = { shown: false, reason: 'crash' };
  else if (!stable) output = { shown: false, reason: 'unstable' };
  else output = s1.output;
  return {
    output,
    stable,
    consistent: !crash && all.every((r) => isDeepStrictEqual(r.output, warm.output)),
    crash,
    readMs: [...timed, s1, s2].map((r) => Math.round(r.ms * 1000) / 1000),
  };
}

/** Where a snapshot-manifest entry's snapshot lives. */
function locate(entry, { dataRoot, sites }) {
  const { domain, state } = parseId(entry.id);
  if (entry.method === 'pane')
    return {
      kind: 'pane',
      domFile: path.join(dataRoot, 'pane', domain, state, 'dom.json'),
      domSha256: entry.domSha256,
      rebuiltSha256: entry.rebuiltSha256,
    };
  const site = sites.find((s) => s.domain === domain);
  const sessionId = site && standingRobotCapture(site).capture?.sessionId;
  if (!sessionId) throw new Error(`${entry.id}: no standing robot session in sites.json`);
  return {
    kind: 'robot',
    dir: path.join(dataRoot, domain, sessionId, state),
    manifestSha256: entry.snapshotSha256,
  };
}

const compactUtc = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Run the reader over one split. Returns { runId, outputsFile, pageStates, errors }. */
export async function run({
  split,
  confirmHeldoutRun = null,
  root = REPO_ROOT,
  readerRoot = REPO_ROOT,
  freezeFile = DEFAULTS.freeze,
  data = DEFAULTS.data,
  sitesFile = DEFAULTS.sites,
  runsFile = DEFAULTS.runs,
  runsDir = DEFAULTS.runsDir,
  browser: givenBrowser = null,
  readerCommit = null,
  gapMs = STABILITY_GAP_MS,
  now = () => new Date(),
}) {
  if (!split) throw new Error('--split is required');
  const dataRoot = path.resolve(root, data);
  const frozen = loadFrozen({ root, freezeFile, paneData: path.join(dataRoot, 'pane') });
  const labels = frozen.labels(split);
  const entries = frozen.snapshots(split);
  const runsPath = path.resolve(root, runsFile);
  const heldoutRun = checkRunAllowed(readRuns(runsPath), split, confirmHeldoutRun);
  const commit = readerCommit ?? git(readerRoot, ['rev-parse', 'HEAD']);
  const dirty = readerCommit ? false : git(readerRoot, ['status', '--porcelain', '--', READER_DIR]) !== '';
  if (isHeldout(split) && dirty)
    throw new Error(`${READER_DIR} has uncommitted changes; a held-out run must name a reader commit`);
  const bundle = await bundleReader({ root: readerRoot });
  const sites = entries.some((e) => e.method === 'robot')
    ? JSON.parse(readFileSync(path.resolve(root, sitesFile), 'utf8')).sites
    : [];
  const targets = entries.map((e) => ({ entry: e, where: locate(e, { dataRoot, sites }) }));

  const { chromium } = givenBrowser ? {} : await import('playwright');
  const browser = givenBrowser ?? (await chromium.launch({ headless: true }));
  const startedAt = now().toISOString();
  const runId = `${compactUtc(startedAt)}-${split}-${randomBytes(3).toString('hex')}`;
  const runDir = path.resolve(root, runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const outputsFile = path.join(runDir, 'outputs.jsonl');
  writeFileSync(outputsFile, '');
  // Logged before reader code executes on any page.
  appendRun(runsPath, {
    runId,
    utc: startedAt,
    readerCommit: commit,
    readerDirty: dirty,
    split,
    heldoutRun,
    frozenLabelSha256: labels.sha256,
    freezeSha256: frozen.freezeSha256,
    readerBundleSha256: bundle.sha256,
    chromium: browser.version(),
    pageStates: targets.length,
    status: 'started',
  });
  writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify(
      {
        runId,
        split,
        readerCommit: commit,
        readerDirty: dirty,
        readerBundleSha256: bundle.sha256,
        readerInputs: bundle.inputs,
        chromium: browser.version(),
        machine: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? null, node: process.version },
        startedAt,
      },
      null,
      1,
    ) + '\n',
  );
  let errors = 0;
  let status = 'failed';
  try {
    for (const { entry, where } of targets) {
      const row = { id: entry.id, split, method: entry.method };
      let opened = null;
      try {
        opened = where.kind === 'pane' ? await openPane(browser, where) : await openRobot(browser, where);
        await installReader(opened.page, bundle.code);
        opened.network.mark();
        Object.assign(row, await readPage(opened.page, opened.url, { gapMs }));
        row.networkAttempts = opened.network.since();
      } catch (e) {
        errors += 1;
        row.harnessError = String(e?.message ?? e).slice(0, 200);
      } finally {
        await opened?.close();
      }
      appendFileSync(outputsFile, JSON.stringify(row) + '\n');
    }
    status = 'complete';
  } finally {
    updateRun(runsPath, runId, { status, endedUtc: now().toISOString() });
    if (!givenBrowser) await browser.close();
  }
  return { runId, outputsFile, pageStates: targets.length, errors };
}

function arg(argv, k) {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
  const opts = { split: arg(argv, '--split'), confirmHeldoutRun: arg(argv, '--confirm-heldout-run') ?? null };
  for (const [flag, key] of [
    ['--freeze', 'freezeFile'],
    ['--data', 'data'],
    ['--sites', 'sitesFile'],
    ['--runs', 'runsFile'],
    ['--runs-dir', 'runsDir'],
  ])
    if (arg(argv, flag)) opts[key] = arg(argv, flag);
  const r = await run(opts);
  // Text-free: no per-page result is printed.
  console.log(JSON.stringify({ runId: r.runId, pageStates: r.pageStates, harnessErrors: r.errors }));
  return r.errors ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exitCode = 1;
    },
  );
