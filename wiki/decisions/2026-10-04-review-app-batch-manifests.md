---
type: Decision
title: The review app bundles every pipeline batch manifest and matches a capture by the source's date
description: Phase 9 milestone 1 — apps/review/src/manifest.ts adds evals/curation/batches/*/manifest.json through an eager Vite glob instead of a list or the build config, keeps every dated capture per source ID and requires the one dated the source's checkedOn when it exists, and pipeline handoff mirrors it (no more "conflicts").
status: accepted
tags: [decision, review, pipeline, phase-9]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T22:31:00Z
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
| Any recorded hash of the ID matches | Found in review: an old capture of a refreshed page would load silently and be stored as evidence of the new date (publish binds the capture by title, URL and `checkedOn`) |

## Decision
1. `manifest.ts` keeps every capture (hash, `capturedOn`, `checkedOn`) per source ID from the fixed manifests and every batch manifest (sorted by path; a batch manifest failing its Zod parse is skipped with a console warning). `manifestComparison(id, hash, checkedOn)` selects the captures dated `checkedOn` when any exist, otherwise only the newest-dated capture, and returns `matches` when the hash is a selected one, `differs` when the ID is known and it is not (worded "matches the A capture, not the one dated B" for an older capture), undefined when the ID is unknown. The fallback covers the merchant sources (catalog `checkedOn` 2026-09-28, captured 2026-10-01) and Phase 9 re-checks of unchanged pages (a later `checkedOn`); taking the newest rather than any keeps the older of two captures from loading again after such a re-check.
2. `pipeline handoff` mirrors it: `readReviewManifests` parses the JSON imports and expands the glob, throwing when either is gone; `reviewAppReadiness` applies the same date rule to the cited sources' `checkedOn` and reports `missing` and `differs` only (the `conflicts` list is dropped: several hashes per ID are expected).
3. UI wording is unchanged ("differs from the corpus manifest" stays true when a file matches none of the hashes).

## Consequences
- Phase 9 freshness should also expose its verified hash per `checkedOn` to the review app (for example a `checkedOn` on the manifest entry it re-checked), so a re-checked source is matched by its date, not by the newest-capture fallback.
- The Render deploy of `main` is what makes a new batch known; a batch is merged and deployed before Evan publishes ([catalog release](../ops/catalog-release.md#publishing-a-pipeline-batch)).
- Any committed batch's captures match for their date, including a batch that is not registered in the build config; the catalog draft still decides which sources need evidence.

## Status
Accepted 2026-10-04 (claude-code/claude-opus-5-5) within the Phase 9 milestone 1 brief.
