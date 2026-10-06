// The capture driver: the only way the tool touches a page. Its API is goto, click, wait, snapshot, status and end.
// It has no typing, key press, <select>, file, coordinate or mouse path; any other property access throws a
// RefusalError. Every rule of docs/evals/generic-reader-protocol.md#capture-posture that code can enforce is here:
// same-site navigation only (an off-site redirect landing stops the site as redirected-off-domain), never a recipe
// checkout path, no form-submitting navigation except during an
// allowlisted add-to-cart click, no clicks on submit or in-form controls unless allowlisted for a purpose, no frames,
// at least `paceMs` between navigations and clicks, at most 25 top-level navigations (one per navigating action,
// protocol .5), and a stop on any block. `checkout-1` is not a robot state since protocol .5.
// Every in-page check runs in a CDP isolated world on the node the click will actually hit, so page scripts cannot
// fake the facts. Redirects are not routed by Playwright, so where the page lands is checked after every action.
// Same-site writes by fetch or XHR are aborted outside an add-to-cart or increment click. robots.txt (protocol .4):
// before the first page of any other host of the site loads (a cart or storefront subdomain), that host's robots.txt
// is fetched, and a disallow-everything rule stops the site (robots-disallow-all); a disallowed path is only recorded.
// The stop check always runs before any robots decision or snapshot on a landing, so a challenge page is never
// snapshotted. In `recon` mode (a look-only reconnaissance session) the driver also refuses every snapshot except
// `view-NN`, every purpose except closing a popup or declining cookies, and any control named like add-to-cart.
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { RefusalError, StopError, detectStop, inspectControl, judgeClick, pageFacts } from './guards.mjs';
import {
  Findings,
  RECON_PURPOSES,
  SnapshotName,
  Target,
  isLoopback,
  sameSite,
  sameTarget,
} from './recipe.mjs';
import { pathAllowed } from './robots.mjs';
import { sha256, writeSnapshot } from './snapshot.mjs';

export const MIN_PACE_MS = 3000;
export const MAX_NAVIGATIONS = 25;
/** Navigation requests one action may cause (its redirects, reloads and script navigations) before it is refused. */
export const MAX_REQUESTS_PER_ACTION = 10;
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
/** A visited page as compared with a recipe URL: origin, path and query, no fragment. */
export const visitKey = (raw) => {
  const u = new URL(raw);
  return `${u.origin}${u.pathname}${u.search}`;
};

/**
 * Add-to-cart wording, refused for every click of a reconnaissance session (which never adds anything). A backstop
 * beside the write guard, which already aborts same-site POSTs outside an allowlisted add-to-cart click.
 */
export const ADD_TO_CART_NAME = new RegExp(
  [
    String.raw`\badd(ed)? to (cart|bag|basket|trolley)\b`,
    String.raw`\badd to shopping (cart|bag)\b`,
    'in den (warenkorb|einkaufswagen)',
    'ajouter au panier',
    String.raw`a[ñn]adir (a la cesta|al carrito)|agregar al carrito`,
    'aggiungi al carrello',
    String.raw`adicionar (ao carrinho|à sacola)|comprar (ahora|agora|ya|já|ja)\b`,
    'in (de )?winkel(wagen|mand)',
    'dodaj do koszyka',
    String.raw`l[äa]gg i (varukorgen|kundvagnen)`,
    'sepete ekle',
    'カートに入れる|カートに追加',
    '加入购物车|加入購物車',
    '장바구니',
    'أضف إلى السلة|اضف الى السلة',
  ].join('|'),
  'i',
);

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
 * opts: { context, page, recipe, sessionDir, paceMs, browserVersion, mode, robotsGroups, fetchRobots }.
 * `run` and `serve` behave the same (the allowlist is always the recipe's); `recon` is look-only. robotsGroups are the
 * entry host's rules; fetchRobots(origin) returns robotsPosture(...) for another host of the site (omitted in tests
 * that do not load other hosts).
 * Returns { driver, session } — `driver` is the guarded API, `session` the record the runner finalizes.
 */
export async function createDriver(opts) {
  const {
    context,
    page,
    recipe,
    sessionDir,
    browserVersion,
    robotsGroups = [],
    fetchRobots = null,
    knownRobotsHosts = [],
  } = opts;
  const recon = opts.mode === 'recon';
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
    // Every main-frame navigation request (redirect hops by script, reloads); reported, not the limit.
    navigationRequests: 0,
    actionSeq: 0,
    countedSeq: 0,
    requestsThisAction: 0,
    // Each goto to the entry origin: where it landed and its server redirect chain (protocol .5 home view).
    homeLandings: [],
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
    // robots.txt of hosts other than the entry host, by host: robotsPosture(...) plus { host, url }.
    robotsHosts: new Map(knownRobotsHosts.map((r) => [r.host, r])),
    visited: new Set(),
    // Every page the session landed on, in order (full URLs; the record commits them masked).
    navigationLog: [],
    views: 0,
  };
  const event = (kind, detail = '') => {
    const d = String(detail).slice(0, 200);
    if (session.events.length < 200 && !session.events.some((e) => e.kind === kind && e.detail === d))
      session.events.push({ kind, detail: d });
  };
  /** robots.txt groups of a host, or null when the host's robots.txt was not fetched (third-party or unchecked). */
  const groupsFor = (u) =>
    u.host === originHost ? robotsGroups : (session.robotsHosts.get(u.host)?.groups ?? null);
  /** Whether robots.txt allows the page's path: recorded, never refusing. null when no rules apply to its host. */
  const robotsAllows = (u) => {
    const g = groupsFor(u);
    return g === null ? null : pathAllowed(g, u.pathname + u.search);
  };
  /** Fetch robots.txt of another host of the site once, before its first page. Returns the posture. */
  const checkHost = async (u) => {
    if (u.host === originHost || !fetchRobots) return null;
    const known = session.robotsHosts.get(u.host);
    if (known) return known;
    const posture = await fetchRobots(`${u.protocol}//${u.host}`);
    session.robotsHosts.set(u.host, { ...posture, host: u.host });
    event('robots-host-checked', `${u.host} ${posture.decision}`);
    return session.robotsHosts.get(u.host);
  };

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
    const refuse = (code, detail, exclusionCode, stops = false) => {
      session.violations.push({ code, detail, exclusionCode, stops });
      event('navigation-aborted', `${code} ${url.host}`);
      return route.abort('blockedbyclient');
    };
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse('refused-scheme', url.protocol);
    if (session.stopped || session.ended) return refuse('refused-after-stop', 'session over');
    if (session.offsite)
      return refuse('refused-third-party-page', 'the session left the site');
    // One top-level navigation per action (protocol .5): a goto or click and every navigation the page makes
    // before the next action (server and script redirects, reloads) count once.
    const newAction = session.countedSeq !== session.actionSeq;
    if (newAction && session.navigations >= MAX_NAVIGATIONS)
      return refuse('refused-navigation-limit', `${MAX_NAVIGATIONS} navigations`);
    if (!newAction && session.requestsThisAction >= MAX_REQUESTS_PER_ACTION)
      return refuse(
        'refused-navigation-loop',
        `${MAX_REQUESTS_PER_ACTION} navigation requests in one action`,
        'tool-error',
      );
    if (session.noNavigation) return refuse('refused-submit', 'a non-add-to-cart submit control navigated');
    const formSubmit = req.method() !== 'GET' || (await formReason(req.url()));
    if (formSubmit && Date.now() > session.allowSubmitUntil)
      return refuse('refused-submit', `form submission (${req.method()}) outside an add-to-cart click`);
    // Protocol .5: no page of another site is ever loaded by the tool (a third-party checkout included).
    if (!sameSite(url.hostname, domain)) return refuse('refused-off-site', url.host);
    if (isCheckout(url)) return refuse('refused-checkout', `${url.host} checkout path`);
    // Another host of the site: its robots.txt first. Only a disallow-everything rule (or a blocked or failed
    // robots.txt) stops the site; a disallowed path is recorded as an event and loads.
    const posture = await checkHost(url).catch(() => ({ stopCode: 'tool-error', decision: 'not-decided' }));
    if (posture?.stopCode)
      return refuse(`robots-host-${posture.stopCode}`, url.host, posture.stopCode, true);
    if (robotsAllows(url) === false) event('robots-disallowed-path', url.host);
    if (newAction) {
      session.navigations += 1;
      session.countedSeq = session.actionSeq;
      session.requestsThisAction = 0;
    }
    session.requestsThisAction += 1;
    session.navigationRequests += 1;
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
  /**
   * After every action: the stop check FIRST (so a challenge page is caught before any robots decision or refusal),
   * then aborted navigations, then where the page landed (redirects are not routed).
   */
  const afterAction = async (startViolations) => {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await sleep(Math.min(1000, paceMs));
    session.lastActionAt = Date.now();
    session.action = null;
    session.allowSubmitUntil = 0;
    session.allowMutateUntil = 0;
    session.noNavigation = false;
    await checkStop();
    const v = session.violations.slice(startViolations);
    if (v.length && v[0].stops) await stop(v[0].exclusionCode, v[0].code);
    if (v.length) throw new RefusalError(v[0].code, `navigation aborted: ${v[0].detail}`, v[0].exclusionCode);
    await checkLanding();
    visit();
  };
  const visit = () => {
    try {
      const u = new URL(page.url());
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        session.visited.add(visitKey(u.href));
        if (session.navigationLog.at(-1) !== u.href) session.navigationLog.push(u.href);
      }
    } catch {
      /* not a URL */
    }
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
      // A redirect (not routed by Playwright) took the page to another site: stop there; nothing more is loaded.
      session.offsite = landed.host;
      event('off-site-landing', landed.host);
      await stop('redirected-off-domain', 'landed-off-domain');
    } else if (isCheckout(landed)) {
      // A redirect onto a checkout path: stop before anything happens on it (no session enters a checkout).
      await stop('would-need-forbidden-action', 'landed-on-checkout');
    } else {
      // A redirect onto another host of the site loads before its robots.txt can be read: check it now (after the
      // stop check), and stop on a disallow-everything rule before anything else happens on the page.
      const posture = await checkHost(landed).catch(() => ({ stopCode: 'tool-error', decision: 'not-decided' }));
      if (posture?.stopCode) await stop(posture.stopCode, `landing-host-${posture.stopCode}`);
      if (robotsAllows(landed) === false) event('robots-disallowed-path', landed.host);
    }
  };
  const checkoutPaths = new Set((recipe.checkoutPaths ?? []).map((p) => p.replace(/\/+$/, '') || '/'));
  /** A same-site URL whose path is one of the recipe's checkout paths (exact, trailing slash ignored). */
  function isCheckout(u) {
    return sameSite(u.hostname, domain) && checkoutPaths.has(normPath(u));
  }
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
    if (isCheckout(u)) throw new RefusalError('refused-checkout', 'checkout paths are never visited');
    if (session.navigations >= MAX_NAVIGATIONS)
      throw new RefusalError('refused-navigation-limit', `${MAX_NAVIGATIONS} navigations used`);
    await checkStop();
    await pace();
    const v0 = session.violations.length;
    session.action = 'goto';
    session.actionSeq += 1;
    session.doc = null;
    let failed = null;
    const response = await page
      .goto(u.href, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      .catch((e) => (failed = e) && null);
    if (failed && session.violations.length === v0) {
      session.lastActionAt = Date.now();
      session.action = null;
      throw new RefusalError('navigation-failed', String(failed.message).split('\n')[0], 'tool-error');
    }
    await afterAction(v0);
    if (visitKey(u.href) === visitKey(recipe.origin)) {
      // Server redirects from the response; script redirects show in where the page finally landed.
      const chain = [];
      for (let r = response?.request() ?? null; r; r = r.redirectedFrom()) chain.unshift(r.url());
      const landed = page.url();
      session.homeLandings.push({
        requested: u.href,
        chain,
        landed,
        sameSite: (() => {
          try {
            return sameSite(new URL(landed).hostname, domain);
          } catch {
            return false;
          }
        })(),
      });
    }
    record({ do: 'goto', url: u.href });
    return status();
  }

  async function click(rawTarget, purpose) {
    active();
    notOffsite();
    const target = parseTarget(rawTarget);
    // The allowlist is the recipe's, in every mode: an operator session cannot add to it.
    if (recon && purpose !== undefined && !RECON_PURPOSES.includes(purpose))
      throw new RefusalError('refused-recon-purpose', `a reconnaissance session never clicks for ${purpose}`);
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
    if (recon && ADD_TO_CART_NAME.test(info.name))
      throw new RefusalError('refused-recon-add-to-cart', 'a reconnaissance session never adds to the cart');
    if (purpose === 'add-to-cart' && !onProductPage())
      throw new RefusalError(
        'refused-not-product-page',
        'add-to-cart is clicked only on a recipe product page',
      );
    const v0 = session.violations.length;
    session.action = 'click';
    session.actionSeq += 1;
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
    await checkStop();
    await checkLanding();
    visit();
    return status();
  }

  async function snapshot(state) {
    active();
    const parsed = SnapshotName.safeParse(state);
    if (!parsed.success) throw new RefusalError('refused-bad-state', 'unknown snapshot name', 'tool-error');
    if (recon && !/^view-\d{2}$/.test(state))
      throw new RefusalError(
        'refused-recon-snapshot',
        'a reconnaissance session takes only view-NN snapshots, which never count',
      );
    if (session.snapshots.some((s) => s.state === state))
      throw new RefusalError('refused-duplicate-state', `${state} already captured`, 'tool-error');
    if (session.offsite)
      throw new RefusalError('refused-third-party-page', 'nothing is captured on another site');
    // Never snapshot a challenge, wall or block page: the stop check runs first.
    await checkStop();
    const url = new URL(page.url());
    const robotsAllowed = session.offsite ? null : robotsAllows(url);
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
      robotsAllowed,
      dir: snap.dir,
    });
    if (recon) session.views += 1;
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

  async function end({ exclusion, notReached, findings } = {}) {
    if (session.ended) throw new RefusalError('refused-after-stop', 'session already ended', 'tool-error');
    const captured = session.snapshots.some((s) => s.state === 'cart-1' || s.state === 'minicart-1');
    if (exclusion && captured)
      throw new RefusalError('refused-bad-end', 'a captured site cannot also be excluded', 'tool-error');
    if (findings && !recon)
      throw new RefusalError('refused-bad-end', 'findings belong to a reconnaissance session', 'tool-error');
    if (recon && Boolean(findings) === Boolean(exclusion))
      throw new RefusalError(
        'refused-bad-end',
        'a reconnaissance session ends with either findings or an exclusion',
        'tool-error',
      );
    if (recon && notReached?.length)
      throw new RefusalError('refused-bad-end', 'a reconnaissance session reaches no states', 'tool-error');
    let found = null;
    if (findings) {
      found = Findings.parse(findings);
      // The recipe's listing, items and cart path must be pages this session actually loaded: never guessed.
      const seen = (u) => session.visited.has(visitKey(u));
      const paths = [...session.visited].map((k) => new URL(k)).filter((u) => sameSite(u.hostname, domain));
      const unseen = [
        ...(seen(found.listingUrl) ? [] : ['listingUrl']),
        ...found.productUrls.filter((u) => !seen(u)).map(() => 'productUrls'),
        ...(paths.some((u) => normPath(u) === (found.cartPath.replace(/\/+$/, '') || '/')) ? [] : ['cartPath']),
      ];
      const off = [found.listingUrl, ...found.productUrls].some((u) => !sameSite(new URL(u).hostname, domain));
      if (unseen.length || off)
        throw new RefusalError(
          'refused-findings-not-seen',
          `findings must be pages this session loaded on ${domain}: ${unseen.join(', ') || 'off-site URL'}`,
          'tool-error',
        );
      // Listing and items stay on the frame's storefront hosts; only the cart and checkout may be elsewhere.
      if (recipe.hosts) {
        const outside = [found.listingUrl, ...found.productUrls].filter(
          (u) => !recipe.hosts.includes(new URL(u).hostname),
        );
        if (outside.length)
          throw new RefusalError(
            'refused-findings-off-hosts',
            `listing and product URLs must be on the frame's hosts (${recipe.hosts.join(', ')})`,
            'tool-error',
          );
      }
      // The reviewer checks the listing and the item against the snapshots: the home page and the listing as seen.
      const viewed = (u) =>
        session.snapshots.some((x) => /^view-\d{2}$/.test(x.state) && visitKey(x.url) === visitKey(u));
      // The home page is the origin itself, or the same-site page a goto to the origin landed on (protocol .5).
      const homeViewed =
        viewed(recipe.origin) || session.homeLandings.some((h) => h.sameSite && viewed(h.landed));
      const missing = [
        ...(homeViewed ? [] : ['home page']),
        ...(viewed(found.listingUrl) ? [] : ['listingUrl']),
      ];
      if (missing.length)
        throw new RefusalError(
          'refused-findings-no-view',
          `a view-NN snapshot is required of: ${missing.join(', ')}`,
          'tool-error',
        );
      // The host the cart path was loaded on (another host of the site is allowed for the cart).
      const cart = found.cartPath.replace(/\/+$/, '') || '/';
      session.cartHost = session.navigationLog
        .map((h) => new URL(h))
        .find((u) => sameSite(u.hostname, domain) && normPath(u) === cart).host;
    }
    const evidenceSha256 = exclusion ? await evidence(exclusion) : null;
    session.ended = {
      exclusion: exclusion ?? null,
      evidenceSha256,
      notReached: notReached ?? [],
      findings: found,
      cartHost: found ? session.cartHost : null,
    };
    record({
      do: 'end',
      ...(exclusion ? { exclusion } : {}),
      ...(notReached?.length ? { notReached } : {}),
      ...(found ? { findings: found } : {}),
    });
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
      return driver.end({ exclusion: step.exclusion, notReached: step.notReached, findings: step.findings });
    default:
      throw new RefusalError('refused-unknown-action', `no step "${step.do}"`);
  }
}
