---
type: Product
title: Roadmap
description: Project phases, what each delivered or will deliver, and their status.
status: stable
tags: [product, roadmap]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived; full step lists and exit criteria)
  - resource: ../archive/design.md
    title: Design (archived)
---

# Roadmap

Phases from the archived [Phase 2–6 plan](../archive/phase2-goal.md), which keeps the detailed step lists and exit criteria. Each phase or milestone is one branch and one PR cut from the latest `main`; Evan merges.

| Phase | Delivers | Status (2026-10-02) |
| --- | --- | --- |
| 1 Hosting | Render + hosted Supabase, review app online | Done 2026-09-28 |
| 2a v2 harness | Extraction contract v2, prompts, quote resolution, scorer, `eval:v2` | Done 2026-09-28 |
| 2b Real corpus | 15 issuer captures, 37 cases, agent-verified labels | Done 2026-09-29 |
| 2c Experiments | Model × prompt × selection matrix, guided.2, held-out, `docs/evals/results.md` | Done 2026-09-29/30 |
| 3a Helios | `packages/ui`; extension, review app and site on Helios | Done (M1, M3–M5) |
| 3 Real catalog | Catalog v2, engine, DB migration, 7-card catalog, Amazon adapter | M1–M5 merged; **M6 pending**: Evan publishes the 7-card catalog in the hosted review app ([publish runbook](../../docs/release/publish-runbook.md)) |
| 3b Auto badge | Zero-click cart badge, optional vault, onboarding, savings | Implemented on branch `phase3b-auto-badge`, not merged; see [decision](../decisions/2026-10-01-automatic-cart-badge.md) |
| 4 Terms-change detection | Weekly GitHub Action re-captures sources, opens an issue with hashes and short excerpts | Not started |
| 5 Ship | Chrome Web Store listing (Evan pays and submits), demo video | Not started |
| 6 Site coverage harness | LLM drafts site adapters from captured carts; execution-based validation; remote kill switch; drift detection | Not started; design in the archived plan |

Also pending: a human verification pass over the agent-verified labels ([decision](../decisions/2026-09-29-agent-verified-labels.md)), and real-order checks of the `orderConfirmation` URL patterns before the store release.

## Related

* [Goal](goal.md)
* [Now](../now.md)
