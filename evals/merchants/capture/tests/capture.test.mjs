// Unit tests for the capture tool that need no browser (npm run test:scripts). Browser tests: tests/browser/.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { request } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRecon, committableUrl } from '../capture.mjs';
import { rebuildHtml } from '../rebuild.mjs';
import { auditCall, auditTranscript, classifyPath } from '../audit-pane-transcript.mjs';
import { panePlatform, storePlatform } from '../pane-platform.mjs';
import { checkRequest, startControlServer } from '../control-server.mjs';
import { ADD_TO_CART_NAME, createDriver, guardApi, parseTarget } from '../driver.mjs';
import {
  CHECKOUT_NAME,
  ORDER_OR_ACCOUNT,
  RefusalError,
  actionPath,
  detectStop,
  WRITE_BLOCKED_PATH,
  isCheckoutPath,
  judgeClick,
  maskPath,
} from '../guards.mjs';
import { detectPlatform, platformStates } from '../platform.mjs';
import { EVIDENCE_REQUIRED, EXCLUSION_CODES, Findings, Recipe, ReconSpec, SiteRecord, StepSchema } from '../recipe.mjs';
import { groupFor, isAllowed, parseRobots, robotsPosture } from '../robots.mjs';
import { fixtureRecipe } from './fixture-shop.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const refusal = (code) => (e) => e instanceof RefusalError && e.code === code;

// ---- Recipe schema ----

const good = () => ({
  schema: 'capture-recipe.3',
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
    { ...good(), steps: [{ do: 'end', exclusion: 'robots-disallow-path' }] },
    { ...good(), steps: [{ do: 'end', exclusion: 'non-us-storefront' }] },
    {
      ...good(),
      steps: [
        {
          do: 'end',
          findings: { listingUrl: 'https://www.example.de/a', productUrls: ['https://www.example.de/p'], cartPath: '/c', checkoutPaths: [] },
        },
      ],
    },
    { ...good(), schema: 'capture-recipe.1' },
    { ...good(), recon: { sessionId: 'yesterday' } },
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

test('robots posture (.4): only a disallow-everything rule excludes; cart and checkout disallows are recorded', () => {
  const ok = { httpStatus: 200, body: 'User-agent: *\nDisallow: /admin\n' };
  assert.equal(robotsPosture(ok, ['/cart', '/checkout']).decision, 'allowed');
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: *\nDisallow: /\nAllow: /cart\n' }, ['/cart'])
      .decision,
    'robots-disallow-all',
  );
  const path = robotsPosture({ httpStatus: 200, body: 'User-agent: *\nDisallow: /checkout\n' }, [
    '/cart',
    '/checkout',
  ]);
  assert.equal(path.decision, 'allowed');
  assert.equal(path.stopCode, null);
  assert.deepEqual(path.checkedPaths, [
    { path: '/cart', allowed: true },
    { path: '/checkout', allowed: false },
  ]);
  // The tool's own group applies in addition to `*` (stricter than RFC 9309 group selection).
  const own = {
    httpStatus: 200,
    body: 'User-agent: AICheckoutCapture\nDisallow: /cart\n\nUser-agent: *\nAllow: /\n',
  };
  assert.equal(robotsPosture(own, ['/cart']).decision, 'allowed');
  assert.deepEqual(robotsPosture(own, ['/cart']).checkedPaths, [{ path: '/cart', allowed: false }]);
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: *\nDisallow: /*\n' }, []).decision,
    'robots-disallow-all',
  );
  // "Disallows everything" = the root path `/` is disallowed under longest-match evaluation.
  for (const [body, decision] of [
    ['User-agent: *\nDisallow: /\nAllow: /\n', 'allowed'],
    ['User-agent: *\nDisallow: /\nAllow: /$\n', 'allowed'],
    ['User-agent: *\nAllow: /\nDisallow: /*\n', 'robots-disallow-all'],
    ['User-agent: *\nDisallow: /\nAllow: /cart\n', 'robots-disallow-all'],
    ['User-agent: *\nDisallow: /$\n', 'robots-disallow-all'],
    ['User-agent: *\nDisallow: /*?\n', 'allowed'],
  ])
    assert.equal(robotsPosture({ httpStatus: 200, body }, []).decision, decision, body);
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
  // A submit-typed option button is judged allowed; the driver then aborts any navigation it causes.
  assert.equal(code(el({ submit: true, inForm: true, name: 'M' }), 'option'), null);
  assert.equal(
    code(el({ submit: true, inForm: true, name: 'Guest' }), 'continue-as-guest'),
    'refused-submit',
  );
  assert.equal(code(el({ name: 'Place order' })), 'refused-order-or-account');
  assert.equal(code(el({ inForm: true })), 'refused-in-form');
  assert.equal(
    code(el({ submit: true, inForm: true, formHasTextEntry: true, name: 'Apply' }), 'add-to-cart'),
    'refused-input-form',
  );
  assert.equal(
    code(el({ submit: true, inForm: true, formHasPassword: true, name: 'Go' }), 'add-to-cart'),
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
  // Protocol .5: no checkout page is entered, so a checkout URL never decides.
  assert.equal(detectPlatform([{ html: 'x' }], 'https://checkout.shopify.com/1/checkouts/abc').group, 'none-detected');
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
  // The .3 additions to other-detected.
  for (const [html, marker] of [
    ['/bundles/storefront/js/app.js', 'shopware'],
    ['var prestashop = {}', 'prestashop'],
    ['//img.cafe24.com/x.js', 'cafe24'],
    ['https://gigaplus.makeshop.jp/x', 'makeshop'],
  ])
    assert.deepEqual(p(html), { group: 'other-detected', marker });
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

// ---- Review fixes (2026-10-05) ----

test('order, payment, sign-in and register names are refused in ten languages', () => {
  for (const name of [
    'Place order',
    'Pay now',
    'Buy it now',
    'Sign in',
    'Log in',
    'Create an account',
    'Checkout with PayPal',
    'Realizar pedido',
    'Comprar ahora',
    'Iniciar sesión',
    'Passer la commande',
    'Se connecter',
    'Créer un compte',
    'Jetzt kaufen',
    'Zahlungspflichtig bestellen',
    'Anmelden',
    'Acquista ora',
    'Accedi',
    'Registrati',
    'Finalizar pedido',
    'Comprar agora',
    'Criar conta',
    'Nu kopen',
    'Plaats bestelling',
    'Inloggen',
    '注文を確定する',
    '今すぐ購入',
    'ログイン',
    '提交订单',
    '立即购买',
    '登录',
    '주문하기',
    '바로 구매',
    '로그인',
  ])
    assert.match(name, ORDER_OR_ACCOUNT, name);
  for (const name of [
    'Add to cart',
    'In den Warenkorb',
    'Ajouter au panier',
    'Añadir a la cesta',
    'Aggiungi al carrello',
    'Adicionar ao carrinho',
    'In winkelwagen',
    'カートに入れる',
    '加入购物车',
    '장바구니 담기',
    'Checkout',
    'Continue as guest',
    'Reject all',
  ])
    assert.doesNotMatch(name, ORDER_OR_ACCOUNT, name);
});

test('form actions: formaction wins, order and account paths refused, Magento add-to-cart allowed', () => {
  const atc = (formAction) =>
    judgeClick(el({ submit: true, inForm: true, formAction }), 'add-to-cart')?.code ?? null;
  assert.equal(atc('https://s.com/cart/add'), null);
  assert.equal(atc('https://s.com/checkout/cart/add/uenc/x/product/1/'), null);
  assert.equal(actionPath('https://s.com/checkout/cart/add/'), '/cart/add/');
  for (const p of [
    '/checkout/complete',
    '/order/place',
    '/payment',
    '/account/login',
    '/buy',
    '/purchase',
    '/register',
  ])
    assert.equal(atc(`https://s.com${p}`), 'refused-allowlist-mismatch', p);
  // Host words do not count, only the path.
  assert.equal(atc('https://borders-shop.com/cart/add'), null);
});

test('robots: user-agent product token before "/" and non-ASCII rule paths', () => {
  const g = parseRobots('User-agent: AICheckoutCapture/1.0 (+https://x)\nDisallow: /cart\n');
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: AICheckoutCapture/2.1\nDisallow: /cart\n' }, [
      '/cart',
    ]).checkedPaths[0].allowed,
    false,
  );
  assert.equal(
    robotsPosture({ httpStatus: 200, body: 'User-agent: AICheckoutCapture/2.1\nDisallow: /\n' }, [])
      .decision,
    'robots-disallow-all',
  );
  assert.deepEqual(g[0].agents, ['aicheckoutcapture']);
  const grp = groupFor(parseRobots('User-agent: *\nDisallow: /warenkörbe\n'), '*');
  assert.equal(isAllowed(grp, '/warenk%C3%B6rbe'), false);
  assert.equal(isAllowed(grp, '/warenkörbe'), false);
  assert.equal(isAllowed(grp, '/warenkorb'), true);
});

test('committed URLs: no query or fragment, token-like segments replaced', () => {
  assert.equal(committableUrl('https://s.com/cart?token=abc#x'), 'https://s.com/cart');
  assert.equal(
    committableUrl('https://s.com/checkouts/cn/Z2NwLXVzLWVhc3QxOjAxSjk3/information'),
    'https://s.com/checkouts/cn/:token/information',
  );
  assert.equal(committableUrl('https://s.com/c/0123456789abcdef/x'), 'https://s.com/c/:token/x');
  assert.equal(committableUrl('https://s.com/products/blue-shirt-2'), 'https://s.com/products/blue-shirt-2');
  assert.equal(committableUrl(null), null);
});

test('site record: stop detail is a code and committed URLs carry no query', () => {
  const base = JSON.parse(
    JSON.stringify({
      schema: 'capture-site-record.4',
      domain: 'x.com',
      recipeSha256: 'a'.repeat(64),
      tool: { version: 't', browser: 'b', userAgentToken: 'u' },
      recon: { sessionId: '20261006T000000Z' },
      session: {
        id: '20261006T000000Z',
        number: 1,
        startedAt: 's',
        endedAt: 'e',
        topLevelNavigations: 0,
        navigationRequests: 0,
      },
      robots: {
        url: 'https://x.com/robots.txt',
        httpStatus: 200,
        sha256: null,
        posture: 'rules',
        groups: [],
        checkedPaths: [{ path: '/bag', host: 'cart.x.com', allowed: false }],
        decision: 'allowed',
      },
      robotsHosts: [],
      terms: { url: null, copySha256: null, prohibitsAutomated: 'unknown' },
      states: [],
      notReached: [],
      platform: null,
      events: [],
      backgroundWrites: { count: 0, sample: [] },
      stop: { code: 'tool-error', detail: 'recipe-step-refused:refused-submit', evidenceSha256: null },
      outcome: { status: 'incomplete', code: 'tool-error', evidenceSha256: null },
    }),
  );
  assert.ok(SiteRecord.parse(base));
  assert.equal(
    SiteRecord.safeParse({ ...base, stop: { ...base.stop, detail: 'Error: page said "Subtotal $20"' } })
      .success,
    false,
  );
  const st = {
    state: 'cart-1',
    url: 'https://x.com/cart?id=1',
    manifestSha256: 'a'.repeat(64),
    domSha256: 'a'.repeat(64),
    viewportSha256: 'a'.repeat(64),
    robotsAllowed: false,
  };
  assert.equal(SiteRecord.safeParse({ ...base, states: [st] }).success, false);
  // The retired robots code is no longer a decision or an exclusion.
  assert.equal(
    SiteRecord.safeParse({ ...base, robots: { ...base.robots, decision: 'robots-disallow-path' } }).success,
    false,
  );
  assert.ok(SiteRecord.parse({ ...base, states: [{ ...st, url: 'https://x.com/cart' }] }));
});

test('stop detection: a visible challenge element in the main document', () => {
  assert.equal(
    detectStop({
      status: 200,
      url: 'https://s.com/',
      title: '',
      text: '',
      frameUrls: [],
      passwordVisible: false,
      captchaElement: true,
    }).code,
    'captcha',
  );
});

// ---- generic-reader-protocol.4 (Amendment 3) ----

test('exclusion codes are the protocol .4 list, and an end step may record any of them', () => {
  assert.deepEqual(
    [...EXCLUSION_CODES].sort(),
    [
      'add-to-cart-refused',
      'blocked-bot-wall',
      'blocked-extension-check',
      'blocked-http-403',
      'blocked-http-429',
      'captcha',
      'defunct',
      'geo-blocked',
      'needs-input',
      'no-eligible-item',
      'not-a-store',
      'redirected-off-domain',
      'robots-disallow-all',
      'sign-in-required',
      'tool-error',
      'would-need-forbidden-action',
    ],
  );
  for (const code of EXCLUSION_CODES) assert.ok(StepSchema.parse({ do: 'end', exclusion: code }), code);
  for (const code of ['non-us-storefront', 'robots-disallow-path'])
    assert.equal(StepSchema.safeParse({ do: 'end', exclusion: code }).success, false, code);
  assert.ok(EVIDENCE_REQUIRED.includes('geo-blocked'));
});

test('platform reads only empty-cart and the first captured cart state', () => {
  const snaps = ['view-01', 'empty-cart', 'terms', 'minicart-1', 'cart-1', 'checkout-1', 'view-02'].map(
    (state) => ({ state }),
  );
  assert.deepEqual(
    platformStates(snaps).map((s) => s.state),
    ['empty-cart', 'cart-1'],
  );
  assert.deepEqual(
    platformStates(snaps.filter((s) => s.state !== 'cart-1')).map((s) => s.state),
    ['empty-cart', 'minicart-1'],
  );
  assert.deepEqual(platformStates([{ state: 'view-01' }, { state: 'terms' }]), []);
});

test('recon spec: entry host only, popup and cookie purposes only', () => {
  const spec = {
    domain: 'example.de',
    entryUrl: 'https://www.example.de/',
    hosts: ['www.example.de'],
    currency: 'EUR',
    priceBand: [9, 185],
  };
  assert.ok(ReconSpec.parse(spec));
  assert.equal(ReconSpec.safeParse({ ...spec, entryUrl: 'https://www.example.de/damen' }).success, false);
  assert.equal(ReconSpec.safeParse({ ...spec, entryUrl: 'https://other.de/' }).success, false);
  assert.equal(ReconSpec.safeParse({ ...spec, entryUrl: 'https://m.example.de/' }).success, false);
  assert.equal(ReconSpec.safeParse({ ...spec, hosts: [] }).success, false);
  assert.equal(
    ReconSpec.safeParse({
      ...spec,
      allowlist: [{ purpose: 'add-to-cart', target: { role: 'button', name: 'In den Warenkorb' } }],
    }).success,
    false,
  );
  assert.ok(
    ReconSpec.parse({
      ...spec,
      allowlist: [{ purpose: 'decline-cookies', target: { role: 'button', name: 'Ablehnen' } }],
    }),
  );
});

test('recon: add-to-cart wording is refused in the main languages', () => {
  for (const name of [
    'Add to Cart',
    'Add to bag',
    'In den Warenkorb',
    'Ajouter au panier',
    'Añadir a la cesta',
    'Aggiungi al carrello',
    'Dodaj do koszyka',
    'Lägg i varukorgen',
    'Sepete Ekle',
    'カートに入れる',
    '加入购物车',
    '장바구니 담기',
  ])
    assert.ok(ADD_TO_CART_NAME.test(name), name);
  assert.ok(ADD_TO_CART_NAME.test('Comprar ahora'));
  assert.ok(ADD_TO_CART_NAME.test('Comprar agora'));
  for (const name of ['Cart', 'View bag', 'Warenkorb', 'Panier', 'Women', 'Sale', 'Comprar', 'Comprar por categoría']) assert.equal(ADD_TO_CART_NAME.test(name), false, name);
});

test('capture needs a finished reconnaissance session and a recipe equal to its findings', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'capture-recon-'));
  try {
    const recipe = Recipe.parse({ ...good(), origin: 'https://www.example.de/', steps: [] });
    await assert.rejects(checkRecon(out, recipe), /needs a recipe written from a reconnaissance session/);
    const withRecon = { ...recipe, recon: { sessionId: '20261006T010000Z' }, cartHost: 'www.example.de' };
    await assert.rejects(checkRecon(out, withRecon), /did not end with findings/);
    const site = path.join(out, 'example.de');
    const dir = path.join(site, 'recon', '20261006T010000Z');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(site, 'recon-sessions.json'),
      JSON.stringify([{ id: '20261006T010000Z', date: '2026-10-06', stopCode: null, outcome: 'done' }]),
    );
    const visited = [
      'https://www.example.de/',
      'https://www.example.de/damen',
      'https://www.example.de/p/1',
      'https://www.example.de/p/2',
      'https://www.example.de/warenkorb',
    ];
    await writeFile(path.join(dir, 'visited.json'), JSON.stringify(visited));
    await writeFile(path.join(dir, 'recipe.draft.json'), JSON.stringify({ ...withRecon, allowlist: [] }));
    await checkRecon(out, withRecon);
    // A product the reconnaissance loaded but did not find as the item is refused: the recipe must equal the findings.
    await assert.rejects(
      checkRecon(out, { ...withRecon, productUrls: ['https://www.example.de/p/2'] }),
      /differs from its reconnaissance findings in: productUrls/,
    );
    await assert.rejects(checkRecon(out, { ...withRecon, checkoutPaths: [] }), /checkoutPaths/);
    await assert.rejects(checkRecon(out, { ...withRecon, cartHost: 'cart.example.de' }), /cartHost/);
    await assert.rejects(checkRecon(out, { ...withRecon, origin: 'https://m.example.de/' }), /origin/);
    // Loopback fixtures without a recon field are exempt (tests only).
    await checkRecon(out, Recipe.parse(fixtureRecipe('http://127.0.0.1:8080')));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('findings: a stock mismatch names only a found item', () => {
  const f = {
    listingUrl: 'https://www.example.de/a',
    productUrls: ['https://www.example.de/p/1'],
    cartPath: '/c',
    checkoutPaths: [],
  };
  assert.ok(Findings.parse({ ...f, stockMismatch: ['https://www.example.de/p/1'] }));
  assert.equal(Findings.safeParse({ ...f, stockMismatch: ['https://www.example.de/p/9'] }).success, false);
});

test('protocol .5: the continue-as-guest purpose is retired', () => {
  assert.equal(
    Recipe.safeParse({
      ...good(),
      allowlist: [{ purpose: 'continue-as-guest', target: { role: 'button', name: 'Als Gast fortfahren' } }],
    }).success,
    false,
  );
  assert.equal(
    StepSchema.safeParse({ do: 'click', target: { role: 'button', name: 'Guest' }, purpose: 'continue-as-guest' })
      .success,
    false,
  );
});

test('recipe: cartHost must be a host of the site', () => {
  assert.ok(Recipe.parse({ ...good(), cartHost: 'cart.example.de' }));
  assert.equal(Recipe.safeParse({ ...good(), cartHost: 'cart.example.com' }).success, false);
});

test('protocol .5 backstop: checkout wording is refused for every click; cart wording is not', () => {
  for (const name of [
    'Checkout',
    'Check out',
    'Proceed to checkout',
    'Secure checkout',
    'Zur Kasse',
    'Kasse',
    'Caisse',
    'Commander',
    'Passer commande',
    'Finalizar compra',
    'Tramitar pedido',
    'Finalizar pedido',
    'Cassa',
    "Procedi all'acquisto",
    'Afrekenen',
    'Till kassan',
    'Przejdź do kasy',
    'Ödemeye geç',
    'レジに進む',
    '購入手続きへ',
    '去结算',
    '結帳',
    '결제하기',
    '주문하기',
  ]) {
    assert.match(name, CHECKOUT_NAME, name);
    assert.equal(judgeClick({ name, tag: 'a' }, undefined)?.code, 'refused-checkout', name);
    assert.equal(judgeClick({ name, tag: 'button' }, 'close-popup')?.code, 'refused-checkout', name);
  }
  for (const name of [
    'Cart',
    'Bag',
    'View cart',
    'View bag',
    'Shopping bag',
    'Warenkorb',
    'Panier',
    'Carrito',
    'Carrello',
    'Winkelwagen',
    'Varukorg',
    'Koszyk',
    'Sepetim',
    'カート',
    '购物车',
    '장바구니',
    'Continue shopping',
    'Add to cart',
    'Kassel store',
  ])
    assert.doesNotMatch(name, CHECKOUT_NAME, name);
});

test('protocol .5 backstop: checkout path segments, Magento cart paths allowed', () => {
  for (const p of ['/checkout', '/checkout/', '/checkouts/abc', '/en/checkout', '/Checkout/Shipping', '/secure-checkout'])
    assert.equal(isCheckoutPath(p), true, p);
  for (const p of ['/checkout/cart', '/checkout/cart/', '/checkout/cart/add/uenc/x', '/cart', '/my-bag', '/checkoutx', '/'])
    assert.equal(isCheckoutPath(p), false, p);
});

test('protocol .6: vendor challenge markers stop; sensor scripts on ordinary pages do not', () => {
  const f = (markup) => detectStop({ status: 200, url: 'https://s.com/', title: '', text: '', frameUrls: [], markup });
  for (const [markup, code, reason] of [
    ['<div id="sec-if-cpt-container"></div>', 'blocked-bot-wall', 'vendor-akamai'],
    ['<script src="/_sec/cp_challenge/ak-challenge-3-3.js"></script>', 'blocked-bot-wall', 'vendor-akamai'],
    ['<p>Reference #18.x https://errors.edgesuite.net/18.x</p>', 'blocked-bot-wall', 'vendor-akamai'],
    ['<script>window._cf_chl_opt={}</script>', 'blocked-bot-wall', 'vendor-cloudflare'],
    ['<div id="challenge-error-text"></div>', 'blocked-bot-wall', 'vendor-cloudflare'],
    ['<p>Request unsuccessful. Incapsula incident ID: 1-2</p>', 'blocked-bot-wall', 'vendor-imperva'],
    ['<script src="https://ct.captcha-delivery.com/c.js"></script>', 'captcha', 'vendor-datadome'],
    ['<div id="px-captcha-wrapper"></div>', 'captcha', 'vendor-perimeterx'],
  ]) {
    const hit = f(markup);
    assert.equal(hit?.code, code, markup);
    assert.equal(hit?.reason, reason, markup);
  }
  for (const markup of [
    '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
    '<script src="https://js.datadome.co/tags.js"></script>',
    '<script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e"></script>',
    '<script src="/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js"></script>',
    '<h1>Our challenge: great prices</h1>',
  ])
    assert.equal(f(markup), null, markup);
});

test('protocol .6: background writes to checkout, order, payment, sign-in, account or register paths are blocked', () => {
  const blocked = (p) => WRITE_BLOCKED_PATH.test(actionPath(`https://s.com${p}`));
  for (const p of ['/checkout/session', '/api/orders', '/api/payment/intent', '/account/login', '/api/register', '/v1/pay'])
    assert.equal(blocked(p), true, p);
  for (const p of ['/api/graphql', '/cart/add.js', '/checkout/cart/add/uenc/x', '/api/recommendations', '/_/track'])
    assert.equal(blocked(p), false, p);
  assert.equal(maskPath('/api/session/0123456789abcdef0123/x y'), '/api/session/:token/x_y');
});

test('protocol .7: invisible Turnstile is not a challenge; a visible Cloudflare challenge frame is', () => {
  const cf = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/abc/light/normal';
  const f = (extra) =>
    detectStop({ status: 200, url: 'https://s.com/', title: '', text: '', frameUrls: [cf], markup: '', ...extra });
  assert.equal(f({ visibleFrameSrcs: [] }), null);
  assert.equal(f({ visibleFrameSrcs: ['https://other.example/x'] }), null);
  assert.equal(f({ visibleFrameSrcs: [cf] })?.code, 'captcha');
  assert.equal(
    detectStop({
      status: 200,
      url: 'https://s.com/',
      title: '',
      text: '',
      frameUrls: [],
      markup: '<input type="hidden" name="cf-turnstile-response" id="cf-chl-widget-a1b2c_response">',
    }),
    null,
  );
});

test('protocol .7: common add-to-cart write endpoints pass the blocked-path rule', () => {
  const blocked = (p) => WRITE_BLOCKED_PATH.test(actionPath(`https://s.com${p}`));
  for (const p of [
    '/checkout/cart/add/uenc/aHR0cHM6Ly9z/product/1/',
    '/cart/add.js',
    '/cart/add',
    '/on/demandware.store/Sites-RefArch-Site/en_US/Cart-AddProduct',
    '/api/cart',
    '/api/cart/items',
    '/basket/add',
    '/cart/change.js',
  ])
    assert.equal(blocked(p), false, p);
});

test('pane-dom.1 rebuild: escapes text and attributes, drops scripts and handlers, keeps hidden subtrees hidden', () => {
  const doc = {
    format: 'pane-dom.1',
    styleProps: ['display', 'text-decoration-line'],
    root: {
      t: 'html',
      a: { lang: 'de-DE' },
      d: 'block',
      c: [
        { t: 'head', d: 'none', c: [{ t: 'style', d: 'none', c: [{ x: 'b{font-weight:700}' }] }] },
        {
          t: 'body',
          d: 'block',
          c: [
            { t: 'p', a: { title: 'a "q" & b', onclick: 'x()' }, d: 'block', s: ['block', 'none'], c: [{ x: '1 < 2 & 3' }] },
            { t: 'div', d: 'none', c: [{ t: 'span', d: 'inline', s: ['inline', 'none'], c: [{ x: '€99,00' }] }] },
            { t: 'script', a: { src: 'https://x/y.js' }, d: 'none' },
            { t: 'iframe', a: { src: 'https://pay.example/' }, d: 'inline', o: 'https://pay.example', b: [0, 0, 300, 80] },
            { t: 'x-cart', d: 'block', sr: [{ t: 'b', d: 'inline', s: ['inline', 'none'], c: [{ x: '€20,00' }] }] },
            { t: 'img', a: { alt: 'x' }, d: 'inline' },
          ],
        },
      ],
    },
  };
  const html = rebuildHtml(doc);
  assert.match(html, /^<!doctype html><html lang="de-DE">/);
  assert.match(html, /<p title="a &quot;q&quot; &amp; b" style="display:block;text-decoration-line:none">1 &lt; 2 &amp; 3<\/p>/);
  assert.match(html, /<div style="display:none"><span/);
  assert.ok(!/script|onclick|pay\.example\//.test(html));
  assert.match(html, /<iframe data-pane-origin="https:\/\/pay.example" width="300" height="80"><\/iframe>/);
  assert.match(html, /<x-cart><template shadowrootmode="open"><b [^>]*>€20,00<\/b><\/template><\/x-cart>/);
  assert.match(html, /<style[^>]*>b\{font-weight:700\}<\/style>/);
  assert.match(html, /<img alt="x">(?!<\/img>)/);
  assert.throws(() => rebuildHtml({ format: 'pane-trial-dom.1' }), /not a pane-dom.1 or pane-dom.2 export/);
});

test('pane-dom.2 rebuild: clipping styles, invisible text and boxes; meta refresh dropped', () => {
  const html = rebuildHtml({
    format: 'pane-dom.2',
    styleProps: ['display'],
    root: {
      t: 'html',
      d: 'block',
      c: [
        { t: 'head', d: 'none', c: [{ t: 'meta', a: { 'http-equiv': 'Refresh', content: '0;url=https://x/' }, d: 'none' }] },
        {
          t: 'body',
          d: 'block',
          c: [
            { t: 'div', d: 'block', k: { opacity: '0' }, c: [{ t: 'span', d: 'inline', s: ['inline'], b: [0, 0, 40, 10], v: false, bx: true, c: [{ x: '€6,00' }] }] },
            { t: 'span', d: 'block', s: ['block'], b: [0, 0, 1, 1], v: true, bx: false, k: { clip: 'rect(0px, 0px, 0px, 0px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', width: '1px', height: '1px' }, c: [{ x: '€5,00' }] },
          ],
        },
      ],
    },
  });
  assert.ok(!/refresh/i.test(html));
  assert.match(html, /<div style="opacity:0">/);
  assert.match(html, /<span data-pane-box="0,0,40,10" style="display:inline;visibility:hidden">€6,00/);
  assert.match(html, /<span data-pane-box="0,0,1,1" style="display:block;clip:rect\(0px, 0px, 0px, 0px\);overflow-x:hidden;overflow-y:hidden;width:1px;height:1px">€5,00/);
});

// ---- Pane transcript audit (protocol .8 review, M2) ----

test('pane transcript audit: allowed calls pass; typing, form input, other scripts, checkout paths and Chrome tools are flagged', () => {
  const exportText = readFileSync(path.join(dir, 'pane-export.js'), 'utf8');
  const robotsText = readFileSync(path.join(dir, 'pane-robots-hash.js'), 'utf8');
  const use = (name, input) => ({ type: 'tool_use', name: `mcp__Claude_Browser__${name}`, input });
  const line = (...content) => JSON.stringify({ type: 'assistant', message: { content } });
  const ok = [
    line(use('tabs_create', {})),
    line(use('navigate', { url: 'https://www.example.de/robots.txt', tabId: 't1' })),
    line(use('javascript_tool', { action: 'javascript_exec', text: `\n${robotsText}\n`, tabId: 't1' })),
    line(use('navigate', { url: 'https://www.example.de/checkout/cart', tabId: 't1' })),
    line(use('computer', { action: 'left_click', ref: 'ref_3', tabId: 't1' })),
    line(use('javascript_tool', { action: 'javascript_exec', text: exportText, tabId: 't1' })),
    line(use('javascript_tool', { action: 'javascript_exec', text: 'window.__aiCheckoutPaneExport.chunk(0)', tabId: 't1' })),
    line({
      type: 'tool_use',
      name: 'Write',
      input: {
        file_path: '/Users/x/repo/evals/merchants/capture/data/pane/example.de/cart-1/dom.json',
        content: '{"t":"a","c":[{"x":"Proceed to checkout"}]},{"x":"Sign in"}',
      },
    }),
    line({
      type: 'tool_use',
      name: 'Write',
      input: { file_path: '/Users/x/repo/evals/merchants/capture/records/example.de.pane.json', content: '{}' },
    }),
    line({ type: 'tool_use', name: 'Bash', input: { command: 'shasum -a 256 evals/merchants/capture/data/pane/example.de/cart-1/dom.json' } }),
    line(use('tabs_close', { tabId: 't1' })),
  ].join('\n');
  const clean = auditTranscript(ok, { repoRoot: '/Users/x/repo' });
  assert.equal(clean.toolCalls, 11);
  assert.deepEqual(clean.flags, []);
  const bad = [
    line(use('computer', { action: 'type', text: 'shoes' })),
    line(use('computer', { action: 'key', text: 'Enter' })),
    line(use('form_input', { ref: 'ref_1', value: 'x' })),
    line({ type: 'tool_use', name: 'mcp__claude-in-chrome__navigate', input: { url: 'https://x.com' } }),
    line(use('navigate', { url: 'https://www.example.de/en/checkout' })),
    line(use('javascript_tool', { action: 'javascript_exec', text: 'document.querySelector("form").submit()' })),
    line(use('find', { query: 'Proceed to checkout' })),
    line(use('browser_batch', { actions: [{ name: 'computer', input: { action: 'type', text: 'a' } }] })),
    line({ type: 'tool_use', name: 'Bash', input: { command: 'curl https://www.example.de/' } }),
    line({ type: 'tool_use', name: 'Bash', input: { command: 'node -e "fetch(process.argv[1])" x' } }),
    line({ type: 'tool_use', name: 'Bash', input: { command: 'open x' } }),
    line({ type: 'tool_use', name: 'Write', input: { file_path: '/Users/x/repo/wiki/now.md', content: 'x' } }),
    line({ type: 'tool_use', name: 'Edit', input: { file_path: '/Users/x/repo/evals/merchants/capture/records/example.de.json' } }),
    line(use('navigate', { url: 'https://www.example.de/my-account/orders' })),
    line(use('navigate', { url: 'https://www.example.de/customer/address/' })),
    line(use('navigate', { url: 'https://www.example.de/logout' })),
  ].join('\n');
  const rules = auditTranscript(bad, { repoRoot: '/Users/x/repo' }).flags.map((f) => f.rule);
  for (const r of [
    'typing',
    'forbidden-tool',
    'claude-in-chrome',
    'checkout-path',
    'javascript-other',
    'checkout-or-order-wording',
    'bash-network',
    'write-outside-capture-folders',
    'account-path',
  ])
    assert.ok(rules.includes(r), r);
  assert.equal(rules.filter((r) => r === 'typing').length, 3);
  assert.equal(rules.filter((r) => r === 'bash-network').length, 3);
  assert.equal(rules.filter((r) => r === 'bash-not-allowed').length, 3);
  assert.equal(rules.filter((r) => r === 'write-outside-capture-folders').length, 2);
  assert.equal(rules.filter((r) => r === 'account-path').length, 3);
});

// ---- Platform of pane captures (protocol .9, H2) ----

test('pane platform: markers observable in pane-dom.2 exports, from empty-cart and the first cart state only', async () => {
  const doc = (children) => ({ format: 'pane-dom.2', styleProps: [], root: { t: 'html', d: 'block', c: children } });
  const script = (src) => ({ t: 'script', a: { src }, d: 'none' });
  const shopify = doc([script('https://cdn.shopify.com/s/files/x.js')]);
  const sfcc = doc([{ t: 'a', a: { href: '/on/demandware.store/Sites-x/Cart-Show' }, d: 'inline', c: [{ x: 'Bag' }] }]);
  const plain = doc([{ t: 'p', d: 'block', c: [{ x: 'Hello' }] }]);
  assert.deepEqual(panePlatform({ 'empty-cart': plain, 'cart-1': shopify }), {
    group: 'shopify',
    marker: 'cdn.shopify.com',
    states: ['empty-cart', 'cart-1'],
  });
  // minicart-1 counts only when cart-1 is missing; later states never count.
  assert.equal(panePlatform({ 'minicart-1': sfcc, 'cart-1': plain }).group, 'none-detected');
  assert.equal(panePlatform({ 'minicart-1': sfcc }).group, 'sfcc');
  assert.equal(panePlatform({ 'cart-qty2': shopify, 'cart-1': plain }).group, 'none-detected');
  // Script contents are not exported, so a script-only marker (Shopify.shop) can't match.
  const inline = doc([{ t: 'script', d: 'none', c: [{ x: 'Shopify.shop = "x";' }] }]);
  assert.equal(panePlatform({ 'cart-1': inline }).group, 'none-detected');
  assert.throws(() => panePlatform({ 'cart-1': { ...plain, format: 'pane-dom.1' } }), /pane-dom.2/);
  // From disk, the split input form.
  const root = await mkdtemp(path.join(os.tmpdir(), 'pane-platform-'));
  try {
    await mkdir(path.join(root, 'shop.example', 'cart-1'), { recursive: true });
    await writeFile(path.join(root, 'shop.example', 'cart-1', 'dom.json'), JSON.stringify(shopify));
    await mkdir(path.join(root, 'shop.example', 'evidence'), { recursive: true });
    assert.equal((await storePlatform(root, 'shop.example')).group, 'shopify');
    assert.deepEqual((await storePlatform(root, 'missing.example')).states, []);
    // A store stopped after empty-cart is not captured, so the CLI leaves it out of the split input.
    await mkdir(path.join(root, 'stopped.example', 'empty-cart'), { recursive: true });
    await writeFile(path.join(root, 'stopped.example', 'empty-cart', 'dom.json'), JSON.stringify(shopify));
    const cli = execFileSync(process.execPath, [path.join(dir, 'pane-platform.mjs'), root], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(cli), [{ domain: 'shop.example', platform: 'shopify' }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pane transcript audit: paths are normalised and anchored to the repository; Bash is an allowlist', () => {
  const root = '/Users/x/repo';
  const call = (name, input) => auditCall(name, input, { repoRoot: root }).map((f) => f.rule);
  assert.deepEqual(classifyPath('/Users/x/repo/evals/merchants/capture/data/pane/a.de/cart-1/dom.json', root), 'data');
  assert.deepEqual(classifyPath('evals/merchants/capture/data/pane/a.de/cart-1/dom.json', root), 'data');
  assert.deepEqual(classifyPath('evals/merchants/capture/records/a.de.pane.json', root), 'record');
  // Traversal out of the capture folders, or another checkout's capture folder, is outside.
  assert.equal(classifyPath('/Users/x/repo/evals/merchants/capture/data/../../../../wiki/now.md', root), 'outside');
  assert.equal(classifyPath('/tmp/evals/merchants/capture/data/x.json', root), 'outside');
  assert.equal(classifyPath('evals/merchants/capture/records/../../../../AGENTS.md', root), 'outside');
  assert.ok(call('Write', { file_path: '/Users/x/repo/evals/merchants/capture/data/../../../../wiki/now.md', content: 'Checkout' }).includes('write-outside-capture-folders'));
  // The wording skip applies only inside the data folder after normalisation.
  assert.deepEqual(call('Write', { file_path: '/Users/x/repo/evals/merchants/capture/data/pane/a.de/cart-1/dom.json', content: 'Checkout' }), []);
  assert.ok(call('Write', { file_path: '/Users/x/repo/evals/merchants/capture/data/../records/x.json', content: 'Checkout' }).includes('checkout-or-order-wording'));
  for (const ok of ['shasum -a 256 evals/merchants/capture/data/pane/a.de/cart-1/dom.json', 'ls evals/merchants/capture/data/pane/a.de', 'wc -c x.json', 'head -c 200 x.json'])
    assert.deepEqual(call('Bash', { command: ok }), [], ok);
  for (const bad of ['cat a > b', 'cat a | tee b', 'cp a b', 'mv a b', 'ls; rm -rf x', 'shasum $(echo x)', 'python3 -c "print(1)"'])
    assert.ok(call('Bash', { command: bad }).includes('bash-not-allowed'), bad);
});
