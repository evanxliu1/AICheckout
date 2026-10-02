import extension from './extension/eslint.config.js';
import globals from 'globals';
import js from '@eslint/js';

/** Product code: what ships in the extension, the hosted apps and the shared packages. */
export const PRODUCT_CODE = [
  'extension/**/*.{js,mjs,cjs,ts,tsx}',
  'packages/**/*.{js,mjs,cjs,ts,tsx}',
  'apps/**/*.{js,mjs,cjs,ts,tsx}',
];
/** Any relative path into the repository's tools/ directory, and the pipeline workspace by package name. */
export const TOOLS_IMPORT_PATTERNS = [
  {
    regex: '^(\\.\\.?/)*tools(/|$)',
    message: 'Product code must not import tools/ (maintainer tooling). Move shared code into packages/*.',
  },
  {
    regex: '^@ai-checkout/catalog-pipeline(/|$)',
    message: 'Product code must not import the catalog pipeline. Move shared code into packages/*.',
  },
];
export default [
  ...extension,
  {
    ignores: [
      '**/dist/**',
      '**/dist-catalog-test/**',
      '**/dist-e2e/**',
      '**/node_modules/**',
      '**/test-results/**',
    ],
  },
  {
    files: ['apps/**/*.ts', 'scripts/**/*.mjs', 'extension/scripts/**/*.mjs', 'packages/*/scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  { files: ['extension/scripts/**/*.mjs'], rules: js.configs.recommended.rules },
  // Boundary: product code never imports the maintainer tooling in tools/ (the catalog pipeline). The pipeline may
  // import product packages, not the reverse. Decision: wiki/decisions/2026-10-02-agent-driven-card-pipeline.md;
  // test: scripts/lib/import-boundary.test.mjs.
  {
    files: PRODUCT_CODE,
    rules: { 'no-restricted-imports': ['error', { patterns: TOOLS_IMPORT_PATTERNS }] },
  },
  // The public site is rendered to static HTML at build time; there is no fast refresh to protect.
  {
    files: ['apps/site/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
];
