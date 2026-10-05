---
type: Product
title: Phase 9 plan (catalog freshness)
description: Ordered milestones that renew the published catalog before release 2 expires (2026-11-01T00:00Z) — review-app support for pipeline batches, pipeline fixes from the Phase 8 run, a hash-only freshness check of every cited source, and the renewal run that ends in a release Evan publishes by about 2026-10-28.
status: stable
tags: [product, plan, phase-9, catalog, freshness]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T04:45:00Z
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

Started 2026-10-04 at Evan's request, after Phase 8 ([roadmap](roadmap.md)). The goal is a renewed catalog that Evan publishes before release 2 (`2026-10-02.expansion.1`) expires at **2026-11-01T00:00Z**, when `/v1/catalog` would answer 503: ready branch by 2026-10-14, Evan asked to publish from 2026-10-20, **latest 2026-10-28**. The tooling should make the next monthly renewal routine.

## Constraints

- **Every cited source must be fresh.** Catalog v3 requires every cited source's `checkedOn` to fall within the 30 days before `verifiedAt`, and `expiresAt` to be at most 30 days after it (`schema.ts`, mirrored in SQL). That covers all 328 sources: 312 expansion pages (captured 2026-10-02), 14 real-card pages (2026-09-29; the real folder holds 15, and `chase-rewards-category-faq` is cited from its later expansion capture) and the 2 merchant MCC pages (`checkedOn` 2026-09-28 in `merchants.json`, while `merchant-manifest.json` says captured 2026-10-01, a pre-existing mismatch).
- **Published estimates have a window too.** NerdWallet estimates must be read within the 30 days before `verifiedAt`. The current read, 2026-10-02, holds for any catalog verified up to 2026-11-01, so this renewal is fine; the next one must re-read them.
- **Captures are frozen.** A changed page becomes a new dated capture in a new batch, and its cards run through the pipeline again. Released corpora are never edited.
- **Rule IDs.** A refreshed rule with changed terms gets a new ID (ledger), so shoppers keep recorded spend only on unchanged rules.
- **No fallback curation model.** Evan, 2026-10-04: the Phase 8 Codex stalls were his laptop and network being off. Retry, do not switch models ([user directives](user-directives.md)).

## How freshness works (hash-only; Stage 2 decision 1)

1. `pipeline freshness` re-renders every cited source exactly as capture does (same script, same hints) into a temporary directory outside the repository, computes SHA-256, and deletes the text.
2. **Unchanged:** it records `{ sourceId, checkedOn, sha256 }` in a committed, text-free freshness record. The builder takes the newest matching `checkedOn` as the source's date, which keeps the catalog valid without re-labelling.
3. **Changed:** the cards citing the page go into a refresh batch per issuer (new dated captures in the batch's own folder). Every change counts, including a one-word date change: hash-only means no judgment about which changes matter. Real cards included (below) (new dated captures in the batch's own folder). They are then extracted, verified, adjudicated, applied and overlaid as in Phase 8. The run also measures the false-change rate, which decides whether a capture normalizer is ever needed (review change 5).
4. **Merchant MCC pages** (third-party, cited by merchants, not cards): unchanged pages get a new `checkedOn`; a changed one is re-captured by hand into `real/merchant-captures` with a new dated manifest entry and its MCC re-checked, or dropped. The pipeline has no merchant stage before Phase 10.
5. **Unreachable or bot-walled:** no new `checkedOn`, so the source ages out unless resolved. The session drops the source or holds the card out, each with a reason.
6. **Build and publish.** The build takes a new catalog version and checks rule-ID continuity against the published release; `handoff` gives Evan the publish steps.

## Milestones

One branch and PR each, from the latest `main`. Each gets an independent reviewer subagent and CI before the coordinator merges it.

| # | Milestone | Delivers |
| --- | --- | --- |
| 1 | Review app knows pipeline batches | `apps/review/src/manifest.ts` bundles batch manifests, and a source may have several known hashes (one per dated capture). This unblocks publishing any pipeline batch; it reaches Evan through the Render deploy of `main` |
| 2 | Pipeline fixes from the Phase 8 run | A published version is never rebuilt with other contents (`publishedVersions`); `run build --proposed` builds without changing what ships; `drop-source`; `next` returns all cards of a failed stage |
| 3 | `pipeline freshness` | Hash-only re-check of every cited source (issuer, real and merchant layers); a freshness record; the builder reads `checkedOn`; refresh batches for changed pages. **Real cards:** a batch may refresh a real card; `checkRealCards` (pinned to release 1, `CATALOG_V2`) is replaced for refreshed real cards by the rule-ID continuity check against the published release, keeping the release-1 names and rule-ID prefixes. Also fixes `capture-issuer-pages.mjs` joining an absolute `--captures`/`--manifest` path under `--dir` |
| 4 | Renewal run (done 2026-10-05, PR #50 merged and deployed; [results](../../docs/evals/freshness-2026-10.md)) | Freshness over all 328 sources, refresh batches for changed pages, renewed catalog under a new version, eval, `handoff`. Results in `docs/evals/freshness-2026-10.md` |
| 5 | Agent publish path (added 2026-10-05 at Evan's request; [decision](../decisions/2026-10-05-agent-publish-cli-session.md)) | `pipeline login` / `logout` (Evan's own CLI session, stored outside the repository) and `pipeline publish`: match every cited source to a bundled manifest hash, upload the captures, create the draft, check it equals `CATALOG_V3`, publish only with `--confirm <version>` after Evan's `publish <version>` in chat. Then the renewal is published this way |

## Milestone 3, built (2026-10-05)

Branch `phase9-m3-freshness`: `pipeline freshness` writes the text-free record `evals/curation/freshness/<date>.json` (328 sources from the build config: issuer, real and merchant layers; one capture process per host into `os.tmpdir()`, text deleted; resumable per day); the builder dates a source by the newest record that found it `unchanged` (merchant MCC `checkedOn` too) and refuses a cited source outside the 30-day window by name; `init --refresh-from-freshness <date>` seeds a refresh batch per issuer from the changed cards' current layers, research recorded `seeded`; a batch may replace a real card (release-1 names and rule-ID scheme, `checkRealCards` skipped only for it, ledger continuity applies); the review app and `handoff` read the records. Details: [pipeline](../system/card-expansion-pipeline.md#built-so-far), [decision](../decisions/2026-10-05-freshness-records-and-seeded-refresh.md). A smoke run on 2026-10-05 of three real-card terms pages (record kept out of the repository): Citi Double Cash terms PDF and Capital One Quicksilver terms unchanged, Amex Blue Cash Everyday terms changed (the probe had seen one-word differences on both Amex terms pages).

Open for milestone 4: the run over all 328 sources (about 2.5 s per page per host; Amex, Chase, Citi, Capital One and others in parallel); commit the record, then seed one refresh batch per issuer with changed cards (`wells-fargo-2026-10` is already a batch id: use `<issuer>-refresh-2026-10`); decide flagged and unreachable sources; re-capture any changed merchant MCC page by hand; a new catalog version; the first committed record changes `CATALOG_V3`'s dates, so the builder's byte-identity test (no records) and `catalog:v3:check` move with it.

## Schedule

| Date | Target |
| --- | --- |
| 2026-10-06 | Milestones 1 and 2 merged |
| 2026-10-09 | Milestone 3 merged |
| 2026-10-14 | Renewal run at a ready branch; merged and deployed (done 2026-10-05) |
| 2026-10-19 | Milestone 5 (agent publish path) merged and deployed; Evan has run `pipeline login` |
| from 2026-10-20 | Evan asked to publish (latest 2026-10-28; hard limit 2026-11-01T00:00Z) |

If the renewal run is not at a ready branch by 2026-10-20, tell Evan at once. The fallback is a manual renewal: new dated captures with the existing scripts and a rebuild.

## Wells Fargo refresh batch

Evan decided on 2026-10-04 that the renewal **includes** the Phase 8 batch `wells-fargo-2026-10` as the Wells Fargo layer (registered in the build config under the renewal's new version), superseding the default of the [not-shipped decision](../decisions/2026-10-04-wells-fargo-batch-not-shipped.md). If its pages changed again by the freshness run, those cards go through a newer batch as any other.

## Probe, 2026-10-04 (five days after the real captures)

Re-captured into a scratch folder with the capture script (nothing committed): of the 15 real-card pages, 5 are byte-identical; 4 differ by one or two words (both Amex terms pages, Amex retail info, Chase Freedom Unlimited product); 6 product pages were substantially rewritten (Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver and Savor, Amex Blue Cash Everyday and Preferred), several touching rate or dollar figures. Both merchant MCC pages are identical. Six of 11 Wells Fargo pages were identical two days after their capture. Expect most product pages to need a full re-run; the run measures the false-change rate across all sources.

## Related

* [Roadmap](roadmap.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Catalog release](../ops/catalog-release.md)
* [Pipeline v1 acceptance run](../../docs/evals/pipeline-v1.md)
