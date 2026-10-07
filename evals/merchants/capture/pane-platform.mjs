#!/usr/bin/env node
// Platform group of pane captures (generic-reader-protocol.9), offline, from `pane-dom.2` exports only. Reads each
// store's `empty-cart` and first captured cart state in the fixed order cart-1, minicart-1, cart-qty2, cart-2items,
// cart-other (`paneStates`),
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
import { detectPlatform } from './platform.mjs';

/**
 * Cart states of a pane capture in the fixed order used for platform detection (protocol .9): a store is captured
 * when any of them has an export with the operator's item, and its platform comes from `empty-cart` (if any) plus
 * the first of these that exists.
 */
export const PANE_CART_STATES = ['cart-1', 'minicart-1', 'cart-qty2', 'cart-2items', 'cart-other'];

/** The states platform detection reads for a pane store: empty-cart and the first cart state in fixed order. */
export function paneStates(states) {
  const has = new Set(states);
  const cart = PANE_CART_STATES.find((st) => has.has(st));
  return [...(has.has('empty-cart') ? ['empty-cart'] : []), ...(cart ? [cart] : [])];
}

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
  const chosen = paneStates(Object.keys(docsByState));
  if (!chosen.length) return { group: 'none-detected', marker: null, states: [] };
  for (const state of chosen)
    if (docsByState[state]?.format !== 'pane-dom.2') throw new Error(`${state}: platform needs a pane-dom.2 export`);
  const pages = chosen.map((state) => ({ html: markerText(docsByState[state]), headers: {} }));
  return { ...detectPlatform(pages), states: chosen };
}

/** Read one store's exports under <root>/<domain>/<state>/dom.json (evidence/ is never read). */
export async function storePlatform(root, domain) {
  const docs = {};
  for (const state of await readdir(path.join(root, domain)).catch(() => [])) {
    if (state !== 'empty-cart' && !PANE_CART_STATES.includes(state)) continue;
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
    // Only captured stores: any cart-state export with the operator's item (a store stopped after empty-cart is not).
    if (!p.states.some((st) => PANE_CART_STATES.includes(st))) continue;
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
