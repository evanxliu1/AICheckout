---
type: Decision
title: The Wells Fargo acceptance batch is kept out of the shipped catalog; publishing it is Evan's call
description: Phase 8 milestone 6 — the wells-fargo-2026-10 refresh batch is merged as data and evidence, not registered in the build config; CATALOG_V3 stays 2026-10-02.expansion.1; the proposed build 2026-10-04.wells-fargo.1 is kept as a report; a batch that is published gets a new catalog version.
status: accepted
tags: [decision, catalog, pipeline, phase-8]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T21:07:00Z
sources:
  - resource: ../../docs/evals/pipeline-v1.md
    title: Pipeline v1 acceptance run
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline
---

# The Wells Fargo acceptance batch is kept out of the shipped catalog (2026-10-04)

## Context
The Phase 8 acceptance run re-derived the six Wells Fargo cards of `expansion.v1` as the pipeline batch `wells-fargo-2026-10`. Evan's brief: do not merge the batch's catalog change into what ships unless it is identical to, or verified better than, `expansion.v1`; Evan decides on publishing. `pipeline run build` registers the batch in `evals/curation/catalog-batches.json` and rewrites `CATALOG_V3`, so merging the run as it stands would change the bundled extension catalog. The first build also wrote the batch under the published version `2026-10-02.expansion.1`.

## Options considered
| Option | Why not / why |
| --- | --- |
| Merge with the batch registered under a new version | Not identical: 30 rules change terms (activation, sources, wording, one U.S.-only flag); "better" is agent judgment only, and the One Key U.S.-only flag reverses a Phase 7 judgment call |
| Do not merge the run at all | Loses the evidence (state, labels, eval) the acceptance run exists to produce |
| **Merge the batch's data and eval, unregistered; keep the proposed build as a report** | Chosen: `CATALOG_V3` and the ledger stay as published; `catalog:v3:check` passes; the batch can be registered later with one config line and a version bump |

## Decision
1. The branch merges `evals/curation/batches/wells-fargo-2026-10/` (state, research, labels, findings, overlay, `pipeline/eval.json`, `pipeline/proposed-catalog-build-report.md`) and `docs/evals/pipeline-v1.md`. `catalog-batches.json`, `rule-id-ledger.json`, `catalog-v3.ts` and the build report stay as on `main`.
2. A batch that is to be published gets a new catalog version in `catalog-batches.json` (here `2026-10-04.wells-fargo.1`); a published version is never rebuilt with other contents, and its ledger entry is never rewritten.
3. Publishing the refresh is Evan's decision. Before any batch can be published the review app must know its manifest (`apps/review/src/manifest.ts`).

## Consequences
- The batch's state shows build and eval done for a build that does not ship; `pipeline/proposed-catalog-build-report.md` says what it would ship.
- Phase 9 adds: a builder refusal for a published version with other contents, a way to build a batch without changing what ships, and review-app support for batch manifests.

## Status
Accepted 2026-10-04 by the coordinator (claude-code/claude-opus-5-5) under Evan's brief; publishing remains Evan's.
