// PROTOTYPE, Phase 10 merchant probe (wiki/product/phase-10-feasibility-probe.md). Throwaway, not product code.
//
// Generic cart reader design steps 1-3 (wiki/system/merchant-coverage-design.md#generic-cart-reader) plus a simple
// decide, run over the dom.json snapshots written by driver.mjs (a JSON tree with computed styles; open shadow
// roots inlined, closed roots and iframes absent). Usage:
//   node prototype-reader.mjs                 -> per-snapshot result + timing, compared with labels.json if present
//   node prototype-reader.mjs --json out.json -> also write results (amounts, kinds, timings; no page text)
//   node prototype-reader.mjs --rows <site>/<state> -> debug: print the candidate rows (local terminal only)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probeDir = path.resolve(here, '..');
const sitesDir = path.join(probeDir, 'data', 'sites');

const MONEY = /(-|−|–)?\s?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\s?\.\s?(\d{2}))?(?!\d)/g;
const SUMMARY_HEADING = /\b(order|cart|bag|basket|checkout)\s+summary\b|^\s*summary\s*$|\bcart totals?\b|^\s*your order\b|^\s*order details\s*$/i;
const SUMMARY_ATTR = /summary|totals?\b|order-?total|cart-?total|subtotal|ordertotal|minicart-?footer|cart-?footer|drawer-?footer/i;
const LABEL = /\b(sub-?\s?total|total|items total|products)\b/i;
const DISTRACTOR_TEXT =
  /\b(save|saved|saving|savings|off\b|payments? of|interest|\/\s?mo\b|per month|a month|away from|free shipping|points?|rewards?|was\b|reg\.|compare|value|earn|klarna|afterpay|affirm|sezzle|paypal|pay in|donat)/i;
const DISTRACTOR_ATTR =
  /recommend|carousel|upsell|cross-?sell|also-?(like|bought)|similar|product-?(card|tile)|line-?item|cart-?item|item-?price|product-?price|promo|slick|swiper|wishlist/i;
const KIND_RANK = { afterCredit: 3, estimatedTotal: 2, subtotal: 1 };

function kindOf(label) {
  if (/after (gift card|credit|rewards)|amount due|balance due|remaining balance|total due/i.test(label)) return 'afterCredit';
  if (/sub-?\s?total|items? total|merchandise|products/i.test(label)) return 'subtotal';
  if (/total/i.test(label)) return 'estimatedTotal';
  return null;
}

/** Annotates the tree in one pass: visibility, strike-through, attribute trail, text. */
function prepare(node, parent) {
  const s = node.s || {};
  const hidden =
    s.d === 'none' || s.v === 'hidden' || s.v === 'collapse' || s.o === '0' || node.a?.hidden !== undefined;
  node.vis = !hidden && (!parent || parent.vis) && node.r && node.r[2] > 0 && node.r[3] > 0;
  if (hidden) node.vis = false;
  node.strike = Boolean((s.td || '').includes('line-through') || parent?.strike);
  const own = [node.a?.class, node.a?.id, node.a?.['data-testid'], node.a?.['data-test'], node.a?.['data-qa'], node.a?.['aria-label']]
    .filter(Boolean)
    .join(' ');
  node.attr = own;
  node.trail = (parent ? parent.trail + ' ' : '') + own;
  node.parent = parent;
  const parts = [];
  const strikeParts = [];
  for (const c of node.c) {
    if (typeof c === 'string') {
      if (node.vis) (node.strike ? strikeParts : parts).push(c);
    } else {
      prepare(c, node);
      if (c.vis) {
        parts.push(c.text);
        if (c.strikeText) strikeParts.push(c.strikeText);
      }
    }
  }
  node.text = parts.join(' ').replace(/\s+/g, ' ').trim();
  node.strikeText = strikeParts.join(' ').trim();
}

function* walk(node) {
  yield node;
  for (const c of node.c) if (typeof c !== 'string') yield* walk(c);
}

function amounts(text) {
  const out = [];
  for (const m of text.matchAll(MONEY)) {
    if (m[1]) continue; // negative or credit row: never the amount
    out.push(Number(m[2].replace(/,/g, '')) * 100 + (m[3] ? Number(m[3]) : 0));
  }
  return out;
}

/** Step 1: summary regions (headings, landmarks, aria labels, platform attribute markers). */
function regions(root) {
  const found = new Set();
  for (const n of walk(root)) {
    if (!n.vis) continue;
    const headingLike = /^h[1-6]$/.test(n.t) || n.a?.role === 'heading' || n.t === 'legend' || n.t === 'caption';
    const short = n.text.length > 0 && n.text.length <= 40;
    const byHeading = short && (headingLike || n.c.every((c) => typeof c === 'string')) && SUMMARY_HEADING.test(n.text);
    const byAttr = SUMMARY_ATTR.test(n.attr) && !DISTRACTOR_ATTR.test(n.attr) && n.text.length < 600;
    if (!byHeading && !byAttr) continue;
    // Climb to the nearest ancestor that holds a labelled amount (at most 6 levels).
    let cur = n;
    for (let i = 0; i < 7 && cur; i += 1, cur = cur.parent) {
      if (LABEL.test(cur.text) && amounts(cur.text).length > 0 && cur.text.length < 1500) {
        found.add(cur);
        break;
      }
    }
  }
  return [...found];
}

/** Step 2 and 3: total rows inside the regions, minus distractors. */
function totalRows(scope) {
  const rows = [];
  for (const n of walk(scope)) {
    if (!n.vis || n.text.length === 0 || n.text.length > 80) continue;
    const label = n.text.replace(MONEY, ' ').trim();
    if (!LABEL.test(label)) continue;
    const amts = amounts(n.text);
    if (amts.length !== 1) continue;
    rows.push(n);
  }
  // Keep the smallest qualifying elements (drop any row that contains another row).
  const set = new Set(rows);
  const minimal = rows.filter((n) => {
    for (const d of walk(n)) if (d !== n && set.has(d)) return false;
    return true;
  });
  const out = [];
  for (const n of minimal) {
    const label = n.text.replace(MONEY, ' ').trim();
    const amount = amounts(n.text)[0];
    const kind = kindOf(label);
    let reason = null;
    if (!kind) reason = 'no-kind';
    else if (DISTRACTOR_TEXT.test(label)) reason = 'distractor-text';
    else if (DISTRACTOR_ATTR.test(n.trail)) reason = 'distractor-container';
    else if (n.strikeText && amounts(n.strikeText).includes(amount)) reason = 'strikethrough';
    out.push({ node: n, label, amount, kind, reason });
  }
  return out;
}

export function read(tree) {
  prepare(tree, null);
  const regs = regions(tree);
  const scopes = regs.length ? regs : [tree];
  const seen = new Set();
  const rows = [];
  for (const s of scopes) for (const r of totalRows(s)) if (!seen.has(r.node)) (seen.add(r.node), rows.push(r));
  const kept = rows.filter((r) => !r.reason);
  if (!kept.length) return { result: 'none', regions: regs.length, rows };
  const best = Math.max(...kept.map((r) => KIND_RANK[r.kind]));
  const top = kept.filter((r) => KIND_RANK[r.kind] === best);
  const distinct = [...new Set(top.map((r) => r.amount))];
  const kind = top[0].kind;
  if (distinct.length === 1 && regs.length) return { result: 'found', amount: distinct[0], kind, regions: regs.length, rows };
  return { result: 'ask', amount: distinct.length === 1 ? distinct[0] : null, candidates: distinct, kind, regions: regs.length, rows };
}

function snapshots() {
  const out = [];
  for (const site of readdirSync(sitesDir).sort())
    for (const state of readdirSync(path.join(sitesDir, site)).sort())
      if (existsSync(path.join(sitesDir, site, state, 'dom.json'))) out.push(`${site}/${state}`);
  return out;
}

const args = process.argv.slice(2);
if (args[0] === '--rows') {
  const tree = JSON.parse(readFileSync(path.join(sitesDir, args[1], 'dom.json'), 'utf8'));
  const r = read(tree);
  console.log(r.result, r.amount, r.kind, 'regions', r.regions);
  for (const row of r.rows) console.log(row.reason || 'KEPT', row.kind, row.amount, '|', row.label.slice(0, 60));
} else {
  const labelsFile = path.join(probeDir, 'labels.json');
  const labels = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, 'utf8')).snapshots : [];
  const results = [];
  for (const id of snapshots()) {
    const raw = readFileSync(path.join(sitesDir, id, 'dom.json'), 'utf8');
    const t0 = performance.now();
    const tree = JSON.parse(raw);
    const t1 = performance.now();
    const r = read(tree);
    const t2 = performance.now();
    const meta = JSON.parse(readFileSync(path.join(sitesDir, id, 'meta.json'), 'utf8'));
    const label = labels.find((l) => l.id === id);
    let outcome = 'unlabelled';
    if (label) {
      const exp = label.expected;
      if (r.result === 'found') outcome = exp && exp.amountCents === r.amount && exp.kind === r.kind ? 'found-correct' : 'found-wrong';
      else if (r.result === 'ask') outcome = exp && r.candidates.includes(exp.amountCents) ? 'ask-contains' : 'ask-without';
      else outcome = exp ? 'none-missed' : 'none-correct';
    }
    results.push({
      id,
      result: r.result,
      amountCents: r.amount ?? null,
      kind: r.kind ?? null,
      candidates: r.candidates ?? null,
      regions: r.regions,
      readerMs: Math.round((t2 - t1) * 10) / 10,
      parseMs: Math.round((t1 - t0) * 10) / 10,
      inPageSerializeMs: meta.serializeMs,
      nodes: meta.nodes,
      outcome,
    });
  }
  for (const r of results)
    console.log(
      r.id.padEnd(32),
      r.result.padEnd(5),
      String(r.amountCents ?? '-').padStart(6),
      String(r.kind ?? '-').padEnd(15),
      String(r.readerMs).padStart(6) + 'ms',
      r.outcome,
    );
  const ms = results.map((r) => r.readerMs).sort((a, b) => a - b);
  const p = (q) => ms[Math.min(ms.length - 1, Math.ceil(q * ms.length) - 1)];
  const ser = results.map((r) => r.inPageSerializeMs).sort((a, b) => a - b);
  const ps = (q) => ser[Math.min(ser.length - 1, Math.ceil(q * ser.length) - 1)];
  const tally = {};
  for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1;
  const summary = { snapshots: results.length, readerMs: { p50: p(0.5), p95: p(0.95), max: ms[ms.length - 1] }, inPageSerializeMs: { p50: ps(0.5), p95: ps(0.95), max: ser[ser.length - 1] }, outcomes: tally };
  console.log(JSON.stringify(summary));
  const i = args.indexOf('--json');
  if (i >= 0) writeFileSync(args[i + 1], JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2) + '\n');
}
