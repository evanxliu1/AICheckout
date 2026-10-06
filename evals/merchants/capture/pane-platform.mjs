#!/usr/bin/env node
// Platform group of pane captures (generic-reader-protocol.9), offline, from `pane-dom.2` exports only. Reads each
// store's `empty-cart` and first captured cart state (`cart-1`, else `minicart-1`; platform.mjs `platformStates`),
// flattens each export to marker text (every tag with all its attributes, and every text node; script elements keep
// their attributes, so a script `src` counts) and applies platform.mjs's markers. Pane exports carry no response
// headers and no inline script contents, so header markers (`x-magento-*`) and script-only markers (`Shopify.shop`,
// SAP's `ACC.`) can't match; markers in attributes and text (`cdn.shopify.com` in a src, `/on/demandware.store/`,
// `Magento_` module paths, `/_ui/` with `hybris`, `cdn11.bigcommerce.com`, ...) can.
//
//   node evals/merchants/capture/pane-platform.mjs <data/pane> [domain ...]            [{domain, platform}] for split
//   node evals/merchants/capture/pane-platform.mjs <data/pane> [domain ...] --markers  with marker and states read
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectPlatform, platformStates } from './platform.mjs';

/** Every element as `<tag a="v" ...>` and every text node (not script contents), in document order, open shadow roots included. */
export function markerText(doc) {
  const out = [];
  const walk = (n) => {
    if ('x' in n) return void out.push(n.x);
    out.push(`<${n.t}${Object.entries(n.a ?? {}).map(([k, v]) => ` ${k}="${v}"`).join('')}>`);
    for (const c of n.sr ?? []) walk(c);
    // Script and noscript contents are never exported; skip any that slipped in, so only observable markers count.
    for (const c of n.c ?? []) if (!(['script', 'noscript'].includes(n.t) && 'x' in c)) walk(c);
  };
  walk(doc.root);
  return out.join('');
}

/** Platform from parsed exports keyed by state name: { 'empty-cart': doc, 'cart-1': doc, ... }. */
export function panePlatform(docsByState) {
  const chosen = platformStates(Object.keys(docsByState).map((state) => ({ state })));
  if (!chosen.length) return { group: 'none-detected', marker: null, states: [] };
  for (const { state } of chosen)
    if (docsByState[state]?.format !== 'pane-dom.2') throw new Error(`${state}: platform needs a pane-dom.2 export`);
  const pages = chosen.map(({ state }) => ({ html: markerText(docsByState[state]), headers: {} }));
  return { ...detectPlatform(pages), states: chosen.map((s) => s.state) };
}

/** Read one store's exports under <root>/<domain>/<state>/dom.json (evidence/ is never read). */
export async function storePlatform(root, domain) {
  const docs = {};
  for (const state of await readdir(path.join(root, domain)).catch(() => [])) {
    if (!['empty-cart', 'minicart-1', 'cart-1'].includes(state)) continue;
    try {
      docs[state] = JSON.parse(await readFile(path.join(root, domain, state, 'dom.json'), 'utf8'));
    } catch {
      /* no export for this state */
    }
  }
  return panePlatform(docs);
}

async function main(argv) {
  const markers = argv.includes('--markers');
  const [root, ...domains] = argv.filter((a) => a !== '--markers');
  if (!root) {
    console.error('usage: pane-platform.mjs <data/pane> [domain ...] [--markers]');
    return 2;
  }
  const list = domains.length ? domains : (await readdir(root)).filter((d) => !d.startsWith('.'));
  const out = [];
  for (const domain of list) {
    const p = await storePlatform(root, domain);
    // Only captured stores: a cart-1 or minicart-1 export (a store stopped after empty-cart is not captured).
    if (!p.states.some((st) => st === 'cart-1' || st === 'minicart-1')) continue;
    out.push(markers ? { domain, platform: p.group, marker: p.marker, states: p.states } : { domain, platform: p.group });
  }
  console.log(JSON.stringify(out, null, 1));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exitCode = 1;
    },
  );
