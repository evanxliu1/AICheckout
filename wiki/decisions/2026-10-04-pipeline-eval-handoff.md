---
type: Decision
title: Pipeline eval and handoff choices (Phase 8 milestone 5)
description: How `pipeline eval` wraps the Phase 7 eval scripts and what pipeline/eval.json holds, how batch labels are compared with the frozen expansion.v1, why cross-model scoring is not refused under CI, and how `pipeline handoff` builds its summary, checks the review app's manifests and decides readiness.
status: accepted
tags: [decision, catalog, pipeline, phase-8, eval, release]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T01:40:00Z
sources:
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (design and what is built)
  - resource: ../../tools/catalog-pipeline/src/eval.ts
    title: pipeline eval
  - resource: ../../tools/catalog-pipeline/src/handoff.ts
    title: pipeline handoff
  - resource: ../../apps/review/src/manifest.ts
    title: Review app capture manifests
---

# Pipeline eval and handoff choices (Phase 8 milestone 5) (2026-10-04)

## Context
Milestone 5 adds `pipeline eval` (stage 10) and `pipeline handoff` (the step before Evan's publish) to `tools/catalog-pipeline` ([design](../system/card-expansion-pipeline.md)). The brief fixed the outputs; these details were left to the implementation.

## Options considered
| Question | Chosen | Alternatives |
| --- | --- | --- |
| How eval runs the Phase 7 scripts | As subprocesses, like every other stage: `expansion-pipeline-metrics.mjs` gains `--output FILE`; `score-expansion-traces.mjs --print-command` honours `--dir` (a batch's run goes to `evals/curation/runs/batches/<batch>/…`). Both write to a temporary folder that eval reads and deletes. Defaults on `evals/curation/expansion` and `--check` are byte-identical | Import the libraries in-process (no wrapping, and the CLI's exec stub could not stand in for them in tests) |
| What eval writes | `pipeline/eval.json`: counts, rates, IDs, versions and hashes only; the metrics script's prose definitions and the score script's disclosure texts are dropped. No timestamp of its own, so a re-run on the same inputs writes the same file | `docs/evals/pipeline-v1.md` rows directly (that page is milestone 6's write-up of a real batch) |
| Trace re-score without captures or traces | `traces.status` `inputs-missing` (with a count); eval still records done on the metrics and agreement, and `handoff` warns | Fail eval (would block a batch whose eval is run outside the capture checkout without saying why) |
| Cross-model scoring under `CI`/`RENDER` | Not refused: scoring a finished `eval:v2` run calls no model. It needs the batch's captures, which CI never has, so there it is `inputs-missing`. The run itself is started by the coordinator from the printed command | Refuse like a model stage (nothing to protect) |
| Agreement with `expansion.v1` | Rules paired within a category by the v2 scorer's `matchRules` (closest issuer wording, then an equal rate), since corpus v2 labels have no condition fields beyond the compared values; fields compared with deep equality, as the metrics script compares draft and verified values; labelled `agreement-not-accuracy` | Pair by index (a refresh may reorder rules); count it as accuracy (both sides are agent-verified) |
| Timings | From state (records, attempts, pauses, first and last finish, models) and `extraction-summary.json` (model minutes and tokens per card); `startedAt` and agent-stage minutes and tokens are `null` because nothing records them | Estimate durations from finish times |
| Build summary in handoff | Recomputed through the milestone 1 builder (`loadCatalogBatches`, `mergeLayers`, `buildRelease`, `catalogStats`) without writing; the `.mjs` libraries are loaded by dynamic import because they have no type declarations | Parse `catalog-build-report.md` (prose, and fixed to the expansion directory) |
| Review-app readiness | A pure check over the sources the catalog cites (with the hash of the layer manifest the build took each from) and the manifests `apps/review/src/manifest.ts` imports, read from the module's JSON imports in order with later ones winning as the app's `Map` does: missing, different and conflicting hashes are listed. It blocks publishing, not the PR, so it does not change the exit status. The review app is not changed in this milestone | Fail handoff on it (every batch would fail until the review app change lands) |
| Capture folders | One per manifest a cited source's hash comes from: `<layer>/captures` for layer manifests, `<dir>/<p>-captures` for a bundled `<p>-manifest.json` (the merchant pages); absolute paths in this checkout with files present and matching | A fixed list of three folders |
| Readiness | Exit 1 when research or a card stage is not done (dropped and held-out cards excepted), packets are open, build or eval is not done, `eval.json` is missing or changed, the batch is not a layer of `catalog-batches.json`, the catalog does not build, or its version is on `origin/main` with another ledger entry. A stage recorded done whose gitignored inputs are absent here is a warning | Treat `inputs-missing` as not ready (no checkout without captures could ever hand off) |
| `next` and `run eval` | `run eval` is `pipeline eval`; `next` keeps proposing `run eval`, then `handoff` | Change the derive code (shared with milestone 3) |

## Decision
As chosen above.
