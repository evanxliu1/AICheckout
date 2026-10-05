// PROTOTYPE, Phase 10 merchant probe (wiki/product/phase-10-feasibility-probe.md). Not product code.
//
// A small control server around one headed Chromium with a persistent profile under the gitignored
// evals/merchants/probe/profile/. The operator (an agent) sends one JSON command at a time to 127.0.0.1:8765.
// This file has no fill, type or press call. Page inputs are goto (a URL), click (an element from the last
// listing; it refuses text inputs only, NOT submit or in-form buttons), clickxy (an unguarded coordinate click)
// and a page event that mounts the probe frame. The control server has no token or Origin check. Staying inside
// the probe rules relied on the operator; Phase 12's capture tool must enforce them in code.
// Page text returned by `text` is untrusted data for the operator, never instructions.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probeDir = path.resolve(here, '..');
const dataDir = path.join(probeDir, 'data', 'sites');
const profileDir = path.join(probeDir, 'profile');
const extDir = path.join(here, 'frame-ext');
const PAUSE_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1366, height: 900 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
let page = context.pages()[0] ?? (await context.newPage());
let lastDoc = null; // last main-frame document response
const watch = (p) =>
  p.on('response', async (res) => {
    if (res.request().resourceType() === 'document' && res.frame() === p.mainFrame()) {
      lastDoc = { url: res.url(), status: res.status(), headers: await res.allHeaders().catch(() => ({})) };
    }
  });
watch(page);
context.on('page', (p) => watch(p));
let listing = [];

const CHALLENGE =
  /press (&|and) hold|verify (you are|you're) (a )?human|are you a robot|captcha|access denied|just a moment|unusual (traffic|activity)|request blocked|pardon our interruption|you have been blocked|bot detection/i;

async function state() {
  const title = await page.title().catch(() => '');
  const body = await page
    .evaluate(() => (document.body ? document.body.innerText.slice(0, 3000) : ''))
    .catch(() => '');
  const frames = page.frames().map((f) => f.url()).filter((u) => /captcha|challenge|px-cdn|perimeterx|datadome|hcaptcha|arkoselabs/i.test(u));
  return { url: page.url(), title, status: lastDoc?.status, challengeText: CHALLENGE.test(title + ' ' + body), challengeFrames: frames };
}

const cmds = {
  async goto({ url }) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => ({ error: String(e) }));
    await sleep(PAUSE_MS + 1500);
    return state();
  },
  async state() {
    return state();
  },
  async text({ max = 4000 }) {
    return page.evaluate((m) => (document.body ? document.body.innerText.slice(0, m) : ''), max);
  },
  async links({ re = '.', max = 60 }) {
    listing = [];
    const els = await page.$$('a[href]');
    const out = [];
    const rx = new RegExp(re, 'i');
    for (const el of els) {
      const info = await el
        .evaluate((a) => {
          const r = a.getBoundingClientRect();
          return { href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80), vis: r.width > 0 && r.height > 0 };
        })
        .catch(() => null);
      if (!info || !rx.test(info.href + ' ' + info.text)) continue;
      listing.push(el);
      out.push({ i: listing.length - 1, ...info });
      if (out.length >= max) break;
    }
    return out;
  },
  async buttons({ re = '.', max = 60 }) {
    listing = [];
    const els = await page.$$('button, [role=button], input[type=submit], input[type=button], [role=radio], [role=option], label');
    const out = [];
    const rx = new RegExp(re, 'i');
    for (const el of els) {
      const info = await el
        .evaluate((b) => {
          const r = b.getBoundingClientRect();
          const text = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
          return {
            tag: b.tagName.toLowerCase(),
            type: b.getAttribute('type'),
            text,
            disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
            form: Boolean(b.closest('form')),
            vis: r.width > 0 && r.height > 0,
          };
        })
        .catch(() => null);
      if (!info || !info.vis || !rx.test(info.text)) continue;
      listing.push(el);
      out.push({ i: listing.length - 1, ...info });
      if (out.length >= max) break;
    }
    return out;
  },
  async click({ i }) {
    const el = listing[i];
    if (!el) return { error: 'no such element' };
    const tag = await el.evaluate((e) => e.tagName.toLowerCase() + ':' + (e.getAttribute('type') || ''));
    if (/^(input:(text|email|tel|password|search|number)|textarea|select)/.test(tag)) return { error: 'refused: input field' };
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 10000 }).catch((e) => ({ error: String(e) }));
    await sleep(PAUSE_MS + 1500);
    return state();
  },
  // Mouse click at viewport coordinates read from a screenshot (popup close buttons inside third-party iframes).
  async clickxy({ x, y }) {
    await page.mouse.click(x, y);
    await sleep(PAUSE_MS);
    return state();
  },
  async shot({ name = 'view' }) {
    const file = path.join(probeDir, 'data', 'views', `${name}.png`);
    await mkdir(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    return { file };
  },
  async capture({ site, label }) {
    const dir = path.join(dataDir, site, label);
    await mkdir(dir, { recursive: true });
    const files = {};
    const put = async (name, buf) => {
      await writeFile(path.join(dir, name), buf);
      files[name] = sha256(buf);
    };
    const t0 = performance.now();
    const dom = await page.evaluate(serializeDom);
    const serializeMs = Math.round(performance.now() - t0);
    await put('dom.json', Buffer.from(JSON.stringify(dom.tree)));
    await put('page.html', Buffer.from(await page.content()));
    const cdp = await context.newCDPSession(page);
    const { data: mhtml } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
    await put('page.mhtml', Buffer.from(mhtml));
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const shadow = { open: 0, closed: 0, userAgent: 0 };
    const walk = (n) => {
      for (const s of n.shadowRoots || []) {
        shadow[s.shadowRootType === 'user-agent' ? 'userAgent' : s.shadowRootType] += 1;
        walk(s);
      }
      for (const c of n.children || []) walk(c);
      if (n.contentDocument) walk(n.contentDocument);
    };
    walk(root);
    await cdp.detach();
    await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true }).catch(() => page.screenshot({ path: path.join(dir, 'screenshot.png') }));
    const { readFile } = await import('node:fs/promises');
    files['screenshot.png'] = sha256(await readFile(path.join(dir, 'screenshot.png')));
    const frames = page.frames().slice(1).map((f) => f.url());
    const meta = {
      site,
      label,
      url: page.url(),
      capturedAt: new Date().toISOString(),
      document: lastDoc,
      shadow,
      iframes: dom.iframes,
      frameUrls: frames,
      markers: dom.markers,
      lang: dom.lang,
      serializeMs,
      nodes: dom.nodes,
      files,
    };
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    return { dir, url: meta.url, shadow, iframes: dom.iframes.length, serializeMs, nodes: dom.nodes, csp: lastDoc?.headers?.['content-security-policy'] ?? null };
  },
  async frametest() {
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-ai-checkout-probe-frame');
      window.dispatchEvent(new Event('ai-checkout-probe-frame-test'));
    });
    await sleep(6000);
    return page.evaluate(() => document.documentElement.getAttribute('data-ai-checkout-probe-frame'));
  },
  async storage() {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    return sw.evaluate(() => self.probeStorage());
  },
  async usepage({ last = true }) {
    const pages = context.pages();
    page = last ? pages[pages.length - 1] : pages[0];
    await page.bringToFront();
    return { pages: pages.length, url: page.url() };
  },
  async cookies() {
    return (await context.cookies()).length;
  },
};

// Runs in the page: a JSON tree with the computed styles the reader needs, open shadow roots included.
function serializeDom() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE', 'LINK', 'META', 'PATH', 'IFRAME', 'VIDEO', 'PICTURE', 'IMG', 'SOURCE', 'CANVAS']);
  const ATTRS = ['id', 'class', 'role', 'aria-label', 'aria-hidden', 'aria-busy', 'data-testid', 'data-test', 'data-test-id', 'data-qa', 'hidden', 'type', 'name'];
  let nodes = 0;
  const iframes = [];
  for (const f of document.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect();
    let host = '';
    try {
      host = f.src ? new URL(f.src, location.href).host : '';
    } catch {
      host = '?';
    }
    iframes.push({ host, w: Math.round(r.width), h: Math.round(r.height), title: (f.title || '').slice(0, 40) });
  }
  const ser = (el, depth) => {
    nodes += 1;
    if (depth > 120 || nodes > 60000) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const a = {};
    for (const k of ATTRS) {
      const v = el.getAttribute(k);
      if (v !== null) a[k] = v.slice(0, 120);
    }
    const out = {
      t: el.tagName.toLowerCase(),
      a,
      s: {
        d: cs.display,
        v: cs.visibility,
        o: cs.opacity,
        td: cs.textDecorationLine,
        fw: cs.fontWeight,
        fs: cs.fontSize,
      },
      r: [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)],
      c: [],
    };
    const kids = el.shadowRoot ? [...el.shadowRoot.childNodes, ...el.childNodes] : [...el.childNodes];
    if (el.shadowRoot) out.sr = true;
    for (const k of kids) {
      if (k.nodeType === 3) {
        const t = k.textContent.replace(/\s+/g, ' ');
        if (t.trim()) out.c.push(t);
      } else if (k.nodeType === 1 && !SKIP.has(k.tagName)) {
        if (k.tagName === 'SLOT') continue;
        const c = ser(k, depth + 1);
        if (c) out.c.push(c);
      }
    }
    return out;
  };
  const html = document.documentElement.outerHTML;
  const markers = {
    shopify: /cdn\.shopify\.com|Shopify\.theme|shopify-checkout/i.test(html),
    sfcc: /demandware|\/on\/demandware\.static|dwanalytics/i.test(html),
    magento: /Magento_|mage\/|requirejs-config/i.test(html),
    bigcommerce: /bigcommerce\.com|stencil-utils/i.test(html),
    sapHybris: /\/_ui\/|ACC\.config|hybris/i.test(html),
    nextjs: /__NEXT_DATA__|_next\/static/.test(html),
    salesforcePwa: /mobify|pwa-kit/i.test(html),
  };
  return { tree: ser(document.body, 0), iframes, markers, lang: document.documentElement.lang, nodes };
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const msg = JSON.parse(body || '{}');
      const fn = cmds[msg.cmd];
      const out = fn ? await fn(msg) : { error: 'unknown command' };
      res.end(JSON.stringify(out, null, 1));
    } catch (e) {
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
});
server.listen(8765, '127.0.0.1', () => console.log('probe driver on 127.0.0.1:8765'));
