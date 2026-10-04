import { fileURLToPath } from 'node:url';

/** The repository root (tools/catalog-pipeline/src → ../../..). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
