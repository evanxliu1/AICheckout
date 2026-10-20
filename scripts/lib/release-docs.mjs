// Release-doc wording check (Phase 15.5). The public release material must describe the extension as it is
// since Phase 15.1: the badge at any https store, no privileged stores, pseudonymous usage reports. Every run
// refuses the retired three-store wording and "anonymous" as a data claim; `release: true` (milestone 15.7)
// also refuses the placeholders Evan still has to fill.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Files and directories checked, relative to the repository root. */
export const CHECKED_PATHS = [
  'docs/release/README.md',
  'docs/release/privacy-policy.md',
  'docs/release/store-listing.md',
  'docs/release/support.md',
  'docs/release/reviewer-instructions.md',
  'docs/verification/merchants.md',
  'extension/README.md',
  'README.md',
  'apps/site/src',
];

/** Always refused: wording from before the adapters were retired, and "anonymous" as a description of data. */
export const STALE_RULES = [
  { rule: 'three-stores', pattern: /Amazon US, Best Buy US,? and Newegg US/i },
  {
    rule: 'three-stores',
    pattern:
      /\b(?:three|3) (?:supported |legacy |named |U\.S\. )?(?:stores|sites|checkouts|retailers|merchants|carts)\b/i,
  },
  {
    rule: 'only-on-store',
    pattern:
      /\bonly (?:on|at) (?:the |these |its |their )?(?:Amazon|Best Buy|Newegg|three|supported|named|listed)/i,
  },
  {
    rule: 'supported-store',
    pattern: /\bsupported (?:cart|carts|merchant|merchants|retailer|retailers|store|stores)\b/i,
  },
  { rule: 'anonymous', pattern: /\banonym(?:ous|ously|ized|ised|ization|isation|ity)\b/i },
];

/** Refused before a release: placeholders and decisions Evan still has to settle. */
export const RELEASE_RULES = [
  { rule: 'placeholder', pattern: /SUPPORT_EMAIL_TBD|EFFECTIVE_DATE_TBD|\[\[[A-Z_]+\]\]/ },
  { rule: 'evan-pending', pattern: /Evan to (?:confirm|supply)/ },
];

const TEXT_FILE = /\.(?:md|ts|tsx|html)$/;

function* files(root, path) {
  const absolute = join(root, path);
  if (statSync(absolute).isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) yield* files(root, join(path, entry));
  } else if (TEXT_FILE.test(path)) yield path;
}

/** Every rule hit in `text`, with its 1-based line number. */
export function findings(text, rules, file = '') {
  const found = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries())
    for (const { rule, pattern } of rules) {
      const match = pattern.exec(line);
      if (match) found.push({ file, line: index + 1, rule, text: match[0] });
    }
  return found;
}

/** Checks the release material under `root`; `release` adds the placeholder rules. */
export function checkReleaseDocs(root, { release = false } = {}) {
  const rules = release ? [...STALE_RULES, ...RELEASE_RULES] : STALE_RULES;
  const found = [];
  for (const path of CHECKED_PATHS)
    for (const file of files(root, path))
      found.push(
        ...findings(readFileSync(join(root, file), 'utf8'), rules, relative(root, join(root, file))),
      );
  return found;
}
