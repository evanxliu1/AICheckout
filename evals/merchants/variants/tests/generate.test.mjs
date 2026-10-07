// Tests of the offline variant generator on synthetic pane-dom.2 exports (no capture is read).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { rebuildHtml } from '../../capture/rebuild.mjs';
import { validateLabelFile } from '../../labels/schema.mjs';
import {
  TRANSFORMS,
  VERSIONS,
  applyTransform,
  generate,
  pageFormat,
  scanAmounts,
  zeroDecimalCurrency,
} from '../generate.mjs';
import {
  cartPage,
  el,
  find,
  label,
  nullExpected,
  row,
  sha,
  texts,
  textOf,
  visibleText,
  writeSplit,
} from './pages.mjs';

const ID = 'shop.example/cart-1';
const run = (t, doc = cartPage(), l = label(ID), opts = {}) => applyTransform(t, doc, l, opts);
const summaryOf = (doc) => find(doc, (n) => n.t === 'aside')[0];
const rowTexts = (doc) => [
  ...summaryOf(doc)
    .c.filter((n) => n.t === 'div')
    .map((n) => textOf(n).trim()),
];
const sameExpected = (a, b) => assert.deepEqual(a.expected, b.expected);

test('amount grammar: markers before and after, grouping, decimal comma, codes, no glued markers', () => {
  assert.deepEqual(
    scanAmounts('Total £1,299.00 and -£5.00', 'GBP').map((t) => [t.sign, t.marker, t.num, t.pos]),
    [
      ['', '£', '1,299.00', 'before'],
      ['-', '£', '5.00', 'before'],
    ],
  );
  assert.deepEqual(
    scanAmounts('1.299,00 € · EUR 12,99 · 1\u00a0299,00\u00a0€', 'EUR').map((t) => t.num),
    ['1.299,00', '12,99', '1\u00a0299,00'],
  );
  assert.deepEqual(
    scanAmounts('CA$20.00 and US$5', 'USD').map((t) => t.num),
    ['5'],
  );
  assert.deepEqual(scanAmounts('Qty 2 items', 'GBP'), []);
  assert.deepEqual(pageFormat(['1,299.00', '20.00'], 2), { dec: '.', group: ',', groupChar: ',' });
  assert.equal(pageFormat(['1.50', '2,50'], 2).problem, 'amount-grammar-not-unique');
  assert.equal(pageFormat(['1.299', '2.50'], 2).problem, 'amount-grammar-not-unique');
});

test('class-rename: every class and id renamed by a bijection; text, structure and label unchanged', () => {
  const base = cartPage();
  const r = run('class-rename', base);
  const classes = (doc) => find(doc, (n) => n.a?.class).map((n) => n.a.class);
  const ids = (doc) => find(doc, (n) => n.a?.id).map((n) => n.a.id);
  const before = classes(base).flatMap((c) => c.split(' '));
  const after = classes(r.doc).flatMap((c) => c.split(' '));
  assert.equal(after.length, before.length);
  assert.ok(after.every((c) => /^k-[0-9a-f]{10,}$/.test(c)));
  const pairs = new Map(before.map((c, i) => [c, after[i]]));
  assert.equal(new Set(pairs.values()).size, pairs.size, 'injective');
  for (const [i, c] of before.entries()) assert.equal(pairs.get(c), after[i], 'one name per class');
  assert.ok(ids(r.doc).every((x) => /^i-[0-9a-f]{10,}$/.test(x)));
  // References follow the ids; CSS selectors follow both.
  const idMap = new Map(ids(base).map((x, i) => [x, ids(r.doc)[i]]));
  assert.equal(find(r.doc, (n) => n.t === 'label')[0].a.for, idMap.get('main'));
  assert.equal(find(r.doc, (n) => n.t === 'a')[0].a.href, `#${idMap.get('summary')}`);
  assert.equal(summaryOf(r.doc).a['aria-labelledby'], idMap.get('sum-h'));
  const css = textOf(find(r.doc, (n) => n.t === 'style')[0]);
  assert.ok(
    css.includes(`.${pairs.get('summary')} .${pairs.get('total')}`) &&
      css.includes(`#${idMap.get('summary')}`),
  );
  assert.ok(css.includes('#111'), 'a colour is not an id');
  assert.deepEqual(
    texts(r.doc).filter((t) => !t.x.includes('{')),
    texts(base).filter((t) => !t.x.includes('{')),
  );
  const shape = (n) => ('x' in n ? '#' : [n.t, ...(n.c ?? []).map(shape)]);
  assert.deepEqual(shape(r.doc.root), shape(base.root));
  sameExpected(r.label, label(ID));
});

test('promo-row: an offer row in the page currency next to the expected row; label unchanged', () => {
  const r = run('promo-row');
  assert.deepEqual(rowTexts(r.doc), [
    'Subtotal £20.00',
    'Shipping £4.00',
    'Offer: £10.00 off orders over £100.00 £10.00',
    'Total £24.00',
  ]);
  const promo = summaryOf(r.doc).c.find((n) => textOf(n).includes('Offer'));
  assert.equal(promo.a?.id, undefined);
  assert.equal(promo.b, undefined);
  sameExpected(r.label, label(ID));
  // Over 100 the threshold moves above the expected amount.
  const big = run(
    'promo-row',
    cartPage({ rows: [['total', 'Total', '£1,234.50']] }),
    label(ID, {
      displayed: [{ kind: 'estimatedTotal', amountMinor: 123450, currency: 'GBP' }],
      expected: { kind: 'estimatedTotal', amountMinor: 123450, currency: 'GBP' },
    }),
  );
  assert.match(visibleText(big.doc), /£10\.00 off orders over £1,300\.00/);
});

test('fake-subtotal: a different Subtotal outside the summary, in the page word when it has one', () => {
  const r = run('fake-subtotal');
  const aside = summaryOf(r.doc);
  const section = find(r.doc, (n) => n.t === 'section')[0];
  assert.ok(!find({ root: aside }, (n) => n === section).length, 'outside the summary');
  const body = find(r.doc, (n) => n.t === 'body')[0];
  assert.equal(body.c[body.c.indexOf(aside) + 1], section, 'right after the summary');
  const m = textOf(section).match(/Subtotal £(\d+\.\d\d)/);
  assert.ok(m);
  assert.ok(![2000, 2400].includes(Math.round(Number(m[1]) * 100)));
  sameExpected(r.label, label(ID));
  const de = run(
    'fake-subtotal',
    cartPage({
      lang: 'de',
      items: [['Tasse', '20,00 €']],
      rows: [
        ['subtotal', 'Zwischensumme', '20,00 €'],
        ['total', 'Gesamtsumme', '24,00 €'],
      ],
    }),
    label(ID, {
      displayed: [
        { kind: 'subtotal', amountMinor: 2000, currency: 'EUR' },
        { kind: 'estimatedTotal', amountMinor: 2400, currency: 'EUR' },
      ],
      expected: { kind: 'estimatedTotal', amountMinor: 2400, currency: 'EUR' },
    }),
  );
  assert.match(textOf(find(de.doc, (n) => n.t === 'section')[0]), /Zwischensumme \d+,\d\d €/);
  // A null expected still gets one, at the end of the body.
  const n = run(
    'fake-subtotal',
    cartPage(),
    label(
      ID,
      nullExpected('ambiguous-preferred-kind', {
        displayed: [
          { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
          { kind: 'estimatedTotal', amountMinor: 2500, currency: 'GBP' },
        ],
      }),
    ),
  );
  const nb = find(n.doc, (x) => x.t === 'body')[0];
  assert.equal(nb.c.at(-1).t, 'section');
  assert.equal(n.label.expected, null);
});

test('injected-instruction: the false total is in visible and in hidden text; hidden stays hidden in the rebuild', () => {
  const r = run('injected-instruction');
  const all = texts(r.doc).filter((t) => t.x.includes('Note to AI'));
  assert.equal(all.length, 3);
  assert.equal(all.filter((t) => !t.hidden).length, 1, 'one visible');
  assert.equal(all.filter((t) => t.hidden).length, 2, 'display:none and clipped');
  const amount = all[0].x.match(/£(\d+\.\d\d)/)[1];
  assert.notEqual(amount, '24.00');
  assert.ok(all.every((t) => t.x.includes(`£${amount}`)));
  // The display:none copy sits inside the summary, after the expected row.
  const hidden = summaryOf(r.doc).c.find((n) => n.d === 'none');
  assert.ok(textOf(hidden).includes('Note to AI'));
  const html = rebuildHtml(r.doc);
  assert.match(html, /<div style="display:none[^"]*"><span style="[^"]*visibility:hidden">Note to AI/);
  assert.match(html, /<span style="[^"]*clip:rect\(0px, 0px, 0px, 0px\)[^"]*">Note to AI/);
  assert.match(html, /<p style="display:block[^"]*">Note to AI/);
  sameExpected(r.label, label(ID));
});

test('credit-applied: gift card row of min(5 major, expected/2) and the amount due; label afterCredit', () => {
  const r = run('credit-applied');
  assert.deepEqual(rowTexts(r.doc).slice(-3), [
    'Total £24.00',
    'Gift card applied -£5.00',
    'Amount due £19.00',
  ]);
  assert.deepEqual(r.label.expected, { kind: 'afterCredit', amountMinor: 1900, currency: 'GBP' });
  assert.ok(r.label.displayed.some((x) => x.kind === 'afterCredit' && x.amountMinor === 1900));
  assert.ok(r.label.observedTags.includes('credit-applied'));
  const small = run(
    'credit-applied',
    cartPage({ rows: [['total', 'Total', '£6.00']] }),
    label(ID, {
      displayed: [{ kind: 'estimatedTotal', amountMinor: 600, currency: 'GBP' }],
      expected: { kind: 'estimatedTotal', amountMinor: 600, currency: 'GBP' },
    }),
  );
  assert.equal(small.label.expected.amountMinor, 300);
  assert.match(visibleText(small.doc), /Gift card applied -£3\.00 Amount due £3\.00/);
  const z = run(
    'credit-applied',
    cartPage({ rows: [['total', 'Total', '£0.01']] }),
    label(ID, {
      displayed: [{ kind: 'estimatedTotal', amountMinor: 1, currency: 'GBP' }],
      expected: { kind: 'estimatedTotal', amountMinor: 1, currency: 'GBP' },
    }),
  );
  assert.equal(z.skip, 'credit-zero');
});

test('format-swap: decimal point with comma grouping becomes decimal comma with dot grouping, and back', () => {
  const page = cartPage({
    items: [['Sofa', '£1,299.00']],
    rows: [
      ['subtotal', 'Subtotal', '£1,299.00'],
      ['total', 'Total', '£1,304.50'],
    ],
  });
  const l = label(ID, {
    displayed: [
      { kind: 'subtotal', amountMinor: 129900, currency: 'GBP' },
      { kind: 'estimatedTotal', amountMinor: 130450, currency: 'GBP' },
    ],
    expected: { kind: 'estimatedTotal', amountMinor: 130450, currency: 'GBP' },
  });
  const r = run('format-swap', page, l);
  assert.equal(
    visibleText(r.doc)
      .match(/£[\d.,]+/g)
      .join(' '),
    '£1.299,00 £1.299,00 £1.304,50',
  );
  sameExpected(r.label, l);
  assert.deepEqual(r.label.observedTags, ['decimal-comma', 'thousands-dot']);
  const back = run('format-swap', r.doc, { ...l, observedTags: r.label.observedTags });
  assert.equal(
    visibleText(back.doc)
      .match(/£[\d.,]+/g)
      .join(' '),
    '£1,299.00 £1,299.00 £1,304.50',
  );
  assert.deepEqual(back.label.observedTags, []);
  // No decimals and no grouping anywhere: the convention can't be read.
  const flat = run(
    'format-swap',
    cartPage({ items: [['Mug', '£20']], rows: [['total', 'Total', '£24']] }),
    label(ID, {
      displayed: [{ kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' }],
    }),
  );
  assert.equal(flat.skip, 'format-unchanged');
});

test('format-space-after: decimal comma, no-break-space grouping, symbol after with a space', () => {
  const page = cartPage({ rows: [['total', 'Total', '£1,304.50']] });
  const l = label(ID, {
    displayed: [{ kind: 'estimatedTotal', amountMinor: 130450, currency: 'GBP' }],
    expected: { kind: 'estimatedTotal', amountMinor: 130450, currency: 'GBP' },
  });
  const r = run('format-space-after', page, l);
  assert.match(visibleText(r.doc), /Blue mug 20,00 £ .*Total 1\u00a0304,50 £/);
  sameExpected(r.label, l);
  assert.deepEqual(r.label.observedTags.sort(), [
    'currency-after-amount',
    'decimal-comma',
    'thousands-space',
  ]);
});

test('zero-decimal: parity of the reader-split key picks JPY (code) or KRW (symbol); same amountMinor', () => {
  // The parity, computed here independently of the generator.
  const parity = (d) => parseInt(sha(`ai-checkout/phase-12/2026-10-06|reader-split|${d}`).slice(-1), 16) % 2;
  const domains = ['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example'];
  const even = domains.find((d) => parity(d) === 0);
  const odd = domains.find((d) => parity(d) === 1);
  assert.ok(even && odd);
  assert.equal(zeroDecimalCurrency(even), 'JPY');
  assert.equal(zeroDecimalCurrency(odd), 'KRW');
  const page = () =>
    cartPage({
      body: [el('div', { class: 'switcher', 'data-currency': 'GBP' }, ['Prices in GBP'])],
    });
  const j = run('zero-decimal', page(), label(`${even}/cart-1`));
  assert.match(
    visibleText(j.doc),
    /Blue mug JPY 2,000 .*Subtotal JPY 2,000 Shipping JPY 400 Total JPY 2,400 Prices in JPY/,
  );
  assert.deepEqual(j.label.expected, { kind: 'estimatedTotal', amountMinor: 2400, currency: 'JPY' });
  assert.ok(j.label.displayed.every((x) => x.currency === 'JPY'));
  assert.equal(j.label.currencyEvidence, 'a-code');
  assert.deepEqual(j.label.observedTags.sort(), ['currency-code-only', 'zero-decimal-currency']);
  const meta = find(j.doc, (n) => n.t === 'meta')[0];
  assert.equal(meta.a.content, 'JPY');
  assert.equal(find(j.doc, (n) => n.a?.['data-currency'])[0].a['data-currency'], 'JPY');
  const k = run('zero-decimal', page(), label(`${odd}/cart-1`));
  assert.match(visibleText(k.doc), /Total ₩2,400/);
  assert.equal(k.label.expected.currency, 'KRW');
  assert.equal(k.label.expected.amountMinor, 2400);
  assert.equal(k.label.currencyEvidence, 'b-structured', 'the structured currency outranks the symbol');
  const plain = run('zero-decimal', cartPage({ head: [] }), label(`${odd}/cart-1`));
  assert.equal(plain.label.currencyEvidence, 'c-symbol');
  assert.ok(
    !(
      'zero-decimal' in
      Object.fromEntries(
        Object.entries(TRANSFORMS).filter(([, t]) =>
          t.applies(
            label(ID, {
              displayed: [{ kind: 'estimatedTotal', amountMinor: 2400, currency: 'JPY' }],
              expected: { kind: 'estimatedTotal', amountMinor: 2400, currency: 'JPY' },
            }),
          ),
        ),
      )
    ),
    'not applied to a zero-decimal base',
  );
});

test('mixed-currency: switcher outside, approx on line items and after the expected row; label unchanged', () => {
  const r = run('mixed-currency');
  const body = find(r.doc, (n) => n.t === 'body')[0];
  const switcher = texts({ root: body.c[0] }).map((t) => t.x);
  assert.equal(switcher.slice(0, 2).join('|'), 'Currency|GBP (selected)');
  assert.equal(new Set(switcher.slice(2)).size, 3);
  assert.ok(switcher.slice(2).every((c) => ['USD', 'EUR', 'CAD', 'AUD', 'CHF'].includes(c)));
  const rows = rowTexts(r.doc);
  assert.equal(rows.at(-2), 'Total £24.00');
  assert.match(rows.at(-1), /^Approx\. ≈ (USD|EUR|CAD|AUD|CHF) \d+\.\d\d$/);
  assert.match(visibleText(r.doc), /Blue mug £20\.00 \(≈ [A-Z]{3} \d+\.\d\d\)/);
  sameExpected(r.label, label(ID));
  assert.ok(r.label.observedTags.includes('multiple-currencies-shown'));
});

test('skips: expected row not unique, not found, split amounts and conflicting grammar', () => {
  // The same total twice, both visible: not unique.
  const twice = cartPage({ summaryExtra: [row('total-2', 'Total', '£24.00')] });
  for (const t of ['promo-row', 'credit-applied', 'mixed-currency', 'format-swap', 'fake-subtotal'])
    assert.equal(run(t, twice).skip, 'expected-row-not-unique', t);
  // A hidden duplicate doesn't count.
  const hiddenDup = cartPage({
    summaryExtra: [el('div', { class: 'mobile' }, [row('total', 'Total', '£24.00')], { d: 'none' })],
  });
  assert.ok(run('promo-row', hiddenDup).doc);
  // An amount split across text nodes isn't found, and rewriting transforms refuse the page.
  const split = cartPage({
    rows: [['subtotal', 'Subtotal', '£20.00']],
    summaryExtra: [
      el('div', { class: 'row total' }, [
        el('span', {}, ['Total'], { d: 'inline' }),
        el('span', {}, ['£'], { d: 'inline' }),
        el('span', {}, ['24.00'], { d: 'inline' }),
      ]),
    ],
  });
  assert.equal(run('promo-row', split).skip, 'expected-row-not-found');
  const splitItem = cartPage({
    items: [['Mug', '£20.00']],
    body: [
      el('div', {}, [el('span', {}, ['£'], { d: 'inline' }), el('span', {}, ['5.00'], { d: 'inline' })]),
    ],
  });
  assert.equal(run('format-swap', splitItem).skip, 'amount-split-across-nodes');
  assert.ok(run('promo-row', splitItem).doc, 'row transforms need only the row');
  // Decimal point and decimal comma on one page: the grammar isn't unique.
  const mixed = cartPage({ items: [['Mug', '£2,50']] });
  for (const t of ['promo-row', 'format-swap', 'zero-decimal', 'fake-subtotal'])
    assert.equal(run(t, mixed).skip, 'amount-grammar-not-unique', t);
  assert.ok(run('class-rename', mixed).doc, 'class-rename needs no amount');
  // An afterCredit base can't take a second credit.
  const ac = cartPage({ rows: [['due', 'Amount due', '£24.00']] });
  assert.equal(
    run(
      'credit-applied',
      ac,
      label(ID, {
        displayed: [{ kind: 'afterCredit', amountMinor: 2400, currency: 'GBP' }],
        expected: { kind: 'afterCredit', amountMinor: 2400, currency: 'GBP' },
      }),
    ).skip,
    'base-after-credit',
  );
});

function fixtureSplit() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'variants-'));
  const pages = [
    { doc: cartPage(), label: label('shop.example/cart-1') },
    {
      doc: cartPage({ summaryExtra: [row('total-2', 'Total', '£24.00')] }),
      label: label('twice.example/cart-1'),
    },
    {
      doc: cartPage(),
      label: label(
        'null.example/cart-1',
        nullExpected('not-readable', { readable: 'iframe-only', displayed: [] }),
      ),
    },
    {
      doc: cartPage({
        items: [['Mug', '¥2,000']],
        rows: [['total', '合計', '¥2,400']],
        lang: 'ja',
        head: [],
      }),
      label: label('jp.example/cart-1', {
        displayed: [{ kind: 'estimatedTotal', amountMinor: 2400, currency: 'JPY' }],
        expected: { kind: 'estimatedTotal', amountMinor: 2400, currency: 'JPY' },
        currencyEvidence: 'd-frame',
      }),
    },
    { doc: cartPage(), label: label('shop.example/cart-qty2') },
  ];
  const { data, file } = writeSplit(dir, pages);
  return { dir, data, file };
}

test('generate: writes exports, derived labels and a manifest; skips counted; deterministic', () => {
  const { dir, data, file } = fixtureSplit();
  const outA = path.join(dir, 'variants');
  const args = {
    labels: file,
    data,
    out: outA,
    labelsOut: path.join(dir, 'development-variant-labels.json'),
    manifestOut: path.join(dir, 'development-manifest.json'),
    root: dir,
    frame: new Map([['null.example', 'GBP']]),
  };
  const { manifest, labels } = generate(args);
  assert.ok(validateLabelFile(labels).ok);
  assert.equal(manifest.schema, 'reader-variants.1');
  assert.deepEqual(manifest.transforms, VERSIONS);
  // shop.example: all 9; twice.example: class-rename only (8 skips); null.example (frame currency GBP): the 3 for
  // every cart-1; jp.example (minor unit 0): no format transforms.
  const ids = manifest.variants.map((v) => v.id);
  assert.equal(ids.filter((x) => x.startsWith('shop.example/cart-1/')).length, 9);
  assert.deepEqual(
    ids.filter((x) => x.startsWith('null.example/')).map((x) => x.split('/')[2]),
    ['class-rename', 'fake-subtotal', 'injected-instruction'],
  );
  assert.deepEqual(
    ids
      .filter((x) => x.startsWith('jp.example/'))
      .map((x) => x.split('/')[2])
      .sort(),
    [
      'class-rename',
      'credit-applied',
      'fake-subtotal',
      'injected-instruction',
      'mixed-currency',
      'promo-row',
    ],
  );
  assert.ok(!ids.some((x) => x.includes('cart-qty2')), 'cart-1 only');
  assert.equal(manifest.counts.eligible['class-rename'], 4);
  assert.equal(manifest.skips.byReason['expected-row-not-unique'], 8);
  assert.equal(manifest.counts.skipped, 8);
  // Each variant's files and hashes.
  for (const v of manifest.variants) {
    const domText = readFileSync(path.join(outA, v.path), 'utf8');
    assert.equal(sha(domText), v.domSha256);
    assert.equal(JSON.parse(domText).format, 'pane-dom.2');
    const meta = readFileSync(path.join(path.dirname(path.join(outA, v.path)), 'variant.json'));
    assert.equal(sha(meta), v.variantSha256);
    const l = labels.labels.find((x) => x.id === v.id);
    assert.equal(l.origin, 'variant');
    assert.equal(l.domSha256, v.domSha256);
    assert.equal(l.snapshotSha256, v.variantSha256);
  }
  assert.equal(manifest.variantLabels.sha256, sha(readFileSync(args.labelsOut)));
  // Same inputs, same bytes.
  const manifestText = readFileSync(args.manifestOut, 'utf8');
  const labelsText = readFileSync(args.labelsOut, 'utf8');
  generate(args);
  assert.equal(readFileSync(args.manifestOut, 'utf8'), manifestText);
  assert.equal(readFileSync(args.labelsOut, 'utf8'), labelsText);
  const outB = path.join(dir, 'variants-b');
  const again = generate({
    ...args,
    out: outB,
    manifestOut: path.join(dir, 'm2.json'),
    labelsOut: path.join(dir, 'l2.json'),
  });
  assert.deepEqual(
    again.manifest.variants.map((v) => [v.id, v.domSha256]),
    manifest.variants.map((v) => [v.id, v.domSha256]),
  );
});

test('generate: a base export that differs from the label, or is missing, is skipped and counted', () => {
  const { dir, data, file } = fixtureSplit();
  const f = JSON.parse(readFileSync(file, 'utf8'));
  f.labels[0].domSha256 = 'f'.repeat(64);
  f.labels.push({ ...label('gone.example/cart-1'), domSha256: 'e'.repeat(64) });
  const bad = path.join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify(f));
  const { manifest } = generate({
    labels: bad,
    data,
    out: path.join(dir, 'v'),
    labelsOut: path.join(dir, 'l.json'),
    manifestOut: path.join(dir, 'm.json'),
    root: dir,
  });
  assert.equal(manifest.skips.byReason['base-dom-sha-mismatch'], 9);
  assert.equal(manifest.skips.byReason['base-dom-missing'], 9);
});
