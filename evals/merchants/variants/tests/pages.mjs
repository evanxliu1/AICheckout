// Synthetic pane-dom.2 exports and reader-labels.2 labels for the variant tests. No capture is read.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const STYLE_PROPS = [
  'display',
  'visibility',
  'opacity',
  'position',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration-line',
  'text-transform',
  'white-space',
  'direction',
  'unicode-bidi',
];
const DEF = {
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'font-size': '16px',
  'font-weight': '400',
  'font-style': 'normal',
  'text-decoration-line': 'none',
  'text-transform': 'none',
  'white-space': 'normal',
  direction: 'ltr',
  'unicode-bidi': 'normal',
};
export const sha = (s) => createHash('sha256').update(s).digest('hex');
export const H = (c) => c.repeat(64);

/** An element as pane-export.js records it; string children are text nodes. */
export function el(t, attrs = {}, children = [], { d = 'block', v = true, bx = true, k } = {}) {
  const c = children.map((x) => (typeof x === 'string' ? { x } : x));
  const node = { t, ...(Object.keys(attrs).length ? { a: attrs } : {}), d };
  if (k) node.k = k;
  if (c.some((x) => 'x' in x && x.x.trim() !== '')) {
    node.s = STYLE_PROPS.map((p) => (p === 'display' ? d : DEF[p]));
    node.b = [10, 10, 100, 20];
    node.v = v;
    node.bx = bx;
  }
  if (c.length) node.c = c;
  return node;
}
const span = (cls, text, opts) => el('span', cls ? { class: cls } : {}, [text], { d: 'inline', ...opts });
export const row = (cls, label, amount) =>
  el('div', { class: `row ${cls}` }, [span('label', label), ' ', span('value', amount)]);

/** A cart page: items [[name, price]], summary rows [[class, label, amount]], extra head and body nodes. */
export function cartPage({
  lang = 'en',
  items = [['Blue mug', '£20.00']],
  rows = [
    ['subtotal', 'Subtotal', '£20.00'],
    ['shipping', 'Shipping', '£4.00'],
    ['total', 'Total', '£24.00'],
  ],
  head = [el('meta', { property: 'og:price:currency', content: 'GBP' }, [], { d: 'none' })],
  body = [],
  summaryExtra = [],
} = {}) {
  const root = el('html', { lang }, [
    el(
      'head',
      {},
      [
        el('title', {}, ['Cart'], { d: 'none' }),
        el(
          'style',
          {},
          ['.summary .total{font-weight:700} #summary{padding:4px} .row.total .value{color:#111}'],
          {
            d: 'none',
          },
        ),
        ...head,
      ],
      { d: 'none' },
    ),
    el('body', { class: 'page cart-page' }, [
      el('header', { class: 'site-header' }, [
        el('a', { class: 'skip', href: '#summary' }, ['Skip to summary'], { d: 'inline' }),
      ]),
      el('main', { id: 'main', class: 'cart' }, [
        el(
          'div',
          { class: 'cart-items' },
          items.map(([name, price]) =>
            el('div', { class: 'item line' }, [span('name', name), ' ', span('price', price)]),
          ),
        ),
        el('label', { for: 'main', class: 'sr' }, ['Cart'], { d: 'inline' }),
      ]),
      el('aside', { id: 'summary', class: 'summary order-summary', 'aria-labelledby': 'sum-h' }, [
        el('h2', { id: 'sum-h' }, ['Order summary']),
        ...rows.map(([cls, label, amount]) => row(cls, label, amount)),
        ...summaryExtra,
      ]),
      ...body,
    ]),
  ]);
  return {
    format: 'pane-dom.2',
    url: 'https://shop.example/cart',
    lang,
    title: 'Cart',
    viewport: [1280, 900],
    scroll: [1280, 2000],
    styleProps: STYLE_PROPS,
    root,
    nodes: 0,
    truncated: false,
    shadowRoots: 0,
    iframes: [],
  };
}

/** A final reader-labels.2 label for a real page-state. */
export function label(id, over = {}) {
  const [, state] = id.split('/');
  return {
    id,
    split: 'development',
    state,
    origin: 'action',
    snapshotSha256: H('a'),
    domSha256: H('b'),
    readable: 'top-frame',
    displayed: [
      { kind: 'subtotal', amountMinor: 2000, currency: 'GBP' },
      { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
    ],
    expected: { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
    currencyEvidence: 'c-symbol',
    currencyConflict: false,
    observedTags: [],
    confidence: 'high',
    notes: '',
    ...over,
  };
}
export const nullExpected = (reason, over = {}) => ({
  expected: null,
  expectedReason: reason,
  currencyEvidence: undefined,
  currencyConflict: undefined,
  ...over,
});

/** Write pages as collect-pane-exports.mjs leaves them and a final labels file; labels get the export SHA-256. */
export function writeSplit(dir, pages, split = 'development') {
  const data = path.join(dir, 'pane');
  const labels = [];
  for (const { doc, label: l } of pages) {
    const [domain, state] = l.id.split('/');
    const d = path.join(data, domain, state);
    mkdirSync(d, { recursive: true });
    const text = JSON.stringify(doc);
    writeFileSync(path.join(d, 'dom.json'), text);
    labels.push({ ...l, split, domSha256: sha(text) });
  }
  const file = path.join(dir, `final-${split}.json`);
  writeFileSync(
    file,
    JSON.stringify(JSON.parse(JSON.stringify({ schema: 'reader-labels.2', role: 'final', split, labels }))),
  );
  return { data, file };
}

/** Text nodes in document order: [{x, hidden}] (hidden: under display none, v false or a clip). */
export function texts(doc) {
  const out = [];
  const walk = (n, hidden) => {
    if ('x' in n) return void out.push({ x: n.x, hidden });
    const h = hidden || n.d === 'none' || n.v === false || n.bx === false;
    for (const c of [...(n.sr ?? []), ...(n.c ?? [])]) walk(c, h);
  };
  walk(doc.root, false);
  return out;
}
export const visibleText = (doc) =>
  texts(doc)
    .filter((t) => !t.hidden && t.x.trim())
    .map((t) => t.x)
    .join(' ');
/** Every element with a predicate, in document order. */
export function find(doc, pred) {
  const out = [];
  const walk = (n) => {
    if ('x' in n) return;
    if (pred(n)) out.push(n);
    for (const c of [...(n.sr ?? []), ...(n.c ?? [])]) walk(c);
  };
  walk(doc.root);
  return out;
}
export const textOf = (n) => ('x' in n ? n.x : [...(n.sr ?? []), ...(n.c ?? [])].map(textOf).join(''));
