// The blind audit's deterministic parts: the labels gate and the comparison. Synthetic data only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLabels, sheetSections } from '../check-labels.mjs';
import { compareStore, standsAfter } from '../score.mjs';

const record = (extra = {}) => ({
  id: 'kroger-us',
  name: 'Kroger',
  hosts: ['kroger.com'],
  kind: 'merchant',
  physicalGoods: true,
  category: 'supermarkets',
  evidence: { basis: 'definition', sourceIds: ['kroger-com-page-1', 'chase-rewards-category-faq'] },
  brandIds: [],
  disabled: false,
  ...extra,
});
const label = (extra = {}) => ({
  domain: 'kroger.com',
  kind: 'merchant',
  physicalGoods: true,
  brandIds: [],
  category: 'supermarkets',
  basis: 'definition',
  quotes: [],
  notes: null,
  ...extra,
});

test('compareStore: agreement gives no disagreement', () => {
  assert.deepEqual(compareStore(record(), label()), []);
});

test('compareStore: a bonus the auditor does not support, a different bonus, and cant-tell are wrong-bonus subtypes', () => {
  assert.equal(compareStore(record(), label({ category: 'general-merchandise', basis: 'default' }))[0].subtype, 'unsupported');
  assert.equal(compareStore(record(), label({ category: 'dining' }))[0].subtype, 'different');
  assert.equal(compareStore(record(), label({ category: 'cant-tell', basis: null }))[0].subtype, 'cant-tell');
  for (const out of [
    compareStore(record(), label({ category: 'dining' })),
    compareStore(record(), label({ category: 'cant-tell', basis: null })),
  ])
    assert.equal(out[0].type, 'wrong-bonus');
});

test('compareStore: a default record the auditor would grant a bonus is a missed bonus; cant-tell is not', () => {
  const r = record({ category: 'general-merchandise', evidence: { basis: 'default', sourceIds: [] } });
  assert.equal(compareStore(r, label())[0].type, 'missed-bonus');
  assert.deepEqual(compareStore(r, label({ category: 'cant-tell', basis: null })), []);
  assert.deepEqual(compareStore(r, label({ category: 'general-merchandise', basis: 'default' })), []);
});

test('compareStore: brands, kind and goods, with cant-tell never a disagreement', () => {
  const r = record({ brandIds: ['kroger'] });
  assert.equal(compareStore(r, label({ brandIds: [] }))[0].subtype, 'auditor-drops');
  assert.equal(compareStore(r, label({ brandIds: ['kroger', 'ralphs'] }))[0].subtype, 'auditor-adds');
  assert.equal(compareStore(r, label({ brandIds: ['ralphs'] }))[0].subtype, 'different');
  assert.deepEqual(compareStore(r, label({ brandIds: 'cant-tell' })), []);
  assert.equal(compareStore(record(), label({ kind: 'marketplace' }))[0].type, 'wrong-kind');
  assert.deepEqual(compareStore(record(), label({ kind: 'cant-tell' })), []);
  assert.equal(compareStore(record(), label({ physicalGoods: false }))[0].type, 'wrong-goods');
  assert.deepEqual(compareStore(record(), label({ physicalGoods: 'cant-tell' })), []);
});

test('standsAfter: a record error stands unless the adjudicator sides with the record; a missed bonus only when it sides with the auditor', () => {
  const wrong = { type: 'wrong-bonus' };
  assert.equal(standsAfter(wrong, undefined), true);
  assert.equal(standsAfter(wrong, 'record'), false);
  assert.equal(standsAfter(wrong, 'auditor'), true);
  assert.equal(standsAfter(wrong, 'neither'), true);
  const missed = { type: 'missed-bonus' };
  assert.equal(standsAfter(missed, 'auditor'), true);
  assert.equal(standsAfter(missed, 'record'), false);
  assert.equal(standsAfter(missed, 'neither'), false);
});

test('checkLabels: order, ids, verbatim quotes, the 25-word limit and forbidden files', () => {
  const packet = { packet: 3, domains: ['a.com', 'b.com'] };
  const lists = { brands: [{ id: 'kroger', name: 'Kroger' }], categories: ['supermarkets', 'general-merchandise'] };
  const sheet = sheetSections('# a.com\n\n## a-com-page-1 (store page) https://a.com/\n\n```\nWe are a grocery store chain in Ohio.\n```\n');
  const sheets = new Map([['a.com', sheet], ['b.com', new Map()]]);
  const ok = {
    schemaVersion: 1,
    packet: 3,
    provenance: 'agent-verified',
    auditor: { agent: 'merchant-auditor', model: 'm', date: '2026-10-11', filesRead: ['evals/merchants/db/audit/packets/3/packet.json'] },
    stores: [
      label({ domain: 'a.com', quotes: [{ source: 'a-com-page-1', quote: 'grocery store chain', supports: 'category' }, { source: 'a-com-page-1', quote: 'We are a grocery store chain', supports: 'definition' }] }),
      label({ domain: 'b.com', category: 'general-merchandise', basis: 'default' }),
    ],
  };
  assert.deepEqual(checkLabels({ packet, labels: ok, sheets, lists }), []);
  const bad = structuredClone(ok);
  bad.stores.reverse();
  bad.stores[1].quotes[0].quote = 'grocery store chain in Texas';
  bad.stores[1].quotes.push({ source: 'a-com-page-1', quote: 'w '.repeat(26).trim(), supports: 'kind' });
  bad.stores[0].brandIds = ['nobody'];
  bad.auditor.filesRead.push('evals/merchants/db/records/a-us.json');
  const errors = checkLabels({ packet, labels: bad, sheets, lists });
  assert.ok(errors.some((e) => e.includes('domains must be')));
  assert.ok(errors.some((e) => e.includes('not found verbatim')));
  assert.ok(errors.some((e) => e.includes('over 25 words')));
  assert.ok(errors.some((e) => e.includes('not a catalog brand id')));
  assert.ok(errors.some((e) => e.includes('must not read')));
});

test('checkLabels: a bonus needs a non-default basis and quotes; cant-tell needs a null basis', () => {
  const packet = { packet: 1, domains: ['a.com'] };
  const lists = { brands: [], categories: ['dining', 'general-merchandise'] };
  const sheets = new Map([['a.com', new Map()]]);
  const base = { schemaVersion: 1, packet: 1, provenance: 'agent-verified', auditor: { agent: 'merchant-auditor', model: 'm', date: '2026-10-11', filesRead: ['x'] } };
  const run = (store) => checkLabels({ packet, labels: { ...base, stores: [label({ domain: 'a.com', ...store })] }, sheets, lists });
  assert.ok(run({ category: 'dining', basis: 'default' }).some((e) => e.includes('needs issuer, corroborated or definition')));
  assert.ok(run({ category: 'dining', basis: 'issuer', quotes: [] }).some((e) => e.includes('needs a category or definition quote')));
  assert.ok(run({ category: 'cant-tell', basis: 'default' }).some((e) => e.includes('null when the category')));
  assert.ok(run({ category: 'general-merchandise', basis: 'definition' }).some((e) => e.includes('general-merchandise is default')));
});
