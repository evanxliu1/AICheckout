// Re-scoring of saved expansion extraction traces (scripts/extract-cards.mjs writes one file per card to the
// gitignored extractions/ folder) against the agent-verified expansion corpus, with the v2 scorer. The traces
// become one observation bundle; `evaluate()` then checks every trace's document hashes and context hash
// against what the corpus and the local captures produce, so a trace collected on other text is rejected.
import { canonicalJson } from '../../apps/api/src/curation/canonical.ts';
import { evaluate } from '../../apps/api/src/curation/v2/evaluate.ts';
import { summarizeReport } from '../../apps/api/src/curation/v2/summarize.ts';
import { summarize } from '../../apps/api/src/curation/v2/score.ts';

const PROVIDER_IDS = { codex: 'codex-cli', claude: 'claude-cli' };

/**
 * One bundle from per-card trace files (`{ cardId, configuration, cliVersion, trace }`). Every file must share
 * one configuration. Traces for cards not in the corpus (dropped by verification) are returned as `skipped`.
 */
export function bundleFromTraces(loaded, files) {
  if (!files.length) throw new Error('No extraction traces.');
  const configurations = new Set(files.map((f) => canonicalJson(f.configuration)));
  if (configurations.size !== 1)
    throw new Error(`Traces come from ${configurations.size} configurations; expected one.`);
  const config = files[0].configuration;
  if (!(config.provider in PROVIDER_IDS)) throw new Error(`Unknown provider ${config.provider}.`);
  const caseIds = new Set(loaded.cases.map(({ item }) => item.id));
  const byCard = new Map();
  for (const file of files) {
    if (byCard.has(file.cardId)) throw new Error(`Two traces for ${file.cardId}.`);
    byCard.set(file.cardId, file);
  }
  const split = loaded.cases[0].item.split;
  if (loaded.cases.some(({ item }) => item.split !== split))
    throw new Error('Traces are scored on one split; this corpus has two.');
  const cliVersions = [...new Set(files.map((f) => f.cliVersion).filter(Boolean))].sort();
  const configuration = {
    provider: {
      id: PROVIDER_IDS[config.provider],
      model: config.model,
      mode: 'subscription',
      ...(cliVersions.length ? { cliVersions } : {}),
      ...(config.outputTokens === 'visible' ? { outputTokens: 'visible' } : {}),
    },
    effort: config.effort ?? null,
    prompt: config.prompt,
    selection: config.selection,
    split,
    repeat: 1,
  };
  // Trace files are named by card ID, which is the case ID in the expansion corpus.
  const observations = loaded.cases
    .filter(({ item }) => byCard.has(item.id))
    .map(({ item }) => {
      const { trace } = byCard.get(item.id);
      if (trace.extraction && trace.extraction.cardId !== item.cardId)
        throw new Error(`Trace ${item.id} holds an extraction for ${trace.extraction.cardId}.`);
      return { caseId: item.id, repeat: 1, trace };
    });
  return {
    bundle: {
      schemaVersion: 2,
      corpus: { version: loaded.corpus.version, hash: loaded.hash, inputsHash: loaded.inputsHash },
      experiment: [config.model, config.effort, config.prompt, config.selection, split]
        .filter(Boolean)
        .join('.')
        .toLowerCase(),
      // Collected by scripts/extract-cards.mjs, not by eval:v2; evaluate() still verifies every trace's inputs.
      provenance: 'imported-unverified',
      configuration,
      observations,
    },
    skipped: [...byCard.keys()].filter((id) => !caseIds.has(id)).sort(),
    missing: [...caseIds].filter((id) => !byCard.has(id)).sort(),
    sourceConfiguration: config,
  };
}

const round = (f) => ({ ...f, rate: f.rate === null ? null : Number(f.rate.toFixed(4)) });

/**
 * Score a bundle on the whole corpus and on the drafted and undrafted cards separately, plus a per-issuer
 * breakdown of the whole set. Each subset is scored as its own complete run.
 */
export function scoreSubsets(loaded, bundle, draftedIds, failures = new Map()) {
  const subset = (keep) => {
    const cases = loaded.cases.filter(({ item }) => keep(item.id));
    const ids = new Set(cases.map(({ item }) => item.id));
    const sub = { ...bundle, observations: bundle.observations.filter((o) => ids.has(o.caseId)) };
    const subFailures = new Map(
      [...failures].filter(([slot]) => ids.has(slot.slice(0, slot.lastIndexOf('#')))),
    );
    return { report: evaluate({ ...loaded, cases }, sub, { failures: subFailures }), bundle: sub };
  };
  const row = (name, keep) => {
    const { report, bundle: sub } = subset(keep);
    return { report, row: summarizeReport(name, report, sub) };
  };
  const all = row('all', () => true);
  const drafted = row('drafted', (id) => draftedIds.has(id));
  const undrafted = row('undrafted', (id) => !draftedIds.has(id));
  const issuerOf = new Map(loaded.cases.map(({ item }) => [item.id, item.issuer]));
  const issuers = [...new Set(issuerOf.values())].sort();
  const byIssuer = Object.fromEntries(
    issuers.map((issuer) => {
      const s = summarize(all.report.cases.filter((c) => issuerOf.get(c.caseId) === issuer));
      return [
        issuer,
        {
          runs: s.cases,
          ruleRecall: round(s.ruleRecall),
          rulePrecision: round(s.rulePrecision),
          endToEndFieldAccuracy: round(s.endToEndFieldAccuracy),
          cardFieldAccuracy: round(s.cardFieldAccuracy),
          issueRecall: round(s.issueRecall),
          falseClean: s.falseClean,
        },
      ];
    }),
  );
  return { all: all.row, drafted: drafted.row, undrafted: undrafted.row, byIssuer };
}
