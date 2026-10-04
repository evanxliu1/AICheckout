// The file paths of a capture run (scripts/capture-issuer-pages.mjs). `--dir` is resolved from the repository root;
// `--sources`, `--captures`, `--manifest`, `--report` and `--renderer` from `--dir`, so a relative value stays under
// the directory and an absolute one is used as given (Phase 9: `pipeline freshness` captures into a temporary
// directory outside the repository). `--hints` is resolved from the root, as before.
import { resolve } from 'node:path';

export function capturePaths(root, values) {
  const dir = resolve(root, values.dir);
  const under = (value) => (value ? resolve(dir, value) : null);
  return {
    dir,
    sources: under(values.sources),
    captures: under(values.captures),
    manifest: under(values.manifest),
    report: under(values.report),
    renderer: under(values.renderer),
    hints: values.hints ? resolve(root, values.hints) : null,
  };
}
