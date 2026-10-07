// Tests of the reader-labels.2 schema and validate-labels.mjs on synthetic labels.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MINOR_UNITS, preferredKind, validateLabelFile } from '../schema.mjs';
import { clean, label, labellerFile, nullExpected } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const problems = (labels) => validateLabelFile(labellerFile('l1', labels)).problems.map((p) => p.message);
const one = (l) => problems([clean(l)]);

test('reader-labels.2: a well-formed label of each expected case passes', () => {
  assert.deepEqual(
    problems(
      [
        label('shop.example/cart-1'),
        label('shop.example/empty-cart', {
          ...nullExpected('no-total-displayed'),
          displayed: [],
          readable: 'none-displayed',
        }),
        label(
          'shop.example/minicart-1',
          nullExpected('not-readable', { readable: 'iframe-only', displayed: [] }),
        ),
        label(
          'shop.example/cart-qty2',
          nullExpected('ambiguous-preferred-kind', {
            displayed: [
              { kind: 'estimatedTotal', amountMinor: 4000, currency: 'GBP' },
              { kind: 'estimatedTotal', amountMinor: 4400, currency: 'GBP' },
            ],
          }),
        ),
        label(
          'shop.example/cart-2items',
          nullExpected('currency-undetermined', {
            displayed: [{ kind: 'subtotal', amountMinor: 1299, currency: null }],
            observedTags: ['shared-symbol'],
          }),
        ),
        label('shop.example/cart-1/credit-applied', {
          displayed: [
            { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
            { kind: 'afterCredit', amountMinor: 1900, currency: 'GBP' },
          ],
          expected: { kind: 'afterCredit', amountMinor: 1900, currency: 'GBP' },
          currencyEvidence: 'a-code',
          currencyConflict: true,
        }),
        label('shop.jp/cart-1', {
          displayed: [{ kind: 'subtotal', amountMinor: 1299, currency: 'JPY' }],
          expected: { kind: 'subtotal', amountMinor: 1299, currency: 'JPY' },
          observedTags: ['zero-decimal-currency', 'non-english-labels'],
          notes: 'Total row reads "合計" next to the amount.',
        }),
      ].map(clean),
    ),
    [],
  );
});

test('reader-labels.2: the schema refuses unknown fields, enums, tags and float amounts', () => {
  assert.ok(one(label('a.example/cart-1', { extra: 1 })).length);
  assert.ok(one(label('a.example/cart-1', { readable: 'somewhere' })).length);
  assert.ok(one(label('a.example/cart-1', { observedTags: ['not-a-tag'] })).length);
  assert.ok(
    one(label('a.example/cart-1', { observedTags: ['rtl-layout', 'rtl-layout'] })).some((m) =>
      /repeat/.test(m),
    ),
  );
  assert.ok(one(label('a.example/cart-1', { state: 'checkout-2' })).length);
  assert.ok(
    one(label('a.example/cart-1', { displayed: [{ kind: 'subtotal', amountMinor: 20.5, currency: 'GBP' }] }))
      .length,
  );
  assert.ok(one(label('a.example/cart-1', { expectedReason: 'non-usd' })).length);
  assert.ok(
    one(label('a.example/cart-1', { currencyEvidence: undefined })).some((m) => /currencyEvidence/.test(m)),
  );
  assert.ok(
    one(label('a.example/cart-1', { currencyConflict: undefined })).some((m) => /currencyConflict/.test(m)),
  );
  assert.ok(one(label('a.example/cart-1', { expected: null })).some((m) => /expectedReason/.test(m)));
  assert.ok(
    one(label('a.example/cart-1', nullExpected('not-readable', { currencyEvidence: 'd-frame' }))).some((m) =>
      /non-null expected only/.test(m),
    ),
  );
});

test('reader-labels.2: notes quote at most 25 words', () => {
  const long = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  assert.ok(one(label('a.example/cart-1', { notes: `row "${long}"` })).some((m) => /25 words/.test(m)));
  assert.deepEqual(
    one(label('a.example/cart-1', { notes: `row "${long.split(' ').slice(0, 25).join(' ')}"` })),
    [],
  );
});

test('validator: currency table, preferred kind, reasons, ids and split', () => {
  assert.ok(MINOR_UNITS.currencies.JPY === 0);
  assert.ok(
    one(
      label('a.example/cart-1', {
        displayed: [{ kind: 'subtotal', amountMinor: 100, currency: 'XAU' }],
        expected: { kind: 'subtotal', amountMinor: 100, currency: 'XAU' },
      }),
    ).some((m) => /currency-minor-units/.test(m)),
  );
  // expected must be the most preferred displayed kind
  assert.ok(
    one(
      label('a.example/cart-1', { expected: { kind: 'subtotal', amountMinor: 2000, currency: 'GBP' } }),
    ).some((m) => /most preferred/.test(m)),
  );
  assert.ok(
    one(
      label('a.example/cart-1', { expected: { kind: 'estimatedTotal', amountMinor: 2500, currency: 'GBP' } }),
    ).some((m) => /not one of the displayed/.test(m)),
  );
  assert.ok(
    one(
      label('a.example/cart-1', {
        displayed: [
          { kind: 'estimatedTotal', amountMinor: 2400, currency: 'GBP' },
          { kind: 'estimatedTotal', amountMinor: 2600, currency: 'GBP' },
        ],
      }),
    ).some((m) => /ambiguous-preferred-kind/.test(m)),
  );
  assert.ok(
    one(label('a.example/cart-1', nullExpected('no-total-displayed'))).some((m) =>
      /with displayed rows/.test(m),
    ),
  );
  assert.ok(
    one(label('a.example/cart-1', nullExpected('ambiguous-preferred-kind'))).some((m) =>
      /two different/.test(m),
    ),
  );
  assert.ok(
    one(label('a.example/cart-1', { readable: 'closed-shadow-only' })).some((m) => /not-readable/.test(m)),
  );
  assert.ok(
    one(
      label('a.example/cart-1', { displayed: [{ kind: 'subtotal', amountMinor: 1, currency: null }] }),
    ).some((m) => /without currency/.test(m)),
  );
  // ids
  assert.ok(one(label('a.example/cart-1', { state: 'cart-qty2' })).some((m) => /id state/.test(m)));
  assert.ok(one(label('a.example/cart-1/unknown-transform')).some((m) => /unknown transform/.test(m)));
  assert.ok(
    one(label('a.example/empty-cart/promo-row', { state: 'empty-cart' })).some((m) =>
      /variants apply/.test(m),
    ),
  );
  assert.ok(one(label('a.example/cart-1', { origin: 'variant' })).some((m) => /unknown transform/.test(m)));
  assert.ok(one(label('not a domain/cart-1')).some((m) => /id is not/.test(m)));
  assert.ok(problems([label('a.example/cart-1'), label('a.example/cart-1')]).includes('duplicate id'));
  const f = labellerFile('l1', [label('a.example/cart-1')]);
  f.labels[0].split = 'heldout-a';
  assert.ok(validateLabelFile(f).problems.some((p) => /not the file's/.test(p.message)));
  assert.equal(
    preferredKind([{ kind: 'subtotal' }, { kind: 'afterCredit' }, { kind: 'estimatedTotal' }]),
    'afterCredit',
  );
});

test('validate-labels.mjs CLI: exit 0 on a valid file, 1 with ids and messages on an invalid one', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'labels-'));
  const cli = path.join(here, '..', 'validate-labels.mjs');
  const good = path.join(dir, 'good.json');
  writeFileSync(good, JSON.stringify(labellerFile('l1', [label('a.example/cart-1')])));
  assert.match(execFileSync('node', [cli, good], { encoding: 'utf8' }), /"ok": true/);
  const bad = path.join(dir, 'bad.json');
  writeFileSync(
    bad,
    JSON.stringify(labellerFile('l1', [label('a.example/cart-1'), label('a.example/cart-1')])),
  );
  const r = (() => {
    try {
      execFileSync('node', [cli, bad], { encoding: 'utf8' });
      return null;
    } catch (e) {
      return e;
    }
  })();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /duplicate id/);
});
