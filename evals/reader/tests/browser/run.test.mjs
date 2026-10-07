// run.mjs in Playwright Chromium on synthetic rebuilt pane pages (no capture is read): JavaScript off, every request
// aborted (a 127.0.0.1 server referenced by the page receives nothing), the placeholder reader injected and read per
// the protocol (warm-up, three timed reads, a stability pair 500 ms apart), runs.json logged, then scored.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { readRuns } from '../../lib.mjs';
import { installReader, openPane, readPage, run } from '../../run.mjs';
import { bundleReader } from '../../bundle.mjs';
import { score } from '../../score.mjs';
import { frozenEnv, label, paneDoc } from '../helpers.mjs';

let browser;
let server;
let origin;
const hits = [];
before(async () => {
  browser = await chromium.launch({ headless: true });
  server = createServer((req, res) => {
    hits.push(req.url);
    res.end('x');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

const cartPage = () =>
  paneDoc([
    { t: 'link', a: { rel: 'stylesheet', href: `${origin}/site.css` } },
    { t: 'noscript', c: [{ t: 'p', a: { id: 'ns' }, c: [{ x: 'Scripting is off' }] }] },
    { t: 'img', a: { src: `${origin}/item.png`, alt: 'item' } },
    {
      t: 'section',
      a: { 'aria-label': 'Order summary' },
      c: [
        { t: 'p', b: [0, 0, 100, 20], c: [{ x: 'Subtotal £20.00' }] },
        { t: 'p', c: [{ x: 'Estimated total £24.00' }] },
      ],
    },
  ]);
const frame = [
  { domain: 'dev.example', operator: 'dev', regionGroup: 'europe' },
  { domain: 'held.example', operator: 'held', regionGroup: 'us' },
];

test('a rebuilt pane page loads with JavaScript off and no network; the placeholder withholds', async () => {
  const env = frozenEnv({
    pages: { 'dev.example/cart-1': cartPage() },
    labels: { development: [label('dev.example/cart-1')] },
    frame,
  });
  const where = {
    domFile: path.join(env.root, 'data', 'pane', 'dev.example', 'cart-1', 'dom.json'),
    ...env.hashes['dev.example/cart-1'],
  };
  const opened = await openPane(browser, where);
  try {
    // <noscript> content is parsed as markup only when scripting is disabled.
    assert.equal(await opened.page.evaluate(() => document.querySelector('#ns')?.textContent), 'Scripting is off');
    assert.equal(opened.url, 'https://shop.example/cart');
    assert.equal(await opened.page.evaluate(() => document.querySelector('script')), null);
    await installReader(opened.page, (await bundleReader()).code);
    opened.network.mark();
    const t0 = Date.now();
    const r = await readPage(opened.page, opened.url);
    assert.ok(Date.now() - t0 >= 500, 'the stability pair is 500 ms apart');
    assert.deepEqual(r.output, { shown: false, reason: 'not-implemented' });
    assert.equal(r.stable, true);
    assert.equal(r.consistent, true);
    assert.equal(r.crash, null);
    assert.equal(r.readMs.length, 5, 'three timed reads and the stability pair');
    assert.ok(r.readMs.every((ms) => ms >= 0 && ms < 50));
    assert.equal(opened.network.since(), 0);
  } finally {
    await opened.close();
  }
  assert.deepEqual(hits, [], 'the server referenced by the page received no request');
});

test('a rebuild that differs from the frozen rebuilt.html is refused', async () => {
  const env = frozenEnv({ pages: { 'dev.example/cart-1': cartPage() }, labels: {}, frame });
  await assert.rejects(
    openPane(browser, {
      domFile: path.join(env.root, 'data', 'pane', 'dev.example', 'cart-1', 'dom.json'),
      ...env.hashes['dev.example/cart-1'],
      rebuiltSha256: 'c'.repeat(64),
    }),
    /differs from the frozen rebuilt/,
  );
});

test('run + score: development and held-out runs logged before reading, outputs recorded, limit enforced', async () => {
  const env = frozenEnv({
    pages: {
      'dev.example/cart-1': cartPage(),
      'dev.example/empty-cart': paneDoc([{ t: 'p', c: [{ x: 'Your cart is empty' }] }]),
      'held.example/cart-1': cartPage(),
    },
    labels: {
      development: [label('dev.example/cart-1'), label('dev.example/empty-cart', { readable: 'none-displayed', displayed: [], expected: null, expectedReason: 'no-total-displayed', currencyEvidence: undefined, currencyConflict: undefined })],
      'heldout-a': [label('held.example/cart-1')],
    },
    frame,
  });
  const opts = { ...env, browser, readerCommit: 'abc1234' };
  const dev = await run({ split: 'development', ...opts });
  assert.equal(dev.pageStates, 2);
  assert.equal(dev.errors, 0);
  const lines = readFileSync(dev.outputsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    lines.map((l) => [l.id, l.output.reason, l.networkAttempts]),
    [
      ['dev.example/cart-1', 'not-implemented', 0],
      ['dev.example/empty-cart', 'not-implemented', 0],
    ],
  );
  const runs = readRuns(path.join(env.root, 'runs.json')).runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'complete');
  assert.equal(runs[0].heldoutRun, null);
  assert.match(runs[0].chromium, /^\d+\./);
  const s = score({ runId: dev.runId, ...env });
  assert.equal(s.whole.counts.withheld, 2);
  assert.equal(s.whole.counts.withheldExpected, 1);
  assert.equal(s.whole.pageState.precision.n, 0);
  assert.equal(s.criterion1.passed, false);
  assert.equal(s.timing.timedReads, 10);

  const h1 = await run({ split: 'heldout-a', confirmHeldoutRun: '1', ...opts });
  assert.equal(h1.errors, 0);
  const cls = score({ runId: h1.runId, classOnly: true, ...env });
  assert.deepEqual(cls.classes, { us: { 'coverage-miss': 1 } });
  await run({ split: 'heldout-a', confirmHeldoutRun: '2', ...opts });
  await assert.rejects(run({ split: 'heldout-a', confirmHeldoutRun: '3', ...opts }), /used 2 of 2/);
  assert.deepEqual(
    readRuns(path.join(env.root, 'runs.json')).runs.map((r) => [r.split, r.heldoutRun]),
    [
      ['development', null],
      ['heldout-a', 1],
      ['heldout-a', 2],
    ],
  );
  assert.deepEqual(hits, []);
});
