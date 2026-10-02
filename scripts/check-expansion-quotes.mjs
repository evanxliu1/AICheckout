// Check that the committed catalog-expansion files quote no issuer capture beyond 25 words.
//
//   node scripts/check-expansion-quotes.mjs [--dir evals/curation/expansion]
//
// Needs the local captures (gitignored). Scans every string of corpus.draft.json, corpus.json,
// product-notes.json and verification/*.json, and every line or table cell of verify/*.md and
// verification-report.md, for a run of more than 25 consecutive words that also appears in a capture (case-,
// whitespace- and quotation-mark-insensitive). Also checks that every corpus anchor and issuer wording is at most
// 25 words. Exits 1 and lists the offending strings if any.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  MAX_QUOTE_WORDS,
  captureIndex,
  longCaptureRun,
  markdownUnits,
  stringsOf,
  wordCount,
} from './lib/expansion-quotes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { dir: { type: 'string', default: 'evals/curation/expansion' } } });
const dir = resolve(root, values.dir);
const list = async (sub, ext) =>
  (await readdir(join(dir, sub)).catch(() => []))
    .filter((name) => name.endsWith(ext))
    .sort()
    .map((name) => join(dir, sub, name));

const captureFiles = await list('captures', '.txt');
if (!captureFiles.length) {
  console.error(`No captures in ${join(dir, 'captures')}: cannot check quotes.`);
  process.exit(1);
}
const index = captureIndex(await Promise.all(captureFiles.map((path) => readFile(path, 'utf8'))));

const jsonFiles = [
  ...['corpus.draft.json', 'corpus.json', 'product-notes.json'].map((name) => join(dir, name)),
  ...(await list('verification', '.json')),
];
const markdownFiles = [...(await list('verify', '.md')), join(dir, 'verification-report.md')];

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
  for (const item of data.cases ?? [])
    for (const [at, value] of stringsOf(item.reference, `${item.id}.reference`))
      if (/\.(anchors\[\d+\]|issuerWording)$/.test(at) && wordCount(value) > MAX_QUOTE_WORDS)
        problems.push(`${relative(root, path)} ${at}: ${wordCount(value)} words`);
}
for (const path of markdownFiles) {
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) continue;
  checked++;
  for (const [at, unit] of markdownUnits(text)) {
    const run = longCaptureRun(unit, index);
    if (run)
      problems.push(
        `${relative(root, path)} ${at}: quotes ${wordCount(run)}+ words: "${run.slice(0, 120)}…"`,
      );
  }
}

if (problems.length) {
  console.error(`${problems.length} quote(s) over ${MAX_QUOTE_WORDS} words:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(
  `OK: ${checked} files, no run of more than ${MAX_QUOTE_WORDS} words from ${captureFiles.length} captures.`,
);
