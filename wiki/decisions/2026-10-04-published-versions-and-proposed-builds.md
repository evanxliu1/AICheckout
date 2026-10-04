---
type: Decision
title: Published catalog versions, proposed builds, drop-source and grouped next steps (Phase 9 milestone 2)
description: Phase 9 M2 choices — publishedVersions in the build config checked through the ledger entry (rule IDs, order and terms), a proposed build that writes a would-be config, catalog, report and ledger diff under the batch's pipeline/proposed/, drop-source with reason codes that moves captures to captures-dropped/ and refuses frozen layers, and next grouping every card of a stage that shares a queue code.
status: accepted
tags: [decision, catalog, pipeline, phase-9]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T22:07:00Z
sources:
  - resource: ../../docs/evals/pipeline-v1.md
    title: Pipeline v1 acceptance run (what the run exposed)
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline
  - resource: 2026-10-04-wells-fargo-batch-not-shipped.md
    title: The Wells Fargo batch is not shipped
---

# Published catalog versions, proposed builds, drop-source and grouped next steps (2026-10-04)

## Context
The Phase 8 acceptance run ([pipeline v1](../../docs/evals/pipeline-v1.md#what-the-run-exposed-in-v1)) exposed four gaps: the builder rebuilt the published `2026-10-02.expansion.1` with other contents and rewrote its ledger entry; `run build` always changes what ships; bot-walled sources were dropped by hand; `next` handed failed cards to the session one at a time. Phase 9 milestone 2 fixes them.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| What "other contents" means for a published version | Whole catalog bytes; rule IDs and terms | **Rule IDs (with their order) and each rule's card and terms SHA-256, against the version's ledger entry.** The ledger already holds exactly these; card-level text (exclusions, names) has no ledger record. A published version without a ledger entry is refused |
| Where the refusal lives | Pipeline only; builder | **`updateLedger` (builder)**, so `npm run catalog:v3` and the pipeline both stop before anything is written; the published entry is returned unchanged, never rewritten (its `jsonBytes` included) |
| How a proposed build passes its inputs to the builder | A `--version` and `--add-batch` flag on the builder; a would-be config file | **A would-be config** (`pipeline/proposed/catalog-batches.json`: the committed config with the batch as newest layer and the new version), passed with `--config`; the builder's `--out-dir` writes the catalog JSON, the build report and `ledger-diff.json` there. `handoff` rebuilds its summary from the same file, so it reports what the proposed build would ship |
| What marks a proposed build in `state.json` | Infer from output paths; explicit fields | **`proposed: true` and `catalogVersion`** on the build record (also `catalogVersion` on a shipping build): codes, not text. A proposed build queues no `publish` item |
| What a "frozen layer" is for `drop-source` | Base layers only; any registered batch | **A base layer of the build config, or a batch registered in it while the config's version is published** (its sources are in a published catalog). An unregistered or proposed-only batch can drop sources |
| Where a dropped capture goes | Delete it; keep it in `captures/` | **`<batch>/captures-dropped/`**, gitignored like `captures/`; nothing is deleted. The capture stage of the affected cards turns stale (their source list changed) and re-runs without fetching what still passes |
| What `next` groups | Every card with the code; per stage and code | **Per stage and code** (an agent step also per issuer, since a packet is per issuer): capture-flagged, gate-failed and needs-reverify return every matching card in one step |

## Decision
As in the table. `publishedVersions` lists only v3 versions (`2026-10-02.expansion.1`); release 1's `2026-09-29.real.1` is v2 and not built from this config. The coordinator adds a version in the PR after Evan publishes it ([catalog release](../ops/catalog-release.md)).

## Consequences
- A refresh batch to be shipped needs a version bump: `run build --version <new>` sets it in the config while registering the batch; the config's own version stays refused otherwise.
- `pipeline/proposed/` is committed with the batch (catalog JSON about 0.6 MB, build report, ledger diff of IDs and counts, would-be config); the frozen Wells Fargo batch keeps its hand-made `proposed-catalog-build-report.md`, which the new builder reproduces byte for byte.
- `drop-source` records `{ reason, droppedAt }` per source in `state.json`; re-accepting research could bring the source back into `sources.json`.

## Status
Accepted 2026-10-04 by the implementing session (claude-code/claude-opus-5-5) under the Phase 9 milestone 2 brief.
