// Bundle a reader into one browser script with esbuild (an IIFE that sets `__aiCheckoutCartReader`) and check what
// went into it.
//   generic (packages/cart-reader): only files of packages/cart-reader/src; no reference to the rebuild's
//     `data-pane-*` attributes (protocol, "No pane-only cues"; the harness also strips them before the reader runs,
//     this is a tripwire); no answer lookup: no retail-frame-3 domain of the split being run and at most
//     MAX_FRAME_DOMAINS frame domains anywhere in the bundle.
//   legacy (evals/reader/legacy-entry.ts): the extension's three store adapters, from extension/src/checkout and
//     packages/rewards-core/src only. They are per-store readers by design, so the frame tripwire doesn't apply.
import path from 'node:path';
import { build } from 'esbuild';
import { REPO_ROOT, sha256 } from './lib.mjs';

export const GLOBAL_NAME = '__aiCheckoutCartReader';
export const MAX_FRAME_DOMAINS = 3;
const PANE_CUE = /data-pane|dataset\s*(?:\.\s*pane|\[\s*['"`]pane)/i;
export const MODES = {
  generic: { entry: 'packages/cart-reader/src/index.ts', allowed: ['packages/cart-reader/src/'] },
  legacy: {
    entry: 'evals/reader/legacy-entry.ts',
    allowed: ['evals/reader/legacy-entry.ts', 'extension/src/checkout/', 'packages/rewards-core/src/'],
  },
};

/** Frame domains that occur in the code as whole host names (case-insensitive). */
export function frameDomainsIn(code, domains) {
  const text = code.toLowerCase();
  const hits = [];
  for (const d of domains) {
    let i = text.indexOf(d);
    while (i >= 0) {
      const before = text[i - 1] ?? '';
      const after = text[i + d.length] ?? '';
      if (!/[a-z0-9-]/.test(before) && !/[a-z0-9-]/.test(after)) {
        hits.push(d);
        break;
      }
      i = text.indexOf(d, i + 1);
    }
  }
  return hits;
}

/**
 * Returns { code, sha256, inputs } or throws when the bundle breaks a rule. `frameDomains` (all retail-frame-3
 * domains) and `splitDomains` (the split's) arm the answer-lookup tripwire of a generic bundle.
 */
export async function bundleReader({
  root = REPO_ROOT,
  mode = 'generic',
  frameDomains = [],
  splitDomains = [],
} = {}) {
  const { entry, allowed } = MODES[mode];
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
    alias: {
      '@ai-checkout/rewards-core/money': path.resolve(root, 'packages/rewards-core/src/money.ts'),
      '@ai-checkout/rewards-core/generic-merchant': path.resolve(
        root,
        'packages/rewards-core/src/generic-merchant.ts',
      ),
    },
  });
  const inputs = Object.keys(result.metafile.inputs)
    .map((p) => p.split(path.sep).join('/'))
    .sort();
  const outside = inputs.filter((p) => !allowed.some((a) => (a.endsWith('/') ? p.startsWith(a) : p === a)));
  if (outside.length)
    throw new Error(`the ${mode} reader bundle may only contain ${allowed.join(', ')}: ${outside.join(', ')}`);
  const code = result.outputFiles[0].text;
  if (PANE_CUE.test(code)) throw new Error('the reader refers to data-pane-* attributes, which it must not read');
  if (mode === 'generic') {
    const inSplit = frameDomainsIn(code, splitDomains);
    if (inSplit.length)
      throw new Error(`no answer lookup: the reader contains ${inSplit.length} domain(s) of the split being run`);
    const inFrame = frameDomainsIn(code, frameDomains);
    if (inFrame.length > MAX_FRAME_DOMAINS)
      throw new Error(`no answer lookup: the reader contains ${inFrame.length} retail-frame-3 domains`);
  }
  return { code, sha256: sha256(code), inputs };
}
