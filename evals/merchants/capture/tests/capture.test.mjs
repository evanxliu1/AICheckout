// Unit tests for the capture tool that need no browser (npm run test:scripts). Browser tests: tests/browser/.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRequest, startControlServer } from '../control-server.mjs';
import { createDriver, guardApi, parseTarget } from '../driver.mjs';
import { RefusalError, detectStop, judgeClick } from '../guards.mjs';
import { detectPlatform } from '../platform.mjs';
import { Recipe, SiteRecord } from '../recipe.mjs';
import { groupFor, isAllowed, parseRobots, robotsPosture } from '../robots.mjs';
import { fixtureRecipe } from './fixture-shop.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const refusal = (code) => (e) => e instanceof RefusalError && e.code === code;

// ---- Recipe schema ----

const good = () => ({
  schema: 'capture-recipe.1',
  domain: 'example.de',
  origin: 'https://www.example.de',
  listingUrl: 'https://www.example.de/damen',
  productUrls: ['https://www.example.de/p/1'],
  cartPath: '/warenkorb',
  checkoutPaths: ['/kasse'],
  allowlist: [{ purpose: 'add-to-cart', target: { role: 'button', name: 'In den Warenkorb' } }],
  steps: [
    { do: 'goto', url: 'https://www.example.de/p/1' },
    { do: 'click', target: { role: 'button', name: 'In den Warenkorb' }, purpose: 'add-to-cart' },
    { do: 'wait', ms: 1000 },
    { do: 'snapshot', state: 'minicart-1' },
    { do: 'end' },
  ],
});

test('recipe: a non-U.S. recipe with an allowlisted add-to-cart parses', () => {
  assert.equal(Recipe.parse(good()).domain, 'example.de');
  assert.ok(
    Recipe.parse({
      ...good(),
      domain: 'example.xn--p1ai',
      origin: 'https://example.xn--p1ai',
      listingUrl: 'https://example.xn--p1ai/',
      productUrls: ['https://example.xn--p1ai/p'],
      steps: [],
    }),
  );
});

test('recipe: rejects typing, select, coordinates and unknown keys', () => {
  for (const step of [
    { do: 'type', target: { selector: '#q' }, text: 'x' },
    { do: 'fill', target: { selector: '#q' }, value: 'x' },
    { do: 'press', key: 'Enter' },
    { do: 'selectOption', target: { selector: 'select' }, value: 'M' },
    { do: 'setInputFiles', target: { selector: 'input' }, files: [] },
    { do: 'click', target: { x: 10, y: 20 } },
    { do: 'click', target: { selector: '#a', position: { x: 1, y: 1 } } },
    { do: 'click', target: { selector: 'iframe >> internal:control=enter-frame >> button' } },
    { do: 'goto', url: 'https://www.example.de/x', waitUntil: 'load' },
  ]) {
    assert.equal(Recipe.safeParse({ ...good(), steps: [step] }).success, false, JSON.stringify(step));
  }
});

test('recipe: rejects off-site and non-https URLs, credentials, bad paths and a purpose not on the allowlist', () => {
  const bad = [
    { ...good(), listingUrl: 'https://other.com/x' },
    { ...good(), productUrls: ['http://www.example.de/p/1'] },
    { ...good(), termsUrl: 'https://user:pw@www.example.de/agb' },
    { ...good(), cartPath: 'warenkorb' },
    { ...good(), origin: 'https://www.example.de/shop' },
    { ...good(), steps: [{ do: 'goto', url: 'https://evil.example.com/' }] },
    { ...good(), steps: [{ do: 'click', target: { selector: '#apply' }, purpose: 'add-to-cart' }] },
    { ...good(), steps: [{ do: 'click', target: { selector: '#x' }, purpose: 'checkout' }] },
    { ...good(), steps: [{ do: 'end' }, { do: 'snapshot', state: 'cart-1' }] },
    { ...good(), steps: [{ do: 'snapshot', state: 'cart-3' }] },
    { ...good(), steps: [{ do: 'end', exclusion: 'robots-disallow-all' }] },
    { ...good(), domain: 'Example.DE' },
    { ...good(), extra: true },
    { ...good(), allowlist: [good().allowlist[0], good().allowlist[0]] },
  ];
  for (const r of bad) assert.equal(Recipe.safeParse(r).success, false, JSON.stringify(r).slice(0, 120));
});

test('recipe: http is allowed only on loopback fixtures', () => {
  assert.ok(Recipe.parse(fixtureRecipe('http://127.0.0.1:8080')));
});

// ---- robots.txt ----

test('robots: groups, merging, comments and empty Disallow', () => {
  const groups = parseRobots(
    '\uFEFF# c\nDisallow: /orphan\nUser-agent: A\nUser-agent: *\nDisallow: /cart # x\n\nUser-agent: b\nDisallow:\nUser-agent: *\nAllow: /cart/public\n',
  );
  assert.deepEqual(groupFor(groups, '*').rules, [
    { type: 'disallow', path: '/cart' },
    { type: 'allow', path: '/cart/public' },
  ]);
  assert.deepEqual(groupFor(groups, 'b').rules, []);
  assert.equal(groupFor(groups, 'c'), null);
});

test('robots: longest match, Allow wins ties, wildcards and $', () => {
  const g = {
    agents: ['*'],
    rules: [
      { type: 'disallow', path: '/checkout' },
      { type: 'allow', path: '/checkout/start' },
      { type: 'disallow', path: '/*.php$' },
      { type: 'disallow', path: '/a' },
      { type: 'allow', path: '/a' },
      { type: 'disallow', path: '/basket*' },
    ],
  };
  assert.equal(isAllowed(g, '/checkout'), false);
  assert.equal(isAllowed(g, '/checkout/start'), true);
  assert.equal(isAllowed(g, '/checkout/step2'), false);
  assert.equal(isAllowed(g, '/x/index.php'), false);
  assert.equal(isAllowed(g, '/x/index.php?y=1'), true);
  assert.equal(isAllowed(g, '/a'), true);
  assert.equal(isAllowed(g, '/basket-view'), false);
  assert.equal(isAllowed(g, '/cart'), true);
  assert.equal(isAllowed(null, '/anything'), true);
});

test('robots posture: the protocol rule (star or tool group, all or a named path)', () => {
  const ok = { httpStatus: 200, body: 'User-agent: *\nDisallow: /admin\n' };
  assert.equal(robotsPosture(ok, ['/cart', '/checkout']).decision, 'allowed');
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: *\nDisallow: /\nAllow: /cart\n' }, ['/cart'])
      .decision,
    'robots-disallow-all',
  );
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: *\nDisallow: /checkout\n' }, ['/cart', '/checkout'])
      .decision,
    'robots-disallow-path',
  );
  // The tool's own group applies in addition to `*` (stricter than RFC 9309 group selection).
  const own = {
    httpStatus: 200,
    body: 'User-agent: AICheckoutCapture\nDisallow: /cart\n\nUser-agent: *\nAllow: /\n',
  };
  assert.equal(robotsPosture(own, ['/cart']).decision, 'robots-disallow-path');
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: aicheckoutcapture\nDisallow: /\n' }, ['/cart'])
      .decision,
    'robots-disallow-all',
  );
  // Another crawler's rules do not apply.
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: Googlebot\nDisallow: /\n' }, ['/cart']).decision,
    'allowed',
  );
  assert.equal(robotsPosture({ httpStatus: 404, body: null }, ['/cart']).posture, 'no-robots-4xx');
  assert.equal(robotsPosture({ httpStatus: 404, body: null }, ['/cart']).decision, 'allowed');
  assert.equal(robotsPosture({ httpStatus: 403, body: null }, ['/cart']).stopCode, 'blocked-http-403');
  assert.equal(robotsPosture({ httpStatus: 429, body: null }, ['/cart']).stopCode, 'blocked-http-429');
  assert.equal(robotsPosture({ httpStatus: 503, body: null }, ['/cart']).stopCode, 'tool-error');
  assert.equal(robotsPosture({ httpStatus: null, body: null }, ['/cart']).posture, 'unreachable');
});

// ---- Driver API surface: no typing, select, file or coordinate path ----

test('driver API: typing, keys, select, files, mouse and raw page access are refused', () => {
  const api = guardApi({ goto() {}, click() {}, wait() {}, snapshot() {}, status() {}, end() {} });
  const cases = {
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
    tap: 'refused-coordinate-click',
    dblclick: 'refused-coordinate-click',
    evaluate: 'refused-raw-page',
    page: 'refused-raw-page',
    frame: 'refused-cross-origin-frame',
    somethingElse: 'refused-unknown-action',
  };
  for (const [prop, code] of Object.entries(cases)) assert.throws(() => api[prop]('x'), refusal(code), prop);
  assert.throws(() => {
    api.goto = null;
  }, refusal('refused-unknown-action'));
  assert.equal(api.then, undefined);
});

test('driver API: coordinate and frame-entering targets are refused before any page work', () => {
  assert.throws(() => parseTarget({ x: 1, y: 2 }), refusal('refused-coordinate-click'));
  assert.throws(
    () => parseTarget({ selector: '#a', position: { x: 1, y: 1 } }),
    refusal('refused-coordinate-click'),
  );
  assert.throws(
    () => parseTarget({ selector: 'iframe >> internal:control=enter-frame >> #w' }),
    refusal('refused-cross-origin-frame'),
  );
  assert.throws(() => parseTarget({ text: 'Buy' }), refusal('refused-bad-target'));
  assert.deepEqual(parseTarget({ role: 'button', name: 'Add' }), { role: 'button', name: 'Add' });
});

test('driver: a pace below 3 s is refused for a real site', async () => {
  await assert.rejects(
    createDriver({ context: null, page: null, recipe: good(), sessionDir: '/nonexistent', paceMs: 100 }),
    refusal('refused-pace'),
  );
});

test('no code path: tool sources never call fill, type, press, keyboard, mouse, selectOption or setInputFiles', () => {
  for (const f of [
    'driver.mjs',
    'capture.mjs',
    'snapshot.mjs',
    'guards.mjs',
    'control-server.mjs',
    'replay.mjs',
  ]) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    for (const re of [
      /\.fill\(/,
      /\.type\(/,
      /\.press\(/,
      /\.pressSequentially\(/,
      /\.keyboard\b/,
      /\.mouse\b/,
      /\.selectOption\(/,
      /\.setInputFiles\(/,
      /\.tap\(/,
      /\.dblclick\(/,
      /position\s*:/,
      /\.check\(/,
      /\.dispatchEvent\(/,
      /\.frameLocator\(/,
      /contentFrame\(/,
    ])
      assert.doesNotMatch(src, re, `${f} ${re}`);
  }
});

// ---- Click judgement (facts as inspectTarget reports them) ----

const el = (over = {}) => ({
  tag: 'button',
  inputType: null,
  role: null,
  name: 'Add to cart',
  submit: false,
  inForm: false,
  formAction: null,
  formHasPassword: false,
  formHasTextEntry: false,
  textEntry: false,
  select: false,
  file: false,
  frame: false,
  ...over,
});

test('click judgement: each refusal', () => {
  const code = (info, purpose) => judgeClick(info, purpose)?.code ?? null;
  assert.equal(code(el()), null);
  assert.equal(code(el({ frame: true })), 'refused-cross-origin-frame');
  assert.equal(code(el({ tag: 'input', inputType: 'file', file: true })), 'refused-file-input');
  assert.equal(code(el({ tag: 'select', select: true })), 'refused-select');
  assert.equal(code(el({ tag: 'input', inputType: 'text', textEntry: true })), 'refused-text-entry');
  assert.equal(code(el({ tag: 'label', textEntry: true })), 'refused-text-entry');
  assert.equal(code(el({ submit: true, inForm: true })), 'refused-submit');
  assert.equal(code(el({ submit: true, inForm: true }), 'option'), 'refused-submit');
  assert.equal(code(el({ inForm: true })), 'refused-in-form');
  assert.equal(
    code(el({ submit: true, inForm: true, formHasTextEntry: true, name: 'Apply' }), 'add-to-cart'),
    'refused-input-form',
  );
  assert.equal(
    code(el({ submit: true, inForm: true, formHasPassword: true, name: 'Sign in' }), 'add-to-cart'),
    'refused-input-form',
  );
  assert.equal(
    code(el({ submit: true, inForm: true, name: 'Gutschein einlösen' }), 'add-to-cart'),
    'refused-allowlist-mismatch',
  );
  assert.equal(
    code(el({ submit: true, inForm: true, formAction: '/account/login' }), 'add-to-cart'),
    'refused-allowlist-mismatch',
  );
  assert.equal(code(el({ inForm: true, name: 'Continue as guest' }), 'continue-as-guest'), 'refused-in-form');
  assert.equal(code(el({ tag: 'div', name: 'M' }), 'option'), 'refused-allowlist-mismatch');
});

test('click judgement: allowlisted clicks pass in any language', () => {
  assert.equal(judgeClick(el({ submit: true, inForm: true, name: 'In den Warenkorb' }), 'add-to-cart'), null);
  assert.equal(
    judgeClick(el({ submit: true, inForm: true, name: 'Ajouter au panier' }), 'add-to-cart'),
    null,
  );
  assert.equal(judgeClick(el({ inForm: true, name: 'M' }), 'option'), null);
  assert.equal(judgeClick(el({ tag: 'input', inputType: 'radio', inForm: true, name: '' }), 'option'), null);
  assert.equal(judgeClick(el({ inForm: true, name: '+' }), 'quantity-increment'), null);
  assert.equal(judgeClick(el({ name: 'Als Gast fortfahren' }), 'continue-as-guest'), null);
  assert.equal(judgeClick(el({ name: 'Alle ablehnen' }), 'decline-cookies'), null);
});

// ---- Stops ----

test('stop detection: HTTP, CAPTCHA frames, walls, extension checks, sign-in walls', () => {
  const f = (over) =>
    detectStop({
      status: 200,
      url: 'https://s.com/cart',
      title: '',
      text: '',
      frameUrls: [],
      passwordVisible: false,
      ...over,
    })?.code ?? null;
  assert.equal(f({}), null);
  assert.equal(f({ status: 403 }), 'blocked-http-403');
  assert.equal(f({ status: 429 }), 'blocked-http-429');
  assert.equal(f({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor?k=1&size=normal'] }), 'captcha');
  assert.equal(f({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor?k=1&size=invisible'] }), null);
  assert.equal(f({ frameUrls: ['https://geo.captcha-delivery.com/x'] }), 'captcha');
  assert.equal(f({ text: 'Press & Hold to confirm you are a human' }), 'blocked-bot-wall');
  assert.equal(f({ title: 'Just a moment...' }), 'blocked-bot-wall');
  assert.equal(f({ text: 'Zugriff verweigert' }), 'blocked-bot-wall');
  assert.equal(f({ text: 'Please disable your ad blocker' }), 'blocked-extension-check');
  assert.equal(f({ url: 'https://s.com/account/login', passwordVisible: true }), 'sign-in-required');
  assert.equal(f({ url: 'https://s.de/anmelden', passwordVisible: true }), 'sign-in-required');
  // A sign-in form beside guest checkout is not a wall.
  assert.equal(f({ url: 'https://s.com/checkout', passwordVisible: true }), null);
});

// ---- Platform ----

test('platform: protocol markers, first group wins, marker recorded', () => {
  const p = (html, headers = {}, checkout = null) => detectPlatform([{ html, headers }], checkout);
  assert.deepEqual(p('<script src="https://cdn.shopify.com/s.js">'), {
    group: 'shopify',
    marker: 'cdn.shopify.com',
  });
  assert.deepEqual(p('x', {}, 'https://checkout.shopify.com/1/checkouts/abc'), {
    group: 'shopify',
    marker: 'checkout.shopify.com',
  });
  assert.deepEqual(p('<a href="/on/demandware.store/Sites-x">'), {
    group: 'sfcc',
    marker: '/on/demandware.store/',
  });
  assert.deepEqual(p('<img src="/image/x.png"> mage/'), { group: 'none-detected', marker: null });
  assert.deepEqual(p('x', { 'x-magento-tags': 'a' }), { group: 'adobe-commerce', marker: 'x-magento-*' });
  assert.deepEqual(p('"Magento_Ui/js"'), { group: 'adobe-commerce', marker: 'Magento_' });
  assert.equal(p('/_ui/responsive ACC.config').group, 'sap-commerce');
  assert.equal(p('/_ui/responsive only').group, 'none-detected');
  assert.equal(p('cdn11.bigcommerce.com/s-abc').group, 'bigcommerce');
  assert.equal(p('wp-content/plugins/woocommerce/').group, 'other-detected');
  assert.equal(p('__NEXT_DATA__ _next/static').group, 'none-detected');
  assert.equal(detectPlatform([{ html: 'dwvar_x' }, { html: 'cdn.shopify.com' }]).group, 'shopify');
});

// ---- Site record ----

test('site record schema: rejects page text fields and unknown codes', () => {
  assert.equal(
    SiteRecord.safeParse({ schema: 'capture-site-record.1', domain: 'x.com', pageText: 'Subtotal' }).success,
    false,
  );
});

// ---- Control server ----

test('control server: request checks', () => {
  const token = 'a'.repeat(64);
  const ok = { host: '127.0.0.1:9', 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const c = (method, headers) => checkRequest({ method, headers }, { token, port: 9 })?.[0] ?? 200;
  assert.equal(c('POST', ok), 200);
  assert.equal(c('GET', ok), 405);
  assert.equal(c('POST', { ...ok, origin: 'https://evil.example' }), 403);
  assert.equal(c('POST', { ...ok, origin: 'null' }), 403);
  assert.equal(c('POST', { ...ok, 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(c('POST', { ...ok, host: 'evil.example:9' }), 403);
  assert.equal(c('POST', { ...ok, host: 'localhost:9' }), 403);
  assert.equal(c('POST', { ...ok, 'content-type': 'text/plain' }), 415);
  assert.equal(c('POST', { ...ok, authorization: undefined }), 401);
  assert.equal(c('POST', { ...ok, authorization: `Bearer ${'b'.repeat(64)}` }), 401);
});

test('control server: live, bound to 127.0.0.1, token and Origin enforced', async () => {
  const seen = [];
  const server = await startControlServer(async (cmd) => {
    seen.push(cmd);
    if (cmd.do === 'click') throw new RefusalError('refused-submit', 'x');
    return { ok: 1 };
  });
  const send = (headers, body = '{"do":"status"}') =>
    new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: server.port, method: 'POST', path: '/', headers },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${server.token}` };
  try {
    assert.equal((await send(auth)).status, 200);
    assert.equal((await send({ ...auth, origin: 'http://127.0.0.1:1' })).status, 403);
    assert.equal((await send({ 'content-type': 'application/json' })).status, 401);
    const refused = await send(auth, '{"do":"click","target":{"selector":"#x"}}');
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.code, 'refused-submit');
    assert.equal(refused.body.error.exclusionCode, 'would-need-forbidden-action');
    assert.equal(seen.length, 2);
  } finally {
    await server.close();
  }
});
