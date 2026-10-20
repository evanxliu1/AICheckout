#!/usr/bin/env node
// Refuses stale or placeholder wording in the public release material (Phase 15.5).
//   node scripts/check-release-docs.mjs            stale three-store wording, "anonymous" as a data claim
//   node scripts/check-release-docs.mjs --release  plus the placeholders Evan has to fill (SUPPORT_EMAIL_TBD,
//                                                  "Evan to confirm"); milestone 15.7 runs this before submission
import { fileURLToPath } from 'node:url';
import { checkReleaseDocs, CHECKED_PATHS } from './lib/release-docs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const release = process.argv.includes('--release');
const found = checkReleaseDocs(root, { release });
for (const { file, line, rule, text } of found) console.error(`${file}:${line}: ${rule}: "${text}"`);
if (found.length) {
  console.error(
    `\n${found.length} finding(s) in ${CHECKED_PATHS.length} checked paths${release ? ' (release mode)' : ''}.`,
  );
  process.exit(1);
}
console.log(`Release docs clean${release ? ' for release' : ''} (${CHECKED_PATHS.length} checked paths).`);
