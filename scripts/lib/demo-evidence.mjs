import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const demoRoot = resolve(import.meta.dirname, '../..');
export const demoAssets = join(demoRoot, 'docs/release/assets');
export const digest = data => createHash('sha256').update(data).digest('hex');
export function fileEvidence(path) {
  const bytes = readFileSync(path);
  return { path: relative(demoRoot, path), bytes: bytes.length, sha256: digest(bytes) };
}
function tree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Demo provenance cannot follow symbolic links');
    return entry.isDirectory() ? tree(path) : [fileEvidence(path)];
  });
}
export function fullStackEvidence() {
  const sourceDirs = ['apps/api/src', 'apps/review/src', 'supabase/migrations'];
  for (const item of readdirSync(join(demoRoot, 'packages'), { withFileTypes: true })) {
    if (item.isDirectory()) sourceDirs.push(`packages/${item.name}/src`);
  }
  return {
    sourceFiles: [...sourceDirs.flatMap(path => tree(join(demoRoot, path))),
      ...['package-lock.json', 'apps/review/index.html', 'apps/review/vite.config.ts',
        'scripts/lib/local-catalog-fixture.mjs', 'scripts/fixtures/openai-refusal-preload.mjs',
        'apps/review/e2e/portfolio-demo.spec.mjs'].map(path => fileEvidence(join(demoRoot, path)))].sort((a, b) => a.path.localeCompare(b.path)),
    buildFiles: ['apps/api/dist', 'apps/review/dist'].flatMap(path => tree(join(demoRoot, path))).sort((a, b) => a.path.localeCompare(b.path)),
  };
}
