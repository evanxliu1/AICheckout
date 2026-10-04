---
type: Product
title: Roadmap
description: Project phases, what each delivered or will deliver, and their status.
status: stable
tags: [product, roadmap]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T00:30:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived; full step lists and exit criteria)
  - resource: ../archive/design.md
    title: Design (archived)
---

# Roadmap

Phases from the archived [Phase 2–6 plan](../archive/phase2-goal.md), which keeps the detailed step lists and exit criteria. Each phase or milestone is one branch and one PR cut from the latest `main`; Evan or the authorized coordinating session merges. PRs: #4 2a, #5 2b, #6 2c, #7 Phase 3 M1 (ui), #8 M2 (catalog v2), #9 M3 (extension), #10 M4 (review), #11 M5 (site), #12 M6 prep, #13 3b auto badge, #14 3b follow-ups, #16 Phase 7 capture and extraction, #17 Phase 7 verification, #18–#31 Phase 7 Stage 2 (plan, M11, M3, M9, M1, M2, M8, M4, M6, M5, M10 part 1, Tailwind 4, M7, M10 part 2), #32 Ocean theme, #33 release media.

| Phase | Delivers | Status (2026-10-04) |
| --- | --- | --- |
| 1 Hosting | Render + hosted Supabase, review app online | Done 2026-09-28 |
| 2a v2 harness | Extraction contract v2, prompts, quote resolution, scorer, `eval:v2` | Done 2026-09-28 |
| 2b Real corpus | 15 issuer captures, 37 cases, agent-verified labels | Done 2026-09-29 |
| 2c Experiments | Model × prompt × selection matrix, guided.2, held-out, `docs/evals/results.md` | Done 2026-09-29/30 |
| 3a Helios | `packages/ui`; extension, review app and site on Helios | Done (M1, M3–M5) |
| 3 Real catalog | Catalog v2, engine, DB migration, 7-card catalog, Amazon adapter | Done. M1–M6 merged; migrations pushed to hosted; the 7-card catalog `2026-09-29.real.1` is published (sequence 1, 2026-10-02T02:29Z). The M6 live-refresh check closed 2026-10-03: the extension's `prepareCatalogUpdate` accepts hosted release 2 over a cached release 1 (checked through the update logic, not a loaded `build:hosted` extension; [catalog release](../ops/catalog-release.md#release-2-published-2026-10-03)) |
| 3b Auto badge | Zero-click cart badge, optional vault, onboarding, savings | Merged 2026-10-02 (PRs #13, #14); see [decision](../decisions/2026-10-01-automatic-cart-badge.md) and [cart badge](../system/cart-badge.md) |
| 4 Terms-change detection | Weekly GitHub Action re-captures sources, opens an issue with hashes and short excerpts | Not started |
| 5 Ship | Chrome Web Store listing (Evan pays and submits), demo video | Not started |
| 6 Site coverage harness | LLM drafts site adapters from captured carts; execution-based validation; remote kill switch; drift detection | Not started; design in the archived plan |
| 7 Card expansion | 180 consumer cards of the top-10 U.S. issuers: capture, gpt-5.6-luna extraction, verified labels (Stage 1); catalog v3 with points valuation, merchant-specific, chosen, rotating, gated and closed-loop rules, larger limits, wallet search, eval and a published release (Stage 2) | Stage 1 done: PRs #16 and #17 merged, `expansion.v1` has 173 agent-verified cards. Stage 2 ([plan](phase-7-stage-2.md), M1–M11): **done 2026-10-03**. M1–M10 and the M11 draft merged (PRs #18–#31), release media in the Ocean look (PR #33); the extension bundles the 178-card `CATALOG_V3`, and Evan published it as hosted release 2 on 2026-10-03T06:15Z, expiring 2026-11-01 ([catalog release](../ops/catalog-release.md)). The M11 pipeline design was approved for Phase 8 on 2026-10-03. See [catalog expansion](../system/catalog-expansion.md) and [decision](../decisions/2026-10-01-top-ten-issuer-card-expansion.md) |
| 8 Card-expansion pipeline | v1: CLI in `tools/catalog-pipeline` (batch state, hashing, claimed work packets, gates with a label-evidence lint), multi-batch catalog builder with rule-ID continuity, skill `expand-catalog` and four pinned subagents (researcher, verifier, adjudicator, overlay author), `eval` and `handoff`; acceptance run: Wells Fargo as a refresh batch with new dated captures (labels compared with `expansion.v1`), measured in `docs/evals/pipeline-v1.md` | **Active.** Design approved by Evan 2026-10-03 with the Fable 5.1 review's changes ([card-expansion pipeline](../system/card-expansion-pipeline.md), [decision](../decisions/2026-10-02-agent-driven-card-pipeline.md)). Target 2026-10-17; if it slips past 2026-10-20, freshness starts in parallel or falls back to a manual refresh |
| 9 Freshness | Hash-only freshness checks of every catalog source, new dated captures for changed pages in a new batch, a renewed release before release 2 expires (2026-11-01T00:00Z; Evan publishes by about 2026-10-28) | Next after Phase 8; v1 leaves the hooks (state fields, a `freshness` stage slot, dates from manifests) |
| 10 Merchant-expansion pipeline | More checkout merchants: site adapters, merchant profiles and brand links so merchant-specific rules apply (builds on Phase 6), reusing the pipeline pattern | After Phase 9 |

Order set by Evan on 2026-10-03 (replacing the 2026-10-02 order): **Phase 8 card-expansion pipeline v1 → Phase 9 freshness → Phase 10 merchant-expansion pipeline → Chrome Web Store release (Phase 5)**. Phase 4 (terms-change detection) overlaps Phase 9 and is revisited after it.

Also pending: a human verification pass over the agent-verified labels, deferred by Evan on 2026-10-02 ([decision](../decisions/2026-09-29-agent-verified-labels.md)), and real-order checks of the `orderConfirmation` URL patterns before the store release.

## Related

* [Goal](goal.md)
* [Now](../now.md)
