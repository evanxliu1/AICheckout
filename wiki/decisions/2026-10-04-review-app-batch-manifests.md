---
type: Decision
title: The review app bundles every pipeline batch manifest and accepts any recorded hash of a source
description: Phase 9 milestone 1 — apps/review/src/manifest.ts adds evals/curation/batches/*/manifest.json through an eager Vite glob instead of a list or the build config, keeps a set of hashes per source ID, and pipeline handoff mirrors it (no more "conflicts").
status: accepted
tags: [decision, review, pipeline, phase-9]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T22:05:00Z
sources:
  - resource: ../../apps/review/src/manifest.ts
    title: Capture hash check
  - resource: ../../tools/catalog-pipeline/src/handoff.ts
    title: pipeline handoff
---

# The review app bundles every pipeline batch manifest (2026-10-04)

## Context
The review app compared a loaded capture's SHA-256 with one hash per source ID from three fixed manifests. Pipeline batches write `evals/curation/batches/<batch>/manifest.json`, and a refreshed source keeps its ID with a new hash, so no batch could be published: for `wells-fargo-2026-10`, 3 cited sources were unknown and 2 (the refreshed pricing pages) would read "differs".

## Options considered
| Option | Why not / why |
| --- | --- |
| Add each batch manifest as an explicit import | A product PR per batch; easy to forget |
| Bundle only the batches registered in `catalog-batches.json` | Couples the review app to the build config; a batch must be registered (and so shipped) to be publishable |
| **Eager `import.meta.glob` of `evals/curation/batches/*/manifest.json`** | Chosen: every committed batch is known after the next deploy; manifests hold IDs, URLs, dates and hashes only, so the bundle stays text-free |
| One hash per ID, last manifest wins | A refreshed source would refuse either its old or its new capture |

## Decision
1. `manifest.ts` keeps a `Set` of hashes per source ID from the fixed manifests and every batch manifest (sorted by path). `manifestComparison` returns `matches` when the file's hash is any of them, `differs` when the ID is known and none matches, undefined when the ID is unknown.
2. `pipeline handoff` mirrors it: `readReviewManifests` parses the JSON imports and expands the glob, throwing when either is gone; `reviewAppReadiness` reports `missing` and `differs` only (the `conflicts` list is dropped: several hashes per ID are expected).
3. UI wording is unchanged ("differs from the corpus manifest" stays true when a file matches none of the hashes).

## Consequences
- The Render deploy of `main` is what makes a new batch known; a batch is merged and deployed before Evan publishes ([catalog release](../ops/catalog-release.md#publishing-a-pipeline-batch)).
- Any committed batch's captures match, including a batch that is not registered in the build config; the catalog draft still decides which sources need evidence.

## Status
Accepted 2026-10-04 (claude-code/claude-opus-5-5) within the Phase 9 milestone 1 brief.
