#!/usr/bin/env node
// Collector of pane exports (generic-reader-protocol.11, checklist step 7). The coordinator runs it after each pane
// operator session; the operator no longer writes `dom.json` itself.
//
//   node evals/merchants/capture/collect-pane-exports.mjs <transcript.jsonl> --record <records/<domain>.pane.json>
//        [--data <capture/data/pane>] [--transcript-id <id>] [--dry-run]
//
// Why: the pane JavaScript tool returns at most a few hundred kilobytes of text; a larger result (most `pane-dom.2`
// chunks) is saved by the Claude Code harness to a tool-results file as a JSON array of text blocks instead of being
// returned. The operator's tools (Write; Bash limited to shasum, ls, cat, head, wc) can't turn that file back into the
// export, so in the 2026-10-07 pilot no export could be saved. This script reads the operator's transcript, which
// holds every JavaScript call and its result (inline, or the path of the saved file), and for each export:
//   - finds the export call (the exact text of pane-export.js) and its summary ({format, bytes, sha256, chunks, ...});
//   - takes the chunk fetches `window.__aiCheckoutPaneExport.chunk(i)` that follow it, before the next export, the
//     last result for each i;
//   - decodes each chunk (a JSON string literal at the start of the result text, inline or in the saved file);
//   - joins them in order and checks the UTF-8 SHA-256 and byte count against the summary; a mismatch is reported
//     and nothing is written for that export.
// The export is matched to a state by its SHA-256 in the operator's record (`states[]`, and `evidence` for judgement
// exclusions): `data/pane/<domain>/<state>/dom.json` + `meta.json`, or `data/pane/<domain>/evidence/<name>/`.
// It also stamps the record with the transcript ID, start and end UTC times and a `timeline` (every tool call of the
// session in order with its UTC time, tool, action and masked URL), since the operator has no clock.
// It never sends anything anywhere and never reads a page.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { maskPath } from './guards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const EXPORT_TEXT = readFileSync(path.join(here, 'pane-export.js'), 'utf8').trim();
const CHUNK_CALL = /^window\.__aiCheckoutPaneExport\.chunk\((\d{1,4})\);?$/;
const SAVED = /Output has been saved to (\S+?\.txt)/;
const JS_TOOL = /javascript_tool$/;
/** The protocol's pane states (step 7); anything else in a record's states[] is refused. */
export const STATES = new Set(['empty-cart', 'minicart-1', 'cart-1', 'cart-qty2', 'cart-2items', 'cart-other']);

/** The leading JSON string literal of a result text, decoded; null when the text doesn't start with one. */
export function leadingJsonString(text) {
  const t = text.trimStart();
  if (t[0] !== '"') return null;
  for (let i = 1; i < t.length; i++) {
    if (t[i] === '\\') i++;
    else if (t[i] === '"') return JSON.parse(t.slice(0, i + 1));
  }
  return null;
}

/** The leading JSON object of a result text (the export summary), parsed; null otherwise. */
export function leadingJsonObject(text) {
  const t = text.trimStart();
  if (t[0] !== '{') return null;
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(t.slice(0, i + 1));
  }
  return null;
}

const blocksText = (content) =>
  typeof content === 'string' ? content : (content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');

/** Text of one tool result: inline, or read back from the harness's saved tool-results file. */
export function resultText(content, readFile = (p) => readFileSync(p, 'utf8')) {
  const inline = blocksText(content);
  const saved = inline.match(SAVED);
  if (saved && !inline.trimStart().startsWith('"') && !inline.trimStart().startsWith('{')) {
    return { text: blocksText(JSON.parse(readFile(saved[1]))), savedFile: saved[1] };
  }
  return { text: inline, savedFile: null };
}

/** Ordered tool calls of a transcript with their results: [{id, name, input, utc, content}]. */
export function toolCalls(lines) {
  const calls = [];
  const byId = new Map();
  for (const e of lines) {
    const c = e.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'tool_use') {
        const call = { id: b.id, name: b.name, input: b.input || {}, utc: e.timestamp || null, content: null };
        calls.push(call);
        byId.set(b.id, call);
      } else if (b.type === 'tool_result' && byId.has(b.tool_use_id)) byId.get(b.tool_use_id).content = b.content;
    }
  }
  return calls;
}

/** Exports found in the calls: [{summary, utc, chunks: Map(i -> {text, savedFile})}]. */
export function findExports(calls, readFile) {
  const exports = [];
  let current = null;
  for (const call of calls) {
    if (!JS_TOOL.test(call.name)) continue;
    const text = String(call.input.text || '').trim();
    if (text === EXPORT_TEXT) {
      const summary = call.content ? leadingJsonObject(resultText(call.content, readFile).text) : null;
      current = { summary, utc: call.utc, chunks: new Map() };
      exports.push(current);
      continue;
    }
    const m = text.match(CHUNK_CALL);
    if (m && current && call.content) current.chunks.set(Number(m[1]), resultText(call.content, readFile));
  }
  return exports;
}

/** Joined and checked export text, or {error}. */
export function assemble(exp) {
  const s = exp.summary;
  if (!s || typeof s.sha256 !== 'string' || !Number.isInteger(s.chunks)) return { error: 'no-summary' };
  const parts = [];
  for (let i = 0; i < s.chunks; i++) {
    const r = exp.chunks.get(i);
    if (!r) return { error: `missing-chunk-${i}` };
    const part = leadingJsonString(r.text);
    if (part === null) return { error: `undecodable-chunk-${i}` };
    parts.push(part);
  }
  const json = parts.join('');
  const got = sha256(json);
  if (got !== s.sha256) return { error: 'sha256-mismatch', got };
  if (Buffer.byteLength(json, 'utf8') !== s.bytes) return { error: 'bytes-mismatch' };
  return { json };
}

const maskUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.origin}${maskPath(x.pathname)}`;
  } catch {
    return null;
  }
};

/** Text-free timeline of the session's tool calls. */
export function timeline(calls) {
  return calls.map((c, n) => {
    const row = { n, utc: c.utc, tool: c.name.replace(/^mcp__Claude_Browser__/, '') };
    if (c.input.action) row.action = c.input.action;
    if (c.input.url) row.url = maskUrl(c.input.url) ?? String(c.input.url).slice(0, 40);
    if (c.name.endsWith('browser_batch')) row.batch = (c.input.actions || []).map((a) => a.name);
    if (JS_TOOL.test(c.name)) {
      const t = String(c.input.text || '').trim();
      row.js = t === EXPORT_TEXT ? 'export' : CHUNK_CALL.test(t) ? 'chunk' : t.startsWith('// Pane robots') ? 'robots' : 'other';
    }
    return row;
  });
}

/** Targets in the record: [{kind: 'state'|'evidence', name, sha256}]. */
export function recordTargets(record) {
  const out = [];
  const states = Array.isArray(record.states) ? record.states : Object.entries(record.states || {}).map(([state, v]) => ({ state, ...v }));
  for (const s of states) {
    const sha = s.sha256 || s.exportSha256 || s.meta?.sha256;
    if (s.state && sha) out.push({ kind: 'state', name: s.state, sha256: sha, bytes: s.bytes, chunks: s.chunks });
  }
  const ev = record.evidence ? (Array.isArray(record.evidence) ? record.evidence : [record.evidence]) : [];
  ev.forEach((e, i) => {
    const sha = e.sha256 || e.exportSha256;
    if (sha) out.push({ kind: 'evidence', name: e.name || `evidence-${i + 1}`, sha256: sha, bytes: e.bytes, chunks: e.chunks });
  });
  const osha = record.outcome?.evidenceSha256;
  if (osha && !out.some((t) => t.sha256 === osha)) out.push({ kind: 'evidence', name: 'evidence-1', sha256: osha });
  return out;
}

export function collect({ transcriptPath, recordPath, dataRoot, transcriptId, dryRun = false, readFile }) {
  const lines = readFileSync(transcriptPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const calls = toolCalls(lines);
  const exports = findExports(calls, readFile);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const domain = record.domain;
  if (!domain || /[/\\]|\.\./.test(domain)) throw new Error('record has no valid domain');
  if (path.basename(recordPath) !== `${domain}.pane.json`) throw new Error('record file name does not match its domain');
  const report = { domain, exports: exports.length, written: [], errors: [] };
  for (const t of recordTargets(record)) {
    const candidates = exports.filter((e) => e.summary?.sha256 === t.sha256);
    if (!candidates.length) {
      report.errors.push({ target: t.name, error: 'no-export-with-sha256' });
      continue;
    }
    let done = null;
    let lastError = null;
    for (const exp of candidates.reverse()) {
      const a = assemble(exp);
      if (a.json) {
        done = { exp, json: a.json };
        break;
      }
      lastError = a.error;
    }
    if (!done) {
      report.errors.push({ target: t.name, error: lastError });
      continue;
    }
    if (t.kind === 'state' ? !STATES.has(t.name) : !/^[a-z0-9-]+$/.test(t.name)) {
      report.errors.push({ target: t.name, error: 'bad-state-name' });
      continue;
    }
    const sum = done.exp.summary;
    if ((t.bytes != null && t.bytes !== sum.bytes) || (t.chunks != null && t.chunks !== sum.chunks)) {
      report.errors.push({ target: t.name, error: 'record-summary-mismatch' });
      continue;
    }
    const dir = path.join(dataRoot, domain, t.kind === 'evidence' ? path.join('evidence', t.name) : t.name);
    const s = done.exp.summary;
    const meta = {
      format: s.format,
      state: t.kind === 'state' ? t.name : null,
      evidence: t.kind === 'evidence' ? t.name : null,
      url: s.url,
      utc: done.exp.utc,
      bytes: s.bytes,
      sha256: s.sha256,
      nodes: s.nodes,
      truncated: s.truncated,
      shadowRoots: s.shadowRoots,
      iframes: s.iframes,
      collectedBy: 'collect-pane-exports.mjs',
    };
    const metaPath = path.join(dir, 'meta.json');
    if (existsSync(path.join(dir, 'dom.json')) && !(existsSync(metaPath) && JSON.parse(readFileSync(metaPath, 'utf8')).collectedBy)) {
      report.errors.push({ target: t.name, error: 'existing-file-not-from-collector' });
      continue;
    }
    if (!dryRun) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'dom.json'), done.json);
      writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    }
    report.written.push({ target: t.name, kind: t.kind, bytes: s.bytes, sha256: s.sha256 });
  }
  const stamped = calls.filter((c) => c.utc);
  record.transcriptId = transcriptId ?? record.transcriptId ?? path.basename(transcriptPath, '.jsonl');
  record.startUtc = stamped[0]?.utc ?? record.startUtc ?? null;
  record.endUtc = stamped.at(-1)?.utc ?? record.endUtc ?? null;
  record.timeline = timeline(calls);
  record.collected = {
    by: 'collect-pane-exports.mjs',
    exports: report.written.map(({ target, kind, sha256: h }) => ({ target, kind, sha256: h })),
    errors: report.errors,
  };
  if (!dryRun) writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const transcriptPath = args[0];
  const recordPath = opt('--record');
  if (!transcriptPath || !recordPath) {
    console.error('usage: collect-pane-exports.mjs <transcript.jsonl> --record <path> [--data <dir>] [--transcript-id <id>] [--dry-run]');
    process.exit(2);
  }
  const report = collect({
    transcriptPath,
    recordPath,
    dataRoot: opt('--data') || path.join(here, 'data', 'pane'),
    transcriptId: opt('--transcript-id'),
    dryRun: args.includes('--dry-run'),
  });
  console.log(JSON.stringify(report));
  process.exit(report.errors.length ? 1 : 0);
}
