// Tests of collect-pane-exports.mjs (generic-reader-protocol.11, checklist step 7).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collect, leadingJsonObject, leadingJsonString, resultText } from '../collect-pane-exports.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_TEXT = readFileSync(path.join(here, '..', 'pane-export.js'), 'utf8');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const TAB = '\n\nTab context:\n- Executed in tab-1: "Cart" ("https://shop.example/cart")';

function transcript(dir, entries) {
  const p = path.join(dir, 'agent-test.jsonl');
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}
let n = 0;
const use = (name, input, ts) => {
  const id = `toolu_${++n}`;
  return [id, { timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }];
};
const res = (id, text) => ({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
const JS = 'mcp__Claude_Browser__javascript_tool';
const summary = (json, chunks) =>
  JSON.stringify({ bytes: Buffer.byteLength(json), chunks, format: 'pane-dom.2', iframes: 0, nodes: 3, sha256: sha(json), shadowRoots: 0, truncated: false, url: 'https://shop.example/cart' }, null, 2) + TAB;

function session(dir, json, { split = 1, savedChunk = -1, tamper = false, dropChunk = -1 } = {}) {
  const parts = [];
  const size = Math.ceil(json.length / split);
  for (let i = 0; i < split; i++) parts.push(json.slice(i * size, (i + 1) * size));
  const entries = [];
  const [nav, navE] = use('mcp__Claude_Browser__navigate', { url: 'https://shop.example/cart?x=1', tabId: 'tab-1' }, '2026-10-07T06:00:00.000Z');
  entries.push(navE, res(nav, 'ok'));
  const [ex, exE] = use(JS, { action: 'javascript_exec', tabId: 'tab-1', text: EXPORT_TEXT }, '2026-10-07T06:00:05.000Z');
  entries.push(exE, res(ex, summary(json, split)));
  parts.forEach((p, i) => {
    if (i === dropChunk) return;
    const [c, cE] = use(JS, { action: 'javascript_exec', tabId: 'tab-1', text: `window.__aiCheckoutPaneExport.chunk(${i})` }, `2026-10-07T06:00:1${i}.000Z`);
    entries.push(cE);
    const body = JSON.stringify(tamper && i === 0 ? p.replace('a', 'b') : p);
    if (i === savedChunk) {
      const file = path.join(dir, `saved-${i}.txt`);
      writeFileSync(file, JSON.stringify([{ type: 'text', text: body + TAB }], null, 2));
      entries.push(res(c, `Error: result (999,999 characters) exceeds maximum allowed tokens. Output has been saved to ${file}.\nFormat: JSON array with schema: [{type: string, text: string}]`));
    } else entries.push(res(c, body + TAB));
  });
  return transcript(dir, entries);
}

function setup(json, opts) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'collect-'));
  const t = session(dir, json, opts);
  const rec = path.join(dir, 'shop.example.pane.json');
  writeFileSync(rec, JSON.stringify({ domain: 'shop.example', states: [{ state: 'cart-1', sha256: sha(json) }] }));
  return { dir, t, rec, data: path.join(dir, 'data') };
}

const DOC = JSON.stringify({ format: 'pane-dom.2', url: 'https://shop.example/cart', root: { t: 'html', text: 'Prix 12,99 € "quoted" \\ ünïcødé العربية' } });

test('leading JSON helpers decode a string or object followed by tab context', () => {
  assert.equal(leadingJsonString(JSON.stringify('a"b\\c') + TAB), 'a"b\\c');
  assert.equal(leadingJsonString('{"a":1}'), null);
  assert.deepEqual(leadingJsonObject('{"a":{"b":"}"}}' + TAB), { a: { b: '}' } });
});

test('inline single chunk is written byte-exact with meta and the record is stamped', () => {
  const { t, rec, data } = setup(DOC);
  const r = collect({ transcriptPath: t, recordPath: rec, dataRoot: data, transcriptId: 'wf/agent-test' });
  assert.deepEqual(r.errors, []);
  assert.equal(readFileSync(path.join(data, 'shop.example', 'cart-1', 'dom.json'), 'utf8'), DOC);
  const meta = JSON.parse(readFileSync(path.join(data, 'shop.example', 'cart-1', 'meta.json'), 'utf8'));
  assert.equal(meta.sha256, sha(DOC));
  assert.equal(meta.utc, '2026-10-07T06:00:05.000Z');
  const record = JSON.parse(readFileSync(rec, 'utf8'));
  assert.equal(record.transcriptId, 'wf/agent-test');
  assert.equal(record.startUtc, '2026-10-07T06:00:00.000Z');
  assert.equal(record.timeline[0].url, 'https://shop.example/cart');
  assert.equal(record.timeline[1].js, 'export');
  assert.ok(!JSON.stringify(record.timeline).includes('Prix'));
});

test('multi-chunk export with a chunk saved by the harness to a tool-results file', () => {
  const { t, rec, data } = setup(DOC, { split: 3, savedChunk: 1 });
  const r = collect({ transcriptPath: t, recordPath: rec, dataRoot: data });
  assert.deepEqual(r.errors, []);
  assert.equal(readFileSync(path.join(data, 'shop.example', 'cart-1', 'dom.json'), 'utf8'), DOC);
  assert.equal(resultText([{ type: 'text', text: '"x"' }]).savedFile, null);
});

test('a SHA-256 mismatch or a missing chunk writes nothing and is reported', () => {
  for (const opts of [{ split: 2, tamper: true }, { split: 2, dropChunk: 1 }]) {
    const { t, rec, data } = setup(DOC, opts);
    const r = collect({ transcriptPath: t, recordPath: rec, dataRoot: data });
    assert.equal(r.written.length, 0);
    assert.match(r.errors[0].error, /sha256-mismatch|missing-chunk-1/);
    assert.equal(existsSync(path.join(data, 'shop.example', 'cart-1', 'dom.json')), false);
  }
});

test('a record state whose SHA-256 no export has is reported; evidence goes to evidence/', () => {
  const { t, rec, data } = setup(DOC);
  writeFileSync(rec, JSON.stringify({ domain: 'shop.example', states: [{ state: 'cart-1', sha256: 'f'.repeat(64) }], outcome: { code: 'geo-blocked', evidenceSha256: sha(DOC) } }));
  const r = collect({ transcriptPath: t, recordPath: rec, dataRoot: data });
  assert.equal(r.errors[0].error, 'no-export-with-sha256');
  assert.equal(readFileSync(path.join(data, 'shop.example', 'evidence', 'evidence-1', 'dom.json'), 'utf8'), DOC);
});

test('a record domain with a path separator is refused', () => {
  const { t, rec, data } = setup(DOC);
  writeFileSync(rec, JSON.stringify({ domain: '../x', states: [] }));
  assert.throws(() => collect({ transcriptPath: t, recordPath: rec, dataRoot: data }), /valid domain/);
});

test('states outside the protocol list, a record/summary mismatch and a file the collector did not write are refused', () => {
  const { t, rec, data } = setup(DOC);
  writeFileSync(rec, JSON.stringify({ domain: 'shop.example', states: [{ state: 'checkout-1', sha256: sha(DOC) }] }));
  assert.equal(collect({ transcriptPath: t, recordPath: rec, dataRoot: data }).errors[0].error, 'bad-state-name');
  writeFileSync(rec, JSON.stringify({ domain: 'shop.example', states: [{ state: 'cart-1', sha256: sha(DOC), chunks: 2 }] }));
  assert.equal(collect({ transcriptPath: t, recordPath: rec, dataRoot: data }).errors[0].error, 'record-summary-mismatch');
  const dir = path.join(data, 'shop.example', 'cart-1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'dom.json'), '{"operator":"wrote this"}');
  writeFileSync(rec, JSON.stringify({ domain: 'shop.example', states: [{ state: 'cart-1', sha256: sha(DOC) }] }));
  assert.equal(collect({ transcriptPath: t, recordPath: rec, dataRoot: data }).errors[0].error, 'existing-file-not-from-collector');
});

test('a record whose file name is not its domain is refused', () => {
  const { t, dir, data } = setup(DOC);
  const other = path.join(dir, 'other.example.pane.json');
  writeFileSync(other, JSON.stringify({ domain: 'shop.example', states: [] }));
  assert.throws(() => collect({ transcriptPath: t, recordPath: other, dataRoot: data }), /file name/);
});

test('a retried chunk uses its last result; two exports keep their own chunks; evidence[] form', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'collect-'));
  const a = DOC;
  const b = JSON.stringify({ format: 'pane-dom.2', other: 'second page €' });
  const entries = [];
  const add = (text, result, ts) => {
    const [id, e] = use(JS, { action: 'javascript_exec', tabId: 'tab-1', text }, ts);
    entries.push(e, res(id, result));
  };
  add(EXPORT_TEXT, summary(a, 1), '2026-10-07T07:00:00.000Z');
  add('window.__aiCheckoutPaneExport.chunk(0)', JSON.stringify('garbage') + TAB, '2026-10-07T07:00:01.000Z');
  add('window.__aiCheckoutPaneExport.chunk(0)', JSON.stringify(a) + TAB, '2026-10-07T07:00:02.000Z');
  add(EXPORT_TEXT, summary(b, 1), '2026-10-07T07:00:03.000Z');
  add('window.__aiCheckoutPaneExport.chunk(0)', JSON.stringify(b) + TAB, '2026-10-07T07:00:04.000Z');
  const t = transcript(dir, entries);
  const rec = path.join(dir, 'shop.example.pane.json');
  writeFileSync(rec, JSON.stringify({ domain: 'shop.example', states: [{ state: 'cart-1', sha256: sha(a) }], evidence: [{ name: 'evidence-1', sha256: sha(b) }] }));
  const data = path.join(dir, 'data');
  const r = collect({ transcriptPath: t, recordPath: rec, dataRoot: data });
  assert.deepEqual(r.errors, []);
  assert.equal(readFileSync(path.join(data, 'shop.example', 'cart-1', 'dom.json'), 'utf8'), a);
  assert.equal(readFileSync(path.join(data, 'shop.example', 'evidence', 'evidence-1', 'dom.json'), 'utf8'), b);
  // Collecting again overwrites the collector's own files.
  assert.deepEqual(collect({ transcriptPath: t, recordPath: rec, dataRoot: data }).errors, []);
});

test('a byte-count mismatch and an undecodable chunk are refused', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'collect-'));
  const [ex, exE] = use(JS, { action: 'javascript_exec', text: EXPORT_TEXT }, '2026-10-07T08:00:00.000Z');
  const bad = JSON.parse(summary(DOC, 1).split(TAB)[0]);
  bad.bytes += 1;
  const [c, cE] = use(JS, { action: 'javascript_exec', text: 'window.__aiCheckoutPaneExport.chunk(0)' }, '2026-10-07T08:00:01.000Z');
  const t = transcript(dir, [exE, res(ex, JSON.stringify(bad) + TAB), cE, res(c, JSON.stringify(DOC) + TAB)]);
  const rec = path.join(dir, 'shop.example.pane.json');
  writeFileSync(rec, JSON.stringify({ domain: 'shop.example', states: [{ state: 'cart-1', sha256: sha(DOC) }] }));
  assert.equal(collect({ transcriptPath: t, recordPath: rec, dataRoot: path.join(dir, 'd') }).errors[0].error, 'bytes-mismatch');
  const [c2, cE2] = use(JS, { action: 'javascript_exec', text: 'window.__aiCheckoutPaneExport.chunk(0)' }, '2026-10-07T08:00:02.000Z');
  const t2 = transcript(dir, [exE, res(ex, summary(DOC, 1)), cE2, res(c2, 'Error: tab closed')]);
  assert.equal(collect({ transcriptPath: t2, recordPath: rec, dataRoot: path.join(dir, 'd') }).errors[0].error, 'undecodable-chunk-0');
});
