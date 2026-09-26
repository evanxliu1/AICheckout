import extension from './extension/eslint.config.js';
import globals from 'globals';
import js from '@eslint/js';
export default [
  ...extension,
  { ignores: ['**/dist/**', '**/dist-catalog-test/**', '**/node_modules/**', '**/test-results/**'] },
  { files: ['apps/**/*.ts', 'scripts/**/*.mjs', 'extension/scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['extension/scripts/**/*.mjs'], rules: js.configs.recommended.rules },
];
