// The import boundary: product code (extension, packages/*, apps/*) never imports tools/ or the catalog pipeline
// workspace; tools/ and scripts/ may import product packages. Lints source text with the repository's real ESLint
// config, so the test fails if the rule in eslint.config.js is removed or stops matching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

/** The `no-restricted-imports` messages ESLint reports for `code` as if it lived at `filePath`. */
async function boundaryErrors(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
}

const FORBIDDEN = [
  ['extension/src/background/x.ts', "import { run } from '../../../tools/catalog-pipeline/src/cli.ts';"],
  ['packages/rewards-core/src/x.ts', "import { run } from '../../../tools/catalog-pipeline/src/cli.ts';"],
  ['apps/api/src/x.ts', "export { run } from '../../../tools/catalog-pipeline/src/cli.ts';"],
  ['apps/review/src/x.tsx', "import { stages } from '@ai-checkout/catalog-pipeline';"],
  ['apps/site/src/x.ts', "import { stages } from '@ai-checkout/catalog-pipeline/stages';"],
  ['packages/ui/scripts/x.mjs', "import { run } from '../../../tools/catalog-pipeline/src/cli.mjs';"],
  ['extension/scripts/x.mjs', "import '../../tools/anything.mjs';"],
];

for (const [filePath, code] of FORBIDDEN) {
  test(`product code may not import tools/: ${filePath}`, async () => {
    const errors = await boundaryErrors(code, filePath);
    assert.equal(errors.length, 1, `expected one boundary error for ${code}`);
    assert.equal(errors[0].severity, 2);
  });
}

const ALLOWED = [
  ['apps/api/src/x.ts', "import { catalogV2Schema } from '@ai-checkout/rewards-core';"],
  ['extension/src/x.ts', "import { helper } from './toolsHelper.ts';"],
  ['packages/ui/src/x.tsx', "import { toolbar } from '../toolbar/index.ts';"],
  // The pipeline lives outside product code: scripts/ and tools/ may import product packages and tools/.
  ['scripts/x.mjs', "import { run } from '../tools/catalog-pipeline/src/cli.mjs';"],
  ['tools/catalog-pipeline/src/x.ts', "import { catalogV3Schema } from '@ai-checkout/rewards-core';"],
  [
    'tools/catalog-pipeline/src/x.ts',
    "import { canonicalJson } from '../../../apps/api/src/curation/canonical.ts';",
  ],
];

for (const [filePath, code] of ALLOWED) {
  test(`allowed import: ${filePath}: ${code}`, async () => {
    assert.deepEqual(await boundaryErrors(code, filePath), []);
  });
}
