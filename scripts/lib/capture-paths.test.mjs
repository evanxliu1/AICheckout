import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturePaths } from './capture-paths.mjs';

const root = '/repo/';
const defaults = {
  dir: 'evals/curation/real',
  sources: 'sources.json',
  captures: 'captures',
  manifest: 'manifest.json',
};

test('relative paths stay under --dir, as before', () => {
  assert.deepEqual(capturePaths(root, { ...defaults, report: 'parts/report.json', hints: 'x/hints.json' }), {
    dir: '/repo/evals/curation/real',
    sources: '/repo/evals/curation/real/sources.json',
    captures: '/repo/evals/curation/real/captures',
    manifest: '/repo/evals/curation/real/manifest.json',
    report: '/repo/evals/curation/real/parts/report.json',
    renderer: null,
    hints: '/repo/x/hints.json',
  });
});

test('absolute --captures, --manifest, --report and --renderer are honoured, not nested under --dir', () => {
  const paths = capturePaths(root, {
    ...defaults,
    dir: '/tmp/fresh',
    captures: '/tmp/elsewhere/captures',
    manifest: '/tmp/elsewhere/manifest.json',
    report: '/tmp/elsewhere/report.json',
    renderer: '/tmp/elsewhere/renderer.json',
    hints: '/tmp/hints.json',
  });
  assert.equal(paths.dir, '/tmp/fresh');
  assert.equal(paths.sources, '/tmp/fresh/sources.json');
  assert.equal(paths.captures, '/tmp/elsewhere/captures');
  assert.equal(paths.manifest, '/tmp/elsewhere/manifest.json');
  assert.equal(paths.report, '/tmp/elsewhere/report.json');
  assert.equal(paths.renderer, '/tmp/elsewhere/renderer.json');
  assert.equal(paths.hints, '/tmp/hints.json');
});
