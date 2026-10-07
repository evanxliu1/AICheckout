// Bundle packages/cart-reader into one browser script with esbuild (an IIFE that sets `__aiCheckoutCartReader`), and
// check what went into it: only files of packages/cart-reader/src (no evals/ file, no frame, label or candidate
// list, no dependency), and no reference to the rebuild's `data-pane-*` attributes (protocol, "No pane-only cues").
import path from 'node:path';
import { build } from 'esbuild';
import { REPO_ROOT, sha256 } from './lib.mjs';

export const GLOBAL_NAME = '__aiCheckoutCartReader';
const PANE_CUE = /data-pane|dataset\s*(?:\.\s*pane|\[\s*['"`]pane)/i;

/** Returns { code, sha256, inputs } or throws when the bundle breaks a rule. */
export async function bundleReader({
  root = REPO_ROOT,
  entry = 'packages/cart-reader/src/index.ts',
  allowedDir = 'packages/cart-reader/src',
} = {}) {
  const result = await build({
    entryPoints: [path.resolve(root, entry)],
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    globalName: GLOBAL_NAME,
    platform: 'browser',
    target: 'chrome120',
    legalComments: 'none',
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs).sort();
  const outside = inputs.filter((p) => !p.split(path.sep).join('/').startsWith(`${allowedDir}/`));
  if (outside.length) throw new Error(`the reader bundle may only contain ${allowedDir}/: ${outside.join(', ')}`);
  const code = result.outputFiles[0].text;
  if (PANE_CUE.test(code)) throw new Error('the reader refers to data-pane-* attributes, which it must not read');
  return { code, sha256: sha256(code), inputs };
}
