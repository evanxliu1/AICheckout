// Tests of freeze.mjs on synthetic final labels, synthetic pane snapshots and a synthetic robot site record.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, freeze } from '../freeze.mjs';
import { clean, label } from './helpers.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'freeze-'));
  const data = path.join(dir, 'pane');
  // A pane page-state as collect-pane-exports.mjs and render-pane.mjs leave it.
  const pane = (domain, state) => {
    const d = path.join(data, domain, state);
    mkdirSync(d, { recursive: true });
    const files = {
      'dom.json': `{"format":"pane-dom.2","d":"${domain}"}`,
      'rebuilt.html': '<!doctype html>',
      'viewport.png': 'v',
      'full.png': 'f',
    };
    for (const [k, v] of Object.entries(files)) writeFileSync(path.join(d, k), v);
    writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ state, sha256: sha(files['dom.json']) }));
    const render = JSON.stringify({
      format: 'pane-render.1',
      domSha256: sha(files['dom.json']),
      rebuiltSha256: sha(files['rebuilt.html']),
      viewportSha256: sha('v'),
      fullSha256: sha('f'),
    });
    writeFileSync(path.join(d, 'render.json'), render);
    return { snapshotSha256: sha(render), domSha256: sha(files['dom.json']) };
  };
  const dev = pane('dev.example', 'cart-1');
  const ha = pane('held.example', 'cart-1');
  const robotManifest = 'e'.repeat(64);
  const sites = path.join(dir, 'sites.json');
  writeFileSync(
    sites,
    JSON.stringify({
      sites: [
        {
          domain: 'robot.example',
          protocol5: { states: [{ state: 'cart-1', manifestSha256: robotManifest }] },
        },
      ],
    }),
  );
  const final = (split, labels) => {
    const p = path.join(dir, `final-${split}.json`);
    writeFileSync(
      p,
      JSON.stringify(
        clean({
          schema: 'reader-labels.2',
          role: 'final',
          split,
          adjudicated: [],
          labels: labels.map((l) => ({ ...l, split })),
        }),
      ),
    );
    return p;
  };
  const labels = [
    final('development', [
      label('dev.example/cart-1', dev),
      label('robot.example/cart-1', { snapshotSha256: robotManifest }),
      label('dev.example/cart-1/class-rename', dev),
    ]),
    final('heldout-a', [label('held.example/cart-1', ha)]),
  ];
  const variants = path.join(dir, 'variant-manifest.json');
  writeFileSync(variants, '{"schema":"synthetic"}');
  const splits = path.join(dir, 'splits.json');
  writeFileSync(splits, '[]');
  return { dir, data, sites, labels, variants: [variants], splits };
}

test('freeze: snapshot manifest and freeze.json with every hash; --check passes, then catches any change', () => {
  const s = setup();
  const out = freeze({
    ...s,
    commit: 'abc1234',
    utc: '2026-10-07T00:00:00.000Z',
    outDir: s.dir,
    root: s.dir,
  });
  assert.equal(out.schema, 'reader-freeze.1');
  assert.equal(out.commit, 'abc1234');
  assert.deepEqual(
    out.files.map((f) => f.role),
    [
      'labels',
      'labels',
      'variant-manifest',
      'snapshot-manifest',
      'currency-minor-units',
      'item-price-bands',
      'retail-frame-3',
      'splits',
    ],
  );
  assert.equal(out.files[0].path, 'final-development.json');
  const manifest = JSON.parse(readFileSync(path.join(s.dir, 'snapshot-manifest.json'), 'utf8'));
  assert.deepEqual(
    manifest.entries.map((e) => [e.id, e.split, e.method]),
    [
      ['dev.example/cart-1', 'development', 'pane'],
      ['held.example/cart-1', 'heldout-a', 'pane'],
      ['robot.example/cart-1', 'development', 'robot'],
    ],
  );
  assert.equal(manifest.entries[0].viewportSha256, sha('v'));
  const freezeFile = path.join(s.dir, 'freeze.json');
  assert.deepEqual(check(freezeFile, { data: s.data, root: s.dir }), []);
  writeFileSync(path.join(s.data, 'held.example', 'cart-1', 'full.png'), 'changed');
  assert.deepEqual(check(freezeFile, { data: s.data, root: s.dir }), [
    'held.example/cart-1: fullSha256 differs from the freeze',
  ]);
  writeFileSync(s.splits, '[{}]');
  assert.ok(check(freezeFile, { root: s.dir }).includes('splits.json: SHA-256 differs from the freeze'));
});

test('freeze: refuses labels that are not the snapshots, a missing split and a labeller file', () => {
  const s = setup();
  const opts = { ...s, commit: 'x', utc: 'y', outDir: s.dir, root: s.dir };
  assert.throws(() => freeze({ ...opts, labels: [s.labels[0]] }), /one final labels file per split/);
  writeFileSync(path.join(s.data, 'dev.example', 'cart-1', 'viewport.png'), 'changed');
  assert.throws(() => freeze(opts), /dev.example\/cart-1: viewportSha256 differs from render.json/);
  const t = setup();
  const f = JSON.parse(readFileSync(t.labels[1], 'utf8'));
  f.labels[0].snapshotSha256 = 'd'.repeat(64);
  writeFileSync(t.labels[1], JSON.stringify(f));
  assert.throws(
    () => freeze({ ...t, commit: 'x', utc: 'y', outDir: t.dir, root: t.dir }),
    /snapshotSha256 is not render.json's/,
  );
  const r = JSON.parse(readFileSync(t.labels[0], 'utf8'));
  r.labels[1].snapshotSha256 = 'd'.repeat(64);
  writeFileSync(t.labels[0], JSON.stringify(r));
  assert.throws(() => freeze({ ...t, commit: 'x', utc: 'y', outDir: t.dir, root: t.dir }), /no robot state/);
  const u = setup();
  const l = JSON.parse(readFileSync(u.labels[0], 'utf8'));
  writeFileSync(u.labels[0], JSON.stringify({ ...l, role: 'labeller', labeller: { id: 'l1', model: 'm' } }));
  assert.throws(
    () => freeze({ ...u, commit: 'x', utc: 'y', outDir: u.dir, root: u.dir }),
    /not a final labels file/,
  );
});

test('freeze.mjs CLI: writes freeze.json; --check exits 0, then 1 after a change', () => {
  const s = setup();
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'freeze.mjs');
  const args = [
    cli,
    '--root',
    s.dir,
    '--out-dir',
    s.dir,
    '--data',
    s.data,
    '--sites',
    s.sites,
    '--splits',
    s.splits,
  ];
  for (const l of s.labels) args.push('--labels', l);
  args.push('--variants', s.variants[0], '--commit', 'abc', '--utc', '2026-10-07T00:00:00Z');
  execFileSync('node', args, { encoding: 'utf8' });
  const check0 = [cli, '--check', 'freeze.json', '--root', s.dir, '--data', s.data];
  assert.equal(JSON.parse(execFileSync('node', check0, { encoding: 'utf8' })).ok, true);
  writeFileSync(s.variants[0], '{}');
  let err;
  try {
    execFileSync('node', [cli, '--check', 'freeze.json', '--root', s.dir], { encoding: 'utf8' });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.status, 1);
  assert.match(err.stdout, /variant-manifest.json: SHA-256 differs/);
});
