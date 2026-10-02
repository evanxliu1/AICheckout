// Run the v2 LLM extraction on each expansion card's captured pages.
//
//   node scripts/extract-cards.mjs [--dir evals/curation/expansion] [--only id,id] [--concurrency 3]
//     [--provider codex] [--model gpt-5.5] [--effort low] [--prompt guided.2] [--selection keyword-window.1]
//
// Reads <dir>/cards.json, <dir>/manifest.json, and the gitignored <dir>/captures/. Each card's trace goes to
// the gitignored <dir>/extractions/<cardId>.json (it holds model quotes of issuer text); a summary without
// issuer text goes to the committed <dir>/extraction-summary.json. Resumable: cards with a saved extraction
// are skipped unless it ended in a timeout or provider error or a page it read was re-captured. A timeout or provider error is retried once. A
// usage limit stops the run with exit status 3; run the same command again later to continue.
//
// Input limits: the harness admits at most 4 documents and ~64k estimated input tokens. When a card's pages
// exceed that with the chosen selection, the lowest-priority pages are dropped (the summary records which).
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/expansion' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    provider: { type: 'string', default: 'codex' },
    model: { type: 'string', default: 'gpt-5.5' },
    effort: { type: 'string', default: 'low' },
    prompt: { type: 'string', default: 'guided.2' },
    selection: { type: 'string', default: 'keyword-window.1' },
    'summary-only': { type: 'boolean', default: false },
  },
});
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3)
  throw new Error('--concurrency must be 1 to 3.');

// The harness is TypeScript; bundle the pieces this script needs, as scripts/evaluate-curation-v2.mjs does.
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      export { executeTask } from './apps/api/src/curation/runner.ts';
      export { extractionTaskV2 } from './apps/api/src/curation/v2/task.ts';
      export { buildContextV2 } from './apps/api/src/curation/v2/context.ts';
      export { createCodexProvider } from './apps/api/src/curation/codex.ts';
      export { createClaudeProvider } from './apps/api/src/curation/claude.ts';
      export { cliVersion } from './apps/api/src/curation/cli-version.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const harness = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

/** Same limits as live eval:v2 runs (apps/api/src/curation/v2/eval-cli.ts). */
const LIMITS = {
  attemptTimeoutMs: 240_000,
  totalTimeoutMs: 480_000,
  maxInputTokens: 64_000,
  maxOutputTokens: 8192,
};
const MAX_DOCUMENTS = 4;
const MAX_BODY = 400_000;
const RETRYABLE = new Set(['timeout', 'provider_error']);
const EXIT_RATE_LIMITED = 3;
const KIND_PRIORITY = [
  'product-page',
  'rewards-terms',
  'application-terms',
  'rates-and-fees',
  'rotating-calendar',
  'category-faq',
  'partner-page',
];

const dir = resolve(root, values.dir);
const outDir = join(dir, 'extractions');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const { cards } = JSON.parse(await readFile(join(dir, 'cards.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const sources = new Map(manifest.sources.map((source) => [source.id, source]));
const only = values.only ? new Set(values.only.split(',')) : null;
await mkdir(outDir, { recursive: true, mode: 0o700 });

const configuration = {
  provider: values.provider,
  model: values.model,
  effort: values.effort,
  prompt: values.prompt,
  selection: values.selection,
};

async function readSaved(cardId) {
  try {
    return JSON.parse(await readFile(join(outDir, `${cardId}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** The card's documents in priority order, with a record of anything dropped or cut to fit the limits. */
async function inputFor(card) {
  const notes = [];
  const documents = [];
  const ordered = [...card.sourceIds].sort((a, b) => {
    const rank = (id) => KIND_PRIORITY.indexOf(sources.get(id)?.kind ?? '');
    return rank(a) - rank(b);
  });
  for (const sourceId of ordered) {
    const source = sources.get(sourceId);
    if (!source) {
      notes.push(`${sourceId}: not captured`);
      continue;
    }
    let body;
    try {
      body = await readFile(join(dir, 'captures', `${sourceId}.txt`), 'utf8');
    } catch {
      notes.push(`${sourceId}: capture file missing`);
      continue;
    }
    if (sha256(body) !== source.sha256) {
      notes.push(`${sourceId}: capture does not match manifest hash`);
      continue;
    }
    if (body.length > MAX_BODY) {
      // Keyword-window lines are verbatim, so quotes from the excerpt still resolve in the full capture.
      body = selectLines(body);
      notes.push(`${sourceId}: longer than ${MAX_BODY} characters; sent as keyword-window excerpt`);
    }
    documents.push({
      id: sourceId,
      title: source.title,
      url: source.url,
      capturedOn: source.capturedOn,
      body,
      contentHash: sha256(body),
    });
  }
  while (documents.length > MAX_DOCUMENTS)
    notes.push(`${documents.pop().id}: dropped (more than 4 documents)`);
  const input = { cardId: card.id, cardName: card.name.slice(0, 120), documents };
  // Drop lowest-priority pages until the context fits the token limit.
  while (
    input.documents.length > 1 &&
    harness.buildContextV2(input, configuration.prompt, configuration.selection).inputTokenEstimate >
      LIMITS.maxInputTokens
  )
    notes.push(`${input.documents.pop().id}: dropped to fit the input token limit`);
  return { input, notes };
}

/** Keyword-window excerpt of a body (same rule as context.ts selectText), for pages over the schema limit. */
function selectLines(body) {
  const context = harness.buildContextV2(
    {
      cardId: 'x',
      cardName: 'x',
      documents: [{ id: 'x', title: 'x', url: 'https://x', capturedOn: '2026-01-01', body, contentHash: '' }],
    },
    'guided.2',
    'keyword-window.1',
  );
  return JSON.parse(context.user).documents[0].text.slice(0, MAX_BODY);
}

async function providerFor() {
  if (configuration.provider === 'codex') {
    const provider = await harness.createCodexProvider({
      model: configuration.model,
      reasoningEffort: configuration.effort,
    });
    return { provider, cliVersion: await harness.cliVersion('codex') };
  }
  if (configuration.provider === 'claude') {
    const provider = harness.createClaudeProvider({
      model: configuration.model,
      effort: configuration.effort,
    });
    return { provider, cliVersion: await harness.cliVersion('claude') };
  }
  throw new Error('--provider must be codex or claude.');
}

const rateLimited = (trace) =>
  trace.status === 'provider_error' && trace.attempts.at(-1)?.outcome === 'rate-limit';

async function writeAtomic(path, text) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, path);
}

function summarize(card, saved) {
  if (!saved) return { cardId: card.id, issuer: card.issuer, status: 'not-run' };
  const { trace, notes, attempts } = saved;
  const findings = {};
  for (const finding of trace.findings ?? []) findings[finding.code] = (findings[finding.code] ?? 0) + 1;
  const usage = trace.attempts.reduce(
    (sum, attempt) => ({
      inputTokens: sum.inputTokens + (attempt.usage?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (attempt.usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  return {
    cardId: card.id,
    issuer: card.issuer,
    status: trace.status,
    rules: trace.extraction?.rules.length ?? null,
    categories: trace.extraction
      ? [...new Set(trace.extraction.rules.map((rule) => rule.category))].sort()
      : null,
    issues: trace.extraction ? trace.extraction.issues.map((issue) => issue.code) : null,
    findings,
    documents: saved.documents.map((document) => document.id),
    inputNotes: notes,
    runs: attempts,
    cliVersion: saved.cliVersion ?? null,
    durationMs: trace.durationMs,
    inputTokenEstimate: trace.context?.inputTokenEstimate ?? null,
    ...usage,
    runAt: trace.startedAt,
  };
}

async function writeSummary() {
  const rows = [];
  for (const card of cards) rows.push(summarize(card, await readSaved(card.id)));
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  await writeFile(
    join(dir, 'extraction-summary.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedBy: 'scripts/extract-cards.mjs',
        configuration: {
          ...configuration,
          limits: LIMITS,
          cliVersions: [...new Set(rows.flatMap((row) => (row.cliVersion ? [row.cliVersion] : [])))],
        },
        counts,
        cards: rows,
      },
      null,
      2,
    ) + '\n',
  );
  return counts;
}

if (values['summary-only']) {
  console.log(await writeSummary());
  process.exit(0);
}

const { provider, cliVersion } = await providerFor();
const task = harness.extractionTaskV2(configuration.prompt, configuration.selection);
const saved = new Set(
  (await readdir(outDir)).filter((name) => name.endsWith('.json')).map((n) => n.slice(0, -5)),
);
const queue = [];
for (const card of cards) {
  if (only && !only.has(card.id)) continue;
  if (saved.has(card.id)) {
    const previous = await readSaved(card.id);
    // A saved extraction stands only while every page it read still matches the manifest.
    const current =
      previous?.documents.every(
        (document) => sources.get(document.id)?.sha256 === (document.sourceSha256 ?? document.contentHash),
      ) ?? false;
    if (previous && current && !RETRYABLE.has(previous.trace.status)) continue;
  }
  queue.push(card);
}
console.log(
  `${queue.length} cards to extract (${configuration.provider} ${configuration.model} ${configuration.effort}).`,
);

let stopped = false,
  next = 0,
  done = 0;
async function worker() {
  while (!stopped && next < queue.length) {
    const card = queue[next++];
    const { input, notes } = await inputFor(card);
    if (!input.documents.length) {
      console.log(`${card.id}: no captured documents; skipped`);
      continue;
    }
    const previous = await readSaved(card.id);
    let trace,
      attempts = previous?.attempts ?? 0;
    for (let run = 0; run < 2; run++) {
      trace = await harness.executeTask(task, input, provider, { limits: LIMITS });
      attempts++;
      if (rateLimited(trace) || !RETRYABLE.has(trace.status)) break;
      console.log(`${card.id}: ${trace.status}; retrying once`);
    }
    if (rateLimited(trace)) {
      stopped = true;
      console.log(`${card.id}: usage limit reached; stopping. Run again later to resume.`);
      break;
    }
    const record = {
      schemaVersion: 1,
      cardId: card.id,
      configuration,
      cliVersion,
      notes,
      attempts,
      documents: input.documents.map(({ id, url, capturedOn, contentHash }) => ({
        id,
        url,
        capturedOn,
        contentHash,
        sourceSha256: sources.get(id).sha256,
      })),
      trace,
    };
    await writeAtomic(join(outDir, `${card.id}.json`), JSON.stringify(record, null, 2) + '\n');
    done++;
    console.log(
      `[${done}/${queue.length}] ${card.id}: ${trace.status} (${trace.durationMs} ms, ${trace.extraction?.rules.length ?? '-'} rules)`,
    );
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
const counts = await writeSummary();
console.log(counts);
if (stopped) process.exitCode = EXIT_RATE_LIMITED;
