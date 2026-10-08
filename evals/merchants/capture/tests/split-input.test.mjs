// Tests of build-split-input.mjs on synthetic records, exports and site records (no capture is read).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildSplitInput, robotRows } from '../build-split-input.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const doc = (src) =>
  JSON.stringify({
    format: 'pane-dom.2',
    root: { t: 'html', c: [{ t: 'body', c: [{ t: 'script', a: { src } }, { x: 'Cart' }] }] },
  });

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'split-input-'));
  const records = path.join(dir, 'records');
  const data = path.join(dir, 'pane');
  mkdirSync(records);
  const sites = [
    {
      domain: 'robot.example',
      platform: null,
      protocol5: { platform: { group: 'sfcc', marker: '/on/demandware.store/' }, states: [] },
      statusUnderProtocol8: { status: 'captured-stands', method: 'robot' },
    },
    {
      domain: 'pending.example',
      protocol7: { platform: { group: 'none-detected', marker: null }, states: [] },
      statusUnderProtocol8: { status: 'captured-pending-review', method: 'robot' },
    },
    { domain: 'gone.example', statusUnderProtocol8: { status: 'excluded-stands', method: 'robot' } },
    { domain: 'revisit.example', statusUnderProtocol8: { status: 'revisit-pane', method: 'pane' } },
  ];
  const sitesFile = path.join(dir, 'sites.json');
  const writeSites = () => writeFileSync(sitesFile, JSON.stringify({ sites }));
  // A pane store: export files, its record and its sites.json status (all agreeing unless told otherwise).
  const store = (domain, { status = 'captured', states = {}, siteStates, recordStatus = status } = {}) => {
    const exports = [];
    for (const [state, text] of Object.entries(states)) {
      mkdirSync(path.join(data, domain, state), { recursive: true });
      writeFileSync(path.join(data, domain, state, 'dom.json'), text);
      exports.push({ target: state, kind: 'state', sha256: sha(text) });
    }
    writeFileSync(
      path.join(records, `${domain}.pane.json`),
      JSON.stringify({
        schema: 'pane-record.1',
        domain,
        outcome: { status: recordStatus },
        collected: { exports },
      }),
    );
    sites.push({
      domain,
      statusUnderProtocol8: { status: 'revisit-pane', method: 'pane' },
      statusUnderProtocol10: { status, method: 'pane', states: siteStates ?? Object.keys(states) },
    });
    writeSites();
  };
  writeSites();
  const run = () => buildSplitInput({ dataDir: data, recordsDir: records, sitesFile });
  return { dir, records, data, sites, sitesFile, writeSites, store, run };
}

test('split input: pane stores captured in sites.json and their records, robot standing captures, one row each', async () => {
  const f = fixture();
  f.store('shop.example', {
    states: { 'empty-cart': doc('https://cdn.shopify.com/a.js'), 'cart-1': doc('/x.js') },
  });
  f.store('mini.example', { states: { 'minicart-1': doc('/x.js') } });
  f.store('blocked.example', { status: 'excluded', states: {} });
  const r = await f.run();
  assert.deepEqual(r.captured, [
    { domain: 'mini.example', platform: 'none-detected' },
    { domain: 'pending.example', platform: 'none-detected' },
    { domain: 'robot.example', platform: 'sfcc' },
    { domain: 'shop.example', platform: 'shopify' },
  ]);
  assert.deepEqual(r.methods, [
    { domain: 'mini.example', method: 'pane' },
    { domain: 'pending.example', method: 'robot' },
    { domain: 'robot.example', method: 'robot' },
    { domain: 'shop.example', method: 'pane' },
  ]);
  assert.deepEqual(r.skipped, []);
});

test('review M4: sites.json and the pane record must agree', async () => {
  const a = fixture();
  a.store('shop.example', { states: { 'cart-1': doc('/x.js') }, recordStatus: 'incomplete' });
  await assert.rejects(a.run(), /shop.example: sites.json says captured, the record says incomplete/);
  const b = fixture();
  b.store('shop.example', { states: { 'cart-1': doc('/x.js') }, siteStates: ['cart-1', 'cart-qty2'] });
  await assert.rejects(b.run(), /shop.example: sites.json states .* are not the collected states/);
  const c = fixture();
  c.store('shop.example', {
    status: 'incomplete',
    recordStatus: 'captured',
    states: { 'cart-1': doc('/x.js') },
  });
  await assert.rejects(c.run(), /shop.example: the record says captured, sites.json doesn't/);
  const d = fixture();
  d.store('shop.example', { states: { 'empty-cart': doc('/x.js') } });
  await assert.rejects(d.run(), /shop.example: captured without a cart-state export/);
});

test('review M5: every collected export is in the data with its SHA-256, and no state folder is uncollected', async () => {
  const a = fixture();
  a.store('shop.example', { states: { 'cart-1': doc('/x.js'), 'cart-qty2': doc('/y.js') } });
  writeFileSync(path.join(a.data, 'shop.example', 'cart-qty2', 'dom.json'), doc('/changed.js'));
  await assert.rejects(a.run(), /shop.example: cart-qty2 export is not the one the collector recorded/);
  const b = fixture();
  b.store('shop.example', { states: { 'cart-1': doc('/x.js') } });
  mkdirSync(path.join(b.data, 'shop.example', 'cart-2items'));
  await assert.rejects(b.run(), /shop.example: state folder cart-2items has no collected export/);
  const c = fixture();
  c.store('shop.example', { states: { 'cart-1': doc('/x.js') } });
  const lost = path.join(c.records, 'lost.example.pane.json');
  writeFileSync(
    lost,
    JSON.stringify({
      domain: 'lost.example',
      outcome: { status: 'captured' },
      collected: { exports: [{ target: 'cart-1', kind: 'state', sha256: '0'.repeat(64) }] },
    }),
  );
  c.sites.push({
    domain: 'lost.example',
    statusUnderProtocol10: { status: 'captured', method: 'pane', states: ['cart-1'] },
  });
  c.writeSites();
  await assert.rejects(c.run(), /lost.example: cart-1 export is missing in the data/);
});

test('review L5: robot rows exclude pane statuses; duplicate domains are refused', async () => {
  assert.deepEqual(
    robotRows({
      sites: [
        {
          domain: 'p.example',
          platform: { group: 'sfcc' },
          statusUnderProtocol10: { status: 'captured-stands', method: 'pane' },
        },
      ],
    }).rows,
    [],
  );
  assert.deepEqual(
    robotRows({
      sites: [{ domain: 'x.example', statusUnderProtocol9: { status: 'captured-stands', method: 'robot' } }],
    }).skipped,
    [{ domain: 'x.example', reason: 'robot-without-platform' }],
  );
  // The latest status under .8 or later decides; an earlier capture that a later status replaced is not taken.
  assert.deepEqual(
    robotRows({
      sites: [
        {
          domain: 'y.example',
          platform: { group: 'sfcc' },
          statusUnderProtocol8: { status: 'captured-stands' },
          statusUnderProtocol10: { status: 'excluded' },
        },
      ],
    }).rows,
    [],
  );
  const f = fixture();
  f.sites.push({ domain: 'robot.example' });
  f.writeSites();
  await assert.rejects(f.run(), /duplicate domain in sites.json: robot.example/);
});
