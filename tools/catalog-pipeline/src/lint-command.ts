// `pipeline lint-labels [--batch B | --dir <corpus dir>] [--json]`: the label-evidence lint as a report. On a frozen
// corpus (default evals/curation/expansion) findings are reported and the exit status is 0: they are the gate's
// baseline, not failures. On a pipeline batch, any finding exits 1, as the apply and overlay gates would.
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { batchDir } from './files.ts';
import { countByCheck, formatFinding, lintCorpusCase, lintOverlay } from './label-lint.ts';
import type { CorpusCaseLike, LintFinding, OverlayLike } from './label-lint.ts';
import type { Env } from './run.ts';
import { corpusCases } from '../../../scripts/lib/catalog-overlay.mjs';

export const FROZEN_DIR = 'evals/curation/expansion';

export async function lintLabels(
  env: Env,
  options: { batch?: string; dir?: string; json?: boolean },
): Promise<number> {
  const dir = options.batch
    ? batchDir(env.root, options.batch)
    : resolve(env.root, options.dir ?? FROZEN_DIR);
  const corpus = JSON.parse(await readFile(join(dir, 'corpus.json'), 'utf8')) as { cases: CorpusCaseLike[] };
  const cases = corpusCases(corpus) as Map<string, CorpusCaseLike>;
  const overlayText = await readFile(join(dir, 'catalog-overlay.json'), 'utf8').catch(() => null);
  const apply: LintFinding[] = [...cases.values()].flatMap(lintCorpusCase);
  const overlay: LintFinding[] | null =
    overlayText === null ? null : lintOverlay(cases, JSON.parse(overlayText) as OverlayLike);
  const report = {
    dir: relative(env.root, dir),
    cards: cases.size,
    apply: { counts: countByCheck(apply), findings: apply },
    overlay: overlay && { counts: countByCheck(overlay), findings: overlay },
  };
  if (options.json) env.log(JSON.stringify(report, null, 2));
  else {
    const counts = (label: string, list: LintFinding[]) =>
      `${label}: ${list.length} finding(s) (${Object.entries(countByCheck(list))
        .map(([check, n]) => `${check} ${n}`)
        .join(', ')})`;
    env.log(`label lint of ${report.dir} (${cases.size} cards)`);
    env.log(counts('  apply gate, corpus rules (checks a-c)', apply));
    if (overlay) env.log(counts('  overlay gate, catalog rules (checks a-e)', overlay));
    for (const finding of overlay ?? apply) env.log(`  ${formatFinding(finding)}`);
  }
  if (!options.batch) return 0;
  return (overlay ?? apply).length ? 1 : 0;
}
