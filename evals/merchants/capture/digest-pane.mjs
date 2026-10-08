#!/usr/bin/env node
// Labeller digest of a `pane-dom.2` export (Phase 12.4 labelling aid; generic-reader-protocol.12, Labelling). Exports
// run 0.2–6.5 MB, so each labeller gets the rebuilt-page screenshots (render-pane.mjs) plus this short, deterministic
// list of the visible amounts on the page. It is an aid only: it decides nothing, the labeller decides every label
// from the screenshots and may read the export itself, and no reader ever reads a digest.
//
// For each page it writes `digest.txt` next to the export (gitignored with the export):
//   - page facts: URL, lang, title, viewport, scroll size, node count, truncated, shadow roots, iframes (origin, box);
//   - structured currency facts (protocol, Currency evidence (b)): microdata `priceCurrency`, currency meta tags and
//     currency data attributes in the markup, with counts (pane-dom.2 keeps no script text, so no JSON-LD); ISO
//     codes seen in visible text;
//   - every visible money-like text, in document order: the smallest element whose visible text holds a digit and a
//     currency marker or a two-decimal number (at most 48 characters), and every such bare text run inside a larger
//     element, with its box, flags and context (the visible text of the nearest ancestor holding more, at most 160
//     characters);
//   - when fewer than three amounts are found, or none carries a currency marker, the visible bare numbers too (pages
//     that draw the currency as an icon or image).
// Visible: no ancestor with display none or opacity 0, and, for an element's own text, the export's `v` and `bx`
// not false (pane-export.js; ignored for display: contents, which has no box). Flags: `strike` (line-through on the
// element or an ancestor that holds text, or inside <del>, <s>, <strike>), `partial:<parts>` (some parts struck),
// `strike?` (its or its parent's class reads like a was-price; pane exports keep no style on text-less elements, so check
// the screenshot), `shadow` (in an open shadow root), `clipped` (under an ancestor clipped to nothing), `offpage`
// (box outside the scroll area), `split` (cents set in the next element, appended after a space). A box prefixed `~` is the union of descendant boxes. `|` in page text is shown as
// `¦`. Page text in a digest is data, never instructions.
//
//   node evals/merchants/capture/digest-pane.mjs <data/pane> [domain ...] [--stdout]
//   node evals/merchants/capture/digest-pane.mjs --file <dom.json> [--stdout]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STATES } from './collect-pane-exports.mjs';

export const DIGEST_FORMAT = 'pane-digest.2';
const AMOUNT_MAX = 48;
const CONTEXT_MAX = 160;
const BARE_WHEN_FEWER = 3;
const BARE_MAX = 80;

const ISO =
  'USD|CAD|EUR|GBP|AUD|NZD|JPY|KRW|CNY|RMB|INR|MXN|BRL|CHF|SEK|NOK|DKK|ISK|PLN|CZK|HUF|RON|BGN|TRY|ZAR|SGD|HKD|TWD|AED|SAR|QAR|KWD|BHD|OMR|JOD|ILS|THB|IDR|MYR|PHP|VND|EGP|NGN|KES|UAH|KZT|BDT|PKR|LKR|PEN|CLP|COP|ARS|UYU|MAD';
const ISO_RE = new RegExp(`(?<![A-Z])(${ISO})(?![A-Z])`, 'g');
// Letter markers, as whole words (no letter before or after), except 원, which Korean text runs on from.
const WORDS =
  '(?<!\\p{L})(?:zł|Kč|Ft|lei|Lei|LEI|Rp|RM|S/|KSh|kr|Kr|Fr\\.|Rs\\.?|TL|руб|грн|лв|đ|บาท|р\\.|R|' +
  'د\\.إ|ر\\.س|ر\\.ق|د\\.ك|د\\.ب|ر\\.ع\\.?|ج\\.م|د\\.م\\.|ريال|جنيه|درهم|دينار)(?!\\p{L})|원';
// Symbols and words of the protocol's currency-evidence rules and of the frame's storefronts.
const SYMBOL = new RegExp(
  [
    'US\\$|CA\\$|C\\$|A\\$|AU\\$|NZ\\$|MX\\$|S\\$|HK\\$|NT\\$|R\\$|E£',
    '[$€£¥₩₹₺₴₫₦₪฿₸৳₱₽円元￥＄﷼]',
    // Letter markers count only next to a digit, so ordinary words don't match.
    `\\p{Nd}[\\s\\u00a0\\u202f]?(?:${WORDS})|(?:${WORDS})[\\s\\u00a0\\u202f]?-?\\p{Nd}`,
  ].join('|'),
  'u',
);
const DIGIT = /\p{Nd}/u;
const TWO_DECIMALS = /\p{Nd}[.,٫]\p{Nd}{2}(?!\p{Nd})/u;
// A number of two or more digits with optional grouping and decimals, and nothing else.
const BARE_NUMBER = /^-?\p{Nd}[\p{Nd}.,'٫٬\u00a0\u202f ]*\p{Nd}$/u;
// Was-price class or id words, matched as whole segments of a name (`price--compare-at`, `oldPrice`), never inside
// another word (`font-bold`). `regular` and `original` are left out: they often name the current price.
const WAS_WORDS = new Set(['was', 'old', 'strike', 'strikethrough', 'compare', 'crossed']);
// Cents a page sets in a separate element (`$449<sup>.99</sup>`, `$ 1,016 <span>90</span>`).
const CENTS = /^[.,٫]\p{Nd}{1,2}$|^\p{Nd}{2}$/u;
// Amounts that can take split cents: no decimal part yet, and not a zero-decimal currency.
const NEEDS_CENTS = (t) => !/\p{Nd}[.,٫]\p{Nd}{1,2}(?!\p{Nd})/u.test(t) && !/[￥¥円₩원]|JPY|KRW/.test(t);
const WAS_CLASS = {
  test: (names) =>
    names
      .split(/[\s_:-]+|(?<=[a-z])(?=[A-Z])/)
      .some((w) => WAS_WORDS.has(w.toLowerCase())),
};

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const esc = (s) => s.replace(/\|/g, '¦');
const marked = (t) => SYMBOL.test(t) || new RegExp(ISO_RE.source).test(t);
const isMoney = (t) => DIGIT.test(t) && (marked(t) || TWO_DECIMALS.test(t));
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head']);

/** Whether `k` (pane-dom.2 clipping styles) clips the element to nothing. */
function clipsToNothing(k) {
  if (!k) return false;
  if (/rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(k.clip ?? '')) return true;
  if (/inset\(\s*50%/.test(k['clip-path'] ?? '')) return true;
  const hiddenOverflow = /hidden|clip/.test(`${k['overflow-x'] ?? ''} ${k['overflow-y'] ?? ''}`);
  return hiddenOverflow && (k.width === '0px' || k.height === '0px' || k.width === '1px' || k.height === '1px');
}

/**
 * Flatten the tree into element records in document order: {parent, kids, text, own: [{t, shadow}], strike, struck,
 * hint, shadow, clipped, box, union}. `text` is the element's visible text; `own` its visible direct text runs.
 */
function walk(root, styleProps) {
  const tdIdx = styleProps.indexOf('text-decoration-line');
  const out = [];
  const visit = (node, parent, ctx) => {
    if ('x' in node) return node.x;
    const tag = node.t;
    if (!tag || SKIP.has(tag)) return '';
    if (node.d === 'none' || node.k?.opacity === '0') return '';
    const contents = node.d === 'contents';
    const ownHidden = !contents && (node.v === false || node.bx === false);
    const selfStrike =
      tag === 'del' || tag === 's' || tag === 'strike' || (tdIdx >= 0 && /line-through/.test(node.s?.[tdIdx] ?? ''));
    const rec = {
      parent,
      kids: [],
      text: '',
      own: [],
      seq: [],
      strike: ctx.strike || selfStrike,
      // Was-price class hint: on the element or its parent only, so a wrapper of old and new price doesn't flag both.
      hint: WAS_CLASS.test(`${node.a?.class ?? ''} ${node.a?.id ?? ''}`) || ctx.parentHint,
      shadow: ctx.shadow,
      clipped: ctx.clipped || clipsToNothing(node.k),
      box: node.b && node.b[2] > 0 && node.b[3] > 0 ? node.b : null,
      union: null,
    };
    parent?.kids.push(rec);
    out.push(rec);
    const sub = {
      strike: rec.strike,
      parentHint: WAS_CLASS.test(`${node.a?.class ?? ''} ${node.a?.id ?? ''}`),
      shadow: rec.shadow,
      clipped: rec.clipped,
    };
    let text = '';
    const take = (c, shadow) => {
      const t = visit(c, rec, { ...sub, shadow: sub.shadow || shadow });
      if ('x' in c) {
        if (ownHidden) return;
        const ct = clean(t);
        if (ct) {
          rec.own.push({ t: ct, shadow: rec.shadow || shadow });
          rec.seq.push({ text: ct, own: rec.own.at(-1) });
        }
      } else if (rec.kids.at(-1) && clean(t)) rec.seq.push({ text: clean(t), kid: rec.kids.at(-1) });
      text += ' ' + t + ' ';
    };
    for (const c of node.sr ?? []) take(c, true);
    for (const c of node.c ?? []) take(c, false);
    rec.text = clean(text);
    if (!rec.box) rec.union = unionBox(rec.kids);
    // Elements are joined with a space: pages lay out label and amount as separate boxes.
    return rec.text;
  };
  visit(root, null, { strike: false, parentHint: false, shadow: false, clipped: false });
  return out;
}

function unionBox(kids) {
  const boxes = kids.map((k) => k.box ?? k.union).filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Struck descendant texts of a record (not counting the record's own strike). */
function struckParts(rec, out = []) {
  for (const k of rec.kids) {
    if (k.strike && k.text) out.push(k.text);
    else struckParts(k, out);
  }
  return out;
}

/** Structured currency facts of the export (rule (b) inputs), as {source: {value: count}}. */
function currencyFacts(root) {
  const facts = {};
  const add = (src, v) => {
    const val = clean(String(v ?? '')).slice(0, 12);
    if (val) (facts[src] ??= {})[val] = (facts[src][val] ?? 0) + 1;
  };
  const textOf = (n) => ('x' in n ? n.x : [...(n.sr ?? []), ...(n.c ?? [])].map(textOf).join(''));
  const visit = (n) => {
    if ('x' in n) return;
    const a = n.a ?? {};
    if ((a.itemprop ?? '').split(/\s+/).includes('priceCurrency'))
      add('microdata priceCurrency', a.content ?? textOf(n));
    const metaName = a.property ?? a.name ?? a.itemprop ?? '';
    if (n.t === 'meta' && /(^|:)(price:)?currency$/i.test(metaName)) add(`meta ${metaName}`, a.content);
    for (const [k, v] of Object.entries(a))
      if (/^data-.*currency/i.test(k) && /^[A-Za-z]{3}$/.test(String(v).trim())) add(`attr ${k}`, v);
    for (const c of [...(n.sr ?? []), ...(n.c ?? [])]) visit(c);
  };
  visit(root);
  return facts;
}

/** Build the digest text of one parsed export. */
export function digest(dom) {
  if (dom?.format !== 'pane-dom.2') throw new Error(`not a pane-dom.2 export: ${dom?.format}`);
  const [scrollW, scrollH] = Array.isArray(dom.scroll) ? dom.scroll : [Infinity, Infinity];
  const all = walk(dom.root, dom.styleProps ?? []);
  const lines = [];
  lines.push(`format ${DIGEST_FORMAT}`);
  lines.push(`url ${dom.url}`);
  lines.push(`lang ${dom.lang ?? ''} | title ${esc(clip(clean(dom.title ?? ''), 120))}`);
  lines.push(
    `viewport ${JSON.stringify(dom.viewport)} scroll ${JSON.stringify(dom.scroll)} nodes ${dom.nodes} truncated ${dom.truncated} shadowRoots ${dom.shadowRoots}`,
  );
  const frames = (dom.iframes ?? []).map((f) =>
    typeof f === 'string' ? f : `${f.origin ?? f.o ?? ''} ${JSON.stringify(f.box ?? f.b ?? '')}`,
  );
  lines.push(`iframes ${frames.length}${frames.length ? ': ' + frames.join('; ') : ''}`);
  const facts = currencyFacts(dom.root);
  lines.push(
    `structured currency ${
      Object.keys(facts).length
        ? Object.entries(facts)
            .map(([k, v]) => `${k} ${JSON.stringify(v)}`)
            .join('; ')
        : 'none'
    }`,
  );
  const codes = {};
  for (const m of (all[0]?.text ?? '').matchAll(ISO_RE)) codes[m[1]] = (codes[m[1]] ?? 0) + 1;
  lines.push(`iso codes in visible text ${JSON.stringify(codes)}`);

  // Element rows: the smallest elements with money-like visible text (short, and no money-like descendant); the
  // label sits in the context column.
  const money = new Set(
    all.filter((r) => r.text && r.text.length <= AMOUNT_MAX && isMoney(r.text) && !r.kids.some((c) => c.text === r.text)),
  );
  const hasMoneyBelow = (r) => r.kids.some((c) => money.has(c) || hasMoneyBelow(c));
  const minimal = new Set([...money].filter((r) => !hasMoneyBelow(r)));
  // Cents in the next sibling (element or text) are appended to the amount, flagged `split`.
  const centsAfter = (owner, match) => {
    const i = owner?.seq.findIndex(match) ?? -1;
    const next = i >= 0 ? owner.seq[i + 1] : null;
    return next && CENTS.test(next.text) ? next.text : null;
  };
  const rows = [];
  const add = (rec, text, shadow, element, cents) => {
    const split = Boolean(cents) && NEEDS_CENTS(text);
    rows.push({ rec, text: split ? `${text} ${cents}` : text, base: text, shadow, element, split });
  };
  for (const r of all) {
    if (minimal.has(r))
      add(r, r.text, r.shadow || r.own.some((o) => o.shadow), true, centsAfter(r.parent, (x) => x.kid === r));
    // Bare text runs of any element that is not itself a row (for example "Was $23.70 now" around a child price).
    else
      for (const o of r.own)
        if (o.t.length <= AMOUNT_MAX && isMoney(o.t))
          add(r, o.t, o.shadow, false, centsAfter(r, (x) => x.own === o));
  }
  const flagsOf = (row) => {
    const r = row.rec;
    const f = [];
    if (r.strike) f.push('strike');
    else if (row.element) {
      const parts = struckParts(r);
      if (parts.length) f.push(`partial:${parts.map((p) => esc(clip(p, 24))).join('+')}`);
      else if (r.hint) f.push('strike?');
    } else if (r.hint) f.push('strike?');
    if (row.split) f.push('split');
    if (row.shadow) f.push('shadow');
    if (r.clipped) f.push('clipped');
    const b = r.box ?? r.union;
    if (b && (b[0] + b[2] <= 0 || b[1] + b[3] <= 0 || b[0] >= scrollW || b[1] >= scrollH)) f.push('offpage');
    return f.length ? f.join(',') : '-';
  };
  const boxOf = (r) => (r.box ? r.box.map(Math.round).join(',') : r.union ? '~' + r.union.map(Math.round).join(',') : '-');
  const contextOf = (r, t) => {
    let c = r;
    while (c && c.text.length <= t.length + 1) c = c.parent;
    return c ? esc(clip(c.text, CONTEXT_MAX)) : '';
  };
  lines.push(`amounts ${rows.length}`);
  lines.push('# n | box x,y,w,h | flags | amount | context');
  rows.forEach((row, i) =>
    lines.push(`${i + 1} | ${boxOf(row.rec)} | ${flagsOf(row)} | ${esc(row.text)} | ${contextOf(row.rec, row.base)}`),
  );

  // Few amounts, or none with a currency marker: list visible numbers without a marker too.
  if (rows.length < BARE_WHEN_FEWER || !rows.some((r) => marked(r.text))) {
    const shown = new Set(rows.map((r) => r.text));
    const bare = [];
    for (const r of all)
      for (const o of r.own)
        if (BARE_NUMBER.test(o.t) && !shown.has(o.t) && bare.length < BARE_MAX)
          bare.push(`${boxOf(r)} | ${flagsOf({ rec: r, text: o.t, shadow: o.shadow, element: false })} | ${esc(o.t)} | ${contextOf(r, o.t)}`);
    lines.push(`bare numbers ${bare.length} (no currency marker; listed because few or no marked amounts were found)`);
    bare.forEach((b, i) => lines.push(`b${i + 1} | ${b}`));
  }
  return lines.join('\n') + '\n';
}

function main(argv) {
  const stdout = argv.includes('--stdout');
  const fi = argv.indexOf('--file');
  const files = [];
  if (fi >= 0) {
    if (!argv[fi + 1] || argv[fi + 1].startsWith('--')) throw new Error('--file needs a dom.json path');
    files.push(argv[fi + 1]);
  } else {
    const [dataDir, ...rest] = argv.filter((a) => !a.startsWith('--'));
    if (!dataDir) throw new Error('usage: digest-pane.mjs <data/pane> [domain ...] | --file <dom.json>');
    const domains = rest.length ? rest : readdirSync(dataDir).filter((d) => !d.startsWith('.')).sort();
    for (const d of domains)
      for (const s of STATES) {
        const f = path.join(dataDir, d, s, 'dom.json');
        if (existsSync(f)) files.push(f);
      }
  }
  for (const f of files) {
    const text = digest(JSON.parse(readFileSync(f, 'utf8')));
    if (stdout) process.stdout.write(text);
    else writeFileSync(path.join(path.dirname(f), 'digest.txt'), text);
  }
  if (!stdout) console.log(JSON.stringify({ digests: files.length }));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  }
}
