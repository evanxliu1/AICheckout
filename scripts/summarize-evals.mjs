// Aggregates saved v2 evaluation runs into committed results: docs/evals/results.json (metrics only, no
// issuer text) and docs/evals/results.svg (a grouped bar chart drawn by hand, no dependencies).
//
//   node scripts/summarize-evals.mjs [--runs evals/curation/runs/matrix ...] [--out docs/evals]
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    runs: { type: 'string', multiple: true, default: ['evals/curation/runs/matrix'] },
    corpus: { type: 'string', default: 'evals/curation/real' },
    out: { type: 'string', default: 'docs/evals' },
    /** Run IDs added after the rest of their split was chosen; marked "(added)" in charts and results. */
    added: { type: 'string', multiple: true, default: [] },
  },
});

// Every run is re-scored from observations.json with the current scorer and labels (apps/api/src/curation/v2/summarize.ts).
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['apps/api/src/curation/v2/summarize.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { summarizeRuns } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const summary = await summarizeRuns(
  resolve(root, values.corpus),
  values.runs.map((dir) => resolve(root, dir)),
);
if (!summary.rows.length) throw new Error('No run directories with observations.json found.');

const results = {
  generatedAt: new Date().toISOString(),
  scorerVersion: summary.scorerVersion,
  retryCap: summary.retryCap,
  corpus: summary.corpus,
  labelsCollectedWith: [...new Set(summary.rows.flatMap((r) => r.labelsCollectedWith))],
  addedAfter: values.added,
  incomplete: summary.rows.filter((r) => !r.complete).map((r) => r.id),
  rejected: summary.rows.filter((r) => r.rejected).map((r) => r.id),
  runs: summary.rows,
};
const runs = summary.rows;
const out = resolve(root, values.out);
await mkdir(out, { recursive: true });
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');

// Chart: one row per complete dev configuration, three bars each.
const label = (r) =>
  [r.model, r.effort, r.prompt, r.selection.replace('keyword-window.1', 'kw')].filter(Boolean).join(' · ') +
  (values.added.includes(r.id) ? ' (added)' : '');
const series = [
  ['Field accuracy (end to end)', (r) => r.overall.endToEndFieldAccuracy?.rate, '#2563eb'],
  ['Claim precision', (r) => r.overall.claimPrecision?.rate, '#16a34a'],
  ['Expected-issue recall', (r) => r.overall.issueRecall?.rate, '#d97706'],
];
function chart(rows, title) {
  const left = 330,
    width = 900,
    barH = 9,
    rowH = 36,
    top = 50;
  const height = top + rows.length * rowH + 44;
  // Right padding leaves room for the value label after a 100% bar.
  const x = (v) => left + (v ?? 0) * (width - left - 40);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="12" y="22" font-size="15" font-weight="600" fill="#111">${esc(title)}</text>`,
    ...series.map(
      ([name, , color], i) =>
        `<rect x="${12 + i * 230}" y="30" width="10" height="10" fill="${color}"/><text x="${26 + i * 230}" y="39" fill="#333">${esc(name)}</text>`,
    ),
  ];
  for (const tick of [0, 0.25, 0.5, 0.75, 1])
    parts.push(
      `<line x1="${x(tick)}" y1="${top}" x2="${x(tick)}" y2="${height - 24}" stroke="#e5e7eb"/>`,
      `<text x="${x(tick)}" y="${height - 22}" text-anchor="middle" fill="#666">${tick * 100}%</text>`,
    );
  parts.push(
    `<text x="${(left + x(1)) / 2}" y="${height - 6}" text-anchor="middle" fill="#666">share of labeled fields, claims, or issues (higher is better)</text>`,
  );
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    parts.push(`<text x="${left - 8}" y="${y + 20}" text-anchor="end" fill="#111">${esc(label(r))}</text>`);
    series.forEach(([, pick, color], j) => {
      const v = pick(r);
      if (v === null || v === undefined) return;
      parts.push(
        `<rect x="${left}" y="${y + 4 + j * (barH + 1)}" width="${(x(v) - left).toFixed(1)}" height="${barH}" fill="${color}"/>`,
        `<text x="${(x(v) + 4).toFixed(1)}" y="${y + 12 + j * (barH + 1)}" font-size="9" fill="#333">${(v * 100).toFixed(0)}%</text>`,
      );
    });
  });
  parts.push('</svg>');
  return parts.join('\n') + '\n';
}
const byAccuracy = (a, b) =>
  (b.overall.endToEndFieldAccuracy?.rate ?? 0) - (a.overall.endToEndFieldAccuracy?.rate ?? 0);
const splitRows = (split) =>
  runs.filter((r) => r.split === split && r.complete && !r.rejected).sort(byAccuracy);
/** "20 cases; 2 repeats, claude-opus-5-5 1" from the rows themselves. */
function describe(rows) {
  const cases = [...new Set(rows.map((r) => r.planned / r.repeat))].join('/');
  const repeats = [...new Set(rows.map((r) => r.repeat))].sort((a, b) => b - a);
  const common = repeats[0];
  const exceptions = [
    ...new Set(rows.filter((r) => r.repeat !== common).map((r) => `${r.model} ${r.repeat}`)),
  ];
  return `${cases} cases; ${common} repeat${common === 1 ? '' : 's'}${exceptions.length ? `, ${exceptions.join(', ')}` : ''}`;
}
const dev = splitRows('dev');
await writeFile(join(out, 'results.svg'), chart(dev, `Extraction v2, dev split (${describe(dev)})`));
const heldout = splitRows('heldout');
if (heldout.length)
  await writeFile(
    join(out, 'results-heldout.svg'),
    chart(heldout, `Extraction v2, held-out split (${describe(heldout)})`),
  );
console.log(`Summarized ${runs.length} runs (${dev.length} complete dev configurations) into ${out}`);
