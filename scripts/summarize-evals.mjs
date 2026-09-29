// Aggregates saved v2 evaluation runs into committed results: docs/evals/results.json (metrics only, no
// issuer text) and docs/evals/results.svg (a grouped bar chart drawn by hand, no dependencies).
//
//   node scripts/summarize-evals.mjs [--runs evals/curation/runs/matrix ...] [--out docs/evals]
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    runs: { type: 'string', multiple: true, default: ['evals/curation/runs/matrix'] },
    out: { type: 'string', default: 'docs/evals' },
  },
});

const rate = (fraction) => (fraction && fraction.rate !== null ? Number(fraction.rate.toFixed(4)) : null);
const fraction = (f) => (f ? { correct: f.correct, total: f.total, rate: rate(f) } : null);

/** The headline numbers only, for per-repeat and per-variant breakdowns. */
function brief(summary) {
  return {
    runs: summary.cases,
    ruleRecall: fraction(summary.ruleRecall),
    endToEndFieldAccuracy: fraction(summary.endToEndFieldAccuracy),
    fieldAccuracy: fraction(summary.fieldAccuracy),
    claimPrecision: fraction(summary.claimPrecision),
    evidenceValidity: fraction(summary.evidenceValidity),
    issueRecall: fraction(summary.issueRecall),
    falseClean: summary.falseClean,
  };
}

function metrics(summary) {
  return {
    runs: summary.cases,
    ruleRecall: fraction(summary.ruleRecall),
    rulePrecision: fraction(summary.rulePrecision),
    fieldAccuracy: fraction(summary.fieldAccuracy),
    endToEndFieldAccuracy: fraction(summary.endToEndFieldAccuracy),
    cardFieldAccuracy: fraction(summary.cardFieldAccuracy),
    claimPrecision: fraction(summary.claimPrecision),
    unsupportedClaims: summary.unsupportedClaims,
    evidenceValidity: fraction(summary.evidenceValidity),
    issueRecall: fraction(summary.issueRecall),
    issueRecallByCode: Object.fromEntries(
      Object.entries(summary.issueRecallByCode ?? {}).map(([code, f]) => [code, fraction(f)]),
    ),
    exclusionRecall: fraction(summary.exclusionRecall),
    falseClean: summary.falseClean,
    statuses: summary.statuses,
    latencyMs: summary.latencyMs,
    tokens: summary.tokens,
    perField: Object.fromEntries(Object.entries(summary.perField ?? {}).map(([k, f]) => [k, fraction(f)])),
  };
}

/** Counts that the report does not aggregate itself: extra rules and quote failures by category. */
function errorCounts(cases) {
  const extraRules = {},
    missedRules = {},
    fieldErrors = {};
  for (const c of cases) {
    for (const category of c.extraRules) extraRules[category] = (extraRules[category] ?? 0) + 1;
    for (const category of c.missedRules) missedRules[category] = (missedRules[category] ?? 0) + 1;
    for (const e of c.fieldErrors) fieldErrors[e.field] = (fieldErrors[e.field] ?? 0) + 1;
  }
  return {
    extraRules,
    missedRules,
    fieldErrors,
    quotesUnresolved: cases.reduce((n, c) => n + (c.evidence.quotes - c.evidence.resolved), 0),
    quotesGiven: cases.reduce((n, c) => n + c.evidence.quotes, 0),
  };
}

const runs = [];
for (const dir of values.runs) {
  const base = resolve(root, dir);
  for (const name of (await readdir(base, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()) {
    const report = await readFile(join(base, name, 'report.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => undefined);
    if (!report) continue;
    const c = report.configuration;
    runs.push({
      id: name,
      provider: c.provider.id,
      model: c.provider.model,
      effort: c.effort,
      prompt: c.prompt,
      selection: c.selection,
      split: c.split,
      repeat: c.repeat,
      provenance: report.provenance,
      scorerVersion: report.scorerVersion,
      corpusHash: report.corpus.hash,
      planned: report.planned,
      observed: report.observed,
      complete: report.complete,
      overall: metrics(report.overall),
      byRepeat: report.repeats.map(brief),
      byVariant: Object.fromEntries(Object.entries(report.byVariant).map(([k, s]) => [k, brief(s)])),
      byCategory: report.byCategory,
      errors: errorCounts(report.cases),
    });
  }
}
if (!runs.length) throw new Error('No run directories with report.json found.');

const corpusHashes = [...new Set(runs.map((r) => r.corpusHash))];
const scorerVersions = [...new Set(runs.map((r) => r.scorerVersion))];
// A run whose every trace failed at the provider (for example a model the CLI rejects) measured nothing.
const measured = (r) => r.complete && (r.overall.statuses.provider_error ?? 0) < r.observed;
const results = {
  generatedAt: new Date().toISOString(),
  corpusHashes,
  scorerVersions,
  rejected: runs.filter((r) => r.complete && !measured(r)).map((r) => r.id),
  runs: runs.filter(measured),
};
const out = resolve(root, values.out);
await mkdir(out, { recursive: true });
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');

// Chart: one row per complete dev configuration, three bars each.
const label = (r) =>
  [r.model, r.effort, r.prompt, r.selection.replace('keyword-window.1', 'kw')].filter(Boolean).join(' · ');
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
  const height = top + rows.length * rowH + 30;
  const x = (v) => left + (v ?? 0) * (width - left - 20);
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
      `<text x="${x(tick)}" y="${height - 8}" text-anchor="middle" fill="#666">${tick * 100}%</text>`,
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
const dev = runs
  .filter((r) => r.split === 'dev' && measured(r))
  .sort(
    (a, b) => (b.overall.endToEndFieldAccuracy?.rate ?? 0) - (a.overall.endToEndFieldAccuracy?.rate ?? 0),
  );
await writeFile(
  join(out, 'results.svg'),
  chart(dev, `Extraction v2, dev split (${dev[0]?.planned ?? 0} runs per configuration)`),
);
console.log(`Summarized ${runs.length} runs (${dev.length} complete dev configurations) into ${out}`);
