import extension from './extension/eslint.config.js';
import globals from 'globals';
import js from '@eslint/js';
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
  // The public site is rendered to static HTML at build time; there is no fast refresh to protect.
  {
    files: ['apps/site/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
];
