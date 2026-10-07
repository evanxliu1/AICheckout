#!/usr/bin/env node
// Reader run over one split's frozen page-states (docs/evals/generic-reader-protocol.md, Reading time and Peek
// policy). In order, and refusing at the first failure:
//   1. the split is one the harness runs (development, heldout-a); freeze.json exists and freeze.mjs's check
//      passes (every hash; pane snapshots and variant exports re-hashed);
//   2. a held-out split is under its run limit (heldout-a: 2 in total) and `--confirm-heldout-run <n>` names this
//      run's number; a held-out run also needs packages/cart-reader and the harness committed;
//   3. the generic reader (packages/cart-reader) and the legacy adapters (legacy-entry.ts) are bundled with esbuild
//      and checked (bundle.mjs: inputs, data-pane cue, answer-lookup tripwire; inputs tracked by git);
//   4. the run is appended to runs.json (text-free) under an O_EXCL lock that re-checks the limit, BEFORE reader
//      code executes on any page, so a crashed or partial run still counts;
//   5. each real page-state, then each frozen variant, is loaded once in Playwright Chromium with every network
//      request aborted: pane captures and variants rebuilt from dom.json (checked against the frozen SHA-256s)
//      with JavaScript disabled; robot captures from page.mhtml through replay.mjs (manifest checked). Every
//      `data-pane-*` attribute is removed before the readers are injected. The generic reader gets one untimed
//      warm-up read, three timed reads and a stability pair 500 ms apart (each timed; the wait is not); every read
//      is checked against the harness's contract (contract.mjs). On a page whose URL a legacy adapter matches, the
//      legacy reader is read the same way and recorded apart.
// An integrity failure (a hash that doesn't match the freeze) aborts the whole run (status `failed`); any other
// failure on a page is recorded as a harness error and that page is scored as missing.
// Per-page outputs go to runs/<runId>/outputs.jsonl (gitignored; for a held-out split read only by the class-only
// analyst). Robot captures have no variants.
//
//   node evals/reader/run.mjs --split development
//   node evals/reader/run.mjs --split heldout-a --confirm-heldout-run 1
//   options: --freeze <freeze.json> --data <capture/data> --variant-data <capture/data/variants> --sites <sites.json>
//            --runs <runs.json> --runs-dir <dir>
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { rebuildHtml } from '../merchants/capture/rebuild.mjs';
import { VIEWPORT } from '../merchants/capture/render-pane.mjs';
import { openReplay, verifySnapshot } from '../merchants/capture/replay.mjs';
import { standingRobotCapture } from '../merchants/capture/build-split-input.mjs';
import { cartReadingSchema } from './contract.mjs';
import { bundleReader } from './bundle.mjs';
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
export const GENERIC = '__aiCheckoutGenericReader';
export const LEGACY = '__aiCheckoutLegacyReader';
const READER_DIR = 'packages/cart-reader';
const HARNESS_PATHS = ['evals/reader', 'evals/merchants/capture/rebuild.mjs', 'evals/merchants/capture/replay.mjs'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A frozen input whose hash doesn't match: the whole run stops. */
export class IntegrityError extends Error {}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const textSha = (text) => sha256(Buffer.from(text, 'utf8'));

function readChecked(file, expected, what) {
  if (!existsSync(file)) throw new IntegrityError(`${what} is missing`);
  const text = readFileSync(file, 'utf8');
  if (textSha(text) !== expected) throw new IntegrityError(`${what} is not the frozen one`);
  return text;
}

/** Load static HTML from a temp file with JavaScript off and every other request aborted. */
async function loadStatic(browser, html, url) {
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
    url,
    network: net,
    close: async () => {
      await context.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** A pane page-state: dom.json checked, rebuilt and checked against the frozen rebuilt.html. */
export async function openPane(browser, { domFile, domSha256, rebuiltSha256 }) {
  const doc = JSON.parse(readChecked(domFile, domSha256, 'dom.json'));
  const html = rebuildHtml(doc);
  if (rebuiltSha256 && textSha(html) !== rebuiltSha256)
    throw new IntegrityError('the rebuild differs from the frozen rebuilt.html');
  return loadStatic(browser, html, typeof doc.url === 'string' ? doc.url : '');
}

/**
 * A variant: dom.json against the manifest's and the label's domSha256, variant.json against the manifest's
 * variantSha256 and the label's snapshotSha256; rebuilt fresh.
 */
export async function openVariant(browser, { domFile, metaFile, domSha256, variantSha256, label }) {
  if (label.domSha256 !== domSha256 || label.snapshotSha256 !== variantSha256)
    throw new IntegrityError('the variant label is not for the manifest entry');
  readChecked(metaFile, variantSha256, 'variant.json');
  const doc = JSON.parse(readChecked(domFile, domSha256, 'variant dom.json'));
  return loadStatic(browser, rebuildHtml(doc), typeof doc.url === 'string' ? doc.url : '');
}

/** A robot page-state through replay.mjs (every file and the manifest checked, every request aborted). */
export async function openRobot(browser, { dir, manifestSha256 }) {
  let manifest;
  try {
    const v = await verifySnapshot(dir);
    if (v.manifestSha256 !== manifestSha256) throw new Error('manifest is not the frozen one');
    manifest = v.manifest;
  } catch (e) {
    // No path (it names the domain) in the message.
    throw new IntegrityError(`robot snapshot: ${String(e.message).split(dir).join('<snapshot>')}`);
  }
  const { page, context } = await openReplay(browser, dir, { expectedManifestSha256: manifestSha256 });
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

/** Remove every data-pane-* attribute in the page, open shadow roots included. Returns the count removed. */
export async function stripPaneAttributes(page) {
  return page.evaluate(() => {
    let n = 0;
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        for (const name of el.getAttributeNames())
          if (name.startsWith('data-pane-')) {
            el.removeAttribute(name);
            n += 1;
          }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return n;
  });
}

/** Inject a bundled reader under a global name (not a read; not timed). */
export async function installReader(page, code, name = GENERIC) {
  await page.evaluate(`${code}\nglobalThis.${name} = __aiCheckoutCartReader; undefined;`);
}

/** One read: the reader's page-reading function called once, wall time measured in the page. */
async function readOnce(page, url, name) {
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
    { name, url },
  );
  if (r.error) return { ms: r.ms, error: r.error };
  const parsed = cartReadingSchema.safeParse(r.json == null ? undefined : JSON.parse(r.json));
  return parsed.success ? { ms: r.ms, output: parsed.data } : { ms: r.ms, error: 'invalid-output' };
}

/**
 * The protocol's reads on a loaded page: one untimed warm-up, three timed reads, a stability pair 500 ms apart.
 * The scored output is the stability pair's when both reads agree, else withheld `unstable`; any thrown or invalid
 * read is a crash (scored as withheld `crash`). `consistent` is false when any two of the six reads differ.
 */
export async function readPage(page, url, { gapMs = STABILITY_GAP_MS, name = GENERIC } = {}) {
  const warm = await readOnce(page, url, name);
  const timed = [];
  for (let i = 0; i < TIMED_READS; i += 1) timed.push(await readOnce(page, url, name));
  const s1 = await readOnce(page, url, name);
  await sleep(gapMs);
  const s2 = await readOnce(page, url, name);
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
  if (!sessionId) throw new IntegrityError('no standing robot session in sites.json');
  return {
    kind: 'robot',
    dir: path.join(dataRoot, domain, sessionId, state),
    manifestSha256: entry.snapshotSha256,
  };
}

const compactUtc = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Commit and uncommitted state of paths (git status --porcelain). */
function gitState(root, paths) {
  return { commit: git(root, ['rev-parse', 'HEAD']), dirty: git(root, ['status', '--porcelain', '--', ...paths]) !== '' };
}

/**
 * Run the readers over one split. Returns { runId, outputsFile, pageStates, variants, errors }.
 * `testOnlyReaderCommit` skips every git call (commit, dirty state, tracked inputs); tests only.
 */
export async function run({
  split,
  confirmHeldoutRun = null,
  root = REPO_ROOT,
  readerRoot = REPO_ROOT,
  freezeFile = DEFAULTS.freeze,
  data = DEFAULTS.data,
  variantData = DEFAULTS.variantData,
  sitesFile = DEFAULTS.sites,
  runsFile = DEFAULTS.runs,
  runsDir = DEFAULTS.runsDir,
  browser: givenBrowser = null,
  testOnlyReaderCommit = null,
  gapMs = STABILITY_GAP_MS,
  now = () => new Date(),
}) {
  if (!split) throw new Error('--split is required');
  const runsPath = path.resolve(root, runsFile);
  checkRunAllowed(readRuns(runsPath), split, confirmHeldoutRun);
  const heldout = isHeldout(split);
  const dataRoot = path.resolve(root, data);
  const variantRoot = path.resolve(root, variantData);
  const frozen = loadFrozen({ root, freezeFile, paneData: path.join(dataRoot, 'pane'), variantData: variantRoot });
  const labels = frozen.labels(split);
  const variants = frozen.variants(split);
  const entries = frozen.snapshots(split);
  const heldoutRun = checkRunAllowed(readRuns(runsPath), split, confirmHeldoutRun);
  const reader = testOnlyReaderCommit
    ? { commit: testOnlyReaderCommit, dirty: false }
    : gitState(readerRoot, [READER_DIR]);
  const harness = testOnlyReaderCommit ? { commit: testOnlyReaderCommit, dirty: false } : gitState(REPO_ROOT, HARNESS_PATHS);
  if (heldout && (reader.dirty || harness.dirty))
    throw new Error('the reader or the harness has uncommitted changes; a held-out run must name commits');
  const bundle = await bundleReader({
    root: readerRoot,
    frameDomains: frozen.frameDomains(),
    splitDomains: frozen.splitDomains(split),
  });
  // The legacy adapters are harness-side: always the repository's extension code.
  const legacy = await bundleReader({ root: REPO_ROOT, mode: 'legacy' });
  if (!testOnlyReaderCommit) {
    git(readerRoot, ['ls-files', '--error-unmatch', '--', ...bundle.inputs]);
    git(REPO_ROOT, ['ls-files', '--error-unmatch', '--', ...legacy.inputs]);
  }
  const sites = entries.some((e) => e.method === 'robot')
    ? JSON.parse(readFileSync(path.resolve(root, sitesFile), 'utf8')).sites
    : [];
  const say = (id, i) => (heldout ? `held-out page-state #${i + 1}` : id);
  const labelById = new Map(variants.labels.map((l) => [l.id, l]));
  const targets = [];
  entries.forEach((e, i) => {
    try {
      targets.push({ id: e.id, method: e.method, where: locate(e, { dataRoot, sites }) });
    } catch (err) {
      throw new IntegrityError(`${say(e.id, i)}: ${err.message}`);
    }
  });
  for (const v of variants.manifest.variants ?? []) {
    const label = labelById.get(v.id);
    if (!label) throw new IntegrityError('a manifest variant has no frozen variant label');
    const domFile = path.join(variantRoot, v.path);
    targets.push({
      id: v.id,
      method: 'pane',
      variant: true,
      where: {
        kind: 'variant',
        domFile,
        metaFile: path.join(path.dirname(domFile), 'variant.json'),
        domSha256: v.domSha256,
        variantSha256: v.variantSha256,
        label,
      },
    });
  }

  const { chromium } = givenBrowser ? {} : await import('playwright');
  const browser = givenBrowser ?? (await chromium.launch({ headless: true }));
  const startedAt = now().toISOString();
  const runId = `${compactUtc(startedAt)}-${split}-${randomBytes(3).toString('hex')}`;
  const runDir = path.resolve(root, runsDir, runId);
  const outputsFile = path.join(runDir, 'outputs.jsonl');
  let logged = false;
  let errors = 0;
  let status = 'failed';
  try {
    // Logged before reader code executes on any page; the lock re-checks the run limit.
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
        frozenVariantLabelSha256: variants.sha256,
        freezeSha256: frozen.freezeSha256,
        readerBundleSha256: bundle.sha256,
        legacyBundleSha256: legacy.sha256,
        chromium: browser.version(),
        pageStates: entries.length,
        variants: targets.length - entries.length,
        status: 'started',
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
          split,
          reader: { ...reader, bundleSha256: bundle.sha256, inputs: bundle.inputs },
          legacy: { bundleSha256: legacy.sha256, inputs: legacy.inputs },
          harness: { ...harness, paths: HARNESS_PATHS },
          chromium: browser.version(),
          machine: {
            platform: os.platform(),
            arch: os.arch(),
            cpu: os.cpus()[0]?.model ?? null,
            node: process.version,
          },
          startedAt,
        },
        null,
        1,
      ) + '\n',
    );
    for (const [i, t] of targets.entries()) {
      const row = { id: t.id, split, method: t.method, ...(t.variant ? { variant: true } : {}) };
      let opened = null;
      try {
        if (t.where.kind === 'pane') opened = await openPane(browser, t.where);
        else if (t.where.kind === 'variant') opened = await openVariant(browser, t.where);
        else opened = await openRobot(browser, t.where);
        await stripPaneAttributes(opened.page);
        await installReader(opened.page, bundle.code, GENERIC);
        await installReader(opened.page, legacy.code, LEGACY);
        opened.network.mark();
        Object.assign(row, await readPage(opened.page, opened.url, { gapMs, name: GENERIC }));
        const legacyMatches = await opened.page.evaluate(
          ({ name, url }) => globalThis[name].matches(url),
          { name: LEGACY, url: opened.url },
        );
        if (legacyMatches) row.legacy = await readPage(opened.page, opened.url, { gapMs, name: LEGACY });
        row.networkAttempts = opened.network.since();
      } catch (e) {
        if (e instanceof IntegrityError) throw new IntegrityError(`${say(t.id, i)}: ${e.message}`);
        errors += 1;
        row.harnessError = String(e?.message ?? e).slice(0, 200);
      } finally {
        await opened?.close();
      }
      appendFileSync(outputsFile, JSON.stringify(row) + '\n');
    }
    status = 'complete';
  } finally {
    if (logged) updateRun(runsPath, runId, { status, endedUtc: now().toISOString() });
    if (!givenBrowser) await browser.close();
  }
  return { runId, outputsFile, pageStates: entries.length, variants: targets.length - entries.length, errors };
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
    ['--variant-data', 'variantData'],
    ['--sites', 'sitesFile'],
    ['--runs', 'runsFile'],
    ['--runs-dir', 'runsDir'],
  ])
    if (arg(argv, flag)) opts[key] = arg(argv, flag);
  const r = await run(opts);
  // Text-free: no per-page result is printed.
  console.log(
    JSON.stringify({ runId: r.runId, pageStates: r.pageStates, variants: r.variants, harnessErrors: r.errors }),
  );
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
