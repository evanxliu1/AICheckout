// The capture driver: the only way the tool touches a page. Its API is goto, click, wait, snapshot, status and end.
// It has no typing, key press, <select>, file, coordinate or mouse path; any other property access throws a
// RefusalError. Every rule of docs/evals/generic-reader-protocol.md#capture-posture that code can enforce is here:
// same-site navigation only, one third-party checkout page at most, no form-submitting navigation except during an
// allowlisted add-to-cart click, no clicks on submit or in-form controls unless allowlisted for a purpose, no frames,
// at least `paceMs` between navigations and clicks, at most 25 top-level navigations, and a stop on any block.
// Every in-page check runs in a CDP isolated world on the node the click will actually hit, so page scripts cannot
// fake the facts. Redirects are not routed by Playwright, so where the page lands is checked after every action.
// Same-site writes by fetch or XHR are aborted outside an add-to-cart or increment click; robots.txt is applied to
// every top-level navigation on the recipe's origin host (never to other hosts).
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { RefusalError, StopError, detectStop, inspectControl, judgeClick, pageFacts } from './guards.mjs';
import { ACTION_STATES, SnapshotName, Target, isLoopback, sameSite, sameTarget } from './recipe.mjs';
import { isAllowed } from './robots.mjs';
import { sha256, writeSnapshot } from './snapshot.mjs';

export const MIN_PACE_MS = 3000;
export const MAX_NAVIGATIONS = 25;
export const API = Object.freeze(['goto', 'click', 'wait', 'snapshot', 'status', 'end']);

export const FORBIDDEN = {
  type: 'refused-typing',
  fill: 'refused-typing',
  press: 'refused-typing',
  pressSequentially: 'refused-typing',
  keyboard: 'refused-typing',
  insertText: 'refused-typing',
  selectOption: 'refused-select',
  setInputFiles: 'refused-file-input',
  mouse: 'refused-coordinate-click',
  clickAt: 'refused-coordinate-click',
  clickxy: 'refused-coordinate-click',
  touchscreen: 'refused-coordinate-click',
  tap: 'refused-coordinate-click',
  dblclick: 'refused-coordinate-click',
  dragAndDrop: 'refused-coordinate-click',
  check: 'refused-in-form',
  submit: 'refused-submit',
  evaluate: 'refused-raw-page',
  page: 'refused-raw-page',
  frame: 'refused-cross-origin-frame',
};

/** Wrap an API object so that anything outside API throws a RefusalError naming the refusal. */
export function guardApi(api) {
  const target = Object.freeze({ ...api });
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
      if (API.includes(prop)) return t[prop];
      const code = FORBIDDEN[prop] ?? 'refused-unknown-action';
      return () => {
        throw new RefusalError(code, `the capture driver has no "${prop}"`);
      };
    },
    set() {
      throw new RefusalError('refused-unknown-action', 'the capture driver is read-only');
    },
    defineProperty() {
      throw new RefusalError('refused-unknown-action', 'the capture driver is read-only');
    },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normPath = (u) => u.pathname.replace(/\/+$/, '') || '/';

/** Parse a click/wait target strictly; coordinates, positions and frame-entering selectors are refused. */
export function parseTarget(raw) {
  if (
    raw &&
    typeof raw === 'object' &&
    ['x', 'y', 'position', 'coordinate', 'coordinates'].some((k) => k in raw)
  )
    throw new RefusalError('refused-coordinate-click', 'targets are elements, never coordinates');
  if (typeof raw?.selector === 'string' && /internal:|>>/.test(raw.selector))
    throw new RefusalError('refused-cross-origin-frame', 'selector may not chain engines or enter frames');
  const r = Target.safeParse(raw);
  if (!r.success)
    throw new RefusalError(
      'refused-bad-target',
      'target must be {role, name[, exact]} or {selector}',
      'tool-error',
    );
  return r.data;
}

/**
 * Create a driver for one site session.
 * opts: { context, page, recipe, sessionDir, paceMs, browserVersion, robotsGroups } (both modes behave the same;
 * the allowlist is always the recipe's)
 * Returns { driver, session } — `driver` is the guarded API, `session` the record the runner finalizes.
 */
export async function createDriver(opts) {
  const { context, page, recipe, sessionDir, browserVersion, robotsGroups = [] } = opts;
  const paceMs = opts.paceMs ?? MIN_PACE_MS;
  const originHost = new URL(recipe.origin).host;
  const loopbackOnly = isLoopback(new URL(recipe.origin).hostname);
  if (paceMs < MIN_PACE_MS && !loopbackOnly)
    throw new RefusalError(
      'refused-pace',
      `pace below ${MIN_PACE_MS} ms is for local fixtures only`,
      'tool-error',
    );
  const domain = recipe.domain;
  const productPaths = new Set(recipe.productUrls.map((u) => normPath(new URL(u))));
  const session = {
    navigations: 0,
    lastActionAt: 0,
    action: null,
    allowSubmitUntil: 0,
    allowMutateUntil: 0,
    noNavigation: false,
    doc: null,
    stopped: null,
    ended: null,
    offsite: null,
    violations: [],
    events: [],
    snapshots: [],
    steps: [],
    allowlist: [...recipe.allowlist],
  };
  const event = (kind, detail = '') => {
    const d = String(detail).slice(0, 200);
    if (session.events.length < 200 && !session.events.some((e) => e.kind === kind && e.detail === d))
      session.events.push({ kind, detail: d });
  };
  const robotsOk = (u) =>
    u.host !== originHost || robotsGroups.every((g) => isAllowed(g, u.pathname + u.search));

  // CDP: navigation reasons (to see GET form submissions) and an isolated world for every in-page check, so page
  // scripts cannot fake the facts the guards read.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  const navReasons = new Map();
  cdp.on('Page.frameRequestedNavigation', (e) => {
    if (navReasons.size > 500) navReasons.clear();
    navReasons.set(e.url, e.reason);
  });
  const formReason = async (url) => {
    const tries = session.action === 'click' ? 25 : 1;
    for (let i = 0; i < tries; i += 1) {
      const r = navReasons.get(url);
      if (r) return /^formSubmission/.test(r);
      await sleep(10);
    }
    return false;
  };
  const isolatedWorld = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: 'ai-checkout-capture-guard',
      grantUniveralAccess: false,
    });
    return executionContextId;
  };
  const isolatedFacts = async () => {
    const contextId = await isolatedWorld();
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(${pageFacts.toString()})()`,
      contextId,
      returnByValue: true,
    });
    return r.result.value;
  };
  /** Inspect, in the isolated world, the control that will receive a click at viewport point (x, y). */
  const inspectAt = async (x, y) => {
    await cdp.send('DOM.getDocument', { depth: 0 });
    const { backendNodeId, frameId } = await cdp.send('DOM.getNodeForLocation', {
      x: Math.round(x),
      y: Math.round(y),
      includeUserAgentShadowDOM: false,
      ignorePointerEventsNone: false,
    });
    const { frameTree } = await cdp.send('Page.getFrameTree');
    // A point inside a child frame (same- or cross-origin) belongs to that frame: never clicked.
    if (frameId && frameId !== frameTree.frame.id) return { tag: 'iframe', frame: true, name: '' };
    const executionContextId = await isolatedWorld();
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId, executionContextId });
    try {
      const r = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function () { return (${inspectControl.toString()})(this); }`,
        returnByValue: true,
      });
      return r.result.value ?? null;
    } finally {
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    }
  };

  await context.route('**/*', async (route) => {
    const req = route.request();
    let nav = false;
    let frame = null;
    try {
      nav = req.isNavigationRequest();
      frame = req.frame();
    } catch {
      nav = false;
    }
    let url;
    try {
      url = new URL(req.url());
    } catch {
      return route.abort('blockedbyclient');
    }
    if (!nav) {
      // fetch, XHR, beacons: a same-site write is allowed only during an allowlisted add-to-cart or increment click.
      const m = req.method();
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(m) &&
        sameSite(url.hostname, domain) &&
        Date.now() > session.allowMutateUntil
      ) {
        event('request-aborted', `${m} ${url.host}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    }
    if (!frame) return route.continue();
    if (frame.page() !== page) {
      event('popup-navigation-aborted', url.host);
      return route.abort('blockedbyclient');
    }
    if (frame !== page.mainFrame()) return route.continue(); // subframe document: never interacted with
    const refuse = (code, detail, exclusionCode) => {
      session.violations.push({ code, detail, exclusionCode });
      event('navigation-aborted', `${code} ${url.host}`);
      return route.abort('blockedbyclient');
    };
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse('refused-scheme', url.protocol);
    if (session.stopped || session.ended) return refuse('refused-after-stop', 'session over');
    if (session.offsite)
      return refuse('refused-third-party-page', 'only the first third-party checkout page loads');
    if (session.navigations >= MAX_NAVIGATIONS)
      return refuse('refused-navigation-limit', `${MAX_NAVIGATIONS} navigations`);
    if (session.noNavigation) return refuse('refused-submit', 'a non-add-to-cart submit control navigated');
    const formSubmit = req.method() !== 'GET' || (await formReason(req.url()));
    if (formSubmit && Date.now() > session.allowSubmitUntil)
      return refuse('refused-submit', `form submission (${req.method()}) outside an add-to-cart click`);
    if (!sameSite(url.hostname, domain)) {
      if (session.action !== 'click') return refuse('refused-off-site', url.host);
      session.offsite = url.host;
      event('off-site-page', url.host);
    } else if (!robotsOk(url)) {
      return refuse('robots-disallow-path', 'robots.txt disallows this path', 'robots-disallow-path');
    }
    session.navigations += 1;
    return route.continue();
  });
  page.on('response', async (res) => {
    try {
      if (res.request().resourceType() === 'document' && res.frame() === page.mainFrame())
        session.doc = {
          url: res.url(),
          status: res.status(),
          headers: await res.allHeaders().catch(() => ({})),
        };
    } catch {
      /* frame detached */
    }
  });
  context.on('page', (p) => {
    if (p !== page) {
      event('popup-closed');
      p.close().catch(() => {});
    }
  });
  page.on('dialog', (d) => {
    event('dialog-dismissed');
    d.dismiss().catch(() => {});
  });

  const active = () => {
    if (session.stopped)
      throw new RefusalError(
        'refused-after-stop',
        `site stopped (${session.stopped.code})`,
        session.stopped.code,
      );
    if (session.ended) throw new RefusalError('refused-after-stop', 'session ended', 'tool-error');
  };
  const notOffsite = () => {
    if (session.offsite)
      throw new RefusalError(
        'refused-third-party-page',
        `on third-party host ${session.offsite}; only a snapshot is allowed`,
      );
  };
  const pace = async () => {
    const wait = session.lastActionAt + paceMs - Date.now();
    if (wait > 0) await sleep(wait);
  };
  const evidence = async (code) => {
    const buf = await page.screenshot().catch(() => null);
    if (!buf) return null;
    await writeFile(path.join(sessionDir, `evidence-${code}.png`), buf);
    return sha256(buf);
  };
  /** Stop the site. `reason` is a short code (it goes into the committed record), `message` is for the operator. */
  const stop = async (code, reason, message = reason) => {
    session.stopped = { code, detail: reason, evidenceSha256: await evidence(code) };
    event('stop', code);
    throw new StopError(code, message);
  };
  const checkStop = async () => {
    if (page.url() === 'about:blank') return;
    const facts = await isolatedFacts().catch(() => ({
      title: '',
      text: '',
      passwordVisible: false,
      captchaElement: false,
    }));
    const hit = detectStop({
      ...facts,
      status: session.doc ? session.doc.status : null,
      url: page.url(),
      frameUrls: page
        .frames()
        .slice(1)
        .map((f) => f.url()),
    });
    if (hit) await stop(hit.code, hit.reason, hit.message);
  };
  /** After every action: aborted navigations, where the page landed (redirects are not routed), then stops. */
  const afterAction = async (startViolations) => {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await sleep(Math.min(1000, paceMs));
    session.lastActionAt = Date.now();
    session.action = null;
    session.allowSubmitUntil = 0;
    session.allowMutateUntil = 0;
    session.noNavigation = false;
    const v = session.violations.slice(startViolations);
    if (v.length) throw new RefusalError(v[0].code, `navigation aborted: ${v[0].detail}`, v[0].exclusionCode);
    await checkLanding();
    await checkStop();
  };
  const checkLanding = async () => {
    let landed;
    try {
      landed = new URL(page.url());
    } catch {
      return;
    }
    if (landed.protocol !== 'http:' && landed.protocol !== 'https:') return;
    if (!sameSite(landed.hostname, domain)) {
      if (!session.offsite) {
        session.offsite = landed.host;
        event('off-site-page', landed.host);
      } else if (landed.host !== session.offsite) {
        await stop('would-need-forbidden-action', 'past-first-third-party-page');
      }
    } else if (!session.offsite && !robotsOk(landed)) {
      event('robots-disallowed-landing', landed.host);
      throw new RefusalError(
        'robots-disallow-path',
        'landed on a path robots.txt disallows',
        'robots-disallow-path',
      );
    }
  };
  const onProductPage = () => {
    try {
      const u = new URL(page.url());
      return sameSite(u.hostname, domain) && productPaths.has(normPath(u));
    } catch {
      return false;
    }
  };
  const record = (step) => session.steps.push(step);

  async function goto(url) {
    active();
    notOffsite();
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new RefusalError('refused-bad-url', 'not a URL', 'tool-error');
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname)))
      throw new RefusalError('refused-scheme', 'https only');
    if (!sameSite(u.hostname, domain))
      throw new RefusalError('refused-off-site', `${u.host} is not on ${domain}`);
    if (session.navigations >= MAX_NAVIGATIONS)
      throw new RefusalError('refused-navigation-limit', `${MAX_NAVIGATIONS} navigations used`);
    await checkStop();
    await pace();
    const v0 = session.violations.length;
    session.action = 'goto';
    session.doc = null;
    let failed = null;
    await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e) => (failed = e));
    if (failed && session.violations.length === v0) {
      session.lastActionAt = Date.now();
      session.action = null;
      throw new RefusalError('navigation-failed', String(failed.message).split('\n')[0], 'tool-error');
    }
    await afterAction(v0);
    record({ do: 'goto', url: u.href });
    return status();
  }

  async function click(rawTarget, purpose) {
    active();
    notOffsite();
    const target = parseTarget(rawTarget);
    // The allowlist is the recipe's, in every mode: an operator session cannot add to it.
    if (
      purpose !== undefined &&
      !session.allowlist.some((a) => a.purpose === purpose && sameTarget(a.target, target))
    )
      throw new RefusalError('refused-not-allowlisted', `${purpose} target is not on the recipe allowlist`);
    await checkStop();
    const locator =
      'selector' in target
        ? page.locator(target.selector)
        : page.getByRole(target.role, { name: target.name, exact: target.exact ?? false });
    const n = await locator.count();
    if (n !== 1) throw new RefusalError('target-not-unique', `target matched ${n} elements`, 'tool-error');
    const el = locator.first();
    // Roles from Playwright's own (isolated) accessibility snapshot: text fields and selects are refused even when
    // they have no box to hit-test.
    const role = /^- ([a-z]+)/.exec((await el.ariaSnapshot({ timeout: 5000 }).catch(() => '')) ?? '')?.[1];
    if (['textbox', 'searchbox', 'spinbutton'].includes(role))
      throw new RefusalError('refused-text-entry', 'target is a text entry field');
    if (['combobox', 'listbox', 'option'].includes(role))
      throw new RefusalError('refused-select', 'target is a select, listbox or option');
    if (!(await el.isVisible()))
      throw new RefusalError('target-not-visible', 'target is not visible', 'tool-error');
    await pace();
    await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await el.boundingBox();
    if (!box) throw new RefusalError('target-not-visible', 'target has no box', 'tool-error');
    const info = await inspectAt(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
    if (!info) throw new RefusalError('inspection-failed', 'could not inspect the click point', 'tool-error');
    const verdict = judgeClick(info, purpose);
    if (verdict) throw new RefusalError(verdict.code, verdict.message);
    if (purpose === 'add-to-cart' && !onProductPage())
      throw new RefusalError(
        'refused-not-product-page',
        'add-to-cart is clicked only on a recipe product page',
      );
    const v0 = session.violations.length;
    session.action = 'click';
    session.doc = null;
    if (purpose === 'add-to-cart') session.allowSubmitUntil = Date.now() + 15_000;
    if (purpose === 'add-to-cart' || purpose === 'quantity-increment')
      session.allowMutateUntil = Date.now() + 15_000;
    session.noNavigation = info.submit && purpose !== 'add-to-cart';
    let failed = null;
    await el.click({ timeout: 10_000 }).catch((e) => (failed = e));
    if (failed && session.violations.length === v0) {
      session.lastActionAt = Date.now();
      session.action = null;
      session.allowSubmitUntil = 0;
      session.allowMutateUntil = 0;
      session.noNavigation = false;
      throw new RefusalError('click-failed', String(failed.message).split('\n')[0], 'tool-error');
    }
    await afterAction(v0);
    record(purpose ? { do: 'click', target, purpose } : { do: 'click', target });
    return status();
  }

  async function wait(arg) {
    active();
    if (typeof arg === 'number') {
      if (!Number.isInteger(arg) || arg < 0 || arg > 30_000)
        throw new RefusalError('refused-bad-wait', 'wait 0–30000 ms', 'tool-error');
      await sleep(arg);
      record({ do: 'wait', ms: arg });
    } else {
      const target = parseTarget(arg?.for);
      const timeoutMs = arg?.timeoutMs ?? 10_000;
      const locator =
        'selector' in target
          ? page.locator(target.selector)
          : page.getByRole(target.role, { name: target.name, exact: target.exact ?? false });
      await locator
        .first()
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .catch(() => {
          throw new RefusalError('wait-timeout', 'target did not appear', 'tool-error');
        });
      record({ do: 'wait', for: target, ...(arg.timeoutMs ? { timeoutMs } : {}) });
    }
    await checkLanding();
    await checkStop();
    return status();
  }

  async function snapshot(state) {
    active();
    const parsed = SnapshotName.safeParse(state);
    if (!parsed.success) throw new RefusalError('refused-bad-state', 'unknown snapshot name', 'tool-error');
    if (session.snapshots.some((s) => s.state === state))
      throw new RefusalError('refused-duplicate-state', `${state} already captured`, 'tool-error');
    if (session.offsite && state !== 'checkout-1')
      throw new RefusalError(
        'refused-third-party-page',
        'only checkout-1 may be captured on a third-party host',
      );
    const url = new URL(page.url());
    if (!session.offsite && ACTION_STATES.includes(state) && state !== 'minicart-1' && !robotsOk(url))
      await stop('robots-disallow-path', 'snapshot-path-disallowed');
    const snap = await writeSnapshot({
      page,
      context,
      dir: path.join(sessionDir, state),
      domain,
      state,
      document: session.doc,
      browserVersion,
    });
    session.snapshots.push({
      state,
      url: snap.url,
      manifestSha256: snap.manifestSha256,
      domSha256: snap.files['dom.json'],
      viewportSha256: snap.files['viewport.png'],
      dir: snap.dir,
    });
    record({ do: 'snapshot', state });
    return { state, manifestSha256: snap.manifestSha256 };
  }

  function status() {
    return {
      url: page.url(),
      navigations: session.navigations,
      offsite: session.offsite,
      stopped: session.stopped?.code ?? null,
      ended: Boolean(session.ended),
      snapshots: session.snapshots.map((s) => s.state),
    };
  }

  async function end({ exclusion, notReached } = {}) {
    if (session.ended) throw new RefusalError('refused-after-stop', 'session already ended', 'tool-error');
    const captured = session.snapshots.some((s) => s.state === 'cart-1' || s.state === 'minicart-1');
    if (exclusion && captured)
      throw new RefusalError('refused-bad-end', 'a captured site cannot also be excluded', 'tool-error');
    const evidenceSha256 = exclusion ? await evidence(exclusion) : null;
    session.ended = { exclusion: exclusion ?? null, evidenceSha256, notReached: notReached ?? [] };
    record({ do: 'end', ...(exclusion ? { exclusion } : {}), ...(notReached?.length ? { notReached } : {}) });
    return status();
  }

  return { driver: guardApi({ goto, click, wait, snapshot, status, end }), session };
}

/** Execute one recipe or control step on a driver. */
export async function runStep(driver, step) {
  switch (step.do) {
    case 'goto':
      return driver.goto(step.url);
    case 'click':
      return driver.click(step.target, step.purpose);
    case 'wait':
      return driver.wait('ms' in step ? step.ms : { for: step.for, timeoutMs: step.timeoutMs });
    case 'snapshot':
      return driver.snapshot(step.state);
    case 'status':
      return driver.status();
    case 'end':
      return driver.end({ exclusion: step.exclusion, notReached: step.notReached });
    default:
      throw new RefusalError('refused-unknown-action', `no step "${step.do}"`);
  }
}
