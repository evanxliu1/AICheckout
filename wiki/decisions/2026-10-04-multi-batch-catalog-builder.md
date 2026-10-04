---
type: Decision
title: Multi-batch catalog builder — layer merge, frozen-layer pairing, newest-capture dates and a rule-ID ledger (Phase 8 M1)
description: How the catalog v3 builder reads a list of batches — a committed build config of layers merged into the inputs the M5 build already takes, pipeline batches paired to their corpus by SHA-256 while the frozen base layer is paired by directory, verifiedAt from the newest issuer-source date rather than the oldest, and an append-only rule-ID ledger as the "previous catalog" for the continuity gate.
status: accepted
tags: [decision, catalog, build, pipeline, phase-8]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T03:00:00Z
sources:
  - resource: ../../scripts/lib/catalog-batches.mjs
    title: Build config, layer loader and merge
  - resource: ../../scripts/lib/catalog-v3.mjs
    title: Build logic, catalogDates, continueRuleIds, updateLedger
  - resource: ../../evals/curation/catalog-batches.json
    title: Build config
  - resource: ../../evals/curation/rule-id-ledger.json
    title: Rule-ID ledger
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (multi-batch builder spec)
---

# Multi-batch catalog builder (Phase 8 M1) (2026-10-04)

## Context
The [approved pipeline](../system/card-expansion-pipeline.md#multi-batch-catalog-builder) builds the release catalog from every batch, newest batch winning per card, with pairing by SHA-256, dates from manifests, completeness and a rule-ID continuity gate. Rebuilding today's inputs must reproduce `CATALOG_V3` `2026-10-02.expansion.1` (hosted release 2) byte for byte, `evals/curation/expansion/` stays frozen, CI has no captures, and `catalog:v3:check` runs where the committed catalog is the output, so the committed catalog cannot serve as "previous".

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Where batches meet the build | `mergeLayers` folds the layers of `evals/curation/catalog-batches.json` into the one input shape `checkOverlay`/`draftCatalogV3`/`buildCatalogV3` already take (one overlaid corpus, the real corpus, one overlay, one deduplicated manifest), plus `cardOrder` | Teach `checkOverlay` and `draftCatalogV3` about batches: touches the M4 checks that produced release 2 |
| Base-layer order | `expansion.v1` then `real.v2.2` (they share no card), which keeps `CATALOG_V3`'s card order | Real first, as the design lists them: reorders every card |
| Frozen-layer pairing | By directory: `expansion.v1` entries carry no `corpusCaseSha256`; the field is optional in the overlay schema, required and checked for `kind: batch` layers (checked too if a base entry has one) | Stamp the hashes into `expansion/catalog-overlay.json`: edits a frozen file |
| Real cards | No layer may replace or drop a card of a layer without an overlay (`real.v2.2`); they stay pinned by `checkRealCards` | Let a batch refresh them: they would need overlay entries and would leave release 1 terms; a later decision if wanted |
| Dropped by a later batch | Newest wins here too: the card leaves the catalog, listed with the batch's reason | Keep the older version: a refresh that finds a card withdrawn would keep stale terms |
| Definitions orphaned by a replacement | Gates, store programs and brands used before but by no winning card are pruned before `checkOverlay`; a definition nobody ever used still fails "unused" | Fail the build: a refresh that rewrites a card's overlay could not drop an old gate |
| `verifiedAt` | **Newest** `checkedOn ?? capturedOn` of the issuer sources the catalog cites (merchant MCC sources excluded), `expiresAt` + 30 days; the oldest date is reported. Today 2026-10-02 / 2026-11-01, oldest 2026-09-29 | **Oldest** source date: gives 2026-09-29 / 2026-10-29 and breaks reproduction of release 2; it is the more conservative reading of "verified" |
| Previous catalog for continuity | Append-only **ledger** `evals/curation/rule-id-ledger.json`: every ID ever issued → card, terms SHA-256 (`stableJson` of the rule without `id`, as `ruleTerms` in `wallet.ts`), first version; rule IDs and JSON bytes per catalog version. Previous = newest entry with another version. Seeded from `2026-10-02.expansion.1`; written by `catalog:v3`, compared by `catalog:v3:check` | The committed `catalog-v3.ts`: equals the output in `--check`, so it detects nothing. A git ref: CI checkouts are shallow and it cannot remember IDs from versions before the previous one |
| New IDs | Unchanged terms on the same card keep the previous ID (even if the generated ID moved); otherwise the generated ID unless the ledger issued it for other terms or another card, then `-v2`, `-v3`, … | Fail the build on a terms change: every refresh would need hand edits |

## Decision
As chosen. The ledger is 195,647 bytes for 820 IDs; a rebuild of an unpublished version replaces that version's entry but never removes an issued ID, so an ID a draft issued stays reserved for its terms. Batch files live in `evals/curation/batches/<batch>/` (`corpus.json`, `catalog-overlay.json`, `product-notes.verified.json`, `manifest.json`, `cards.json`, optional `reward-programs.json` with card mappings to existing programs only); dropped reasons come from the config entry for now, and `loadLayer(root, layer, { dropped })` takes milestone 2's per-card dispositions.

**Freshness (Phase 9).** A manifest source may carry `checkedOn`, the date a re-check found its capture unchanged; the catalog source's `checkedOn` and both catalog dates use it. Freshness re-checks every cited source before a release, so the oldest and newest dates converge on the check date; once that is routine, switching to the oldest-date rule is a one-line change in `catalogDates` and costs nothing. Until then a catalog with a source older than 30 days before the newest fails `catalogV3Schema`'s source window, which is the signal that freshness must run.

## Consequences
- `catalog:v3:check` covers three files: the catalog, the build report (two new sections at the end: batches and dates, rule-ID continuity) and the ledger.
- `draftCatalogV3` takes optional `verifiedAt`/`expiresAt` (the `DRAFT_*` constants stay the defaults), so a batch captured after 2026-10-02 passes the overlay check's draft parse.
- A batch cannot add brands (merchants.json is shared) or programs to the table; both need a separate change.
- The `-vN` suffix lengthens an ID; an ID over 80 characters fails the schema.
- **Commit the ledger with the final build of a version.** Every `npm run catalog:v3` reserves the IDs it issues for good, including draft rebuilds on a branch: if a later iteration changes a rule's terms, its ID moves to the next `-vN`, so branch iterations burn suffixes. Behaviour kept on purpose (an ID never comes back with other terms); review-driven amendment of 2026-10-04 (PR #37 review).

## Status
Accepted 2026-10-04 (Phase 8 milestone 1, coordinator-delegated agent; agent-verified by tests, not human-reviewed). Evan or the coordinator can revise.
