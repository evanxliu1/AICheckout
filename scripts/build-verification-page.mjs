// Build a local page for verifying the real corpus labels against the captured issuer text.
//
//   node scripts/build-verification-page.mjs [--dir evals/curation/real]
//
// Writes <dir>/verification.html (gitignored: it embeds captured issuer text). Open it in a browser, accept or
// fix each field of the base cases (variants are derived mechanically from them), then "Export" to download
// verification.json and hand it back for the fixes to be applied.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { dir: { type: 'string', default: 'evals/curation/real' } } });
const dir = resolve(root, values.dir);
const corpus = JSON.parse(readFileSync(join(dir, 'corpus.v2.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const bodies = Object.fromEntries(
  manifest.sources.map((s) => [s.id, readFileSync(join(dir, 'captures', `${s.id}.txt`), 'utf8')]),
);
const urls = Object.fromEntries(manifest.sources.map((s) => [s.id, s.url]));

const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const pattern = (quote) =>
  new RegExp(
    quote
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+'),
  );

/** The anchor highlighted inside ~300 characters of surrounding source text. */
function context(quote, sourceIds) {
  for (const id of sourceIds) {
    const m = pattern(quote).exec(bodies[id]);
    if (!m) continue;
    const start = Math.max(0, m.index - 300),
      end = Math.min(bodies[id].length, m.index + m[0].length + 300);
    return `<div class="ctx"><a href="${esc(urls[id])}" target="_blank" rel="noreferrer">${esc(id)}</a><pre>${start ? '…' : ''}${esc(
      bodies[id].slice(start, m.index),
    )}<mark>${esc(m[0])}</mark>${esc(bodies[id].slice(m.index + m[0].length, end))}${end < bodies[id].length ? '…' : ''}</pre></div>`;
  }
  return `<div class="ctx missing">Anchor not found: ${esc(quote)}</div>`;
}

const show = (value) =>
  value === null ? '<em>null (not stated)</em>' : `<code>${esc(JSON.stringify(value))}</code>`;
const field = (caseId, path, label, value) => `
  <tr data-key="${esc(`${caseId}::${path}`)}">
    <th>${esc(label)}</th><td>${show(value)}</td>
    <td class="ctl">
      <label><input type="radio" name="${esc(`${caseId}::${path}`)}" value="ok"> OK</label>
      <label><input type="radio" name="${esc(`${caseId}::${path}`)}" value="fix"> Fix</label>
      <input type="text" placeholder="correct value / note">
    </td>
  </tr>`;

let fields = 0;
const sections = corpus.cases
  .filter((c) => !c.variant)
  .map((c) => {
    const ref = c.reference;
    const rows = [];
    const add = (path, label, value) => {
      fields++;
      rows.push(field(c.id, path, label, value));
    };
    const card = [`<h3>Card-level</h3><table>`];
    add('rewardCurrency', 'Reward currency', ref.rewardCurrency.value);
    add('pointValueHundredthsOfCent', 'Point value (1/100 ¢)', ref.pointValueHundredthsOfCent.value);
    card.push(rows.splice(0).join(''), '</table>');
    card.push(
      ...[...ref.rewardCurrency.anchors, ...ref.pointValueHundredthsOfCent.anchors].map((a) =>
        context(a, c.sourceIds),
      ),
    );

    const rules = ref.rules.map((r, i) => {
      for (const [key, label] of [
        ['category', 'Category'],
        ['issuerWording', 'Issuer wording'],
        ['rateBps', 'Rate (bps, total)'],
        ['paidOnPaymentBps', 'Paid on payment (bps)'],
        ['cap', 'Cap'],
        ['activation', 'Activation'],
        ['usMerchantsOnly', 'U.S. merchants only'],
        ['limitedTime', 'Limited time'],
      ])
        add(`rules.${i}.${key}`, label, r[key]);
      return `<h3>Rule ${i + 1}: ${esc(r.category)} — ${esc(r.issuerWording)}</h3><table>${rows.splice(0).join('')}</table>${r.anchors
        .map((a) => context(a, c.sourceIds))
        .join('')}`;
    });
    const exclusions = ref.exclusions.map((e, i) => {
      add(`exclusions.${i}`, 'Exclusion', e.text);
      return `<h3>Exclusion ${i + 1}</h3><table>${rows.splice(0).join('')}</table>${e.anchors.map((a) => context(a, c.sourceIds)).join('')}`;
    });
    add('missingRules', 'Earning rules missing from this list?', 'none');
    const missing = `<h3>Completeness</h3><table>${rows.splice(0).join('')}</table>`;
    return `<section id="${esc(c.id)}"><h2>${esc(c.cardName)} <small>${esc(c.split)} · ${c.sourceIds
      .map((id) => `<a href="${esc(urls[id])}" target="_blank" rel="noreferrer">${esc(id)}</a>`)
      .join(' · ')}</small></h2>${card.join('')}${rules.join('')}${exclusions.join('')}${missing}</section>`;
  });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Corpus Verification</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { --bg:#fff; --fg:#1b1f24; --muted:#5b6470; --line:#d8dde3; --mark:#ffe58a; --ok:#e7f6ea; --fix:#fde8e8; }
body { margin:0; font:15px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:12px 16px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; z-index:1; }
main { max-width:1100px; margin:0 auto; padding:0 16px 80px; }
h2 { margin-top:48px; border-bottom:2px solid var(--fg); } h2 small { font-size:13px; font-weight:400; color:var(--muted); }
h3 { margin:24px 0 6px; font-size:15px; }
table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { width:190px; font-weight:500; } .ctl { width:360px; white-space:nowrap; } .ctl input[type=text] { width:170px; }
tr.ok { background:var(--ok); } tr.fix { background:var(--fix); }
.ctx { margin:6px 0 0 16px; } .ctx a { font-size:12px; color:var(--muted); }
.ctx pre { white-space:pre-wrap; margin:2px 0; padding:8px; background:#f6f8fa; border-radius:6px; font:13px/1.45 ui-monospace, monospace; }
mark { background:var(--mark); } .missing { color:#b42318; }
button { font:inherit; padding:6px 14px; }
</style></head>
<body>
<header><strong>${esc(corpus.version)}</strong><span id="progress"></span>
<button id="export">Export verification.json</button>
<span style="color:var(--muted)">Each field: is the value what the highlighted text says? Null means the captured pages do not state it.</span></header>
<main>${sections.join('')}</main>
<script>
const KEY = 'verification:${esc(corpus.version)}';
const total = ${fields};
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
function render() {
  let done = 0;
  document.querySelectorAll('tr[data-key]').forEach((row) => {
    const s = state[row.dataset.key];
    row.className = s ? s.status : '';
    if (s) { done++; row.querySelector('input[value=' + s.status + ']').checked = true; row.querySelector('input[type=text]').value = s.note || ''; }
  });
  document.getElementById('progress').textContent = done + ' / ' + total + ' fields checked';
}
document.addEventListener('change', (e) => {
  const row = e.target.closest('tr[data-key]'); if (!row) return;
  const status = row.querySelector('input[type=radio]:checked')?.value;
  const note = row.querySelector('input[type=text]').value;
  if (status) state[row.dataset.key] = { status, note }; save(); render();
});
document.addEventListener('input', (e) => { if (e.target.type === 'text') e.target.dispatchEvent(new Event('change', { bubbles: true })); });
document.getElementById('export').onclick = () => {
  const out = { corpusVersion: '${esc(corpus.version)}', exportedAt: new Date().toISOString(), fields: state };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = 'verification.json'; a.click();
};
render();
</script></body></html>`;
writeFileSync(join(dir, 'verification.html'), html);
console.log(`Wrote ${join(dir, 'verification.html')} (${fields} fields across ${sections.length} cards).`);
