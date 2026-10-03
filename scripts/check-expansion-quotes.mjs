// Check that the committed catalog-expansion files quote no issuer capture beyond 25 words.
//
//   node scripts/check-expansion-quotes.mjs [--dir evals/curation/expansion] [--captures <dir> ...]
//
// Needs the local captures (gitignored), by default <dir>/captures; pass --captures once per capture folder to read
// them from elsewhere (for example the expansion and real capture folders of another worktree). Scans every string of
// corpus.draft.json, corpus.json, product-notes.json, product-notes.verified.json, reward-programs.json,
// catalog-overlay.json, merchants.json and verification/*.json, and every line or table cell of verify/*.md,
// verification-report.md, verification/README.md and verification/conventions/*.md, for a run of more than 25
// consecutive words that also appears in a capture (case-, whitespace- and quotation-mark-insensitive). Quotes read
// together count too: the strings (or anchor `quote`s) of one JSON array must not overlap or abut in a capture into
// such a run, and neither may consecutive lines and cells of a markdown file. Also checks that every corpus anchor
// and issuer wording is at most 25 words, and that every reward-programs.json anchor is verbatim in the capture it
// names, as must every catalog-overlay.json anchor. Exits 1 and lists the offending strings if any.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  MAX_QUOTE_WORDS,
  captureIndex,
  joinedCaptureRun,
  longCaptureRun,
  markdownUnits,
  quoteArraysOf,
  resolves,
  stringsOf,
  wordCount,
} from './lib/expansion-quotes.mjs';
import { overlayAnchors } from './lib/catalog-overlay.mjs';
import { rewardProgramAnchors } from './lib/reward-programs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/expansion' },
    captures: { type: 'string', multiple: true },
  },
});
const dir = resolve(root, values.dir);
const listIn = async (folder, ext) =>
  (await readdir(folder).catch(() => []))
    .filter((name) => name.endsWith(ext))
    .sort()
    .map((name) => join(folder, name));
const list = (sub, ext) => listIn(join(dir, sub), ext);

const captureDirs = (values.captures ?? [join(dir, 'captures')]).map((folder) => resolve(root, folder));
const captureFiles = (await Promise.all(captureDirs.map((folder) => listIn(folder, '.txt')))).flat();
if (!captureFiles.length) {
  console.error(`No captures in ${captureDirs.join(', ')}: cannot check quotes.`);
  process.exit(1);
}
const bodies = await Promise.all(captureFiles.map((path) => readFile(path, 'utf8')));
const index = captureIndex(bodies);
const captureById = new Map(captureFiles.map((path, i) => [basename(path, '.txt'), bodies[i]]));

const jsonFiles = [
  ...[
    'corpus.draft.json',
    'corpus.json',
    'product-notes.json',
    'product-notes.verified.json',
    'reward-programs.json',
    'catalog-overlay.json',
    'merchants.json',
  ].map((name) => join(dir, name)),
  ...(await list('verification', '.json')),
];
const markdownFiles = [
  ...(await list('verify', '.md')),
  join(dir, 'verification-report.md'),
  join(dir, 'verification', 'README.md'),
  ...(await list(join('verification', 'conventions'), '.md')),
];

const problems = [];
let checked = 0;
for (const path of jsonFiles) {
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) continue;
  checked++;
  const data = JSON.parse(text);
  for (const [at, value] of stringsOf(data)) {
    const run = longCaptureRun(value, index);
    if (run)
      problems.push(
        `${relative(root, path)} ${at}: quotes ${wordCount(run)}+ words: "${run.slice(0, 120)}…"`,
      );
  }
  for (const [at, texts] of quoteArraysOf(data)) {
    const run = joinedCaptureRun(texts, index);
    if (run)
      problems.push(
        `${relative(root, path)} ${at}: items ${run.texts.join(', ')} read together form a run of ${run.words}+ capture words`,
      );
  }
  const anchored =
    basename(path) === 'catalog-overlay.json'
      ? overlayAnchors(data)
      : basename(path) === 'reward-programs.json'
        ? rewardProgramAnchors(data)
        : [];
  for (const [at, anchor] of anchored) {
    const body = captureById.get(anchor.sourceId);
    if (body === undefined) problems.push(`${relative(root, path)} ${at}: no capture ${anchor.sourceId}`);
    else if (!resolves(anchor.quote, { documents: [{ id: anchor.sourceId, body }] }))
      problems.push(`${relative(root, path)} ${at}: not verbatim in ${anchor.sourceId}`);
  }
  if (basename(path) === 'catalog-overlay.json') {
    const corpus = JSON.parse(await readFile(join(dir, 'corpus.json'), 'utf8'));
    const sourcesOf = new Map(corpus.cases.map((item) => [item.cardId, item.sourceIds]));
    for (const card of data.cards ?? [])
      for (const added of card.addedRules ?? []) {
        const documents = (sourcesOf.get(card.cardId) ?? [])
          .filter((id) => captureById.has(id))
          .map((id) => ({ id, body: captureById.get(id) }));
        if (!resolves(added.issuerWording, { documents }))
          problems.push(
            `${relative(root, path)} cards.${card.cardId}.addedRules.${added.key}.issuerWording: not verbatim in the card's captures`,
          );
      }
  }
  for (const item of data.cases ?? [])
    for (const [at, value] of stringsOf(item.reference, `${item.id}.reference`))
      if (/\.(anchors\[\d+\]|issuerWording)$/.test(at) && wordCount(value) > MAX_QUOTE_WORDS)
        problems.push(`${relative(root, path)} ${at}: ${wordCount(value)} words`);
}
for (const path of markdownFiles) {
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) continue;
  checked++;
  const units = markdownUnits(text);
  let single = false;
  for (const [at, unit] of units) {
    const run = longCaptureRun(unit, index);
    if (run) {
      single = true;
      problems.push(
        `${relative(root, path)} ${at}: quotes ${wordCount(run)}+ words: "${run.slice(0, 120)}…"`,
      );
    }
  }
  // Consecutive lines and cells read as one text (only reported when no single unit already is).
  const joined = !single && longCaptureRun(units.map(([, unit]) => unit).join(' '), index);
  if (joined)
    problems.push(
      `${relative(root, path)}: consecutive lines or cells read together quote ${wordCount(joined)}+ words: "${joined.slice(0, 120)}…"`,
    );
}

if (problems.length) {
  console.error(`${problems.length} quote(s) over ${MAX_QUOTE_WORDS} words:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(
  `OK: ${checked} files, no run of more than ${MAX_QUOTE_WORDS} words from ${captureFiles.length} captures.`,
);
