// Synthetic frozen inputs for the reader harness tests: final labels, a snapshot manifest, a frame, pane page-states
// (dom.json rebuilt by rebuild.mjs) and a freeze.json that freeze.mjs's check accepts. No capture is read.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebuildHtml } from '../../merchants/capture/rebuild.mjs';
import { clean, label } from '../../merchants/labels/tests/helpers.mjs';

export { label };
export { nullExpected } from '../../merchants/labels/tests/helpers.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A minimal pane-dom.2 export of a cart page. */
export function paneDoc(body, url = 'https://shop.example/cart') {
  return {
    format: 'pane-dom.2',
    url,
    styleProps: [],
    root: { t: 'html', a: { lang: 'en' }, c: [{ t: 'head', c: [] }, { t: 'body', c: body }] },
  };
}

/**
 * Write a frozen environment into a temp root. pages: { '<domain>/<state>': paneDoc } (pane page-states; their
 * labels get the matching hashes); labels: { development: [label], 'heldout-a': [label] }; frame: [{ domain,
 * operator, regionGroup }].
 */
export function frozenEnv({ pages = {}, labels = {}, frame = [] }) {
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
      snapshotSha256: sha(render),
      domSha256: sha(dom),
      rebuiltSha256: sha(html),
      viewportSha256: sha('v'),
      fullSha256: sha('f'),
    };
  }
  const files = [];
  const add = (role, rel, extra = {}) => {
    files.push({ role, ...extra, path: rel });
  };
  const splitRows = [];
  for (const split of ['development', 'heldout-a']) {
    const ls = (labels[split] ?? []).map((l) => {
      const h = hashes[l.id.split('/').slice(0, 2).join('/')];
      return { ...l, split, ...(h ? { snapshotSha256: h.snapshotSha256, domSha256: h.domSha256 } : {}) };
    });
    for (const l of ls) {
      const domain = l.id.split('/')[0];
      if (!splitRows.some((r) => r.domain === domain)) splitRows.push({ domain, split });
      if (l.origin === 'action' && hashes[l.id])
        entries.push({ id: l.id, split, method: 'pane', ...hashes[l.id] });
    }
    add(
      'labels',
      put(
        `final-${split}.json`,
        JSON.stringify(clean({ schema: 'reader-labels.2', role: 'final', split, adjudicated: [], labels: ls })),
      ),
      { split },
    );
    add('agreement-report', put(`agreement-${split}.json`, JSON.stringify({ split, stop: [] })), { split });
  }
  add('variant-manifest', put('variant-manifest.json', '{"schema":"synthetic"}'));
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
  return { root, freezeFile: 'freeze.json', data: 'data', runsFile: 'runs.json', runsDir: 'runs', hashes };
}
