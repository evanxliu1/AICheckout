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
  const store = (domain, { status = 'captured', states = {}, collect = Object.keys(states) } = {}) => {
    const exports = [];
    for (const [state, text] of Object.entries(states)) {
      mkdirSync(path.join(data, domain, state), { recursive: true });
      writeFileSync(path.join(data, domain, state, 'dom.json'), text);
      if (collect.includes(state)) exports.push({ target: state, kind: 'state', sha256: sha(text) });
    }
    writeFileSync(
      path.join(records, `${domain}.pane.json`),
      JSON.stringify({ schema: 'pane-record.1', domain, outcome: { status }, collected: { exports } }),
    );
  };
  const sites = path.join(dir, 'sites.json');
  writeFileSync(
    sites,
    JSON.stringify({
      sites: [
        {
          domain: 'robot.example',
          platform: null,
          protocol5: { platform: { group: 'sfcc', marker: '/on/demandware.store/' } },
          statusUnderProtocol8: { status: 'captured-stands' },
        },
        {
          domain: 'pending.example',
          protocol7: { platform: { group: 'none-detected', marker: null } },
          statusUnderProtocol8: { status: 'captured-pending-review' },
        },
        { domain: 'gone.example', statusUnderProtocol8: { status: 'excluded-stands' } },
        { domain: 'revisit.example', statusUnderProtocol8: { status: 'revisit-pane' } },
      ],
    }),
  );
  return { dir, records, data, sites, store };
}

test('split input: pane stores with a collected cart export, robot standing captures, one row each', async () => {
  const f = fixture();
  f.store('shop.example', {
    states: { 'empty-cart': doc('https://cdn.shopify.com/a.js'), 'cart-1': doc('/x.js') },
  });
  f.store('mini.example', { states: { 'minicart-1': doc('/x.js') } });
  f.store('empty.example', { states: { 'empty-cart': doc('/x.js') } });
  f.store('blocked.example', { status: 'excluded', states: { 'cart-1': doc('/x.js') } });
  const r = await buildSplitInput({ dataDir: f.data, recordsDir: f.records, sitesFile: f.sites });
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
  assert.deepEqual(r.skipped, [
    { domain: 'empty.example', reason: 'captured-without-collected-cart-export' },
  ]);
});

test('split input: refuses a stale export and a domain captured by both methods', async () => {
  const f = fixture();
  f.store('shop.example', { states: { 'cart-1': doc('/x.js') } });
  writeFileSync(path.join(f.data, 'shop.example', 'cart-1', 'dom.json'), doc('/changed.js'));
  await assert.rejects(
    buildSplitInput({ dataDir: f.data, recordsDir: f.records, sitesFile: f.sites }),
    /not the one the collector recorded/,
  );
  const g = fixture();
  g.store('robot.example', { states: { 'cart-1': doc('/x.js') } });
  await assert.rejects(
    buildSplitInput({ dataDir: g.data, recordsDir: g.records, sitesFile: g.sites }),
    /both pane and robot/,
  );
});

test('split input: a record captured with no export in the data is skipped, a robot row without platform too', async () => {
  const f = fixture();
  writeFileSync(
    path.join(f.records, 'lost.example.pane.json'),
    JSON.stringify({
      domain: 'lost.example',
      outcome: { status: 'captured' },
      collected: { exports: [{ target: 'cart-1', kind: 'state', sha256: '0'.repeat(64) }] },
    }),
  );
  const r = await buildSplitInput({ dataDir: f.data, recordsDir: f.records, sitesFile: f.sites });
  assert.deepEqual(r.skipped, [{ domain: 'lost.example', reason: 'cart-export-missing-in-data' }]);
  assert.deepEqual(
    robotRows({ sites: [{ domain: 'x.example', statusUnderProtocol9: { status: 'captured-stands' } }] })
      .skipped,
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
});
