#!/usr/bin/env node
// Audit of pane operator transcripts (generic-reader-protocol.8, M2 of the .8 review). The 12.3 reviewer runs it over
// every pane operator's subagent transcript (Claude Code JSONL, kept locally and gitignored) and checks every flag.
//
//   node evals/merchants/capture/audit-pane-transcript.mjs <transcript.jsonl> [...] [--repo-root <checkout>]
//
// Every tool call in the transcript is checked (calls inside a browser batch included):
//   - forbidden outright: any Claude in Chrome tool (`mcp__claude-in-chrome__*`), `form_input`, `file_upload`, and the
//     pane computer tool's `type` and `key` actions (no typing of any kind);
//   - `navigate` to a path with a `checkout`, `checkouts` or `secure-checkout` segment (Magento `/checkout/cart` allowed)
//     or to a non-web scheme;
//   - any call whose input names checkout, ordering or payment in the checklist's wording lists (a `find` query for
//     "checkout", say), flagged for the reviewer to read;
//   - the JavaScript tool, unless its text is exactly one of the three allowed uses: the export script
//     (`pane-export.js`), a chunk fetch (`window.__aiCheckoutPaneExport.chunk(<n>)`) or the robots hash
//     (`pane-robots-hash.js`), each recognised after trimming surrounding whitespace;
//   - `navigate` to an account, order, profile, address, payment, settings or sign-out path (by path segment);
//   - Write or Edit outside the gitignored capture data folder (`evals/merchants/capture/data/`) and the committed
//     pane records (`evals/merchants/capture/records/<domain>.pane.json`), after normalising the path (`..` resolved,
//     relative paths from the repository root, anchored to --repo-root);
//   - any Bash command other than shasum, ls, cat, head or wc with plain arguments (no redirection, pipe, chaining or
//     substitution), so `>`, `tee`, `cp` and `mv` are flagged;
//   - a pane tool not on the operator's list, and any Bash network access (curl, wget, nc, ncat, telnet, ssh, scp,
//     open, deno, a URL, or node/python code that fetches: `fetch(`, `http.`, `https.`, `urllib`, `requests.`,
//     `net.connect`, `http.client`).
// Not auditable: a click by element `ref` (or coordinate) names no target in the call, so what was clicked is checked
// against the checklist and the pane record's action log, not here.
// Prints a JSON report per transcript; the exit code is 1 when anything is flagged.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKOUT_NAME, ORDER_OR_ACCOUNT, isCheckoutPath } from './guards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (t) => createHash('sha256').update(t.trim(), 'utf8').digest('hex');
export const ALLOWED_SCRIPTS = {
  export: sha(readFileSync(path.join(here, 'pane-export.js'), 'utf8')),
  robots: sha(readFileSync(path.join(here, 'pane-robots-hash.js'), 'utf8')),
};
const CHUNK = /^window\.__aiCheckoutPaneExport\.chunk\(\d{1,4}\);?$/;
/** Path segments of account, order, profile, address, payment, settings and sign-out pages. */
export const ACCOUNT_SEGMENTS = new Set([
  'account',
  'accounts',
  'my-account',
  'myaccount',
  'customer',
  'profile',
  'orders',
  'order',
  'order-history',
  'orderhistory',
  'address',
  'addresses',
  'addressbook',
  'address-book',
  'payment',
  'payments',
  'payment-methods',
  'wallet',
  'settings',
  'preferences',
  'signout',
  'sign-out',
  'logout',
  'log-out',
  'logoff',
]);
const accountPath = (pathname) =>
  pathname
    .split('/')
    .map((x) => {
      try {
        return decodeURIComponent(x).toLowerCase();
      } catch {
        return x.toLowerCase();
      }
    })
    .some((seg) => ACCOUNT_SEGMENTS.has(seg.replace(/\.(html?|aspx?|jsp|php)$/, '')));
/** The repository the audited operator wrote into; override with --repo-root when the transcript came from another
 * checkout of the repository. */
export const DEFAULT_REPO_ROOT = path.resolve(here, '..', '..', '..');
/**
 * Where a Write or Edit lands, after normalising the path (`..` resolved, relative paths taken from the repository
 * root): `data` (the gitignored capture data folder), `record` (a committed `<domain>.pane.json`) or `outside`.
 */
export function classifyPath(filePath, repoRoot = DEFAULT_REPO_ROOT) {
  const root = path.posix.normalize(String(repoRoot).replace(/\\/g, '/'));
  const raw = String(filePath ?? '').replace(/\\/g, '/');
  const abs = path.posix.normalize(path.posix.isAbsolute(raw) ? raw : path.posix.join(root, raw));
  const rel = path.posix.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.posix.isAbsolute(rel)) return 'outside';
  if (rel.startsWith('evals/merchants/capture/data/')) return 'data';
  if (/^evals\/merchants\/capture\/records\/[a-z0-9.-]+\.pane\.json$/.test(rel)) return 'record';
  return 'outside';
}
/** The only Bash an operator may run: shasum, ls, cat, head or wc with plain arguments (no redirection, pipes,
 * chaining or substitution). */
const BASH_OK = /^\s*(shasum|ls|cat|head|wc)(\s+[^;&|<>`$(){}\n\\]*)?\s*$/;
const BASH_NETWORK =
  /\b(curl|wget|nc|ncat|telnet|ssh|scp|open|deno)\b|https?:\/\/|\bfetch\(|\bhttps?\.(get|request)\b|urllib|\brequests\.|net\.connect|http\.client/;
/** Pane tools an operator may call (short names). Anything else from the pane server is flagged. */
export const PANE_TOOLS = new Set([
  'navigate',
  'computer',
  'find',
  'read_page',
  'get_page_text',
  'javascript_tool',
  'tabs_create',
  'tabs_close',
  'tabs_context',
  'browser_batch',
]);

const shortName = (name) => String(name).split('__').pop();
const isPane = (name) => /Claude_Browser__/.test(name) || !String(name).includes('__');

/** Classify one tool call. Returns a list of { rule, detail }. */
export function auditCall(name, input = {}, { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const writes = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(shortName(name));
  const where = writes ? classifyPath(input.file_path, repoRoot) : null;
  const flags = [];
  const flag = (rule, detail = '') => flags.push({ rule, detail: String(detail).slice(0, 160) });
  const n = String(name);
  const s = shortName(n);
  if (/claude-in-chrome/.test(n)) flag('claude-in-chrome', n);
  if (s === 'form_input' || s === 'file_upload') flag('forbidden-tool', s);
  if (s === 'computer' && ['type', 'key'].includes(input.action)) flag('typing', input.action);
  if (s === 'navigate' && typeof input.url === 'string' && !['back', 'forward'].includes(input.url)) {
    let u = null;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input.url) ? input.url : `https://${input.url}`);
    } catch {
      flag('bad-url', input.url);
    }
    if (u && !['http:', 'https:'].includes(u.protocol)) flag('non-web-scheme', u.protocol);
    if (u && isCheckoutPath(u.pathname)) flag('checkout-path', `${u.host}${u.pathname}`);
    if (u && accountPath(u.pathname)) flag('account-path', `${u.host}${u.pathname}`);
  }
  if (s === 'javascript_tool') {
    const text = String(input.text ?? '').trim();
    const ok = sha(text) === ALLOWED_SCRIPTS.export || sha(text) === ALLOWED_SCRIPTS.robots || CHUNK.test(text);
    if (!ok) flag('javascript-other', text.slice(0, 80));
  } else if (s !== 'navigate' && where !== 'data') {
    // Exports written into the capture data folder contain page text ("Checkout", "Sign in"): no wording check there.
    // Navigation is judged by its path above (Magento's /checkout/cart is allowed); other inputs by their wording.
    const words = JSON.stringify(input ?? {});
    if (CHECKOUT_NAME.test(words) || ORDER_OR_ACCOUNT.test(words)) flag('checkout-or-order-wording', words.slice(0, 120));
  }
  if (isPane(n) && /Claude_Browser__/.test(n) && !PANE_TOOLS.has(s)) flag('unlisted-pane-tool', s);
  if (s === 'Bash') {
    const cmd = String(input.command ?? '');
    if (!BASH_OK.test(cmd)) flag('bash-not-allowed', cmd);
    if (BASH_NETWORK.test(cmd)) flag('bash-network', cmd);
  }
  if (writes && where === 'outside') flag('write-outside-capture-folders', input.file_path);
  return flags;
}

/** Every tool_use block in a parsed JSONL transcript, batch actions expanded. */
export function toolCalls(lines) {
  const calls = [];
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    if (v.type === 'tool_use' && typeof v.name === 'string') {
      calls.push({ name: v.name, input: v.input ?? {} });
      if (shortName(v.name) === 'browser_batch')
        for (const a of v.input?.actions ?? [])
          calls.push({ name: `mcp__Claude_Browser__${a.name}`, input: a.input ?? {}, batch: true });
      return;
    }
    Object.values(v).forEach(visit);
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      visit(JSON.parse(line));
    } catch {
      /* not JSON */
    }
  }
  return calls;
}

export function auditTranscript(text, opts = {}) {
  const calls = toolCalls(text.split('\n'));
  const flags = [];
  calls.forEach((c, index) => {
    for (const f of auditCall(c.name, c.input, opts)) flags.push({ index, tool: shortName(c.name), ...f });
  });
  return { toolCalls: calls.length, flags };
}

function main(argv) {
  const at = argv.indexOf('--repo-root');
  const repoRoot = at >= 0 ? argv[at + 1] : DEFAULT_REPO_ROOT;
  const files = argv.filter((a, i) => a !== '--repo-root' && argv[i - 1] !== '--repo-root');
  if (!files.length) {
    console.error('usage: audit-pane-transcript.mjs <transcript.jsonl> [...] [--repo-root <checkout the operator used>]');
    return 2;
  }
  let flagged = 0;
  for (const file of files) {
    const report = { transcript: file, repoRoot, ...auditTranscript(readFileSync(file, 'utf8'), { repoRoot }) };
    flagged += report.flags.length;
    console.log(JSON.stringify(report, null, 1));
  }
  return flagged ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
