// End-to-end runs of the capture tool on the local fixture shop: robots first, product → option → add-to-cart form
// post → cart → checkout → terms, snapshots and the text-free site record, replay of a snapshot, robots exclusions,
// the one-session rule and an operator session over the control server. 127.0.0.1 only.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { runSite } from '../../capture.mjs';
import { openReplay, verifySnapshot } from '../../replay.mjs';
import { fixtureRecipe, startShop } from '../fixture-shop.mjs';

let tmp;
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'capture-e2e-'));
});
after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const steps = (o) => [
  { do: 'goto', url: `${o}/cart` },
  { do: 'snapshot', state: 'empty-cart' },
  { do: 'goto', url: `${o}/products/tee` },
  { do: 'click', target: { selector: 'button.size[data-size="M"]' }, purpose: 'option' },
  { do: 'click', target: { role: 'button', name: 'Add to cart' }, purpose: 'add-to-cart' },
  { do: 'wait', for: { role: 'heading', name: 'Cart' } },
  { do: 'snapshot', state: 'cart-1' },
  { do: 'click', target: { role: 'button', name: 'Increase quantity' }, purpose: 'quantity-increment' },
  { do: 'snapshot', state: 'cart-qty2' },
  { do: 'click', target: { role: 'link', name: 'Checkout' } },
  { do: 'snapshot', state: 'checkout-1' },
  { do: 'goto', url: `${o}/terms` },
  { do: 'snapshot', state: 'terms' },
  {
    do: 'end',
    notReached: [
      { state: 'minicart-1', reason: 'no-mini-cart' },
      { state: 'cart-2items', reason: 'one-product-fixture' },
    ],
  },
];

test('end to end: fixture shop captured; only the add-to-cart form was posted; promo and sign-in forms untouched', async () => {
  const shop = await startShop();
  const out = path.join(tmp, 'e2e-out');
  try {
    const recipe = fixtureRecipe(shop.origin, { steps: steps(shop.origin) });
    const { record, sessionDir } = await runSite({
      recipe,
      mode: 'run',
      outRoot: out,
      profileDir: path.join(tmp, 'profile-e2e'),
      headless: true,
      paceMs: 50,
    });

    // robots.txt came first, before any page.
    assert.deepEqual(shop.log[0], { site: 'shop', method: 'GET', path: '/robots.txt', body: '' });
    // The one form submission was the add-to-cart post, with the chosen option.
    const posts = shop.log.filter((r) => r.method === 'POST');
    assert.deepEqual(
      posts.map((r) => r.path),
      ['/cart/add'],
    );
    assert.match(posts[0].body, /size=M/);
    assert.ok(!shop.log.some((r) => ['/promo', '/login', '/newsletter', '/cart/update'].includes(r.path)));
    assert.ok(!shop.log.some((r) => r.site === 'third-party' && r.path !== '/widget'));

    assert.equal(record.outcome.status, 'captured');
    assert.deepEqual(
      record.states.map((s) => s.state),
      ['empty-cart', 'cart-1', 'cart-qty2', 'checkout-1', 'terms'],
    );
    assert.equal(record.robots.decision, 'allowed');
    assert.deepEqual(record.robots.checkedPaths, [
      { path: '/cart', allowed: true },
      { path: '/checkout', allowed: true },
    ]);
    assert.deepEqual(record.platform, { group: 'bigcommerce', marker: 'cdn11.bigcommerce.com' });
    assert.equal(record.thirdPartyCheckoutHost, null);
    assert.equal(record.stop, null);
    assert.equal(record.notReached.length, 2);
    assert.equal(record.terms.url, `${shop.origin}/terms`);
    assert.equal(record.session.number, 1);

    // The committed record is text-free: no page text, prices or labels from the fixture.
    const text = await readFile(path.join(sessionDir, 'site-record.json'), 'utf8');
    for (const s of ['Fixture Tee', '£', '20.00', 'Subtotal', 'Promo code', 'Sign in'])
      assert.ok(!text.includes(s), s);

    // Snapshot files and hashes, metadata with locale and currency markers.
    const cart = path.join(sessionDir, 'cart-1');
    const { manifest, manifestSha256 } = await verifySnapshot(cart);
    assert.equal(manifestSha256, record.states[1].manifestSha256);
    assert.deepEqual(Object.keys(manifest.files).sort(), [
      'dom.json',
      'full.png',
      'headers.json',
      'meta.json',
      'page.html',
      'page.mhtml',
      'viewport.png',
    ]);
    const meta = JSON.parse(await readFile(path.join(cart, 'meta.json'), 'utf8'));
    assert.equal(meta.captureMethod, 'robot');
    assert.equal(meta.lang, 'en-GB');
    assert.equal(meta.locale.region, 'GB');
    assert.deepEqual(meta.currency.codes, ['GBP']);
    assert.ok(meta.currency.symbolCounts['£'] >= 2);
    assert.equal(meta.shadowRoots.open, 1);
    const headers = JSON.parse(await readFile(path.join(cart, 'headers.json'), 'utf8'));
    assert.equal(headers.status, 200);
    const dom = JSON.parse(await readFile(path.join(cart, 'dom.json'), 'utf8'));
    assert.match(JSON.stringify(dom), /"shadow":"open"/);

    // The recorded recipe reproduces the steps and allowlist.
    const recorded = JSON.parse(await readFile(path.join(sessionDir, 'recipe.recorded.json'), 'utf8'));
    assert.equal(recorded.steps.length, steps(shop.origin).length);

    // Replay hook: MHTML with network blocked keeps the open shadow root and styles; the inputs are still empty.
    const browser = await chromium.launch({ headless: true });
    try {
      const { page, context } = await openReplay(browser, cart, { expectedManifestSha256: manifestSha256 });
      const seen = await page.evaluate(() => ({
        shadow: document.getElementById('summary')?.shadowRoot?.getElementById('sub')?.textContent ?? null,
        strike: getComputedStyle(document.querySelector('.was')).textDecorationLine,
        promo: document.getElementById('promo-code').value,
        scripts: document.scripts.length,
      }));
      assert.deepEqual(seen, { shadow: '£20.00', strike: 'line-through', promo: '', scripts: 0 });
      await context.close();
      const co = await openReplay(browser, path.join(sessionDir, 'checkout-1'));
      assert.deepEqual(
        await co.page.evaluate(() => [
          document.getElementById('email').value,
          document.getElementById('password').value,
        ]),
        ['', ''],
      );
      await co.context.close();
      await assert.rejects(
        openReplay(browser, cart, { expectedManifestSha256: '0'.repeat(64) }),
        /not the expected/,
      );
    } finally {
      await browser.close();
    }

    // One capture session per site.
    await assert.rejects(
      runSite({
        recipe,
        mode: 'run',
        outRoot: out,
        profileDir: path.join(tmp, 'profile-e2e'),
        headless: true,
        paceMs: 50,
      }),
      /already has 1 session/,
    );
  } finally {
    await shop.close();
  }
});

for (const [robots, decision, label] of [
  ['User-agent: *\nDisallow: /cart\n', 'robots-disallow-path', 'star group, cart path'],
  ['User-agent: *\nDisallow: /\n', 'robots-disallow-all', 'star group, everything'],
  [
    'User-agent: AICheckoutCapture\nDisallow: /checkout\n',
    'robots-disallow-path',
    "tool's own group, checkout path",
  ],
]) {
  test(`robots: ${decision} (${label}) excludes the site before any page load`, async () => {
    const shop = await startShop({ robots });
    try {
      const recipe = fixtureRecipe(shop.origin, { steps: steps(shop.origin) });
      const { record } = await runSite({
        recipe,
        mode: 'run',
        outRoot: path.join(tmp, `robots-${decision}-${Math.random()}`),
        profileDir: path.join(tmp, 'profile-robots'),
        headless: true,
        paceMs: 50,
      });
      assert.deepEqual(
        shop.log.map((r) => r.path),
        ['/robots.txt'],
      );
      assert.equal(record.robots.decision, decision);
      assert.deepEqual(record.outcome, { status: 'excluded', code: decision, evidenceSha256: null });
      assert.equal(record.session.topLevelNavigations, 0);
    } finally {
      await shop.close();
    }
  });
}

test('serve: the operator drives the same driver over the control server; refusals come back, the session ends', async () => {
  const shop = await startShop();
  try {
    const recipe = fixtureRecipe(shop.origin);
    const post = (port, token, body, extra = {}) =>
      new Promise((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extra },
          },
          (res) => {
            let t = '';
            res.on('data', (c) => (t += c));
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t) }));
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
      });
    const results = [];
    const { record } = await runSite({
      recipe,
      mode: 'serve',
      outRoot: path.join(tmp, 'serve-out'),
      profileDir: path.join(tmp, 'profile-serve'),
      headless: true,
      paceMs: 50,
      onServer: async ({ port, token }) => {
        // Run the operator in the background; runSite waits for the end step.
        setTimeout(async () => {
          results.push(
            await post(
              port,
              token,
              { do: 'goto', url: `${shop.origin}/products/tee` },
              { origin: 'https://evil.example' },
            ),
          );
          results.push(await post(port, token, { do: 'goto', url: `${shop.origin}/products/tee` }));
          results.push(await post(port, token, { do: 'type', target: { selector: '#giftmsg' }, text: 'hi' }));
          results.push(
            await post(port, token, { do: 'click', target: { role: 'button', name: 'Subscribe' } }),
          );
          results.push(await post(port, token, { do: 'end', exclusion: 'no-eligible-item' }));
        }, 10);
      },
    });
    assert.deepEqual(
      results.map((r) => r.status),
      [403, 200, 422, 422, 200],
    );
    assert.equal(results[2].body.error.code, 'refused-typing');
    assert.equal(results[3].body.error.code, 'refused-submit');
    assert.equal(record.outcome.status, 'excluded');
    assert.equal(record.outcome.code, 'no-eligible-item');
    assert.match(record.outcome.evidenceSha256, /^[0-9a-f]{64}$/);
    assert.ok(!shop.log.some((r) => r.method === 'POST'));
  } finally {
    await shop.close();
  }
});

test('third-party checkout: the host is recorded with checkout-1 and nothing past its first page loads', async () => {
  const shop = await startShop();
  try {
    const o = shop.origin;
    const recipe = fixtureRecipe(o, {
      steps: [
        { do: 'goto', url: `${o}/products/tee` },
        { do: 'click', target: { role: 'button', name: 'Add to cart' }, purpose: 'add-to-cart' },
        { do: 'snapshot', state: 'cart-1' },
        { do: 'click', target: { role: 'link', name: 'Pay with Partner' } },
        { do: 'snapshot', state: 'checkout-1' },
        { do: 'click', target: { role: 'link', name: 'Next' } },
      ],
    });
    const { record } = await runSite({
      recipe,
      mode: 'run',
      outRoot: path.join(tmp, 'tp-out'),
      profileDir: path.join(tmp, 'profile-tp'),
      headless: true,
      paceMs: 50,
    });
    assert.equal(record.thirdPartyCheckoutHost, new URL(shop.thirdParty).host);
    assert.deepEqual(
      record.states.map((s) => s.state),
      ['cart-1', 'checkout-1'],
    );
    // The recipe's last click was refused; the run stops as a tool error, and the site still counts as captured.
    assert.equal(record.stop.code, 'tool-error');
    assert.match(record.stop.detail, /refused-third-party-page/);
    assert.equal(record.outcome.status, 'captured');
    assert.ok(!shop.log.some((r) => r.site === 'third-party' && r.path === '/next'));
  } finally {
    await shop.close();
  }
});
