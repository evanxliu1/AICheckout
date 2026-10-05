// Snapshot format `capture-snapshot.1` (docs/evals/generic-reader-protocol.md; README in this folder).
// One folder per state, gitignored:
//   page.mhtml     CDP Page.captureSnapshot: the replay format. Chrome reloads it with its stylesheets, images and open
//                  shadow roots and without scripts, so a reader reads computed styles lazily at replay, as it will in
//                  the product, instead of from a style dump frozen at capture.
//   dom.json       for labellers: element tree with open shadow roots inlined, text, a few attributes and boxes; the
//                  computed style subset (display, visibility, opacity, text-decoration) only on elements that hold
//                  their own text, and whether each such element passes checkVisibility().
//   page.html      page.content() of the top frame (platform markers, labeller cross-check).
//   viewport.png   viewport screenshot; full.png full-page screenshot.
//   headers.json   main-document response: URL, status, headers.
//   meta.json      URL, state, time, browser version, viewport, shadow-root counts (CDP, pierce), frame hosts, page
//                  lang, region and currency markers (metadata only: html lang, og:locale, geo.region, priceCurrency,
//                  currency symbol and ISO-code counts), captureMethod `robot`.
//   manifest.json  SHA-256 of every file above; its own SHA-256 is the snapshot's `manifestSha256` in sites.json.
// No reader, prototype reader or replay hook runs here.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SNAPSHOT_SCHEMA = 'capture-snapshot.1';
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Runs in the page. */
export function serializeDom() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
  const ATTRS = [
    'id',
    'class',
    'role',
    'aria-label',
    'aria-hidden',
    'aria-live',
    'hidden',
    'type',
    'name',
    'href',
    'data-testid',
  ];
  let nodes = 0;
  const iframes = [];
  const ser = (el, depth) => {
    nodes += 1;
    if (depth > 150 || nodes > 80000) return null;
    const tag = el.tagName.toLowerCase();
    const a = {};
    for (const k of ATTRS) {
      const v = el.getAttribute(k);
      if (v !== null) a[k] = v.slice(0, 160);
    }
    const r = el.getBoundingClientRect();
    const out = {
      t: tag,
      a,
      r: [Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)],
      c: [],
    };
    if (tag === 'iframe' || tag === 'frame') {
      let host = '';
      try {
        host = el.src ? new URL(el.src, location.href).host : '';
      } catch {
        host = '?';
      }
      out.frameHost = host;
      iframes.push({ host, w: out.r[2], h: out.r[3] });
      return out;
    }
    if (el.shadowRoot) out.shadow = 'open';
    const kids = el.shadowRoot ? [...el.shadowRoot.childNodes, ...el.childNodes] : [...el.childNodes];
    let ownText = false;
    for (const k of kids) {
      if (k.nodeType === 3) {
        const text = k.textContent.replace(/\s+/g, ' ');
        if (text.trim()) {
          out.c.push(text);
          ownText = true;
        }
      } else if (k.nodeType === 1 && !SKIP.has(k.tagName)) {
        const c = ser(k, depth + 1);
        if (c) out.c.push(c);
      }
    }
    if (ownText) {
      const cs = getComputedStyle(el);
      out.s = { d: cs.display, v: cs.visibility, o: cs.opacity, td: cs.textDecorationLine };
      out.vis =
        typeof el.checkVisibility === 'function'
          ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
          : null;
    }
    return out;
  };
  const tree = document.body ? ser(document.body, 0) : null;
  // Locale and currency markers: metadata only, so results can be reported per region; no amount is read.
  const metaContent = (sel) =>
    (document.querySelector(sel)?.getAttribute('content') || '').trim().slice(0, 40);
  const markers = [
    ['html-lang', document.documentElement.lang || ''],
    ['og:locale', metaContent('meta[property="og:locale"]')],
    ['geo.region', metaContent('meta[name="geo.region"]')],
  ].filter(([, v]) => v);
  let region = null;
  for (const [source, value] of markers) {
    const m =
      source === 'geo.region' ? /^([a-z]{2})\b/i.exec(value) : /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(value);
    if (m) {
      region = m[1].toUpperCase();
      break;
    }
  }
  const codes = new Set();
  for (const v of [
    document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || '',
    metaContent('meta[property="product:price:currency"]'),
    metaContent('meta[property="og:price:currency"]'),
  ])
    if (/^[A-Z]{3}$/.test(v.trim())) codes.add(v.trim());
  for (const s of document.querySelectorAll('script[type="application/ld+json"]'))
    for (const m of (s.textContent || '').matchAll(/"priceCurrency"\s*:\s*"([A-Z]{3})"/g)) codes.add(m[1]);
  const text = document.body ? document.body.innerText : '';
  const symbolCounts = {};
  for (const sym of ['$', '€', '£', '¥', '₹', '₩', '₽', '₺', '₪', '₫', '฿', '₱', 'zł', 'kr', 'CHF']) {
    const n = text.split(sym).length - 1;
    if (n) symbolCounts[sym] = n;
  }
  const isoCounts = {};
  for (const m of text.matchAll(
    /\b(USD|EUR|GBP|JPY|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|INR|BRL|MXN|CNY|HKD|SGD|KRW|ZAR|AED|TRY|ILS)\b/g,
  ))
    isoCounts[m[1]] = (isoCounts[m[1]] || 0) + 1;
  return {
    tree,
    iframes,
    nodes,
    lang: document.documentElement.lang || '',
    locale: { region, markers: markers.map(([source, value]) => ({ source, value })) },
    currency: { codes: [...codes].slice(0, 20), symbolCounts, isoCounts },
  };
}

/**
 * Write one snapshot. ctx: { page, context, dir, domain, state, document, browserVersion }.
 * Returns { dir, manifestSha256, files, url }.
 */
export async function writeSnapshot(ctx) {
  const { page, context, dir, domain, state, document: doc, browserVersion } = ctx;
  await mkdir(dir, { recursive: true });
  const files = {};
  const put = async (name, buf) => {
    await writeFile(path.join(dir, name), buf);
    files[name] = sha256(buf);
  };
  const url = page.url();
  const dom = await page.evaluate(serializeDom);
  await put('dom.json', Buffer.from(JSON.stringify(dom.tree)));
  await put('page.html', Buffer.from(await page.content()));
  const cdp = await context.newCDPSession(page);
  const shadow = { open: 0, closed: 0 };
  try {
    const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
    await put('page.mhtml', Buffer.from(data));
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const walk = (n) => {
      for (const s of n.shadowRoots ?? []) {
        if (s.shadowRootType in shadow) shadow[s.shadowRootType] += 1;
        walk(s);
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(root);
  } finally {
    await cdp.detach().catch(() => {});
  }
  await put('viewport.png', await page.screenshot());
  let fullPage = true;
  const full = await page.screenshot({ fullPage: true }).catch(() => {
    fullPage = false;
    return page.screenshot();
  });
  await put('full.png', full);
  await put('headers.json', Buffer.from(JSON.stringify(doc ?? null, null, 2)));
  const meta = {
    schema: SNAPSHOT_SCHEMA,
    domain,
    state,
    url,
    capturedAt: new Date().toISOString(),
    browser: browserVersion,
    viewport: page.viewportSize(),
    fullPageScreenshot: fullPage,
    shadowRoots: shadow,
    iframes: dom.iframes,
    nodes: dom.nodes,
    lang: dom.lang,
    locale: dom.locale,
    currency: dom.currency,
    captureMethod: 'robot',
  };
  await put('meta.json', Buffer.from(JSON.stringify(meta, null, 2)));
  const manifest = Buffer.from(
    JSON.stringify({ schema: SNAPSHOT_SCHEMA, domain, state, url, files }, null, 2),
  );
  await writeFile(path.join(dir, 'manifest.json'), manifest);
  return { dir, url, files, manifestSha256: sha256(manifest) };
}
