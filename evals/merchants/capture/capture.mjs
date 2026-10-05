#!/usr/bin/env node
// Phase 12 capture tool: one site per run, from a committed recipe (README.md in this folder).
//
//   node evals/merchants/capture/capture.mjs check <recipe.json>             validate a recipe, load nothing
//   node evals/merchants/capture/capture.mjs run <recipe.json> [options]     robots check, then the recipe's steps
//   node evals/merchants/capture/capture.mjs serve <recipe.json> [options]   robots check, recipe steps, then a local
//                                                                           control server for the operator's steps
// Options: --headless  --out <dir>  --profile <dir>  --second-session
//
// Snapshots, robots.txt and terms copies, logs and the browser profile go to gitignored folders. The committable
// output is each session's text-free site-record.json.
import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startControlServer } from './control-server.mjs';
import { FORBIDDEN, MIN_PACE_MS, createDriver, runStep } from './driver.mjs';
import { RefusalError, StopError } from './guards.mjs';
import { detectPlatform } from './platform.mjs';
import { SITE_RECORD_SCHEMA, SiteRecord, StepSchema, isLoopback, parseRecipe } from './recipe.mjs';
import { ROBOTS_TOKEN, robotsPosture } from './robots.mjs';
import { sha256 } from './snapshot.mjs';

export const TOOL_VERSION = 'capture-tool.1';
const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = path.join(here, 'data');
export const DEFAULT_PROFILE = path.join(here, 'profile');

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

/** One capture session per site; a second only after a tool-error session on an earlier UTC day. */
async function sessionNumber(siteDir, secondSession) {
  let prior = [];
  try {
    prior = JSON.parse(await readFile(path.join(siteDir, 'sessions.json'), 'utf8'));
  } catch {
    prior = [];
  }
  if (prior.length === 0) return { number: 1, prior };
  const last = prior[prior.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  if (secondSession && prior.length === 1 && last.stopCode === 'tool-error' && last.date < today)
    return { number: 2, prior };
  throw new Error(
    `site already has ${prior.length} session(s) (last stop: ${last.stopCode ?? 'none'}); a second session is allowed only after a tool-error, on a later day, with --second-session`,
  );
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

/**
 * Capture one site. opts: { recipe, recipeText?, mode: 'run'|'serve', outRoot, profileDir, headless, paceMs,
 * secondSession, onServer({port, token, tokenFile}) }. Returns { record, recordPath, sessionDir }.
 */
export async function runSite(opts) {
  const recipe = parseRecipe(opts.recipe);
  const recipeSha256 = sha256(opts.recipeText ?? JSON.stringify(opts.recipe));
  const paceMs = opts.paceMs ?? MIN_PACE_MS;
  if (paceMs < MIN_PACE_MS && !isLoopback(new URL(recipe.origin).hostname))
    throw new Error(`pace below ${MIN_PACE_MS} ms is for local fixtures only`);
  const outRoot = path.resolve(opts.outRoot ?? DEFAULT_OUT);
  const profileDir = checkProfileDir(opts.profileDir ?? DEFAULT_PROFILE);
  const release = await acquireLock(outRoot, recipe.domain);
  let context;
  try {
    const siteDir = path.join(outRoot, recipe.domain);
    const { number, prior } = await sessionNumber(siteDir, opts.secondSession);
    const startedAt = new Date();
    const sessionId = utcId(startedAt);
    const sessionDir = path.join(siteDir, sessionId);
    await mkdir(sessionDir, { recursive: true });

    // Playwright's default arguments include --disable-extensions; nothing here loads one, sets a proxy or a stealth
    // plugin. Service workers are blocked so every navigation passes the driver's route guard.
    context = await chromium.launchPersistentContext(profileDir, {
      headless: Boolean(opts.headless),
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    const version = await browserVersion(context, page);

    // robots.txt before any page load: fetched with the browser's own request context (no page is opened).
    const robotsUrl = new URL('/robots.txt', recipe.origin).href;
    const fetched = { httpStatus: null, body: null };
    try {
      const res = await context.request.get(robotsUrl, {
        timeout: 20_000,
        maxRedirects: 5,
        failOnStatusCode: false,
      });
      fetched.httpStatus = res.status();
      fetched.body = fetched.httpStatus < 300 ? (await res.body()).toString('utf8') : null;
    } catch {
      fetched.httpStatus = null;
    }
    if (fetched.body !== null) await writeFile(path.join(sessionDir, 'robots.txt'), fetched.body);
    const paths = [recipe.cartPath, ...recipe.checkoutPaths];
    const robots = robotsPosture(fetched, paths, ROBOTS_TOKEN);

    const { driver, session } = await createDriver({
      context,
      page,
      recipe,
      sessionDir,
      paceMs,
      browserVersion: version,
      mode: opts.mode,
      robotsGroups: robots.groups,
    });
    const log = [];
    const exec = async (step) => {
      try {
        const result = await runStep(driver, step);
        log.push({ step, ok: true });
        return result;
      } catch (e) {
        log.push({ step, ok: false, error: { name: e.name, code: e.code ?? null } });
        throw e;
      }
    };

    if (robots.stopCode) {
      session.stopped = {
        code: robots.stopCode,
        detail: `robots.txt posture ${robots.posture}`,
        evidenceSha256: null,
      };
    } else {
      try {
        for (const step of recipe.steps) await exec(step);
        if (opts.mode === 'serve' && !session.stopped && !session.ended) {
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
              if (step.do === 'end') finish();
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
          session.stopped = {
            code: 'tool-error',
            detail: `recipe step refused: ${e.code}`,
            evidenceSha256: null,
          };
        } else {
          session.stopped = {
            code: 'tool-error',
            detail: String(e.message ?? e)
              .split('\n')[0]
              .slice(0, 200),
            evidenceSha256: null,
          };
        }
      }
    }

    // Platform from every captured state's HTML and main-document headers, and the checkout URL.
    const pages = [];
    for (const s of session.snapshots) {
      const html = await readFile(path.join(s.dir, 'page.html'), 'utf8');
      const doc = JSON.parse(await readFile(path.join(s.dir, 'headers.json'), 'utf8'));
      pages.push({ html, headers: doc?.headers ?? {} });
    }
    const checkout = session.snapshots.find((s) => s.state === 'checkout-1');
    const platform = session.snapshots.length ? detectPlatform(pages, checkout?.url ?? null) : null;
    const terms = session.snapshots.find((s) => s.state === 'terms');

    const captured = session.snapshots.some((s) => s.state === 'cart-1' || s.state === 'minicart-1');
    const exclusion = session.ended?.exclusion ?? null;
    let outcome;
    if (captured) outcome = { status: 'captured', code: null, evidenceSha256: null };
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
      session: {
        id: sessionId,
        number,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        topLevelNavigations: session.navigations,
      },
      robots: {
        url: robotsUrl,
        httpStatus: fetched.httpStatus,
        sha256: fetched.body === null ? null : sha256(fetched.body),
        posture: robots.posture,
        groups: robots.groups,
        checkedPaths: robots.checkedPaths,
        decision: robots.decision,
      },
      terms: {
        url: terms?.url ?? recipe.termsUrl ?? null,
        copySha256: terms?.manifestSha256 ?? null,
        prohibitsAutomated: 'unknown',
      },
      states: session.snapshots.map(({ state, url, manifestSha256, domSha256, viewportSha256 }) => ({
        state,
        url,
        manifestSha256,
        domSha256,
        viewportSha256,
      })),
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
      stopCode: session.stopped?.code ?? null,
      outcome: outcome.status,
    });
    await writeFile(path.join(siteDir, 'sessions.json'), `${JSON.stringify(prior, null, 2)}\n`);
    return { record, recordPath, sessionDir };
  } finally {
    await context?.close().catch(() => {});
    await release();
  }
}

/** List session records under an output root (newest last). */
export async function listRecords(outRoot = DEFAULT_OUT) {
  const out = [];
  for (const domain of await readdir(outRoot).catch(() => [])) {
    for (const id of await readdir(path.join(outRoot, domain)).catch(() => [])) {
      try {
        out.push(JSON.parse(await readFile(path.join(outRoot, domain, id, 'site-record.json'), 'utf8')));
      } catch {
        /* not a session folder */
      }
    }
  }
  return out;
}

async function main(argv) {
  const [cmd, recipePath, ...rest] = argv;
  const flag = (name) => rest.includes(name);
  const value = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!['check', 'run', 'serve'].includes(cmd) || !recipePath) {
    console.error(
      'usage: capture.mjs check|run|serve <recipe.json> [--headless] [--out DIR] [--profile DIR] [--second-session]',
    );
    process.exit(2);
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
    onServer: ({ port, tokenFile }) =>
      console.log(
        JSON.stringify({
          control: `http://127.0.0.1:${port}/`,
          tokenFile,
          note: 'POST JSON steps with Authorization: Bearer <token>',
        }),
      ),
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
