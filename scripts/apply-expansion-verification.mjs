// Apply the per-issuer verification findings to the expansion drafts.
//
//   node scripts/apply-expansion-verification.mjs [--dir evals/curation/expansion] [--version expansion.v1] [--check]
//
// Reads cards.json, manifest.json, corpus.draft.json, product-notes.json, verification/*.json and the local
// captures (gitignored, hash-checked). Validates every file against the format in verification/README.md, checks
// every quote is at most 25 words and verbatim in the capture it names, and applies accepted and modified fixes.
// Writes, unless --check or there are errors (then it writes nothing and exits 1):
//   corpus.json                    corpus v2, annotationStatus "agent-verified": only cards whose verification is
//                                  complete and adjudicated (never a card without a verification entry)
//   product-notes.verified.json    the verified cards' product hints with the verifiers' changes
//   verification-report.md         per-issuer card statuses, fixes by field, adjudication counts
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  applyVerification,
  buildCorpus,
  loadExpansion,
  verificationReport,
} from './lib/expansion-verification.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/expansion' },
    version: { type: 'string', default: 'expansion.v1' },
    check: { type: 'boolean', default: false },
  },
});
const dir = resolve(root, values.dir);
const state = await loadExpansion(dir);
const result = applyVerification(state);
if (result.errors.length) {
  console.error(`${result.errors.length} error(s); nothing written:`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}
const report = verificationReport({ cards: state.cards, statuses: result.statuses, entries: result.entries });
const counts = {};
for (const status of result.statuses.values()) counts[status] = (counts[status] ?? 0) + 1;
console.log(`${state.files.length} verification file(s); cards by status:`, counts);
if (values.check) process.exit(0);

await writeFile(join(dir, 'verification-report.md'), report);
if (result.cases.length) {
  const corpus = buildCorpus(result.cases, result.files, values.version);
  await writeFile(join(dir, 'corpus.json'), JSON.stringify(corpus, null, 2) + '\n');
  await writeFile(
    join(dir, 'product-notes.verified.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedBy: 'scripts/apply-expansion-verification.mjs',
        description:
          'Product hints of the verified cards with the verifiers’ adjudicated changes. verification: confirmed, fixed or added by a verifier (anchor quoted from anchorSourceId), or unreviewed.',
        cards: result.productNotes,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`corpus.json: ${corpus.cases.length} agent-verified cases (${corpus.version})`);
} else console.log('No card is fully verified and adjudicated yet: corpus.json not written.');
console.log('verification-report.md written');
