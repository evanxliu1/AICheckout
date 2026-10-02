---
type: Product
title: Roadmap
description: Project phases, what each delivered or will deliver, and their status.
status: stable
tags: [product, roadmap]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T18:30:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived; full step lists and exit criteria)
  - resource: ../archive/design.md
    title: Design (archived)
---

# Roadmap

Phases from the archived [Phase 2–6 plan](../archive/phase2-goal.md), which keeps the detailed step lists and exit criteria. Each phase or milestone is one branch and one PR cut from the latest `main`; Evan or the authorized coordinating session merges. PRs: #4 2a, #5 2b, #6 2c, #7 Phase 3 M1 (ui), #8 M2 (catalog v2), #9 M3 (extension), #10 M4 (review), #11 M5 (site), #12 M6 prep, #13 3b auto badge, #14 3b follow-ups.

| Phase | Delivers | Status (2026-10-02) |
| --- | --- | --- |
| 1 Hosting | Render + hosted Supabase, review app online | Done 2026-09-28 |
| 2a v2 harness | Extraction contract v2, prompts, quote resolution, scorer, `eval:v2` | Done 2026-09-28 |
| 2b Real corpus | 15 issuer captures, 37 cases, agent-verified labels | Done 2026-09-29 |
| 2c Experiments | Model × prompt × selection matrix, guided.2, held-out, `docs/evals/results.md` | Done 2026-09-29/30 |
| 3a Helios | `packages/ui`; extension, review app and site on Helios | Done (M1, M3–M5) |
| 3 Real catalog | Catalog v2, engine, DB migration, 7-card catalog, Amazon adapter | Done. M1–M6 merged; migrations pushed to hosted; the 7-card catalog `2026-09-29.real.1` is published (sequence 1, 2026-10-02T02:29Z). Left: check a live refresh in a `build:hosted` extension |
| 3b Auto badge | Zero-click cart badge, optional vault, onboarding, savings | Merged 2026-10-02 (PRs #13, #14); see [decision](../decisions/2026-10-01-automatic-cart-badge.md) and [cart badge](../system/cart-badge.md) |
| 4 Terms-change detection | Weekly GitHub Action re-captures sources, opens an issue with hashes and short excerpts | Not started |
| 5 Ship | Chrome Web Store listing (Evan pays and submits), demo video | Not started |
| 6 Site coverage harness | LLM drafts site adapters from captured carts; execution-based validation; remote kill switch; drift detection | Not started; design in the archived plan |
| 7 Card expansion | 180 consumer cards of the top-10 U.S. issuers: capture, gpt-5.6-luna extraction, verified labels, engine support for points and merchant-specific rules, larger catalog limits, wallet search | In progress: captures, extraction and drafts merged (PR #16); 25-word drafts and the verification format on `phase7-verify`; verification, engine work and eval remain. See [catalog expansion](../system/catalog-expansion.md) and [decision](../decisions/2026-10-01-top-ten-issuer-card-expansion.md) |

Also pending: a human verification pass over the agent-verified labels ([decision](../decisions/2026-09-29-agent-verified-labels.md)), and real-order checks of the `orderConfirmation` URL patterns before the store release.

## Related

* [Goal](goal.md)
* [Now](../now.md)
