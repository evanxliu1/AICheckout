---
type: Product
title: Phase 9 plan (catalog freshness)
description: Ordered milestones that renew the published catalog before release 2 expires (2026-11-01T00:00Z) — review-app support for pipeline batches, pipeline fixes from the Phase 8 run, a hash-only freshness check of every cited source, and the renewal run that ends in a release Evan publishes by about 2026-10-28.
status: stable
tags: [product, plan, phase-9, catalog, freshness]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T22:00:00Z
stale_after: 2026-11-15T00:00:00Z
sources:
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (Freshness section, Built so far)
  - resource: ../../docs/evals/pipeline-v1.md
    title: Pipeline v1 acceptance run (gaps the run exposed)
  - resource: ../ops/catalog-release.md
    title: Catalog release runbook
  - resource: ../../packages/rewards-core/src/schema.ts
    title: Catalog date rules (source and estimate windows)
---

# Phase 9 plan: catalog freshness

Started 2026-10-04 at Evan's request, after Phase 8 ([roadmap](roadmap.md)). The goal is a renewed catalog that Evan publishes before release 2 (`2026-10-02.expansion.1`) expires at **2026-11-01T00:00Z**, when `/v1/catalog` would answer 503. The target is to publish by **2026-10-28**, and aim for well before. The tooling should make the next monthly renewal routine.

## Constraints

- **Every cited source must be fresh.** Catalog v3 requires every cited source's `checkedOn` to fall within the 30 days before `verifiedAt`, and `expiresAt` to be at most 30 days after it (`schema.ts`, mirrored in SQL). That covers all 328 sources: 312 expansion pages (captured 2026-10-02), the 15 real-card pages (2026-09-29) and the 2 merchant MCC pages (2026-09-28).
- **Published estimates have a window too.** NerdWallet estimates must be read within the 30 days before `verifiedAt`. The current read, 2026-10-02, holds for any catalog verified up to 2026-11-01, so this renewal is fine; the next one must re-read them.
- **Captures are frozen.** A changed page becomes a new dated capture in a new batch, and its cards run through the pipeline again. Released corpora are never edited.
- **Rule IDs.** A refreshed rule with changed terms gets a new ID (ledger), so shoppers keep recorded spend only on unchanged rules.
- **No fallback curation model.** Evan, 2026-10-04: the Phase 8 Codex stalls were his laptop and network being off. Retry, do not switch models ([user directives](user-directives.md)).

## How freshness works (hash-only; Stage 2 decision 1)

1. `pipeline freshness` re-renders every cited source exactly as capture does (same script, same hints) into a temporary directory outside the repository, computes SHA-256, and deletes the text.
2. **Unchanged:** it records `{ sourceId, checkedOn, sha256 }` in a committed, text-free freshness record. The builder takes the newest matching `checkedOn` as the source's date, which keeps the catalog valid without re-labelling.
3. **Changed:** the cards citing the page go into a refresh batch per issuer (new dated captures in the batch's own folder). They are then extracted, verified, adjudicated, applied and overlaid as in Phase 8. The run also measures the false-change rate, which decides whether a capture normalizer is ever needed (review change 5).
4. **Unreachable or bot-walled:** no new `checkedOn`, so the source ages out unless resolved. The session drops the source or holds the card out, each with a reason.
5. **Build and publish.** The build takes a new catalog version and checks rule-ID continuity against the published release; `handoff` gives Evan the publish steps.

## Milestones

One branch and PR each, from the latest `main`. Each gets an independent reviewer subagent and CI before the coordinator merges it.

| # | Milestone | Delivers |
| --- | --- | --- |
| 1 | Review app knows pipeline batches | `apps/review/src/manifest.ts` bundles batch manifests, and a source may have several known hashes (one per dated capture). This unblocks publishing any pipeline batch; it reaches Evan through the Render deploy of `main` |
| 2 | Pipeline fixes from the Phase 8 run | A published version is never rebuilt with other contents (`publishedVersions`); `run build --proposed` builds without changing what ships; `drop-source`; `next` returns all cards of a failed stage |
| 3 | `pipeline freshness` | Hash-only re-check of every cited source (issuer, real and merchant layers); a freshness record; the builder reads `checkedOn`; refresh batches for changed pages; real-card pages that changed are handled too (today the builder refuses a batch that refreshes a real card) |
| 4 | Renewal run | Freshness over all 328 sources, refresh batches for changed pages, renewed catalog under a new version, eval, `handoff`; Evan publishes. Results in `docs/evals/freshness-2026-10.md` |

## Schedule

| Date | Target |
| --- | --- |
| 2026-10-06 | Milestones 1 and 2 merged |
| 2026-10-09 | Milestone 3 merged |
| 2026-10-14 | Renewal run at a ready branch; merged and deployed |
| by 2026-10-20 | Evan publishes (hard limit 2026-11-01T00:00Z; target 2026-10-28 at the latest) |

If the renewal run is not at a ready branch by 2026-10-20, tell Evan at once. The fallback is a manual renewal: new dated captures with the existing scripts and a rebuild.

## Wells Fargo refresh batch

The Phase 8 batch `wells-fargo-2026-10` is not shipped ([decision](../decisions/2026-10-04-wells-fargo-batch-not-shipped.md)). Five of its 11 pages differ from the 2026-10-02 captures, so the renewal re-runs those cards anyway. The proposal is that the renewal includes it as the Wells Fargo layer, or a newer one if the pages changed again. Evan sees it in the publish review and can hold it back.

## Related

* [Roadmap](roadmap.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Catalog release](../ops/catalog-release.md)
* [Pipeline v1 acceptance run](../../docs/evals/pipeline-v1.md)
