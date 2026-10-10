#!/usr/bin/env node
// Live home-page sweep for the cart page detector (Phase 13c, wiki/product/phase-13c-cart-detection.md, Measurement).
// Loads the home page of every store in evals/merchants/splits.json (both splits) and of the non-store sites in
// evals/reader/live-nonstore.json once each in headless Chromium: logged out, a fresh context per page, no clicks, no
// typing, no forms. robots.txt is respected (a `User-agent: *` Disallow of the home path → `robots-disallowed`, the
// page is never loaded); a 4xx/5xx answer or a challenge or block page → `blocked`, never bypassed. After `load` and
// a short settle the bundled detector (the same bundle, tripwire and in-page call as detect.mjs) runs once. Only
// `{ domain, set, url, status, page, reason, hinted, ms }` is recorded, never page content, in a gitignored run dir
// (evals/reader/runs/live-home-<utc>/results.jsonl); the summary (counts, false shows with Clopper–Pearson bounds,
// domains that showed, with reason codes only) is written to the committed summary path.
//
//   node evals/reader/live-home.mjs [--concurrency 4] [--timeout 30000] [--settle 1500] [--only <substring>]
//                                   [--summary evals/reader/live-home-summary.json]
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleReader } from './bundle.mjs';
import { pageDetectionSchema } from './contract.mjs';
import { REPO_ROOT } from './lib.mjs';
import { GENERIC, installReader } from './run.mjs';
import { clopperPearsonUpper, percentile, proportion } from './stats.mjs';

export const STATUSES = ['loaded', 'blocked', 'robots-disallowed', 'error'];
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_SETTLE_MS = 1500;
const ROBOTS_TIMEOUT_MS = 10_000;
/** Titles of challenge, block and interstitial pages (checked against the title only; nothing is saved). */
const CHALLENGE_TITLE_RE =
  /just a moment|attention required|access denied|verify you are human|are you a human|pardon our interruption|request unavailable|captcha|robot check|bot detection|security check|checking your browser|blocked|forbidden|service unavailable|too many requests|error 4\d\d|error 5\d\d|not available in your (?:country|region)/iu;

/** The sites to sweep: every store of both splits and the committed non-store list. */
export function loadInputs({ root = REPO_ROOT } = {}) {
  const splits = JSON.parse(readFileSync(path.resolve(root, 'evals/merchants/splits.json'), 'utf8'));
  const stores = splits.map((s) => ({ domain: s.domain, set: 'store', split: s.split }));
  const nonstore = JSON.parse(readFileSync(path.resolve(root, 'evals/reader/live-nonstore.json'), 'utf8'));
  const others = nonstore.sites.map((s) => ({ domain: s.domain, set: 'non-store', kind: s.kind }));
  const seen = new Set();
  return [...stores, ...others].filter((s) => (seen.has(s.domain) ? false : (seen.add(s.domain), true)));
}

/**
 * The rules of a robots.txt that apply to a generic user agent: the `User-agent: *` groups' Allow and Disallow
 * lines (a group naming a specific agent only is skipped). Returns `{ allow: string[], disallow: string[] }`.
 */
export function parseRobots(text) {
  const rules = { allow: [], disallow: [] };
  let applies = false;
  let inGroup = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/iu.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      // A new group starts after rules; agents listed together share one group.
      if (inGroup) applies = false;
      inGroup = false;
      if (value === '*') applies = true;
      continue;
    }
    if (key !== 'allow' && key !== 'disallow') continue;
    inGroup = true;
    if (!applies) continue;
    if (key === 'disallow' && value === '') continue; // "Disallow:" allows everything
    rules[key].push(value);
  }
  return rules;
}

/** A robots pattern (with `*` and `$`) to a regex anchored at the path start. */
function robotsPattern(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`, 'u');
}

/** Whether `rules` allow fetching `pathname` (longest match wins, Allow wins a tie, as robots.txt agents do). */
export function robotsAllows(rules, pathname = '/') {
  const match = (patterns) =>
    patterns.filter((p) => robotsPattern(p).test(pathname)).reduce((best, p) => Math.max(best, p.replace(/\$$/, '').length), -1);
  const allow = match(rules.allow);
  const disallow = match(rules.disallow);
  if (disallow < 0) return true;
  return allow >= disallow;
}

/** A challenge or block page, from the HTTP status and the title only. */
export function isChallenge(status, title) {
  if (status != null && status >= 400) return true;
  return CHALLENGE_TITLE_RE.test(title ?? '');
}

/** Fetches a robots.txt URL (10 s, generic UA); unreachable or missing → allowed, as crawlers treat it. */
export async function robotsFor(robotsUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(robotsUrl, {
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      redirect: 'follow',
      headers: { accept: 'text/plain' },
    });
    if (!res.ok) return { allow: [], disallow: [] };
    return parseRobots(await res.text());
  } catch {
    return { allow: [], disallow: [] };
  }
}

/**
 * One site: robots, one load in a fresh context, the detector once. Returns the text-free row. `urlFor` and
 * `fetchImpl` are injectable so a fixture server can stand in for the live sites.
 */
export async function sweepOne(
  browser,
  site,
  {
    code,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    settleMs = DEFAULT_SETTLE_MS,
    urlFor = (d) => `https://${d}/`,
    robotsUrlFor = (pageUrl) => `${new URL(pageUrl).origin}/robots.txt`,
    fetchImpl = fetch,
  },
) {
  const url = urlFor(site.domain);
  const base = { domain: site.domain, set: site.set, url, page: null, reason: null, hinted: null, ms: null };
  const rules = await robotsFor(robotsUrlFor(url), fetchImpl);
  if (!robotsAllows(rules, new URL(url).pathname)) return { ...base, status: 'robots-disallowed' };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs }).catch(() => null);
    if (!response) return { ...base, status: 'error', reason: 'navigation' };
    await page.waitForTimeout(settleMs);
    const title = await page.title().catch(() => '');
    if (isChallenge(response.status(), title)) return { ...base, status: 'blocked', reason: `http-${response.status()}` };
    const finalUrl = page.url().split(/[?#]/)[0];
    await installReader(page, code, GENERIC);
    const r = await page.evaluate(
      ({ name, url }) => {
        const reader = globalThis[name];
        const t0 = performance.now();
        let detection = null;
        let error = null;
        let hinted = null;
        try {
          hinted = reader.cartUrlHint(url, document.title) !== null;
          detection = reader.detectCartPage(document, { url });
        } catch {
          error = 'throw';
        }
        return { ms: performance.now() - t0, error, hinted, json: error ? null : JSON.stringify(detection) };
      },
      { name: GENERIC, url: page.url() },
    );
    if (r.error) return { ...base, url: finalUrl, status: 'error', reason: r.error, ms: r.ms };
    const parsed = pageDetectionSchema.safeParse(JSON.parse(r.json));
    if (!parsed.success) return { ...base, url: finalUrl, status: 'error', reason: 'invalid-output', ms: r.ms };
    return {
      ...base,
      url: finalUrl,
      status: 'loaded',
      page: parsed.data.page,
      reason: parsed.data.reason,
      hinted: r.hinted,
      ms: Math.round(r.ms * 1000) / 1000,
    };
  } catch (error) {
    return { ...base, status: 'error', reason: error?.name === 'TimeoutError' ? 'timeout' : 'page' };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Counts, false shows (a loaded page the detector calls cart or checkout) with exact upper bounds, times. */
export function summarizeLive(rows) {
  const by = (set) => rows.filter((r) => set === 'all' || r.set === set);
  const section = (set) => {
    const list = by(set);
    const loaded = list.filter((r) => r.status === 'loaded');
    const shown = loaded.filter((r) => r.page !== 'none');
    const status = Object.fromEntries(STATUSES.map((s) => [s, list.filter((r) => r.status === s).length]));
    return {
      sites: list.length,
      status,
      falseShows: {
        ...proportion(shown.length, loaded.length),
        clopperPearsonUpper95: loaded.length ? Math.round(clopperPearsonUpper(shown.length, loaded.length) * 1000) / 1000 : null,
      },
      hinted: loaded.filter((r) => r.hinted).length,
      detectMs: {
        unhinted: times(loaded.filter((r) => !r.hinted)),
        hinted: times(loaded.filter((r) => r.hinted)),
      },
      shownDomains: shown.map((r) => ({ domain: r.domain, page: r.page, reason: r.reason })),
    };
  };
  return { all: section('all'), store: section('store'), nonStore: section('non-store') };
}
const times = (rows) => {
  const ms = rows.map((r) => r.ms).filter((x) => x != null);
  return { n: ms.length, p95: ms.length ? Math.round(percentile(ms, 0.95) * 1000) / 1000 : null, max: ms.length ? Math.max(...ms) : null };
};

/** Runs the sweep over `sites` with `concurrency` fresh contexts at a time; `onRow` gets each row as it lands. */
export async function sweep(browser, sites, options, onRow = () => undefined) {
  const { concurrency = DEFAULT_CONCURRENCY } = options;
  const rows = [];
  let next = 0;
  const worker = async () => {
    while (next < sites.length) {
      const site = sites[next++];
      const row = await sweepOne(browser, site, options);
      rows.push(row);
      onRow(row);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sites.length) }, worker));
  return rows;
}

async function main(argv) {
  const opt = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = REPO_ROOT;
  const concurrency = Number(opt('--concurrency') ?? DEFAULT_CONCURRENCY);
  const timeoutMs = Number(opt('--timeout') ?? DEFAULT_TIMEOUT_MS);
  const settleMs = Number(opt('--settle') ?? DEFAULT_SETTLE_MS);
  const only = opt('--only');
  const summaryFile = path.resolve(root, opt('--summary') ?? 'evals/reader/live-home-summary.json');
  const sites = loadInputs({ root }).filter((s) => !only || s.domain.includes(only));
  // The same bundle rules as the scored runs: no answer lookup for any swept domain.
  const domains = sites.map((s) => s.domain);
  const bundle = await bundleReader({ root, frameDomains: domains, splitDomains: domains });
  const utc = new Date().toISOString();
  const runDir = path.resolve(root, 'evals/reader/runs', `live-home-${utc.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
  mkdirSync(runDir, { recursive: true });
  const resultsFile = path.join(runDir, 'results.jsonl');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    let done = 0;
    const rows = await sweep(browser, sites, { code: bundle.code, concurrency, timeoutMs, settleMs }, (row) => {
      appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      done += 1;
      if (done % 25 === 0 || done === sites.length) process.stderr.write(`${done}/${sites.length}\n`);
    });
    const summary = {
      schema: 'live-home.1',
      utc,
      chromium: browser.version(),
      bundleSha256: bundle.sha256,
      inputs: { stores: sites.filter((s) => s.set === 'store').length, nonStore: sites.filter((s) => s.set === 'non-store').length },
      options: { concurrency, timeoutMs, settleMs },
      ...summarizeLive(rows),
    };
    writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 1));
    writeFileSync(summaryFile, `${JSON.stringify(summary, null, 1)}\n`);
    console.log(JSON.stringify(summary, null, 1));
    console.log(`rows: ${resultsFile}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(error?.stack ?? String(error));
      process.exit(1);
    },
  );
