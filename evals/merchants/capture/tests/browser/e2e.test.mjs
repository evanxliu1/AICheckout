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
import { Recipe } from '../../recipe.mjs';
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
    // The one form submission was the add-to-cart post, with the chosen option; the only other write is the
    // increment's fetch, allowed during its allowlisted click.
    const posts = shop.log.filter((r) => r.method === 'POST');
    assert.deepEqual(
      posts.map((r) => r.path),
      ['/cart/add', '/cart/change'],
    );
    assert.match(posts[0].body, /size=M/);
    assert.ok(!shop.log.some((r) => ['/promo', '/login', '/newsletter', '/cart/update'].includes(r.path)));
    assert.ok(!shop.log.some((r) => r.site === 'third-party' && r.path !== '/widget'));

    assert.equal(record.outcome.status, 'captured');
    assert.deepEqual(
      record.states.map((s) => s.state),
      ['empty-cart', 'cart-1', 'cart-qty2', 'terms'],
    );
    assert.equal(record.robots.decision, 'allowed');
    assert.deepEqual(record.robots.checkedPaths, [
      { path: '/cart', host: new URL(shop.origin).host, allowed: true },
      { path: '/checkout', host: new URL(shop.origin).host, allowed: true },
    ]);
    assert.deepEqual(record.platform, { group: 'bigcommerce', marker: 'cdn11.bigcommerce.com' });
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

for (const [robots, label] of [
  ['User-agent: *\nDisallow: /\n', 'star group'],
  ['User-agent: AICheckoutCapture\nDisallow: /\n', "tool's own group"],
]) {
  test(`robots: disallow-all (${label}) excludes the site before any page load`, async () => {
    const shop = await startShop({ robots });
    try {
      const recipe = fixtureRecipe(shop.origin, { steps: steps(shop.origin) });
      const { record } = await runSite({
        recipe,
        mode: 'run',
        outRoot: path.join(tmp, `robots-all-${Math.random()}`),
        profileDir: path.join(tmp, 'profile-robots'),
        headless: true,
        paceMs: 50,
      });
      assert.deepEqual(
        shop.log.map((r) => r.path),
        ['/robots.txt'],
      );
      assert.equal(record.robots.decision, 'robots-disallow-all');
      assert.deepEqual(record.outcome, { status: 'excluded', code: 'robots-disallow-all', evidenceSha256: null });
      assert.equal(record.session.topLevelNavigations, 0);
    } finally {
      await shop.close();
    }
  });
}

test('robots (.4): disallowed cart and checkout paths are recorded, and the site is captured', async () => {
  const shop = await startShop({ robots: 'User-agent: *\nDisallow: /cart\n\nUser-agent: AICheckoutCapture\nDisallow: /checkout\n' });
  try {
    const recipe = fixtureRecipe(shop.origin, { steps: steps(shop.origin) });
    const { record } = await runSite({
      recipe,
      mode: 'run',
      outRoot: path.join(tmp, `robots-path-${Math.random()}`),
      profileDir: path.join(tmp, 'profile-robots'),
      headless: true,
      paceMs: 50,
    });
    assert.equal(record.robots.decision, 'allowed');
    assert.deepEqual(record.robots.checkedPaths, [
      { path: '/cart', host: new URL(shop.origin).host, allowed: false },
      { path: '/checkout', host: new URL(shop.origin).host, allowed: false },
    ]);
    assert.equal(record.outcome.status, 'captured');
    const byState = Object.fromEntries(record.states.map((s) => [s.state, s.robotsAllowed]));
    assert.deepEqual(byState, {
      'empty-cart': false,
      'cart-1': false,
      'cart-qty2': false,
      terms: true,
    });
  } finally {
    await shop.close();
  }
});

test('reconnaissance first: look-only session writes the draft recipe; the capture session runs from it', async () => {
  const shop = await startShop();
  const out = path.join(tmp, 'recon-out');
  try {
    const o = shop.origin;
    const recon = await runSite({
      mode: 'recon',
      recon: {
        domain: '127.0.0.1',
        entryUrl: `${o}/`,
        hosts: ['127.0.0.1'],
        currency: 'GBP',
        priceBand: [8, 155],
        steps: [
          { do: 'goto', url: `${o}/` },
          { do: 'snapshot', state: 'view-01' },
          { do: 'goto', url: `${o}/listing` },
          { do: 'snapshot', state: 'view-02' },
          { do: 'goto', url: `${o}/products/tee` },
          { do: 'snapshot', state: 'view-03' },
          { do: 'goto', url: `${o}/listing` },
          { do: 'click', target: { role: 'link', name: 'Cart' } },
          {
            do: 'end',
            findings: {
              listingUrl: `${o}/listing`,
              productUrls: [`${o}/products/tee`],
              cartPath: '/cart',
              checkoutPaths: [],
              termsUrl: `${o}/terms`,
              stockMismatch: [`${o}/products/tee`],
            },
          },
        ],
      },
      outRoot: out,
      profileDir: path.join(tmp, 'profile-recon'),
      headless: true,
      paceMs: 50,
    });
    assert.equal(recon.record.outcome.status, 'done');
    assert.equal(recon.record.views, 3);
    // The ordered navigation list is committed (masked URLs) for the reviewer.
    assert.deepEqual(
      recon.record.navigation.map((u) => new URL(u).pathname),
      ['/', '/listing', '/products/tee', '/listing', '/cart'],
    );
    assert.equal(recon.record.robots.decision, 'allowed');
    assert.ok(!shop.log.some((r) => r.method === 'POST'));
    const reconText = await readFile(recon.recordPath, 'utf8');
    for (const t of ['Fixture Tee', '£', '20.00']) assert.ok(!reconText.includes(t), t);
    const draft = JSON.parse(await readFile(path.join(recon.sessionDir, 'recipe.draft.json'), 'utf8'));
    assert.equal(draft.recon.sessionId, recon.record.session.id);
    assert.equal(draft.cartPath, '/cart');
    assert.equal(draft.cartHost, new URL(o).host);
    // A structured-data stock mismatch is recorded in the reconnaissance record, never in the recipe.
    assert.deepEqual(recon.record.stockMismatch, [`${o}/products/tee`]);
    assert.equal('stockMismatch' in draft, false);

    // One reconnaissance session per site.
    await assert.rejects(
      runSite({
        mode: 'recon',
        recon: { domain: '127.0.0.1', entryUrl: `${o}/`, hosts: ['127.0.0.1'], currency: 'GBP', priceBand: [8, 155] },
        outRoot: out,
        profileDir: path.join(tmp, 'profile-recon'),
        headless: true,
        paceMs: 50,
      }),
      /recon-sessions.json/,
    );

    // The operator adds the allowlist and steps to the draft and runs the capture session.
    const recipe = { ...fixtureRecipe(o, { steps: steps(o) }), ...draft, allowlist: fixtureRecipe(o).allowlist, steps: steps(o) };
    const { record } = await runSite({
      recipe,
      mode: 'run',
      outRoot: out,
      profileDir: path.join(tmp, 'profile-recon'),
      headless: true,
      paceMs: 50,
    });
    assert.equal(record.outcome.status, 'captured');
    assert.deepEqual(record.recon, { sessionId: recon.record.session.id });
    assert.ok(!record.states.some((s) => s.state.startsWith('view-')));
    assert.deepEqual(record.platform, { group: 'bigcommerce', marker: 'cdn11.bigcommerce.com' });

    // A recipe whose item is not the reconnaissance finding is refused before any browser starts.
    const before = shop.log.length;
    await assert.rejects(
      runSite({
        recipe: { ...recipe, productUrls: [`${o}/products/hat`] },
        mode: 'run',
        outRoot: out,
        profileDir: path.join(tmp, 'profile-recon'),
        headless: true,
        paceMs: 50,
      }),
      /differs from its reconnaissance findings in: productUrls/,
    );
    assert.equal(shop.log.length, before);
  } finally {
    await shop.close();
  }
});

test('a cart on another host of the site: its robots.txt is read up front and the cart path checked against it', async () => {
  const shop = await startShop({ sisterRobots: 'User-agent: *\nDisallow: /bag\n' });
  const out = path.join(tmp, 'cart-host-out');
  try {
    const o = shop.origin;
    const recon = await runSite({
      mode: 'recon',
      recon: {
        domain: '127.0.0.1',
        entryUrl: `${o}/`,
        hosts: ['127.0.0.1'],
        currency: 'GBP',
        priceBand: [8, 155],
        steps: [
          { do: 'goto', url: `${o}/` },
          { do: 'snapshot', state: 'view-01' },
          { do: 'goto', url: `${o}/listing` },
          { do: 'snapshot', state: 'view-02' },
          { do: 'goto', url: `${o}/products/tee` },
          { do: 'goto', url: `${shop.sister}/bag` },
          {
            do: 'end',
            findings: {
              listingUrl: `${o}/listing`,
              productUrls: [`${o}/products/tee`],
              cartPath: '/bag',
              checkoutPaths: [],
            },
          },
        ],
      },
      outRoot: out,
      profileDir: path.join(tmp, 'profile-cart-host'),
      headless: true,
      paceMs: 50,
    });
    assert.equal(recon.record.outcome.status, 'done');
    assert.equal(recon.draft.cartHost, new URL(shop.sister).host);
    const robotsBefore = shop.log.filter((r) => r.site === 'sister' && r.path === '/robots.txt').length;
    const { record } = await runSite({
      recipe: { ...recon.draft, allowlist: fixtureRecipe(o).allowlist, steps: [] },
      mode: 'run',
      outRoot: out,
      profileDir: path.join(tmp, 'profile-cart-host'),
      headless: true,
      paceMs: 50,
    });
    assert.equal(shop.log.filter((r) => r.site === 'sister' && r.path === '/robots.txt').length, robotsBefore + 1);
    assert.deepEqual(record.robots.checkedPaths, [{ path: '/bag', host: new URL(shop.sister).host, allowed: false }]);
    assert.deepEqual(
      record.robotsHosts.map((h) => [h.host, h.decision]),
      [[new URL(shop.sister).host, 'allowed']],
    );
  } finally {
    await shop.close();
  }
});

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
    assert.equal(results[3].body.error.code, 'refused-order-or-account');
    assert.equal(record.outcome.status, 'excluded');
    assert.equal(record.outcome.code, 'no-eligible-item');
    assert.match(record.outcome.evidenceSha256, /^[0-9a-f]{64}$/);
    assert.ok(!shop.log.some((r) => r.method === 'POST'));
  } finally {
    await shop.close();
  }
});

test('protocol .5: no checkout-1 state; a click to an off-site checkout is refused and nothing of it loads', async () => {
  const shop = await startShop();
  try {
    const o = shop.origin;
    const recipe = fixtureRecipe(o, {
      steps: [
        { do: 'goto', url: `${o}/products/tee` },
        { do: 'click', target: { role: 'button', name: 'Add to cart' }, purpose: 'add-to-cart' },
        { do: 'snapshot', state: 'cart-1' },
        { do: 'click', target: { role: 'link', name: 'Partner checkout' } },
      ],
    });
    assert.equal(
      Recipe.safeParse({ ...recipe, steps: [{ do: 'snapshot', state: 'checkout-1' }] }).success,
      false,
    );
    const { record } = await runSite({
      recipe,
      mode: 'run',
      outRoot: path.join(tmp, 'tp-out'),
      profileDir: path.join(tmp, 'profile-tp'),
      headless: true,
      paceMs: 50,
    });
    assert.deepEqual(
      record.states.map((s) => s.state),
      ['cart-1'],
    );
    // The click was refused (its checkout wording is caught first; the off-site rule would refuse it too); the run
    // stops as a tool error, and the site still counts as captured.
    assert.equal(record.stop.code, 'tool-error');
    assert.match(record.stop.detail, /refused-checkout/);
    assert.equal(record.outcome.status, 'captured');
    assert.ok(!shop.log.some((r) => r.site === 'third-party' && r.path !== '/widget'));
  } finally {
    await shop.close();
  }
});
