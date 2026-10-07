// Synthetic frozen inputs for the reader harness tests: final labels, variant manifests and variant labels, a
// snapshot manifest, a frame, pane page-states (dom.json rebuilt by rebuild.mjs), variant exports, robot snapshots
// and a freeze.json that freeze.mjs's check accepts. No capture is read.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebuildHtml } from '../../merchants/capture/rebuild.mjs';
import { clean, label } from '../../merchants/labels/tests/helpers.mjs';

export { label };
export { nullExpected } from '../../merchants/labels/tests/helpers.mjs';
export const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A minimal pane-dom.2 export of a cart page. */
export function paneDoc(body, url = 'https://shop.example/cart') {
  return {
    format: 'pane-dom.2',
    url,
    styleProps: [],
    root: { t: 'html', a: { lang: 'en' }, c: [{ t: 'head', c: [] }, { t: 'body', c: body }] },
  };
}

/** A temp dir under a git repository with every file committed (for the committed runs.json rule). */
export function commitAll(root, message = 'test') {
  const g = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    g('rev-parse', '--git-dir');
  } catch {
    g('init', '-q');
  }
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', message);
}

/**
 * Write a frozen environment into a temp root.
 *   pages:    { '<domain>/<state>': paneDoc }              pane page-states (labels get the matching hashes)
 *   robots:   { '<domain>/<state>': { mhtml, url } }       robot snapshots (session S1 in sites.json)
 *   variants: { '<domain>/<state>/<transform>': { doc, label } }  variant exports and their labels
 *   labels:   { development: [label], 'heldout-a': [label] }
 *   frame:    [{ domain, operator, regionGroup }]
 */
export function frozenEnv({ pages = {}, robots = {}, variants = {}, labels = {}, frame = [] }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-harness-'));
  const put = (rel, text) => {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    return rel;
  };
  const entries = [];
  const hashes = {};
  for (const [id, doc] of Object.entries(pages)) {
    const dir = path.join('data', 'pane', id);
    const dom = JSON.stringify(doc);
    const html = rebuildHtml(doc);
    put(path.join(dir, 'dom.json'), dom);
    put(path.join(dir, 'rebuilt.html'), html);
    put(path.join(dir, 'viewport.png'), 'v');
    put(path.join(dir, 'full.png'), 'f');
    put(path.join(dir, 'meta.json'), JSON.stringify({ state: id.split('/')[1], sha256: sha(dom), url: doc.url }));
    const render = JSON.stringify({
      format: 'pane-render.1',
      domSha256: sha(dom),
      rebuiltSha256: sha(html),
      viewportSha256: sha('v'),
      fullSha256: sha('f'),
    });
    put(path.join(dir, 'render.json'), render);
    hashes[id] = {
      method: 'pane',
      snapshotSha256: sha(render),
      domSha256: sha(dom),
      rebuiltSha256: sha(html),
      viewportSha256: sha('v'),
      fullSha256: sha('f'),
    };
  }
  const sites = [];
  for (const [id, { mhtml, url }] of Object.entries(robots)) {
    const [domain, state] = id.split('/');
    const dir = path.join('data', domain, 'S1', state);
    put(path.join(dir, 'page.mhtml'), mhtml);
    const meta = JSON.stringify({ viewport: { width: 1280, height: 900 } });
    put(path.join(dir, 'meta.json'), meta);
    const manifest = JSON.stringify({
      schema: 'synthetic',
      domain,
      state,
      url,
      files: { 'page.mhtml': sha(mhtml), 'meta.json': sha(meta) },
    });
    put(path.join(dir, 'manifest.json'), manifest);
    hashes[id] = { method: 'robot', snapshotSha256: sha(manifest), domSha256: sha('dom') };
    sites.push({
      domain,
      protocol5: { states: [{ state, manifestSha256: sha(manifest) }], capture: { sessionId: 'S1' } },
    });
  }
  put('sites.json', JSON.stringify({ sites }));
  const files = [];
  const add = (role, rel, extra = {}) => files.push({ role, ...extra, path: rel });
  const splitRows = [];
  for (const split of ['development', 'heldout-a']) {
    const ls = (labels[split] ?? []).map((l) => {
      const h = hashes[l.id];
      return { ...l, split, ...(h ? { snapshotSha256: h.snapshotSha256, domSha256: h.domSha256 } : {}) };
    });
    for (const l of ls) {
      const domain = l.id.split('/')[0];
      if (!splitRows.some((r) => r.domain === domain)) splitRows.push({ domain, split });
      if (hashes[l.id]) {
        const { method, ...h } = hashes[l.id];
        entries.push(
          method === 'pane'
            ? { id: l.id, split, method, ...h }
            : { id: l.id, split, method, snapshotSha256: h.snapshotSha256, domSha256: h.domSha256 },
        );
      }
    }
    const labelsRel = put(
      `final-${split}.json`,
      JSON.stringify(clean({ schema: 'reader-labels.2', role: 'final', split, adjudicated: [], labels: ls })),
    );
    add('labels', labelsRel, { split });
    add('agreement-report', put(`agreement-${split}.json`, JSON.stringify({ split, stop: [] })), { split });
    // Variants of this split's domains.
    const vls = [];
    const ventries = [];
    for (const [id, v] of Object.entries(variants)) {
      if (!ls.some((l) => l.id.split('/')[0] === id.split('/')[0])) continue;
      const rel = `${split}/${id}/dom.json`;
      const dom = JSON.stringify(v.doc);
      put(path.join('data', 'variants', rel), dom);
      const meta = JSON.stringify({ schema: 'reader-variant.1', id, domSha256: sha(dom) }) + '\n';
      put(path.join('data', 'variants', split, id, 'variant.json'), meta);
      vls.push({ ...v.label, id, split, origin: 'variant', domSha256: sha(dom), snapshotSha256: sha(meta) });
      ventries.push({
        id,
        transform: id.split('/')[2],
        path: rel,
        domSha256: sha(dom),
        variantSha256: sha(meta),
      });
    }
    const vlabelsRel = put(
      `variants/${split}-variant-labels.json`,
      JSON.stringify(clean({ schema: 'reader-labels.2', role: 'final', split, labels: vls })),
    );
    const manifestRel = put(
      `variants/${split}-manifest.json`,
      JSON.stringify({
        schema: 'reader-variants.1',
        split,
        baseLabels: { path: labelsRel, sha256: sha(readFileSync(path.join(root, labelsRel))) },
        variantLabels: { path: vlabelsRel, sha256: sha(readFileSync(path.join(root, vlabelsRel))) },
        dataRoot: 'data/variants',
        counts: {
          eligible: { 'class-rename': ventries.length + 1 },
          generated: { 'class-rename': ventries.length },
          skipped: 1,
        },
        skips: {
          byReason: { 'expected-row-not-found': 1 },
          byTransform: { 'class-rename': { 'expected-row-not-found': 1 } },
          entries: [],
        },
        variants: ventries,
      }),
    );
    add('variant-manifest', manifestRel, { split });
    add('variant-labels', vlabelsRel, { split });
  }
  add('snapshot-manifest', put('snapshot-manifest.json', JSON.stringify({ schema: 'reader-snapshots.1', entries })));
  add('currency-minor-units', put('currency-minor-units.json', '{"synthetic":true}'));
  add('item-price-bands', put('item-price-bands.json', '{"synthetic":true}'));
  add('retail-frame-3', put('retail-frame-3.json', JSON.stringify({ domains: frame })));
  add('splits', put('splits.json', JSON.stringify(splitRows)));
  for (const f of files) f.sha256 = sha(readFileSync(path.join(root, f.path)));
  put(
    'freeze.json',
    JSON.stringify({ schema: 'reader-freeze.1', commit: 'abc1234', utc: '2026-10-07T00:00:00.000Z', files }),
  );
  return {
    root,
    freezeFile: 'freeze.json',
    data: 'data',
    variantData: 'data/variants',
    sitesFile: 'sites.json',
    runsFile: 'runs.json',
    runsDir: 'runs',
    hashes,
  };
}
