---
type: Decision
title: Evaluate the expansion as an all-held-out corpus, in three separately reported measurements
description: The expansion corpus loads with its own layout that makes every case held-out; pipeline metrics, the luna re-score (an upper bound) and a pending gpt-5.5 cross-model run are reported separately in docs/evals/expansion.*, never mixed into results.*.
status: accepted
tags: [decision, evaluation, llm, curation, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T22:30:00Z
sources:
  - resource: ../../apps/api/src/curation/v2/corpus.ts
    title: Corpus loader (layout option)
  - resource: ../../scripts/score-expansion-traces.mjs
    title: Expansion trace scorer
  - resource: ../../scripts/lib/expansion-metrics.mjs
    title: Pipeline metrics
  - resource: ../../docs/evals/expansion.md
    title: Expansion eval results
---

# Evaluate the expansion as an all-held-out corpus, in three separately reported measurements (2026-10-02)

## Context

Stage 2 M9 ([plan](../product/phase-7-stage-2.md)) evaluates the 173-card `expansion.v1` corpus. Its labels were seeded from the same gpt-5.6-luna extractions whose traces are saved, so scoring those traces measures agreement rather than accuracy. The corpus writes `corpus.json` with a placeholder `split: "dev"` on every case and a 321-source manifest, and the v2 loader reads only `corpus.v2.json` with at most 100 sources. Captures and traces are gitignored and live in another worktree.

## Options considered

| Option | Why not / why |
| --- | --- |
| Raise the v2 manifest limit and rename the file to `corpus.v2.json` | Changes the committed corpus file, and leaves the placeholder `dev` split, so a run would need no held-out guard |
| Rewrite the splits in `corpus.json` | Edits the agent-verified corpus after the fact |
| **Loader layout `expansion`** (chosen) | Reads `corpus.json`, allows 400 sources, and forces every case to `heldout` at load, so `eval:v2` needs `--allow-heldout`. `--captures DIR` reads captures from another folder. The real and fixture paths are unchanged |
| One expansion score | Hides the seeding bias |
| **Three measurements** (chosen) | Pipeline metrics from committed files; the luna re-score labelled an upper bound, split into the 158 drafted and the 15 undrafted cards; and a cross-model run by a model that neither drafted nor verified the labels |

## Decision

- `loadCorpusV2(dir, { layout, captures })`. `eval:v2` picks the `expansion` layout when the directory has `corpus.json` and no `corpus.v2.json`. A split with no cases is an error, so running the all-held-out expansion with the default `--split dev` fails instead of running nothing.
- Results go to `docs/evals/expansion.{md,json}`, never into `results.*`. The JSON has no timestamps, and its `pipeline` section is recomputed and compared in `npm test`.
- The saved luna traces are scored as an `imported-unverified` bundle: `extract-cards.mjs` collected them, not `eval:v2`. `evaluate()` still checks each trace's document and context hashes.
- The cross-model run (plan decision 4: gpt-5.5 `low`, `guided.2`, `keyword-window.1`, Codex, all 173 cards) uses `--codex-output-tokens visible`. Luna's largest card needed 6,908 visible output tokens, and counting reasoning tokens as well could trip the 8,192 limit on large cards for reasons unrelated to extraction. This differs from the Phase 2c gpt-5.5 rows, which counted total tokens.

## Consequences

- The cross-model command is printed by `node scripts/score-expansion-traces.mjs --print-command` and documented in [`docs/evals/expansion.md`](../../docs/evals/expansion.md). The coordinator or Evan starts it. Rerunning the script with `--run DIR` then fills `crossModel`.
- The luna re-score (80.8% end to end on all 173) is not comparable with the `real.v2.2` rows.
- A later expansion corpus with real splits would need a new layout or a split rule; this layout treats everything as held-out.

## Status

Accepted 2026-10-02 (Claude Code subagent implementing M9 under the coordinator's brief).
