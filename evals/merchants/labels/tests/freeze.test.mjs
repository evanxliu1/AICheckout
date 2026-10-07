// Tests of freeze.mjs on synthetic final labels, agreement reports, pane snapshots, pane records and site records.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, freeze } from '../freeze.mjs';
import { clean, label, nullExpected } from './helpers.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const ROBOT_MANIFEST = 'e'.repeat(64);
const OLD_ROBOT_MANIFEST = '9'.repeat(64);

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'freeze-'));
  const data = path.join(dir, 'pane');
  const records = path.join(dir, 'records');
  mkdirSync(records);
  const sites = [
    {
      domain: 'robot.example',
      // A pilot capture that no longer stands, then the standing one.
      states: [{ state: 'cart-1', manifestSha256: OLD_ROBOT_MANIFEST }],
      protocol5: {
        states: [
          { state: 'view-01', manifestSha256: 'a'.repeat(64) },
          { state: 'cart-1', manifestSha256: ROBOT_MANIFEST },
        ],
      },
      statusUnderProtocol8: { status: 'captured-stands', method: 'robot' },
    },
  ];
  const sitesFile = path.join(dir, 'sites.json');
  const writeSites = () => writeFileSync(sitesFile, JSON.stringify({ sites }));
  const snap = {};
  // A pane page-state as collect-pane-exports.mjs and render-pane.mjs leave it, with its record and status.
  const pane = (domain, states) => {
    const exports = [];
    for (const state of states) {
      const d = path.join(data, domain, state);
      mkdirSync(d, { recursive: true });
      const dom = `{"format":"pane-dom.2","d":"${domain}/${state}"}`;
      const files = {
        'dom.json': dom,
        'rebuilt.html': '<!doctype html>',
        'viewport.png': 'v',
        'full.png': 'f',
      };
      for (const [k, v] of Object.entries(files)) writeFileSync(path.join(d, k), v);
      writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ state, sha256: sha(dom) }));
      const render = JSON.stringify({
        format: 'pane-render.1',
        domSha256: sha(dom),
        rebuiltSha256: sha(files['rebuilt.html']),
        viewportSha256: sha('v'),
        fullSha256: sha('f'),
      });
      writeFileSync(path.join(d, 'render.json'), render);
      exports.push({ target: state, kind: 'state', sha256: sha(dom) });
      snap[`${domain}/${state}`] = { snapshotSha256: sha(render), domSha256: sha(dom) };
    }
    writeFileSync(
      path.join(records, `${domain}.pane.json`),
      JSON.stringify({ domain, outcome: { status: 'captured' }, collected: { exports } }),
    );
    sites.push({ domain, statusUnderProtocol10: { status: 'captured', method: 'pane', states } });
    writeSites();
  };
  pane('dev.example', ['cart-1']);
  pane('held.example', ['cart-1']);
  const splitRows = [
    { domain: 'dev.example', split: 'development' },
    { domain: 'robot.example', split: 'development' },
    { domain: 'held.example', split: 'heldout-a' },
  ];
  const splits = path.join(dir, 'splits.json');
  writeFileSync(splits, JSON.stringify(splitRows));
  const finalFile = (split, labels) => {
    const p = path.join(dir, `final-${split}.json`);
    const f = {
      schema: 'reader-labels.2',
      role: 'final',
      split,
      adjudicated: [],
      labels: labels.map((l) => ({ ...l, split })),
    };
    writeFileSync(p, JSON.stringify(clean(f)));
    return p;
  };
  const reportFile = (split, labelsFile, over = {}) => {
    const p = path.join(dir, `report-${split}.json`);
    writeFileSync(
      p,
      JSON.stringify({ split, stop: [], final: { sha256: sha(readFileSync(labelsFile)) }, ...over }),
    );
    return p;
  };
  const devLabels = () => [
    label('dev.example/cart-1', snap['dev.example/cart-1']),
    label('robot.example/cart-1', { snapshotSha256: ROBOT_MANIFEST }),
    label('dev.example/cart-1/class-rename', snap['dev.example/cart-1']),
  ];
  const labels = [
    finalFile('development', devLabels()),
    finalFile('heldout-a', [label('held.example/cart-1', snap['held.example/cart-1'])]),
  ];
  const reports = [reportFile('development', labels[0]), reportFile('heldout-a', labels[1])];
  // One variant manifest per split (variants/generate.mjs shape), with its labels file and one variant export.
  const variantSet = (split, labelsFile) => {
    const id = `${split === 'development' ? 'dev' : 'held'}.example/cart-1/class-rename`;
    const rel = `${split}/${id}/dom.json`;
    const dom = path.join(dir, 'variants', rel);
    mkdirSync(path.dirname(dom), { recursive: true });
    writeFileSync(dom, `{"format":"pane-dom.2","v":"${id}"}`);
    const vl = path.join(dir, `${split}-variant-labels.json`);
    writeFileSync(vl, JSON.stringify({ schema: 'reader-labels.2', role: 'final', split, labels: [] }));
    const m = path.join(dir, `${split}-manifest.json`);
    writeFileSync(
      m,
      JSON.stringify({
        schema: 'reader-variants.1',
        split,
        baseLabels: { path: path.basename(labelsFile), sha256: sha(readFileSync(labelsFile)) },
        variantLabels: { path: path.basename(vl), sha256: sha(readFileSync(vl)) },
        dataRoot: 'variants',
        variants: [{ id, path: rel, domSha256: sha(readFileSync(dom)) }],
      }),
    );
    return { manifest: m, dom, labels: vl };
  };
  const vsets = [variantSet('development', labels[0]), variantSet('heldout-a', labels[1])];
  const opts = {
    labels,
    reports,
    variants: vsets.map((v) => v.manifest),
    splits,
    data,
    sites: sitesFile,
    records,
    commit: 'abc1234',
    utc: '2026-10-07T00:00:00.000Z',
    outDir: dir,
    root: dir,
  };
  return {
    dir,
    data,
    records,
    sites,
    writeSites,
    snap,
    splitRows,
    splits,
    finalFile,
    reportFile,
    devLabels,
    vsets,
    variantSet,
    opts,
  };
}

test('freeze: snapshot manifest and freeze.json with every hash; --check passes, then catches any change', () => {
  const s = setup();
  const out = freeze(s.opts);
  assert.equal(out.schema, 'reader-freeze.1');
  assert.equal(out.commit, 'abc1234');
  assert.deepEqual(
    out.files.map((f) => f.role),
    [
      'labels',
      'labels',
      'agreement-report',
      'agreement-report',
      'variant-manifest',
      'variant-labels',
      'variant-manifest',
      'variant-labels',
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
  assert.throws(() => freeze({ ...s.opts, labels: [s.opts.labels[0]] }), /one final labels file per split/);
  writeFileSync(path.join(s.data, 'dev.example', 'cart-1', 'viewport.png'), 'changed');
  assert.throws(() => freeze(s.opts), /dev.example\/cart-1: viewportSha256 differs from render.json/);
  const t = setup();
  const held = t.finalFile('heldout-a', [
    label('held.example/cart-1', { ...t.snap['held.example/cart-1'], snapshotSha256: 'd'.repeat(64) }),
  ]);
  const tr = [t.opts.reports[0], t.reportFile('heldout-a', held)];
  assert.throws(() => freeze({ ...t.opts, reports: tr }), /snapshotSha256 is not render.json's/);
  const u = setup();
  const l = JSON.parse(readFileSync(u.opts.labels[0], 'utf8'));
  writeFileSync(
    u.opts.labels[0],
    JSON.stringify({ ...l, role: 'labeller', labeller: { id: 'l1', model: 'm' } }),
  );
  assert.throws(() => freeze(u.opts), /not a final labels file/);
});

test('review M1: labels match splits.json and every captured real page-state has exactly one label', () => {
  // A label whose domain is assigned to the other split.
  const a = setup();
  a.splitRows[0].split = 'heldout-a';
  writeFileSync(a.splits, JSON.stringify(a.splitRows));
  assert.throws(
    () => freeze(a.opts),
    /dev.example\/cart-1: dev.example is in heldout-a, the label in development/,
  );
  // A collected state with no label.
  const b = setup();
  const rec = path.join(b.records, 'dev.example.pane.json');
  const r = JSON.parse(readFileSync(rec, 'utf8'));
  r.collected.exports.push({ target: 'cart-qty2', kind: 'state', sha256: '1'.repeat(64) });
  writeFileSync(rec, JSON.stringify(r));
  assert.throws(
    () => freeze(b.opts),
    /dev.example\/cart-qty2: captured real page-state without a final label/,
  );
  // A label for a state that was not captured.
  const c = setup();
  const dev = c.finalFile('development', [
    ...c.devLabels(),
    label('dev.example/cart-qty2', c.snap['dev.example/cart-1']),
  ]);
  assert.throws(
    () =>
      freeze({
        ...c.opts,
        labels: [dev, c.opts.labels[1]],
        reports: [c.reportFile('development', dev), c.opts.reports[1]],
      }),
    /dev.example\/cart-qty2: labelled but not a captured real page-state/,
  );
  // A label for a domain that is in no split.
  const d = setup();
  writeFileSync(d.splits, JSON.stringify(d.splitRows.filter((x) => x.domain !== 'robot.example')));
  assert.throws(() => freeze(d.opts), /robot.example\/cart-1: robot.example is in no split/);
});

test('review M2: agreement reports with no stop and the frozen labels hash; currency-undetermined at most 10%', () => {
  const a = setup();
  assert.throws(
    () => freeze({ ...a.opts, reports: [a.opts.reports[0]] }),
    /no agreement report for heldout-a/,
  );
  const stopped = a.reportFile('heldout-a', a.opts.labels[1], { stop: ['expected-agreement-below-90'] });
  assert.throws(
    () => freeze({ ...a.opts, reports: [a.opts.reports[0], stopped] }),
    /heldout-a: the agreement report has stop rules/,
  );
  const b = setup();
  const other = b.reportFile('heldout-a', b.opts.labels[1], { final: { sha256: '0'.repeat(64) } });
  assert.throws(
    () => freeze({ ...b.opts, reports: [b.opts.reports[0], other] }),
    /heldout-a: the agreement report is not for these final labels/,
  );
  const c = setup();
  const und = c.finalFile('heldout-a', [
    label(
      'held.example/cart-1',
      nullExpected('currency-undetermined', {
        ...c.snap['held.example/cart-1'],
        displayed: [{ kind: 'subtotal', amountMinor: 1299, currency: null }],
      }),
    ),
  ]);
  assert.throws(
    () =>
      freeze({
        ...c.opts,
        labels: [c.opts.labels[0], und],
        reports: [c.opts.reports[0], c.reportFile('heldout-a', und)],
      }),
    /heldout-a: more than 10% of real cart-1 currency-undetermined \(1 of 1\)/,
  );
});

test('review L2: a pane export must be the one the committed record collected', () => {
  const s = setup();
  const rec = path.join(s.records, 'held.example.pane.json');
  const r = JSON.parse(readFileSync(rec, 'utf8'));
  r.collected.exports[0].sha256 = '2'.repeat(64);
  writeFileSync(rec, JSON.stringify(r));
  assert.throws(
    () => freeze(s.opts),
    /held.example\/cart-1: dom.json is not the export the record collected/,
  );
});

test("review L4: a robot label matches the standing capture's states only", () => {
  const s = setup();
  const dev = s.finalFile('development', [
    label('dev.example/cart-1', s.snap['dev.example/cart-1']),
    label('robot.example/cart-1', { snapshotSha256: OLD_ROBOT_MANIFEST }),
  ]);
  assert.throws(
    () =>
      freeze({
        ...s.opts,
        labels: [dev, s.opts.labels[1]],
        reports: [s.reportFile('development', dev), s.opts.reports[1]],
      }),
    /robot.example\/cart-1: not the standing robot capture's manifest/,
  );
});

test('review L3: --check requires every role', () => {
  const s = setup();
  freeze(s.opts);
  const file = path.join(s.dir, 'freeze.json');
  const f = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(
    file,
    JSON.stringify({
      ...f,
      files: f.files.filter(
        (e) => !(e.role === 'labels' && e.split === 'heldout-a') && e.role !== 'item-price-bands',
      ),
    }),
  );
  assert.deepEqual(check(file, { root: s.dir }), [
    'missing role labels for heldout-a',
    'missing role item-price-bands',
  ]);
});

test('freeze.mjs CLI: writes freeze.json; --check exits 0, then 1 after a change', () => {
  const s = setup();
  const o = s.opts;
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'freeze.mjs');
  const args = [
    cli,
    '--root',
    o.root,
    '--out-dir',
    o.outDir,
    '--data',
    o.data,
    '--sites',
    o.sites,
    '--records',
    o.records,
  ];
  args.push('--splits', o.splits);
  for (const l of o.labels) args.push('--labels', l);
  for (const r of o.reports) args.push('--report', r);
  for (const v of o.variants) args.push('--variants', v);
  args.push('--commit', 'abc', '--utc', '2026-10-07T00:00:00Z');
  execFileSync('node', args, { encoding: 'utf8' });
  const check0 = [cli, '--check', 'freeze.json', '--root', s.dir, '--data', s.data];
  assert.equal(JSON.parse(execFileSync('node', check0, { encoding: 'utf8' })).ok, true);
  writeFileSync(o.variants[0], '{}');
  let err;
  try {
    execFileSync('node', [cli, '--check', 'freeze.json', '--root', s.dir], { encoding: 'utf8' });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.status, 1);
  assert.match(err.stdout, /development-manifest.json: SHA-256 differs/);
});

test('review M4: one variant manifest per split, for the frozen labels, with its labels and exports unchanged', () => {
  const a = setup();
  assert.throws(
    () => freeze({ ...a.opts, variants: [a.opts.variants[0]] }),
    /one variant manifest per split/,
  );
  assert.throws(
    () => freeze({ ...a.opts, variants: [a.opts.variants[0], a.opts.variants[0]] }),
    /two variant manifests for development/,
  );
  // A manifest generated from other final labels.
  const b = setup();
  const stale = b.variantSet('heldout-a', b.opts.labels[0]);
  assert.throws(
    () => freeze({ ...b.opts, variants: [b.opts.variants[0], stale.manifest] }),
    /heldout-a: the variant manifest is not for these final labels/,
  );
  const c = setup();
  writeFileSync(c.vsets[1].labels, '{"labels":[1]}');
  assert.throws(() => freeze(c.opts), /heldout-a: the variant labels file differs from the manifest/);
  const d = setup();
  writeFileSync(d.vsets[0].dom, '{}');
  assert.throws(
    () => freeze(d.opts),
    /development: dev.example\/cart-1\/class-rename: variant export differs from the manifest/,
  );
  // --check with --data re-hashes the variant exports too; it needs a variant manifest per split.
  const e = setup();
  freeze(e.opts);
  const file = path.join(e.dir, 'freeze.json');
  assert.deepEqual(check(file, { data: e.data, root: e.dir }), []);
  writeFileSync(e.vsets[1].dom, '{"changed":1}');
  assert.deepEqual(check(file, { data: e.data, root: e.dir }), [
    'heldout-a: held.example/cart-1/class-rename: variant export differs from the manifest',
  ]);
  assert.deepEqual(check(file, { root: e.dir }), []);
  const f = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(
    file,
    JSON.stringify({
      ...f,
      files: f.files.filter((x) => !(x.split === 'heldout-a' && x.role.startsWith('variant'))),
    }),
  );
  assert.deepEqual(check(file, { root: e.dir }), [
    'missing role variant-manifest for heldout-a',
    'missing role variant-labels for heldout-a',
  ]);
});
