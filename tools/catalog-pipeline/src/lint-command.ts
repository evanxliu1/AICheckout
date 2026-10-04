// `pipeline lint-labels [--batch B | --dir <corpus dir>] [--json]`: the label-evidence lint as a report, with findings
// raised, acknowledged (label-lint.ts, "Acknowledgements") and open. Acks are read from the directory's
// verification/*.json (`labelLintAcks`, the adjudicator's) and overlay/*.json fragments (the overlay author's). On a
// frozen corpus (default evals/curation/expansion, which has no acks) findings are reported and the exit status is 0:
// they are the gate's baseline, not failures. On a pipeline batch, an open finding or an unused ack exits 1, as the
// apply and overlay gates would. This is a report; the gates also check the acks are the ones accepted.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { batchDir } from './files.ts';
import {
  adjudicatorAckSchema,
  countByCheck,
  formatFinding,
  fragmentAckSchema,
  lintCorpusCase,
  lintOverlay,
  resolveAcks,
} from './label-lint.ts';
import type { CorpusCaseLike, LintAck, LintFinding, OverlayLike } from './label-lint.ts';
import type { Env } from './run.ts';
import { corpusCases } from '../../../scripts/lib/catalog-overlay.mjs';

export const FROZEN_DIR = 'evals/curation/expansion';

/** The `labelLintAcks` of every JSON file in a folder that parse with the schema (others are the gates' business). */
async function acksIn(
  dir: string,
  schema: typeof adjudicatorAckSchema | typeof fragmentAckSchema,
): Promise<LintAck[]> {
  const out: LintAck[] = [];
  for (const name of (await readdir(dir).catch(() => [] as string[])).sort()) {
    if (!name.endsWith('.json')) continue;
    const data = JSON.parse(await readFile(join(dir, name), 'utf8')) as { labelLintAcks?: unknown };
    if (!Array.isArray(data.labelLintAcks)) continue;
    for (const item of data.labelLintAcks) {
      const parsed = schema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out;
}

interface GateReport {
  raised: Record<string, number>;
  acked: Record<string, number>;
  open: Record<string, number>;
  findings: LintFinding[];
  ackedFindings: LintFinding[];
  unusedAcks: LintAck[];
}

function gateReport(raised: LintFinding[], ackLists: LintAck[][]): GateReport {
  let open = raised;
  const acked: LintFinding[] = [];
  const unusedAcks: LintAck[] = [];
  ackLists.forEach((acks, i) => {
    const result = resolveAcks(open, acks);
    open = result.open;
    acked.push(...result.acked);
    // Adjudicator acks unused at the overlay gate are fine (a patch may have supplied the evidence).
    if (i === ackLists.length - 1) unusedAcks.push(...result.unused.map((index) => acks[index]));
  });
  return {
    raised: countByCheck(raised),
    acked: countByCheck(acked),
    open: countByCheck(open),
    findings: open,
    ackedFindings: acked,
    unusedAcks,
  };
}

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
  const adjudicatorAcks = await acksIn(join(dir, 'verification'), adjudicatorAckSchema);
  const fragmentAcks = await acksIn(join(dir, 'overlay'), fragmentAckSchema);
  const apply = gateReport([...cases.values()].flatMap(lintCorpusCase), [adjudicatorAcks]);
  const overlay =
    overlayText === null
      ? null
      : gateReport(lintOverlay(cases, JSON.parse(overlayText) as OverlayLike), [
          adjudicatorAcks,
          fragmentAcks,
        ]);
  const report = { dir: relative(env.root, dir), cards: cases.size, apply, overlay };
  if (options.json) env.log(JSON.stringify(report, null, 2));
  else {
    const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
    const line = (label: string, gate: GateReport) =>
      `${label}: ${total(gate.raised)} raised, ${total(gate.acked)} acked, ${total(gate.open)} open (raised: ${Object.entries(
        gate.raised,
      )
        .map(([check, n]) => `${check} ${n}`)
        .join(', ')})${gate.unusedAcks.length ? `; ${gate.unusedAcks.length} unused ack(s)` : ''}`;
    env.log(`label lint of ${report.dir} (${cases.size} cards)`);
    env.log(line('  apply gate, corpus rules (checks a-c)', apply));
    if (overlay) env.log(line('  overlay gate, catalog rules (checks a-e)', overlay));
    for (const finding of (overlay ?? apply).findings) env.log(`  open ${formatFinding(finding)}`);
    for (const finding of (overlay ?? apply).ackedFindings) env.log(`  acked ${formatFinding(finding)}`);
  }
  if (!options.batch) return 0;
  const gate = overlay ?? apply;
  return gate.findings.length || gate.unusedAcks.length || apply.unusedAcks.length ? 1 : 0;
}
