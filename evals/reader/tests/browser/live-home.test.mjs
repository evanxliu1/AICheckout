// live-home.mjs against a fixture server standing in for the live sites (no real site is contacted): robots.txt
// honoured before any load, a 403 and a challenge title recorded as blocked, a home page as loaded/none, a cart
// page as a false show; rows carry no page content.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { bundleReader } from '../../bundle.mjs';
import { summarizeLive, sweep } from '../../live-home.mjs';

let browser;
let server;
let origin;
const hits = [];
const html = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;
const pages = {
  'home.example': html('Acme Outdoor Co', '<main><h1>Welcome</h1><p>Tents from $99.00</p><a href="/cart">Cart (0)</a></main>'),
  'cart.example': html(
    'Your cart',
    '<main><h1>Your cart</h1><div><img src="/x.png" alt=""><label>Qty <input type="number" value="1"></label><button>Remove</button></div><section><div><span>Subtotal</span><span>$20.00</span></div><div><span>Total</span><span>$25.00</span></div><button>Checkout</button></section></main>',
  ),
  'wall.example': html('Just a moment...', '<p>Checking your browser</p>'),
  'denied.example': null,
  'robots.example': html('Robots', '<main><h1>Should never load</h1></main>'),
};
before(async () => {
  browser = await chromium.launch({ headless: true });
  server = createServer((req, res) => {
    const host = new URL(req.url, 'http://x').searchParams.get('site') ?? '';
    hits.push(`${host}${new URL(req.url, 'http://x').pathname}`);
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      res.end(host === 'robots.example' ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nDisallow: /cart/add\n');
      return;
    }
    if (host === 'denied.example') {
      res.statusCode = 403;
      res.end('denied');
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(pages[host] ?? 'not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('live sweep over fixture sites: robots, blocked, loaded none and a false show, text-free rows', async () => {
  const { code } = await bundleReader({ frameDomains: [], splitDomains: [] });
  const sites = Object.keys(pages).map((domain) => ({ domain, set: domain === 'cart.example' ? 'store' : 'non-store' }));
  // The site is carried in a query parameter the fixture server reads back; the page's path stays "/".
  const urlFor = (domain) => `${origin}/?site=${domain}`;
  const robotsUrlFor = (pageUrl) => `${origin}/robots.txt?site=${new URL(pageUrl).searchParams.get('site')}`;
  const rows = await sweep(browser, sites, { code, urlFor, robotsUrlFor, concurrency: 2, timeoutMs: 10_000, settleMs: 100 });
  const byDomain = Object.fromEntries(rows.map((r) => [r.domain, r]));
  assert.equal(byDomain['home.example'].status, 'loaded');
  assert.equal(byDomain['home.example'].page, 'none');
  assert.equal(byDomain['cart.example'].status, 'loaded');
  assert.equal(byDomain['cart.example'].page, 'cart');
  assert.equal(byDomain['wall.example'].status, 'blocked');
  assert.equal(byDomain['denied.example'].status, 'blocked');
  assert.equal(byDomain['denied.example'].reason, 'http-403');
  assert.equal(byDomain['robots.example'].status, 'robots-disallowed');
  assert.ok(!hits.some((h) => h.startsWith('robots.example/') && !h.endsWith('/robots.txt')), 'disallowed page never loaded');
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['domain', 'hinted', 'ms', 'page', 'reason', 'set', 'status', 'url']);
  assert.doesNotMatch(JSON.stringify(rows), /Welcome|Tents|Subtotal|Should never|Checking/);
  const s = summarizeLive(rows);
  assert.equal(s.store.falseShows.k, 1);
  assert.equal(s.nonStore.falseShows.k, 0);
  assert.deepEqual(s.all.status, { loaded: 2, blocked: 2, 'robots-disallowed': 1, error: 0 });
});
