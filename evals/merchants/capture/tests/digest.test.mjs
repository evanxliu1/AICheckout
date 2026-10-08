import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../digest-pane.mjs';

const STYLE_PROPS = [
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
const style = (td = 'none') => ['block', 'visible', '1', 'static', '', '', '', '', '', td, '', '', '', ''];
/** A text-bearing span as pane-export.js records it. */
const txt = (t, x, extra = {}) => ({
  t: 'span',
  d: 'inline',
  s: style(extra.td),
  b: [x, 10, 40, 14],
  v: true,
  bx: true,
  ...extra.n,
  c: [{ x: t }],
});
const div = (c, extra = {}) => ({ t: 'div', d: 'block', c, ...extra });
const page = (children, extra = {}) => ({
  format: 'pane-dom.2',
  url: 'https://shop.example/cart',
  lang: 'de',
  title: 'Warenkorb',
  viewport: [1024, 768],
  scroll: [1024, 2000],
  styleProps: STYLE_PROPS,
  nodes: 20,
  truncated: false,
  shadowRoots: 0,
  iframes: [],
  root: { t: 'html', d: 'block', c: [{ t: 'body', d: 'block', c: children }] },
  ...extra,
});
const rows = (d) =>
  d
    .split('\n')
    .filter((l) => /^\d+ \|/.test(l))
    .map((l) => {
      const [n, box, flags, amount, context] = l.split(' | ');
      return { n, box, flags, amount, context };
    });

test('lists visible amounts with context and leaves hidden ones out', () => {
  const d = digest(
    page([
      div([txt('Zwischensumme', 0), txt('12,99 €', 100)]),
      div([txt('99,00 €', 0)], { d: 'none' }),
      div([txt('3,00 €', 0, { n: { bx: false } })]),
      div([txt('4,00 €', 0, { n: { v: false } })]),
      div([txt('5,00 €', 0)], { k: { opacity: '0' } }),
      div([txt('Voordeel AAA batterijen', 0)]),
    ]),
  );
  const r = rows(d);
  assert.deepEqual(
    r.map((x) => x.amount),
    ['12,99 €'],
  );
  assert.equal(r[0].context, 'Zwischensumme 12,99 €');
  assert.doesNotMatch(d, /99,00|3,00|4,00|5,00/);
});

test('keeps a bare amount inside an element that is money-like but not a row', () => {
  // <strong>$449<sup>.99</sup><div>Was $549.99 Save $100.00</div></strong>
  const sp = (c, x) => ({ t: 'span', d: 'inline', s: style(), b: [x, 0, 80, 14], v: true, bx: true, c });
  const d = digest(
    page([
      { ...sp([{ x: '$449' }, txt('.99', 40), div([txt('Was $549.99 Save $100.00', 0)])], 0), t: 'strong' },
      div([sp([{ x: '$5.00 ' }, txt('$15.99 off', 50)], 0)]),
    ]),
  );
  const amounts = rows(d).map((x) => x.amount);
  assert.ok(amounts.includes('$449 .99'), amounts.join(' / '));
  assert.ok(amounts.includes('$5.00'), amounts.join(' / '));
  assert.ok(amounts.includes('Was $549.99 Save $100.00'));
});

test('flags strike, partial strike, was-price classes and <del>', () => {
  const d = digest(
    page([
      div([txt('19,99 €', 0, { td: 'line-through' })]),
      div([txt('R400', 0, { td: 'line-through' }), txt('R249', 50)]),
      div([{ t: 'del', d: 'inline', c: [txt('30,00 €', 0)] }]),
      div([txt('8,00 €', 0)], { a: { class: 'price--compare-at' } }),
    ]),
  );
  const r = rows(d);
  const by = (a) => r.find((x) => x.amount === a);
  assert.equal(by('19,99 €').flags, 'strike');
  assert.equal(by('R400').flags, 'strike');
  assert.equal(by('R249').flags, '-');
  assert.equal(by('30,00 €').flags, 'strike');
  assert.equal(by('8,00 €').flags, 'strike?');
});

test('reads open shadow roots, including direct text children', () => {
  const d = digest(
    page([
      { t: 'my-total', d: 'inline', sr: [txt('Total $12.00', 0)] },
      { t: 'my-price', d: 'inline', s: style(), b: [0, 30, 60, 14], v: true, bx: true, sr: [{ x: '₩12,900' }] },
    ]),
  );
  const r = rows(d);
  assert.ok(r.find((x) => x.amount === 'Total $12.00').flags.includes('shadow'));
  assert.ok(r.find((x) => x.amount === '₩12,900').flags.includes('shadow'));
});

test('display: contents keeps its text; clipped and off-page rows are flagged, not hidden', () => {
  const d = digest(
    page([
      { t: 'div', d: 'contents', v: false, bx: false, s: style(), c: [{ x: 'Summe 7,00 €' }] },
      div([txt('9,00 €', 0)], { k: { 'overflow-x': 'hidden', 'overflow-y': 'hidden', height: '0px' } }),
      div([txt('11,00 €', 5000, { n: { b: [5000, 10, 40, 14] } })]),
    ]),
  );
  const r = rows(d);
  assert.ok(r.some((x) => x.amount === 'Summe 7,00 €'));
  assert.equal(r.find((x) => x.amount === '9,00 €').flags, 'clipped');
  assert.equal(r.find((x) => x.amount === '11,00 €').flags, 'offpage');
});

test('locale markers, non-Latin digits and adjacency-only letter markers', () => {
  const d = digest(
    page([
      div([txt('49,000원', 0)]),
      div([txt('2.495 TL', 0)]),
      div([txt('￥1,280', 0)]),
      div([txt('EUR12', 0)]),
      div([txt('١٢٣٫٤٥', 0)]),
      div([txt('Total 99 ر.س', 0)]),
      div([txt('TLC 2 items', 0)]),
      div([txt('Lieferung 2 Tage', 0)]),
    ]),
  );
  const amounts = rows(d).map((x) => x.amount);
  for (const a of ['49,000원', '2.495 TL', '￥1,280', 'EUR12', '١٢٣٫٤٥', 'Total 99 ر.س']) assert.ok(amounts.includes(a), a);
  assert.ok(!amounts.includes('TLC 2 items'));
  assert.ok(!amounts.includes('Lieferung 2 Tage'));
});

test('bare numbers are listed when no amount carries a currency marker', () => {
  const d = digest(page([div([txt('Subtotal', 0), txt('89', 60)]), div([txt('12.50', 0)])]));
  assert.match(d, /^bare numbers 1 /m);
  assert.match(d, /^b1 \| .* \| 89 \| Subtotal 89$/m);
});

test('escapes pipes, reads structured currency facts and is deterministic', () => {
  const p = page([
    { t: 'meta', a: { property: 'og:price:currency', content: 'USD' }, d: 'none' },
    { t: 'span', a: { itemprop: 'price priceCurrency' }, d: 'none', c: [{ x: 'CAD' }] },
    div([txt('Total | $3.00', 0)], { a: { 'data-currency': 'CAD' } }),
  ]);
  const d = digest(p);
  assert.match(d, /meta og:price:currency \{"USD":1\}/);
  assert.match(d, /microdata priceCurrency \{"CAD":1\}/);
  assert.match(d, /attr data-currency \{"CAD":1\}/);
  assert.ok(rows(d).some((x) => x.amount === 'Total ¦ $3.00'));
  assert.equal(digest(p), d);
});

test('refuses anything but a pane-dom.2 export', () => {
  assert.throws(() => digest({ format: 'capture-snapshot.1' }), /not a pane-dom.2 export/);
  assert.throws(() => digest({ format: 'pane-dom.1' }), /not a pane-dom.2 export/);
});

test('was-price hint matches whole name segments only', () => {
  const d = digest(
    page([
      div([txt('1,00 €', 0)], { a: { class: 'font-bold text-13' } }),
      div([txt('2,00 €', 0)], { a: { class: 'oldPrice' } }),
    ]),
  );
  const r = rows(d);
  assert.equal(r.find((x) => x.amount === '1,00 €').flags, '-');
  assert.equal(r.find((x) => x.amount === '2,00 €').flags, 'strike?');
});

test('letter markers inside words are not amounts', () => {
  const d = digest(
    page([
      div([txt('Based on 430 Reviews', 0)]),
      div([txt('THANK YOU FOR 42 YEARS.', 0)]),
      div([txt('Sony MDR-7506', 0)]),
      div([txt('19,800원 이상', 0)]),
      div([txt('R 1 299', 0)]),
    ]),
  );
  const amounts = rows(d).map((x) => x.amount);
  assert.deepEqual(amounts, ['19,800원 이상', 'R 1 299']);
});

test('cents in a separate element are appended and flagged split', () => {
  const sp = (c) => ({ t: 'span', d: 'inline', s: style(), b: [0, 0, 80, 14], v: true, bx: true, c });
  const d = digest(
    page([div([sp([{ x: '$449' }, { t: 'sup', d: 'inline', s: style(), b: [40, 0, 10, 8], v: true, bx: true, c: [{ x: '.99' }] }])]), div([txt('$ 1,016', 0), txt('90', 50)])]),
  );
  const r = rows(d);
  assert.ok(r.some((x) => x.amount === '$449 .99'));
  assert.ok(r.some((x) => x.amount === '$ 1,016 90' && x.flags === 'split'));
});

test('a regular or original class does not hint strike', () => {
  const d = digest(page([div([txt('Totaal 19.15', 0)], { a: { class: 'regular-receipt-row' } })]));
  assert.equal(rows(d)[0].flags, '-');
});

test('split cents only after an amount without decimals in a decimal currency; kr. with a period', () => {
  const d = digest(
    page([
      div([txt('$28.00 USD', 0), txt('1', 60)]),
      div([txt('￥1,760', 0), txt('2', 60)]),
      div([txt('Total $30', 0), txt('12', 60)]),
      div([txt('Fri frakt över 499 kr.', 0)]),
    ]),
  );
  const r = rows(d);
  assert.ok(r.some((x) => x.amount === '$28.00 USD' && x.flags === '-'));
  assert.ok(r.some((x) => x.amount === '￥1,760' && x.flags === '-'));
  const t = r.find((x) => x.amount === 'Total $30 12');
  assert.equal(t.flags, 'split');
  assert.equal(t.context, 'Total $30 12');
  assert.ok(r.some((x) => x.amount === 'Fri frakt över 499 kr.'));
});
