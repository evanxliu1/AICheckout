// The reader's split-amount and collapsed-summary rules in Chromium, where there is layout (the unit tests run in
// jsdom, which has none): a total drawn one character per element is read only when the characters stand in one
// line, unclipped and plainly shown. Synthetic pages only; nothing is fetched.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { GLOBAL_NAME, bundleReader } from '../../bundle.mjs';

const URL = 'https://shop.example.com/checkouts/c/1';
let browser;
let code;
before(async () => {
  browser = await chromium.launch({ headless: true });
  ({ code } = await bundleReader({ frameDomains: [], splitDomains: [] }));
});
after(async () => {
  await browser?.close();
});

const row = (label, value) => `<div><span>${label}</span><span>${value}</span></div>`;
const chars = (text, cls = 'c') => [...text].map((ch) => `<span class="${cls}">${ch}</span>`).join('');
/** A checkout summary whose Total is `value`, with `css` for it. */
const checkout = (value, css = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout</title><style>${css}</style></head><body><main><h1>Checkout</h1><section>${row('Subtotal', '$84.00')}${row('Shipping', '$8.00')}${row('Total', value)}<button type="button">Pay now</button></section></main></body></html>`;

async function read(html, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html);
    await page.addScriptTag({ content: code });
    return await page.evaluate(
      ([name, url]) => window[name].readCartPage(document, { url }),
      [GLOBAL_NAME, URL],
    );
  } finally {
    await context.close();
  }
}
const total = (amountMinor) => ({ shown: true, kind: 'estimatedTotal', amountMinor, currency: 'USD' });
const unreadable = { shown: false, reason: 'amount-unreadable' };

test('a total drawn one character per element reads as one amount, beside the old amount fading out', async () => {
  const css =
    '.amount{position:relative;display:grid;overflow:hidden}.layer{grid-area:1/1}.c{position:relative}.old .c{opacity:0;top:1em}';
  const value = `<span class="amount"><span class="layer old" aria-hidden="true">${chars('$91.35')}</span><span class="layer">${chars('$99.35')}</span></span>`;
  assert.deepEqual(await read(checkout(value, css)), {
    detection: { page: 'checkout', reason: 'url-summary' },
    reading: total(9935),
  });
  // Inline-block characters (a split-text effect) and thousands.
  assert.deepEqual(
    (await read(checkout(`<span>${chars('$1,299.35')}</span>`, '.c{display:inline-block}'))).reading,
    total(129935),
  );
});

test('an old digit left among the new ones is not read into the number', async () => {
  // "$919.35" in the tree, "$99.35" on the page: the "1" is rolled out, drawn over or made unseen in four ways.
  const value = `<span class="amount"><span class="c">$</span><span class="c">9</span><span class="o">1</span><span class="c">9</span><span class="c">.</span><span class="c">3</span><span class="c">5</span></span>`;
  const base = '.c,.o{display:inline-block}.amount{display:inline-block;overflow:hidden;height:1.2em}';
  for (const hide of [
    'position:relative;top:-1.2em;margin-right:-.6em',
    'transform:translateY(-120%);margin-right:-.6em',
    'color:transparent;margin-right:-.6em',
    'opacity:.6;margin-right:-.6em',
  ])
    assert.deepEqual((await read(checkout(value, `${base}.o{${hide}}`))).reading, unreadable, hide);
});

test('a digit part-way through a roll, or cut by the box around the amount, is not read into the number', async () => {
  const base =
    '.c,.up,.dn{display:inline-block}.amount{display:inline-block;overflow:hidden;height:1.15em}.up{position:relative;top:-.45em}.dn{position:relative;top:.45em}';
  // "$919.35" in the tree while the "1" rolls out and the "9" rolls in.
  const rolling = `<span class="amount">${chars('$9')}<span class="up">1</span><span class="dn">9</span>${chars('.35')}</span>`;
  assert.deepEqual((await read(checkout(rolling, base))).reading, unreadable);
  // "$99.355" in the tree: a trailing digit half out of the clipping box.
  const trailing = `<span class="amount">${chars('$99.35')}<span class="dn">5</span></span>`;
  assert.deepEqual((await read(checkout(trailing, base))).reading, unreadable);
});

test('characters that do not paint, a fading layer and gradient lettering: unreadable, never a different amount', async () => {
  const extra = (style) => `<span>${chars('$99.35')}<span class="c" style="${style}">5</span></span>`;
  for (const style of ['color:rgba(0,0,0,.004)', '-webkit-text-fill-color:transparent'])
    assert.deepEqual((await read(checkout(extra(style)))).reading, unreadable, style);
  // The old amount's layer still more than half shown, the new one's less.
  const layers = `<span class="amount"><span class="layer old">${chars('$91.35')}</span><span class="layer new">${chars('$99.35')}</span></span>`;
  assert.deepEqual(
    (
      await read(
        checkout(
          layers,
          '.amount{display:grid;overflow:hidden}.layer{grid-area:1/1}.old{opacity:.6}.new{opacity:.4}',
        ),
      )
    ).reading,
    unreadable,
  );
  // Gradient lettering shows though its colour is transparent: the total is there, so the subtotal is not shown.
  const gradient = `<span class="amount">${chars('$92.00')}</span>`;
  assert.deepEqual(
    (
      await read(
        checkout(
          gradient,
          '.amount span{color:transparent;background:linear-gradient(red,blue);-webkit-background-clip:text;background-clip:text}',
        ),
      )
    ).reading,
    unreadable,
  );
});

test('a smaller raised currency symbol belongs to the split amount', async () => {
  const value = `<span><span class="s">$</span>${chars('92.00')}</span>`;
  assert.deepEqual(
    (await read(checkout(value, '.s{font-size:.6em;vertical-align:top}'))).reading,
    total(9200),
  );
});

test('characters cut off by the box around the amount, or on two lines, are not one number', async () => {
  const clipped = `<span class="amount">${chars('$1,299.35')}</span>`;
  assert.deepEqual(
    (
      await read(
        checkout(clipped, '.amount{display:inline-block;overflow:hidden;width:3ch;white-space:nowrap}'),
      )
    ).reading,
    unreadable,
  );
  const wrapped = `<span class="amount">${chars('$1,299.35')}</span>`;
  assert.deepEqual(
    (await read(checkout(wrapped, '.amount{display:inline-block;width:2ch}.c{display:inline-block}')))
      .reading,
    unreadable,
  );
});

test('an extra digit scrolled out of sight sideways, under a clip path or under a mask is not read into the number', async () => {
  // "$99.355" in the tree, "$99.35" on the page.
  const value = `<span class="amount">${chars('$99.35')}<span class="o">5</span></span>`;
  for (const hide of [
    '.amount{display:inline-block;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;width:3.6em;white-space:nowrap;vertical-align:top}.o{margin-left:3em}',
    '.amount{display:inline-block;clip-path:inset(0 .7em 0 0)}',
    '.o{-webkit-mask-image:linear-gradient(transparent,transparent);mask-image:linear-gradient(transparent,transparent)}',
  ])
    assert.deepEqual(
      (await read(checkout(value, `.c,.o{display:inline-block}${hide}`))).reading,
      unreadable,
      hide,
    );
  // A summary in a panel that scrolls downwards, the total whole inside it, is still read.
  assert.deepEqual(
    (await read(checkout(`<span>${chars('$99.35')}</span>`, 'section{overflow-y:auto;height:60px}'))).reading,
    total(9935),
  );
});

test('a collapsed order summary: the control’s one amount is the total, with a label for screen readers only', async () => {
  const sr = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)';
  const page = (inner) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout</title><style>.sr{${sr}}</style></head><body><aside><button type="button" aria-expanded="false"><span>Order summary</span>${inner}</button></aside><main><h1 class="sr">Checkout</h1><form><label>Email <input type="email"></label><button type="button">Pay now</button></form></main></body></html>`;
  assert.deepEqual(
    await read(page('<span><span class="sr">Total price</span><span><strong>$92.00</strong></span></span>'), {
      width: 800,
      height: 800,
    }),
    { detection: { page: 'checkout', reason: 'url-summary' }, reading: total(9200) },
  );
  // A hidden label that is no total label, and a qualifier beside the amount: not read, and no checkout detected.
  for (const inner of [
    '<span><span class="sr">Shipping</span><span>$8.00</span></span>',
    '<span>Spend $25.00</span>',
  ])
    assert.deepEqual(await read(page(inner)), {
      detection: { page: 'none', reason: 'no-structure' },
      reading: { shown: false, reason: 'no-summary' },
    });
});
