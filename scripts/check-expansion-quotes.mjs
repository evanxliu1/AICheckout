// Check that the committed catalog-expansion files quote no issuer capture beyond 25 words.
//
//   node scripts/check-expansion-quotes.mjs [--dir evals/curation/expansion] [--captures <dir> ...]
//
// Needs the local captures (gitignored), by default <dir>/captures; pass --captures once per capture folder to read
// them from elsewhere (for example the expansion and real capture folders of another worktree). Scans every string of
// corpus.draft.json, corpus.json, product-notes.json, product-notes.verified.json, reward-programs.json,
// catalog-overlay.json, merchants.json, verification/*.json (and a pipeline batch's research/*.json and overlay/*.json)
// and the built CATALOG_V3, and every line or table cell
// of verify/*.md, verification-report.md, catalog-build-report.md, verification/README.md and
// verification/conventions/*.md, for a run of more than 25 consecutive words that also appears in a capture (case-,
// whitespace- and quotation-mark-insensitive). Quotes read together count too: the strings (or anchor `quote`s) of
// one JSON array must not overlap or abut in a capture into such a run, and neither may consecutive lines and cells
// of a markdown file. Also checks that every corpus anchor and issuer wording is at most 25 words, and that every
// reward-programs.json anchor is verbatim in the capture it names, as must every catalog-overlay.json anchor. The
// real cards of CATALOG_V3 quote the real captures: pass those folders too. Exits 1 and lists the offending strings.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MAX_QUOTE_WORDS } from './lib/expansion-quotes.mjs';
import { checkQuoteFiles } from './lib/expansion-quote-check.mjs';
import { CATALOG_V3 } from '../packages/rewards-core/src/catalog-v3.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/expansion' },
    captures: { type: 'string', multiple: true },
  },
});
const dir = resolve(root, values.dir);
const captureDirs = (values.captures ?? [`${dir}/captures`]).map((folder) => resolve(root, folder));
const result = await checkQuoteFiles({ root, dir, captureDirs, catalog: CATALOG_V3 });
if (result.noCaptures) {
  console.error(`No captures in ${captureDirs.join(', ')}: cannot check quotes.`);
  process.exit(1);
}
if (result.problems.length) {
  console.error(`${result.problems.length} quote(s) over ${MAX_QUOTE_WORDS} words:`);
  for (const problem of result.problems) console.error(`- ${problem.message}`);
  process.exit(1);
}
console.log(
  `OK: ${result.checked} files, no run of more than ${MAX_QUOTE_WORDS} words from ${result.captures} captures.`,
);
