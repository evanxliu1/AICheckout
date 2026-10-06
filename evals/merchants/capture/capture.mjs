#!/usr/bin/env node
// Phase 12 capture tool: one site per run, from a committed recipe (README.md in this folder).
//
//   node evals/merchants/capture/capture.mjs recon <domain> [options]        look-only reconnaissance session from the
//                                                                           frame's entry host; writes the draft recipe
//   node evals/merchants/capture/capture.mjs check <recipe.json>             validate a recipe, load nothing
//   node evals/merchants/capture/capture.mjs run <recipe.json> [options]     robots check, then the recipe's steps
//   node evals/merchants/capture/capture.mjs serve <recipe.json> [options]   robots check, recipe steps, then a local
//                                                                           control server for the operator's steps
//   node evals/merchants/capture/capture.mjs list-blocked [--out <dir>]      sessions stopped on a block
// Options: --headless  --out <dir>  --profile <dir>  --second-session  (recon: --allowlist <file.json>)
//
// Snapshots, robots.txt and terms copies, logs and the browser profile go to gitignored folders. The committable
// output is each session's text-free site-record.json (recon-record.json for a reconnaissance session).
import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startControlServer } from './control-server.mjs';
import { FORBIDDEN, MIN_PACE_MS, createDriver, runStep, visitKey } from './driver.mjs';
import { RefusalError, StopError } from './guards.mjs';
import { detectPlatform, platformStates } from './platform.mjs';
import {
  RECIPE_SCHEMA,
  RECON_RECORD_SCHEMA,
  ReconRecord,
  ReconSpec,
  SITE_RECORD_SCHEMA,
  SiteRecord,
  StepSchema,
  isLoopback,
  parseRecipe,
} from './recipe.mjs';
import { ROBOTS_TOKEN, pathAllowed, robotsPosture } from './robots.mjs';
import { sha256 } from './snapshot.mjs';

export const TOOL_VERSION = 'capture-tool.2';
const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = path.join(here, 'data');
export const DEFAULT_PROFILE = path.join(here, 'profile');

/** Blocked-site stop codes; `list-blocked` lists the robot's records with them (useful for a later step). */
export const BLOCK_CODES = [
  'blocked-bot-wall',
  'blocked-http-403',
  'blocked-http-429',
  'captcha',
  'blocked-extension-check',
];

/**
 * A URL as committed: no query or fragment, and path segments that look like tokens (long mixed letters and
 * digits, long hex, UUIDs) replaced by ":token".
 */
export function committableUrl(raw) {
  if (raw === null || raw === undefined) return null;
  const u = new URL(raw);
  const tokenLike = (seg) =>
    /^[0-9a-f]{12,}$/i.test(seg) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
    (seg.length >= 16 && /[a-z]/i.test(seg) && /\d/.test(seg));
  const pathname = u.pathname
    .split('/')
    .map((seg) => (tokenLike(seg) ? ':token' : seg))
    .join('/');
  return `${u.protocol}//${u.host}${pathname}`;
}

const utcId = (d = new Date()) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/** Refuse a profile path that is a person's own browser profile. */
export function checkProfileDir(dir) {
  const p = path.resolve(dir);
  const home = os.homedir();
  const personal = [
    path.join(home, 'Library', 'Application Support', 'Google'),
    path.join(home, 'Library', 'Application Support', 'Chromium'),
    path.join(home, '.config', 'google-chrome'),
    path.join(home, '.config', 'chromium'),
    path.join(home, 'AppData', 'Local', 'Google'),
  ];
  if (personal.some((x) => p === x || p.startsWith(x + path.sep)))
    throw new Error(`refused profile ${p}: the capture profile is never a personal browser profile`);
  return p;
}

/** One site at a time: an exclusive lock file under the output root. */
async function acquireLock(outRoot, domain) {
  await mkdir(outRoot, { recursive: true });
  const file = path.join(outRoot, '.capture.lock');
  try {
    const fd = openSync(file, 'wx');
    writeSync(fd, JSON.stringify({ pid: process.pid, domain }));
    closeSync(fd);
  } catch {
    let holder = null;
    try {
      holder = JSON.parse(await readFile(file, 'utf8'));
      process.kill(holder.pid, 0);
    } catch {
      await rm(file, { force: true }); // stale lock from a dead process
      return acquireLock(outRoot, domain);
    }
    throw new Error(
      `another site (${holder.domain}) is being captured by pid ${holder.pid}; one site at a time`,
    );
  }
  return () => rm(file, { force: true });
}

/**
 * One session of a kind per site: one reconnaissance session and one capture session. A second session of the same
 * kind is allowed only after a tool-error session of that kind, on a later UTC day, with --second-session.
 */
async function sessionNumber(siteDir, secondSession, file = 'sessions.json') {
  let prior = [];
  try {
    prior = JSON.parse(await readFile(path.join(siteDir, file), 'utf8'));
  } catch {
    prior = [];
  }
  if (prior.length === 0) return { number: 1, prior };
  const last = prior[prior.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  if (secondSession && prior.length === 1 && last.stopCode === 'tool-error' && last.date < today)
    return { number: 2, prior };
  throw new Error(
    `site already has ${prior.length} session(s) in ${file} (last stop: ${last.stopCode ?? 'none'}); a second session is allowed only after a tool-error, on a later day, with --second-session`,
  );
}

/**
 * A capture session runs only from a recipe written in a finished reconnaissance session of the same site: the
 * recipe names that session, which ended `done`, and its listing, item and cart path are pages that session loaded.
 * Loopback fixtures without a `recon` field are exempt (tests).
 */
export async function checkRecon(outRoot, recipe) {
  if (!recipe.recon) {
    if (isLoopback(new URL(recipe.origin).hostname)) return;
    throw new Error('a capture session needs a recipe written from a reconnaissance session (recipe.recon)');
  }
  const siteDir = path.join(outRoot, recipe.domain);
  const sessions = JSON.parse(await readFile(path.join(siteDir, 'recon-sessions.json'), 'utf8').catch(() => '[]'));
  const s = sessions.find((x) => x.id === recipe.recon.sessionId);
  if (!s || s.outcome !== 'done')
    throw new Error(`reconnaissance session ${recipe.recon.sessionId} of ${recipe.domain} did not end with findings`);
  const dir = path.join(siteDir, 'recon', recipe.recon.sessionId);
  // The recipe's site, listing, items, cart and checkout MUST equal the reconnaissance findings exactly.
  const draft = JSON.parse(await readFile(path.join(dir, 'recipe.draft.json'), 'utf8'));
  const differs = ['origin', 'listingUrl', 'productUrls', 'cartPath', 'checkoutPaths', 'cartHost'].filter(
    (k) => JSON.stringify(recipe[k] ?? null) !== JSON.stringify(draft[k] ?? null),
  );
  if (differs.length)
    throw new Error(`recipe differs from its reconnaissance findings in: ${differs.join(', ')}`);
  const visited = new Set(JSON.parse(await readFile(path.join(dir, 'visited.json'), 'utf8')));
  const unseen = [recipe.listingUrl, ...recipe.productUrls].filter((u) => !visited.has(visitKey(u)));
  const cart = recipe.cartPath.replace(/\/+$/, '') || '/';
  if (![...visited].some((k) => (new URL(k).pathname.replace(/\/+$/, '') || '/') === cart)) unseen.push(cart);
  if (unseen.length)
    throw new Error(`recipe names pages its reconnaissance session never loaded: ${unseen.join(' ')}`);
}

async function browserVersion(context, page) {
  const cdp = await context.newCDPSession(page);
  try {
    const v = await cdp.send('Browser.getVersion');
    return v.product;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Fetch one host's robots.txt with the browser's request context (no page), keep a gitignored copy, decide. */
async function fetchRobots(context, origin, sessionDir, paths = []) {
  const url = new URL('/robots.txt', origin).href;
  const fetched = { httpStatus: null, body: null };
  try {
    const res = await context.request.get(url, { timeout: 20_000, maxRedirects: 5, failOnStatusCode: false });
    fetched.httpStatus = res.status();
    fetched.body = fetched.httpStatus < 300 ? (await res.body()).toString('utf8') : null;
  } catch {
    fetched.httpStatus = null;
  }
  const host = new URL(origin).host;
  const file = paths === null ? `robots-${host.replace(/[^a-z0-9.-]/gi, '_')}.txt` : 'robots.txt';
  if (fetched.body !== null) await writeFile(path.join(sessionDir, file), fetched.body);
  const posture = robotsPosture(fetched, paths ?? [], ROBOTS_TOKEN);
  return {
    ...posture,
    url,
    httpStatus: fetched.httpStatus,
    sha256: fetched.body === null ? null : sha256(fetched.body),
  };
}

const hostRecords = (session) =>
  [...session.robotsHosts.values()].map((r) => ({
    host: r.host,
    url: r.url,
    httpStatus: r.httpStatus,
    sha256: r.sha256,
    posture: r.posture,
    groups: r.groups,
    decision: r.decision,
  }));

/**
 * Open the browser, read the entry host's robots.txt before any page, then run `steps` and, in `serve` and `recon`
 * modes, the operator's steps over the control server. Shared by capture and reconnaissance sessions.
 */
async function drive({ recipe, mode, sessionDir, opts, paths, steps }) {
  // Playwright's default arguments include --disable-extensions; nothing here loads one, sets a proxy or a stealth
  // plugin. Service workers are blocked so every navigation passes the driver's route guard.
  const context = await chromium.launchPersistentContext(opts.profileDir, {
    headless: Boolean(opts.headless),
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const version = await browserVersion(context, page);
  const robots = await fetchRobots(context, recipe.origin, sessionDir, paths);
  // A cart the reconnaissance found on another host of the site: that host's robots.txt is read up front too.
  const entry = new URL(recipe.origin);
  const cartRobots =
    recipe.cartHost && recipe.cartHost !== entry.host
      ? {
          ...(await fetchRobots(context, `${entry.protocol}//${recipe.cartHost}`, sessionDir, null)),
          host: recipe.cartHost,
        }
      : null;
  const { driver, session } = await createDriver({
    context,
    page,
    recipe,
    sessionDir,
    paceMs: opts.paceMs,
    browserVersion: version,
    mode,
    robotsGroups: robots.groups,
    fetchRobots: (origin) => fetchRobots(context, origin, sessionDir, null),
    knownRobotsHosts: cartRobots ? [cartRobots] : [],
  });
  const log = [];
  const exec = async (step) => {
    try {
      const result = await runStep(driver, step);
      log.push({ step, ok: true });
      return result;
    } catch (e) {
      log.push({
        step,
        ok: false,
        error: {
          name: e.name,
          code: e.code ?? null,
          message: String(e.message ?? e)
            .split('\n')[0]
            .slice(0, 300),
        },
      });
      throw e;
    }
  };

  if (robots.stopCode) {
    session.stopped = { code: robots.stopCode, detail: `robots-${robots.posture}`, evidenceSha256: null };
  } else if (cartRobots?.stopCode) {
    session.stopped = { code: cartRobots.stopCode, detail: `cart-host-robots-${cartRobots.posture}`, evidenceSha256: null };
  } else {
    try {
      for (const step of steps) await exec(step);
      if ((mode === 'serve' || mode === 'recon') && !session.stopped && !session.ended) {
        let finish;
        const done = new Promise((r) => (finish = r));
        const server = await startControlServer(async (cmd) => {
          let step = { do: 'status' };
          if (cmd?.do !== 'status') {
            const parsed = StepSchema.safeParse(cmd);
            if (!parsed.success) {
              const code = Object.hasOwn(FORBIDDEN, cmd?.do) ? FORBIDDEN[cmd.do] : 'refused-unknown-action';
              throw new RefusalError(code, 'not a capture step');
            }
            step = parsed.data;
          }
          try {
            return await exec(step);
          } catch (e) {
            if (e instanceof StopError) finish();
            throw e;
          } finally {
            if (step.do === 'end' && session.ended) finish();
          }
        });
        const tokenFile = path.join(sessionDir, 'control-token');
        await writeFile(tokenFile, server.token, { mode: 0o600 });
        await opts.onServer?.({ port: server.port, token: server.token, tokenFile });
        await done;
        await server.close();
        await rm(tokenFile, { force: true });
      }
    } catch (e) {
      if (e instanceof StopError) {
        /* recorded in session.stopped */
      } else if (e instanceof RefusalError) {
        session.stopped = { code: 'tool-error', detail: `recipe-step-refused:${e.code}`, evidenceSha256: null };
      } else {
        session.stopped = { code: 'tool-error', detail: 'unexpected-error', evidenceSha256: null };
      }
    }
  }
  return { context, session, robots, cartRobots, version, log };
}

/** The session's outcome code for sessions.json: a stop, else an `end` exclusion. */
const lastStop = (session) => session.stopped?.code ?? session.ended?.exclusion ?? null;

/**
 * Capture one site. opts: { recipe, recipeText?, mode: 'run'|'serve'|'recon', recon? (ReconSpec, for 'recon'),
 * outRoot, profileDir, headless, paceMs, secondSession, onServer({port, token, tokenFile}) }.
 * Returns { record, recordPath, sessionDir } (a recon record for 'recon').
 */
export async function runSite(opts) {
  if (opts.mode === 'recon') return runRecon(opts);
  const recipe = parseRecipe(opts.recipe);
  const recipeSha256 = sha256(opts.recipeText ?? JSON.stringify(opts.recipe));
  const paceMs = opts.paceMs ?? MIN_PACE_MS;
  if (paceMs < MIN_PACE_MS && !isLoopback(new URL(recipe.origin).hostname))
    throw new Error(`pace below ${MIN_PACE_MS} ms is for local fixtures only`);
  const outRoot = path.resolve(opts.outRoot ?? DEFAULT_OUT);
  const profileDir = checkProfileDir(opts.profileDir ?? DEFAULT_PROFILE);
  await checkRecon(outRoot, recipe);
  const release = await acquireLock(outRoot, recipe.domain);
  let context;
  try {
    const siteDir = path.join(outRoot, recipe.domain);
    const { number, prior } = await sessionNumber(siteDir, opts.secondSession);
    const startedAt = new Date();
    const sessionId = utcId(startedAt);
    const sessionDir = path.join(siteDir, sessionId);
    await mkdir(sessionDir, { recursive: true });

    const driven = await drive({
      recipe,
      mode: opts.mode,
      sessionDir,
      opts: { ...opts, paceMs, profileDir },
      paths: [recipe.cartPath, ...recipe.checkoutPaths],
      steps: recipe.steps,
    });
    context = driven.context;
    const { session, robots, cartRobots, version, log } = driven;
    // Each recipe path against the rules of the host it is served on: the cart path against the cart host's.
    const entryHost = new URL(recipe.origin).host;
    const decided = (r) => r && (r.posture === 'rules' || r.posture === 'no-robots-4xx');
    const checkedPaths = [
      ...(decided(cartRobots ?? robots)
        ? [
            {
              path: recipe.cartPath,
              host: cartRobots?.host ?? entryHost,
              allowed: pathAllowed((cartRobots ?? robots).groups, recipe.cartPath),
            },
          ]
        : []),
      ...(decided(robots)
        ? recipe.checkoutPaths.map((p) => ({ path: p, host: entryHost, allowed: pathAllowed(robots.groups, p) }))
        : []),
    ];

    // Platform only from empty-cart and the first captured cart state, and the checkout-1 host.
    const pages = [];
    for (const s of platformStates(session.snapshots)) {
      const html = await readFile(path.join(s.dir, 'page.html'), 'utf8');
      const doc = JSON.parse(await readFile(path.join(s.dir, 'headers.json'), 'utf8'));
      pages.push({ html, headers: doc?.headers ?? {} });
    }
    const checkout = session.snapshots.find((s) => s.state === 'checkout-1');
    const platform = pages.length ? detectPlatform(pages, checkout?.url ?? null) : null;
    const terms = session.snapshots.find((s) => s.state === 'terms');

    const captured = session.snapshots.some((s) => s.state === 'cart-1' || s.state === 'minicart-1');
    const exclusion = session.ended?.exclusion ?? null;
    let outcome;
    if (captured) outcome = { status: 'captured', code: null, evidenceSha256: null };
    else if (exclusion === 'tool-error')
      outcome = { status: 'incomplete', code: 'tool-error', evidenceSha256: session.ended.evidenceSha256 };
    else if (exclusion)
      outcome = { status: 'excluded', code: exclusion, evidenceSha256: session.ended.evidenceSha256 };
    else if (session.stopped && session.stopped.code !== 'tool-error')
      outcome = {
        status: 'excluded',
        code: session.stopped.code,
        evidenceSha256: session.stopped.evidenceSha256,
      };
    else outcome = { status: 'incomplete', code: session.stopped?.code ?? null, evidenceSha256: null };

    const record = SiteRecord.parse({
      schema: SITE_RECORD_SCHEMA,
      domain: recipe.domain,
      recipeSha256,
      tool: { version: TOOL_VERSION, browser: version, userAgentToken: ROBOTS_TOKEN },
      recon: recipe.recon ?? null,
      session: {
        id: sessionId,
        number,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        topLevelNavigations: session.navigations,
      },
      robots: {
        url: robots.url,
        httpStatus: robots.httpStatus,
        sha256: robots.sha256,
        posture: robots.posture,
        groups: robots.groups,
        checkedPaths,
        decision: robots.decision,
      },
      robotsHosts: hostRecords(session),
      terms: {
        url: committableUrl(terms?.url ?? recipe.termsUrl ?? null),
        copySha256: terms?.manifestSha256 ?? null,
        prohibitsAutomated: 'unknown',
      },
      states: session.snapshots.map(
        ({ state, url, manifestSha256, domSha256, viewportSha256, robotsAllowed }) => ({
          state,
          url: committableUrl(url),
          manifestSha256,
          domSha256,
          viewportSha256,
          robotsAllowed,
        }),
      ),
      notReached: session.ended?.notReached ?? [],
      // An off-site page counts as a third-party checkout only if checkout-1 was captured on it; any other off-site
      // landing (for example a regional redirect) stays an event.
      thirdPartyCheckoutHost:
        session.offsite && checkout && new URL(checkout.url).host === session.offsite
          ? session.offsite
          : null,
      platform,
      events: session.events,
      stop: session.stopped,
      outcome,
    });
    const recordPath = path.join(sessionDir, 'site-record.json');
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    // The steps that ran, with the allowlist as it ended, for the operator to commit as the site's recipe.
    const recorded = { ...recipe, allowlist: session.allowlist, steps: session.steps };
    await writeFile(path.join(sessionDir, 'recipe.recorded.json'), `${JSON.stringify(recorded, null, 2)}\n`);
    await writeFile(path.join(sessionDir, 'steps.log.json'), `${JSON.stringify(log, null, 2)}\n`);
    prior.push({
      id: sessionId,
      date: startedAt.toISOString().slice(0, 10),
      stopCode: lastStop(session),
      outcome: outcome.status,
    });
    await writeFile(path.join(siteDir, 'sessions.json'), `${JSON.stringify(prior, null, 2)}\n`);
    return { record, recordPath, sessionDir };
  } finally {
    await context?.close().catch(() => {});
    await release();
  }
}

/**
 * A reconnaissance session: look only, under the same guards, before the capture session. It finds the listing,
 * the first eligible item(s), the real cart path and any checkout path (protocol .4), and ends with those findings or
 * an exclusion. The tool then writes `recipe.draft.json` (the operator adds the capture allowlist and steps and
 * commits it). Its `view-NN` snapshots never count: they are never labelled or used for platform detection.
 */
async function runRecon(opts) {
  const spec = ReconSpec.parse(opts.recon);
  const paceMs = opts.paceMs ?? MIN_PACE_MS;
  if (paceMs < MIN_PACE_MS && !isLoopback(new URL(spec.entryUrl).hostname))
    throw new Error(`pace below ${MIN_PACE_MS} ms is for local fixtures only`);
  const outRoot = path.resolve(opts.outRoot ?? DEFAULT_OUT);
  const profileDir = checkProfileDir(opts.profileDir ?? DEFAULT_PROFILE);
  const release = await acquireLock(outRoot, spec.domain);
  let context;
  try {
    const siteDir = path.join(outRoot, spec.domain);
    const { number, prior } = await sessionNumber(siteDir, opts.secondSession, 'recon-sessions.json');
    const startedAt = new Date();
    const sessionId = utcId(startedAt);
    const sessionDir = path.join(siteDir, 'recon', sessionId);
    await mkdir(sessionDir, { recursive: true });
    const origin = new URL(spec.entryUrl).origin;
    const pseudo = {
      domain: spec.domain,
      origin: `${origin}/`,
      hosts: spec.hosts,
      productUrls: [],
      allowlist: spec.allowlist,
    };
    const driven = await drive({
      recipe: pseudo,
      mode: 'recon',
      sessionDir,
      opts: { ...opts, paceMs, profileDir },
      paths: [],
      steps: spec.steps,
    });
    context = driven.context;
    const { session, robots, version, log } = driven;

    let draft = null;
    const findings = session.ended?.findings ?? null;
    if (findings) {
      draft = parseRecipe({
        schema: RECIPE_SCHEMA,
        domain: spec.domain,
        origin: `${origin}/`,
        recon: { sessionId },
        cartHost: session.ended.cartHost,
        ...findings,
        allowlist: spec.allowlist,
        steps: [],
      });
    }
    const draftText = draft ? `${JSON.stringify(draft, null, 2)}\n` : null;
    const exclusion = session.ended?.exclusion ?? null;
    let outcome;
    if (draft) outcome = { status: 'done', code: null, evidenceSha256: null, draftRecipeSha256: sha256(draftText) };
    else if (exclusion && exclusion !== 'tool-error')
      outcome = { status: 'excluded', code: exclusion, evidenceSha256: session.ended.evidenceSha256, draftRecipeSha256: null };
    else if (session.stopped && session.stopped.code !== 'tool-error')
      outcome = {
        status: 'excluded',
        code: session.stopped.code,
        evidenceSha256: session.stopped.evidenceSha256,
        draftRecipeSha256: null,
      };
    else outcome = { status: 'incomplete', code: lastStop(session), evidenceSha256: null, draftRecipeSha256: null };

    const record = ReconRecord.parse({
      schema: RECON_RECORD_SCHEMA,
      domain: spec.domain,
      entryUrl: spec.entryUrl,
      currency: spec.currency,
      priceBand: spec.priceBand,
      tool: { version: TOOL_VERSION, browser: version, userAgentToken: ROBOTS_TOKEN },
      session: {
        id: sessionId,
        number,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        topLevelNavigations: session.navigations,
      },
      robots: {
        url: robots.url,
        httpStatus: robots.httpStatus,
        sha256: robots.sha256,
        posture: robots.posture,
        groups: robots.groups,
        decision: robots.decision,
      },
      robotsHosts: hostRecords(session),
      views: session.views,
      navigation: session.navigationLog.map(committableUrl).slice(0, 200),
      events: session.events,
      stop: session.stopped,
      outcome,
    });
    const recordPath = path.join(sessionDir, 'recon-record.json');
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    if (draftText) await writeFile(path.join(sessionDir, 'recipe.draft.json'), draftText);
    await writeFile(path.join(sessionDir, 'visited.json'), `${JSON.stringify([...session.visited], null, 2)}\n`);
    await writeFile(path.join(sessionDir, 'steps.log.json'), `${JSON.stringify(log, null, 2)}\n`);
    prior.push({
      id: sessionId,
      date: startedAt.toISOString().slice(0, 10),
      stopCode: lastStop(session),
      outcome: outcome.status,
    });
    await writeFile(path.join(siteDir, 'recon-sessions.json'), `${JSON.stringify(prior, null, 2)}\n`);
    return { record, recordPath, sessionDir, draft };
  } finally {
    await context?.close().catch(() => {});
    await release();
  }
}

/** The reconnaissance input for a frame domain: entry host, frame currency and its item price band. */
export async function reconSpecFor(domain) {
  const frame = JSON.parse(await readFile(path.join(here, '..', 'retail-frame-3.json'), 'utf8'));
  const bands = JSON.parse(await readFile(path.join(here, '..', 'item-price-bands.json'), 'utf8'));
  const site = frame.domains.find((d) => d.domain === domain);
  if (!site || !site.eligible) throw new Error(`${domain} is not an eligible domain of retail-frame.3`);
  return {
    domain,
    entryUrl: `https://${site.entryHost}/`,
    hosts: site.hosts,
    currency: site.currency,
    priceBand: bands.currencies[site.currency] ?? null,
  };
}

/** List session records under an output root: capture sessions, then reconnaissance sessions. */
export async function listRecords(outRoot = DEFAULT_OUT) {
  const out = [];
  const read = async (...p) => {
    try {
      out.push(JSON.parse(await readFile(path.join(outRoot, ...p), 'utf8')));
    } catch {
      /* not a session folder */
    }
  };
  for (const domain of await readdir(outRoot).catch(() => [])) {
    for (const id of await readdir(path.join(outRoot, domain)).catch(() => []))
      await read(domain, id, 'site-record.json');
    for (const id of await readdir(path.join(outRoot, domain, 'recon')).catch(() => []))
      await read(domain, 'recon', id, 'recon-record.json');
  }
  return out;
}

/** Records whose session stopped on a block (bot wall, 403/429, CAPTCHA, extension check). */
export async function listBlocked(outRoot = DEFAULT_OUT) {
  return (await listRecords(outRoot))
    .filter((r) => BLOCK_CODES.includes(r.stop?.code))
    .map((r) => ({
      domain: r.domain,
      kind: r.schema === RECON_RECORD_SCHEMA ? 'recon' : 'capture',
      sessionId: r.session.id,
      code: r.stop.code,
      reason: r.stop.detail,
      evidenceSha256: r.stop.evidenceSha256,
      outcome: r.outcome.status,
      robotsDecision: r.robots.decision,
    }));
}

async function main(argv) {
  const [cmd, recipePath, ...rest] = argv;
  if (cmd === 'list-blocked') {
    const i = argv.indexOf('--out');
    console.log(JSON.stringify(await listBlocked(i >= 0 ? argv[i + 1] : DEFAULT_OUT), null, 2));
    return;
  }
  const flag = (name) => rest.includes(name);
  const value = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!['check', 'run', 'serve', 'recon'].includes(cmd) || !recipePath) {
    console.error(
      'usage: capture.mjs recon <domain> | check|run|serve <recipe.json>  [--headless] [--out DIR] [--profile DIR] [--second-session] [--allowlist FILE]',
    );
    process.exit(2);
  }
  const onServer = ({ port, tokenFile }) =>
    console.log(
      JSON.stringify({
        control: `http://127.0.0.1:${port}/`,
        tokenFile,
        note: 'POST JSON steps with Authorization: Bearer <token>',
      }),
    );
  if (cmd === 'recon') {
    const allowlist = value('--allowlist') ? JSON.parse(await readFile(value('--allowlist'), 'utf8')) : [];
    const { record, recordPath, draft } = await runSite({
      mode: 'recon',
      recon: { ...(await reconSpecFor(recipePath)), allowlist },
      outRoot: value('--out'),
      profileDir: value('--profile'),
      headless: flag('--headless'),
      secondSession: flag('--second-session'),
      onServer,
    });
    console.log(JSON.stringify({ outcome: record.outcome, recordPath, draft: Boolean(draft) }));
    return;
  }
  const recipeText = await readFile(recipePath, 'utf8');
  const recipe = parseRecipe(JSON.parse(recipeText));
  if (cmd === 'check') {
    console.log(JSON.stringify({ ok: true, domain: recipe.domain, recipeSha256: sha256(recipeText) }));
    return;
  }
  const { record, recordPath } = await runSite({
    recipe,
    recipeText,
    mode: cmd,
    outRoot: value('--out'),
    profileDir: value('--profile'),
    headless: flag('--headless'),
    secondSession: flag('--second-session'),
    onServer,
  });
  console.log(
    JSON.stringify({ outcome: record.outcome, states: record.states.map((s) => s.state), recordPath }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
