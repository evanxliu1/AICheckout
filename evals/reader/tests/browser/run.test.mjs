// run.mjs in Playwright Chromium on synthetic pages only (no capture is read): rebuilt pane pages and variants with
// JavaScript off, a synthetic MHTML robot snapshot through replay.mjs, every request aborted (a 127.0.0.1 server
// referenced by the pages receives nothing), data-pane-* attributes stripped before the reader runs, the protocol's
// reads (warm-up, three timed reads, a stability pair 500 ms apart), synthetic misbehaving readers, the legacy
// adapters on their own store's URL, integrity failures aborting the run, then scoring.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { readRuns } from '../../lib.mjs';
import { installReader, openPane, openRobot, readPage, run, stripPaneAttributes } from '../../run.mjs';
import { bundleReader } from '../../bundle.mjs';
import { score } from '../../score.mjs';
import { frozenEnv, label, nullExpected, paneDoc, sha } from '../helpers.mjs';

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

const cartPage = (url) =>
  paneDoc(
    [
      { t: 'link', a: { rel: 'stylesheet', href: `${origin}/site.css` } },
      { t: 'noscript', c: [{ t: 'p', a: { id: 'ns' }, c: [{ x: 'Scripting is off' }] }] },
      { t: 'img', a: { src: `${origin}/item.png`, alt: 'item' } },
      {
        t: 'section',
        a: { 'aria-label': 'Order summary' },
        c: [
          { t: 'p', b: [0, 0, 100, 20], c: [{ x: 'Subtotal £20.00' }] },
          { t: 'p', c: [{ x: 'Estimated total £24.00' }] },
          {
            t: 'div',
            sr: [{ t: 'span', b: [1, 2, 3, 4], c: [{ x: 'in shadow' }] }],
            c: [],
          },
        ],
      },
    ],
    url,
  );
const frame = [
  { domain: 'dev.example', operator: 'dev', regionGroup: 'europe' },
  { domain: 'held.example', operator: 'held', regionGroup: 'us' },
  { domain: 'robot.example', operator: 'robot', regionGroup: 'us' },
];
const emptyLabel = (id) =>
  label(id, { readable: 'none-displayed', displayed: [], ...nullExpected('no-total-displayed') });
const reader = (body) => `var __aiCheckoutCartReader = { readCart: ${body} };`;

/** A synthetic MHTML snapshot made by Chromium itself from static HTML. */
async function mhtmlOf(html) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  await page.setContent(html);
  const cdp = await context.newCDPSession(page);
  const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
  await context.close();
  return data;
}

test('a rebuilt pane page loads with JavaScript off and no network; data-pane-* stripped; placeholder withholds', async () => {
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
    // Two boxes (one in an open shadow root) and the iframe-free page: every data-pane-* attribute goes.
    assert.equal(await stripPaneAttributes(opened.page), 2);
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

test('review 3: a reader that walks every attribute sees no data-pane-* attribute in a run', async () => {
  const env = frozenEnv({
    pages: { 'dev.example/cart-1': cartPage() },
    labels: { development: [label('dev.example/cart-1')] },
    frame,
  });
  const readerRoot = mkdtempSync(path.join(os.tmpdir(), 'reader-src-'));
  mkdirSync(path.join(readerRoot, 'packages', 'cart-reader', 'src'), { recursive: true });
  // Looks for any attribute whose name starts with the rebuild's prefix, built so the bundle tripwire stays quiet.
  writeFileSync(
    path.join(readerRoot, 'packages', 'cart-reader', 'src', 'index.ts'),
    `const P = ['data', 'pa' + 'ne'].join('-');
export function readCart(document: Document) {
  let n = 0;
  const walk = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll('*')) {
      for (const a of Array.from(el.attributes)) if (a.name.startsWith(P)) n += 1;
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return { shown: false as const, reason: n ? 'saw-pane-attributes' : 'none-seen' };
}
`,
  );
  const r = await run({ split: 'development', ...env, readerRoot, browser, testOnlyReaderCommit: 'abc1234' });
  const [row] = readFileSync(r.outputsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(row.output.reason, 'none-seen');
});

test('review 7: synthetic readers — random is unstable, throwing and Promise or invalid outputs are crashes', async () => {
  const env = frozenEnv({ pages: { 'dev.example/cart-1': cartPage() }, labels: {}, frame });
  const where = {
    domFile: path.join(env.root, 'data', 'pane', 'dev.example', 'cart-1', 'dom.json'),
    ...env.hashes['dev.example/cart-1'],
  };
  const cases = [
    [
      'random',
      reader("() => ({ shown: true, kind: 'subtotal', amountMinor: Math.floor(Math.random() * 1e9), currency: 'GBP' })"),
      (r) => {
        assert.deepEqual(r.output, { shown: false, reason: 'unstable' });
        assert.equal(r.stable, false);
        assert.equal(r.consistent, false);
        assert.equal(r.crash, null);
      },
    ],
    [
      'throwing',
      reader("() => { throw new Error('boom'); }"),
      (r) => assert.deepEqual([r.output.reason, r.crash], ['crash', 'throw']),
    ],
    [
      'promise',
      reader("async () => ({ shown: false, reason: 'later' })"),
      (r) => assert.deepEqual([r.output.reason, r.crash], ['crash', 'invalid-output']),
    ],
    [
      'invalid',
      reader("() => ({ shown: true, kind: 'total', amountMinor: 12.5, currency: 'gbp' })"),
      (r) => assert.deepEqual([r.output.reason, r.crash], ['crash', 'invalid-output']),
    ],
    [
      'first-read-only',
      reader(
        "(() => { let n = 0; return () => (n++ === 0 ? { shown: false, reason: 'warm' } : { shown: false, reason: 'cold' }); })()",
      ),
      (r) => {
        // Only the warm-up differs: the scored output stands and the sequence is inconsistent.
        assert.deepEqual(r.output, { shown: false, reason: 'cold' });
        assert.equal(r.stable, true);
        assert.equal(r.consistent, false);
      },
    ],
  ];
  for (const [name, code, check] of cases) {
    const opened = await openPane(browser, where);
    try {
      await installReader(opened.page, code);
      check(await readPage(opened.page, opened.url, { gapMs: 50 }));
    } catch (e) {
      e.message = `${name}: ${e.message}`;
      throw e;
    } finally {
      await opened.close();
    }
  }
});

test('review 7: a synthetic MHTML robot snapshot loads through replay.mjs; a changed manifest is refused', async () => {
  const mhtml = await mhtmlOf(
    `<html><body><img src="${origin}/robot.png"><p id="t">Subtotal $20.00</p></body></html>`,
  );
  const env = frozenEnv({
    robots: { 'robot.example/cart-1': { mhtml, url: 'https://robot.example/cart' } },
    labels: { development: [label('robot.example/cart-1')] },
    frame,
  });
  const dir = path.join(env.root, 'data', 'robot.example', 'S1', 'cart-1');
  const opened = await openRobot(browser, { dir, manifestSha256: env.hashes['robot.example/cart-1'].snapshotSha256 });
  try {
    assert.equal(opened.url, 'https://robot.example/cart');
    assert.equal(await opened.page.evaluate(() => document.querySelector('#t')?.textContent), 'Subtotal $20.00');
    await installReader(opened.page, (await bundleReader()).code);
    const r = await readPage(opened.page, opened.url, { gapMs: 50 });
    assert.equal(r.output.reason, 'not-implemented');
  } finally {
    await opened.close();
  }
  await assert.rejects(openRobot(browser, { dir, manifestSha256: sha('other') }), /not the frozen one/);
  assert.deepEqual(hits, []);
});

test('run + score: real pages, variants, a robot page and legacy reads in one counted run; limit enforced', async () => {
  const mhtml = await mhtmlOf('<html><body><p>Subtotal $20.00</p></body></html>');
  const env = frozenEnv({
    pages: {
      'dev.example/cart-1': cartPage('https://www.bestbuy.com/cart'),
      'dev.example/empty-cart': paneDoc([{ t: 'p', c: [{ x: 'Your cart is empty' }] }]),
      'held.example/cart-1': cartPage(),
    },
    robots: { 'robot.example/cart-1': { mhtml, url: 'https://robot.example/cart' } },
    variants: {
      'dev.example/cart-1/class-rename': { doc: cartPage(), label: label('dev.example/cart-1/class-rename') },
      'held.example/cart-1/fake-subtotal': { doc: cartPage(), label: label('held.example/cart-1/fake-subtotal') },
    },
    labels: {
      development: [label('dev.example/cart-1'), emptyLabel('dev.example/empty-cart'), label('robot.example/cart-1')],
      'heldout-a': [label('held.example/cart-1')],
    },
    frame,
  });
  const opts = { ...env, browser, testOnlyReaderCommit: 'abc1234', gapMs: 50 };
  const dev = await run({ split: 'development', ...opts });
  assert.deepEqual([dev.pageStates, dev.variants, dev.errors], [3, 1, 0]);
  const lines = readFileSync(dev.outputsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    lines.map((l) => [l.id, l.method, l.output.reason, l.networkAttempts, Boolean(l.variant), Boolean(l.legacy)]),
    [
      ['dev.example/cart-1', 'pane', 'not-implemented', 0, false, true],
      ['dev.example/empty-cart', 'pane', 'not-implemented', 0, false, false],
      ['robot.example/cart-1', 'robot', 'not-implemented', 0, false, false],
      ['dev.example/cart-1/class-rename', 'pane', 'not-implemented', 0, true, false],
    ],
  );
  // The Best Buy adapter matched the store URL and read the page (no Best Buy summary: withheld).
  assert.equal(lines[0].legacy.output.shown, false);
  const runs = readRuns(path.join(env.root, 'runs.json')).runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'complete');
  assert.equal(runs[0].heldoutRun, null);
  assert.equal(runs[0].variants, 1);
  assert.match(runs[0].chromium, /^\d+\./);
  const runJson = JSON.parse(readFileSync(path.join(path.dirname(dev.outputsFile), 'run.json'), 'utf8'));
  assert.deepEqual(runJson.harness.paths, [
    'evals/reader',
    'evals/merchants/capture/rebuild.mjs',
    'evals/merchants/capture/replay.mjs',
  ]);
  const s = score({ runId: dev.runId, ...env });
  assert.equal(s.whole.counts.withheld, 3);
  assert.equal(s.whole.counts.withheldExpected, 2);
  assert.equal(s.whole.pageState.precision.n, 0);
  assert.equal(s.criterion1.passed, false);
  assert.equal(s.timing.timedReads, 15);
  assert.equal(s.variants.byTransform['class-rename'].counts.withheld, 1);
  assert.equal(s.legacy.pageStates, 1);

  const h1 = await run({ split: 'heldout-a', confirmHeldoutRun: '1', ...opts });
  assert.deepEqual([h1.pageStates, h1.variants], [1, 1]);
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

test('re-check B: the generic reader never sees the legacy global, nor the legacy reader the generic one', async () => {
  const env = frozenEnv({
    pages: { 'dev.example/cart-1': cartPage('https://www.bestbuy.com/cart') },
    labels: { development: [label('dev.example/cart-1')] },
    frame,
  });
  const readerRoot = mkdtempSync(path.join(os.tmpdir(), 'reader-src-'));
  mkdirSync(path.join(readerRoot, 'packages', 'cart-reader', 'src'), { recursive: true });
  writeFileSync(
    path.join(readerRoot, 'packages', 'cart-reader', 'src', 'index.ts'),
    `export function readCart() {
  const g = globalThis as Record<string, unknown>;
  const seen = Object.keys(g).some((k) => /legacy|cartreader/i.test(k) && k !== '__aiCheckoutGenericReader');
  return { shown: false as const, reason: seen || '__aiCheckoutLegacyReader' in g ? 'saw-legacy' : 'alone' };
}
`,
  );
  const r = await run({ split: 'development', ...env, readerRoot, browser, testOnlyReaderCommit: 'abc1234', gapMs: 50 });
  const [row] = readFileSync(r.outputsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(row.output.reason, 'alone');
  assert.ok(row.legacy, 'the legacy reader still ran on the Best Buy URL');
  // And in the page after both: only the legacy global remains, the generic one deleted.
  const opened = await openPane(browser, {
    domFile: path.join(env.root, 'data', 'pane', 'dev.example', 'cart-1', 'dom.json'),
    ...env.hashes['dev.example/cart-1'],
  });
  try {
    await installReader(opened.page, (await bundleReader()).code);
    await opened.page.evaluate(() => delete globalThis.__aiCheckoutGenericReader);
    assert.deepEqual(
      await opened.page.evaluate(() => ['__aiCheckoutGenericReader', '__aiCheckoutCartReader'].map((k) => k in globalThis)),
      [false, false],
    );
  } finally {
    await opened.close();
  }
});

test('review 1 / re-check A: an integrity failure refuses the run before it is logged; held-out messages name no page', async () => {
  const mhtml = await mhtmlOf('<html><body><p>Subtotal $20.00</p></body></html>');
  const env = frozenEnv({
    pages: { 'dev.example/cart-1': cartPage() },
    robots: { 'robot.example/cart-1': { mhtml, url: 'https://robot.example/cart' } },
    labels: { development: [label('dev.example/cart-1')], 'heldout-a': [label('robot.example/cart-1')] },
    frame,
  });
  // The robot snapshot changes after the freeze (freeze.mjs re-hashes pane snapshots only).
  writeFileSync(path.join(env.root, 'data', 'robot.example', 'S1', 'cart-1', 'page.mhtml'), 'changed');
  const opts = { ...env, browser, testOnlyReaderCommit: 'abc1234', gapMs: 50 };
  const err = await run({ split: 'heldout-a', confirmHeldoutRun: '1', ...opts }).catch((e) => e);
  assert.match(err.message, /held-out page-state #1: robot snapshot: hash mismatch/);
  assert.ok(!/robot\.example/.test(err.message), 'no domain in a held-out error');
  // The preflight caught it: no reader code ran and nothing was logged.
  assert.deepEqual(readRuns(path.join(env.root, 'runs.json')).runs, []);
});

test('review 1: a page that fails to load inside a logged run is a harness error, and the run still counts', async () => {
  const env = frozenEnv({
    pages: { 'held.example/cart-1': cartPage() },
    labels: { 'heldout-a': [label('held.example/cart-1')] },
    frame,
  });
  // A browser whose contexts can't be created: the run is logged, then the first page fails to open.
  const broken = { version: () => browser.version(), newContext: () => Promise.reject(new Error('no context')) };
  const r = await run({
    split: 'heldout-a',
    confirmHeldoutRun: '1',
    ...env,
    browser: broken,
    testOnlyReaderCommit: 'abc1234',
  });
  assert.equal(r.errors, 1);
  const [line] = readFileSync(r.outputsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.match(line.harnessError, /no context/);
  const [row] = readRuns(path.join(env.root, 'runs.json')).runs;
  assert.deepEqual([row.status, row.heldoutRun], ['complete', 1]);
  await assert.rejects(
    run({ split: 'heldout-a', confirmHeldoutRun: '1', ...env, browser, testOnlyReaderCommit: 'abc1234' }),
    /not this run's number 2/,
  );
});
