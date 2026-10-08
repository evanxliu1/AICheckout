import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assemble } from '../assemble-labels.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
function root() {
  const r = mkdtempSync(path.join(os.tmpdir(), 'assemble-'));
  for (const state of ['empty-cart', 'cart-1']) {
    const dir = path.join(r, 'evals/merchants/capture/data/pane/shop.example', state);
    mkdirSync(dir, { recursive: true });
    const dom = `{"state":"${state}"}`;
    writeFileSync(path.join(dir, 'dom.json'), dom);
    writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ sha256: sha(dom) }));
    writeFileSync(path.join(dir, 'render.json'), `{"render":"${state}"}`);
  }
  return r;
}
const batches = [[{ domain: 'shop.example', split: 'development', method: 'pane', ids: ['shop.example/empty-cart', 'shop.example/cart-1'] }]];
const cart1 = {
  id: 'shop.example/cart-1',
  readable: 'top-frame',
  displayed: [{ kind: 'subtotal', amountMinor: 1299, currency: 'USD' }],
  expected: { kind: 'subtotal', amountMinor: 1299, currency: 'USD' },
  expectedReason: null,
  currencyEvidence: 'd-frame',
  currencyConflict: false,
  observedTags: [],
  confidence: 'high',
  notes: '',
};
const empty = {
  id: 'shop.example/empty-cart',
  readable: 'none-displayed',
  displayed: [],
  expected: null,
  expectedReason: 'no-total-displayed',
  currencyEvidence: 'd-frame',
  observedTags: [],
  confidence: 'high',
  notes: '',
};
const labeller = { id: 'labeller-single', model: 'claude-opus-5-5' };

test('assemble: adds split, state, origin and hashes; drops fields the expected forbids', () => {
  const r = root();
  const { files, problems } = assemble([{ batch: 1, stores: [{ domain: 'shop.example', labels: [cart1, empty], problems: [] }] }], batches, { labeller, root: r });
  assert.deepEqual(problems, {});
  const f = files.development;
  assert.equal(f.role, 'labeller');
  assert.deepEqual(
    f.labels.map((l) => l.id),
    ['shop.example/cart-1', 'shop.example/empty-cart'],
  );
  const byId = new Map(f.labels.map((l) => [l.id, l]));
  assert.equal(byId.get('shop.example/cart-1').snapshotSha256, sha('{"render":"cart-1"}'));
  assert.equal(byId.get('shop.example/cart-1').domSha256, sha('{"state":"cart-1"}'));
  assert.equal(byId.get('shop.example/cart-1').expectedReason, undefined);
  assert.equal(byId.get('shop.example/empty-cart').currencyEvidence, undefined);
  assert.equal(byId.get('shop.example/empty-cart').state, 'empty-cart');
});

test('assemble: reports missing, extra and failed labels', () => {
  const r = root();
  const { problems } = assemble(
    [{ batch: 1, stores: [{ domain: 'shop.example', labels: [cart1, { ...cart1, id: 'other.example/cart-1' }], problems: [] }] }, { batch: 2, failed: true, domains: ['shop.example'] }],
    batches,
    { labeller, root: r },
  );
  assert.ok(problems.development.some((p) => /empty-cart: asked for, not labelled/.test(p)));
  assert.ok(problems.development.some((p) => /labeller agent failed/.test(p)));
  assert.ok(problems.unknown.some((p) => /other.example\/cart-1: not asked for/.test(p)));
});
