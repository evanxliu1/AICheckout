import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReleaseDocs, findings, RELEASE_RULES, STALE_RULES } from './release-docs.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the stale rules catch the retired three-store wording and "anonymous" as a data claim', () => {
  const stale = [
    'On Amazon US, Best Buy US and Newegg US carts, the badge appears.',
    'The badge appears only on the three supported carts.',
    'Three stores are supported today.',
    'Open the toolbar on the supported cart.',
    'Exact amounts, anonymous.',
    'The stored hash is not a promise of anonymization.',
  ];
  for (const line of stale) assert.ok(findings(line, STALE_RULES).length > 0, line);
  const fine = [
    'The badge appears at any https store whose address names the cart.',
    'A random identifier, no name, email or browsing history; this data is pseudonymous.',
    'Chrome 120 and later is supported; unsupported currencies are not compared.',
    'The merchant release names more than 600 stores.',
    'Only on a shopper’s tap does a domain travel.',
  ];
  for (const line of fine) assert.deepEqual(findings(line, STALE_RULES), [], line);
});

test('the release rules catch the placeholders Evan still has to fill, and nothing else', () => {
  assert.equal(findings('Contact: SUPPORT_EMAIL_TBD', RELEASE_RULES)[0]?.rule, 'placeholder');
  assert.equal(findings('Publisher [[PUBLISHER_NAME]]', RELEASE_RULES)[0]?.rule, 'placeholder');
  assert.equal(findings('Non-trader (Evan to confirm)', RELEASE_RULES)[0]?.rule, 'evan-pending');
  assert.deepEqual(findings('Contact: support@example.com; publisher Evan Liu', RELEASE_RULES), []);
});

test('the committed release material has no stale wording', () => {
  assert.deepEqual(checkReleaseDocs(root), []);
});

test('release mode still refuses the committed material while the support email is a placeholder', () => {
  const found = checkReleaseDocs(root, { release: true });
  assert.ok(found.some((f) => f.rule === 'placeholder' && f.text === 'SUPPORT_EMAIL_TBD'));
  assert.ok(found.every((f) => f.rule === 'placeholder' || f.rule === 'evan-pending'));
});
