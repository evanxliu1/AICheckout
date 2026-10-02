import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revealStaticHtml } from './static-html.mjs';

test('opens every details element and drops exclusive-accordion names', () => {
  const out = revealStaticHtml(
    '<details name="FAQ"><summary>Q</summary>A</details><details class="x" open><summary>R</summary></details>',
  );
  assert.match(out, /^<details open><summary>Q<\/summary>A<\/details><details open class="x">/);
  assert.doesNotMatch(out, /name="FAQ"/);
});

test('leaves other tags alone and appends the reveal style', () => {
  const out = revealStaticHtml('<div id="detailsBox">text</div>');
  assert.ok(out.startsWith('<div id="detailsBox">text</div><style>'));
  assert.match(out, /display: revert !important/);
});
