#!/usr/bin/env node
// Offline rebuild of a `pane-dom.2` export (pane-export.js; `pane-dom.1` pane-trial exports are also read) into one
// static HTML file with inline styles
// (generic-reader-protocol.8). The rebuilt file is what labellers screenshot and what the reader's replay loads in
// Playwright with all network blocked; it runs no script.
//
//   node evals/merchants/capture/rebuild.mjs <dom.json> [out.html] [--sha256 <expected>]
//
// The replay MUST load the rebuilt file with JavaScript disabled and all network blocked.
//
// Rules: every element and attribute is kept except `<script>` elements, `<meta http-equiv="refresh">` and `on*`
// event-handler attributes; text is
// escaped; `<style>` contents are kept; elements with recorded computed styles get them as an inline `style` (after
// the page's own inline style, so they win); an element whose recorded `display` is `none` gets `display:none`
// inline, so hidden subtrees stay hidden; `pane-dom.2` clipping and visibility styles (`k`: clip, clip-path, overflow,
// opacity, transform, and width/height when clipping) are inlined on every element that had them; a text element the
// page reported invisible (`v: false`) also gets `visibility:hidden`, so hidden text stays hidden; elements with a
// recorded box get `data-pane-box="x,y,w,h"` (for labellers; a reader must never read `data-pane-*` attributes);
// open shadow roots become declarative shadow DOM (`<template shadowrootmode="open">`); iframes become empty
// `<iframe>` stubs with `data-pane-origin`.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PANE_FORMAT = 'pane-dom.2';
export const PANE_FORMATS = ['pane-dom.1', 'pane-dom.2'];
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT = new Set(['style', 'textarea', 'title']);

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const validName = (n) => /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(n);

function render(node, styleProps, out) {
  if ('x' in node) {
    out.push(escText(node.x));
    return;
  }
  const tag = node.t;
  if (!tag || !validName(tag) || tag === 'script') return;
  if (tag === 'meta' && /^\s*refresh\s*$/i.test(node.a?.['http-equiv'] ?? '')) return;
  const attrs = { ...(node.a ?? {}) };
  for (const k of Object.keys(attrs)) if (/^on/i.test(k) || !validName(k)) delete attrs[k];
  if (tag === 'iframe' || tag === 'frame') {
    out.push(`<iframe data-pane-origin="${escAttr(node.o ?? '')}"`);
    if (node.b) out.push(` width="${node.b[2]}" height="${node.b[3]}"`);
    out.push('></iframe>');
    return;
  }
  const inline = [];
  if (node.s) node.s.forEach((v, i) => v !== '' && inline.push(`${styleProps[i]}:${v}`));
  else if (node.d === 'none') inline.push('display:none');
  for (const [p, v] of Object.entries(node.k ?? {})) inline.push(`${p}:${v}`);
  if (node.v === false) inline.push('visibility:hidden');
  if (node.b) attrs['data-pane-box'] = node.b.join(',');
  if (inline.length) {
    const own = attrs.style ? `${attrs.style.replace(/;?\s*$/, '')};` : '';
    attrs.style = `${own}${inline.join(';')}`;
  }
  out.push(`<${tag}`);
  for (const [k, v] of Object.entries(attrs)) out.push(` ${k}="${escAttr(v)}"`);
  out.push('>');
  if (VOID.has(tag)) return;
  if (node.sr) {
    out.push('<template shadowrootmode="open">');
    for (const c of node.sr) render(c, styleProps, out);
    out.push('</template>');
  }
  for (const c of node.c ?? []) {
    if (RAW_TEXT.has(tag) && 'x' in c) out.push(tag === 'style' ? c.x.replace(/<\/style/gi, '<\\/style') : escText(c.x));
    else render(c, styleProps, out);
  }
  out.push(`</${tag}>`);
}

/** Turn a parsed pane-dom.1 document into a static HTML string. */
export function rebuildHtml(doc) {
  if (!PANE_FORMATS.includes(doc?.format)) throw new Error(`not a ${PANE_FORMATS.join(' or ')} export`);
  const out = ['<!doctype html>'];
  render(doc.root, doc.styleProps ?? [], out);
  return out.join('');
}

/** Read an export, check its SHA-256 if given, and return the rebuilt HTML. */
export async function rebuildFile(file, expectedSha256 = null) {
  const text = await readFile(file, 'utf8');
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error(`${file}: SHA-256 ${sha256} is not the expected one`);
  return { html: rebuildHtml(JSON.parse(text)), sha256 };
}

async function main(argv) {
  const [file, outFile] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--sha256');
  const i = argv.indexOf('--sha256');
  if (!file) {
    console.error('usage: rebuild.mjs <dom.json> [out.html] [--sha256 <expected>]');
    process.exitCode = 2;
    return;
  }
  const { html, sha256 } = await rebuildFile(file, i >= 0 ? argv[i + 1] : null);
  const target = outFile ?? file.replace(/\.json$/, '') + '.rebuilt.html';
  await writeFile(target, html);
  console.log(JSON.stringify({ sha256, out: target, bytes: Buffer.byteLength(html) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  });
}
