# Product

Why the project exists, who it serves, and what the owner has decided it may and may not do.

* [Goal](goal.md) — purpose, users, success criteria, non-goals.
* [User directives](user-directives.md) — dated record of explicit authorizations, prohibitions and preferences.
* [Roadmap](roadmap.md) — phases, what each delivers, status.
* [Merchant coverage plan (Phases 10–17)](phase-10-merchant-expansion.md) — any U.S. online checkout in eight phases, each with its exit check and the decisions it needs: feasibility probe and any-store typed amount (in parallel), reader eval and captures, generic reader v1, merchant database, Release A, measured LLM merchant pipeline, telemetry and Release B; D4 and D6 approved; D1 and D11 approved 2026-10-10; Phase 13c and Phase 14 changed several later phases (see the page's notes).
* [Phase 10 plan (merchant feasibility probe)](phase-10-feasibility-probe.md) — 25 top retail sites visited logged out in a separate profile: logged-out carts, blockers, summary structure, a prototype reader; go/no-go and a proposed reader target. Done 2026-10-05 (PR #58): go (16 of 25); Y = 80% accepted, then replaced on 2026-10-06 by the ≥ 99% shown-amount bar ([report](../../docs/evals/merchant-probe-2026-10.md)).
* [Phase 11 plan (any store, typed amount)](phase-11-any-store.md) — the popup recommends a card at any U.S. online store with a generic profile the engine supplies and a typed amount. Done 2026-10-05 (PR #57).
* [Phase 12 plan (reader eval protocols and captures)](phase-12-reader-eval.md) — pre-registered generic-reader evaluation (signed through `generic-reader-protocol.9`; ≥ 99% bar on shown amounts, coverage reported), merchant-pipeline held-out domains, a robot capture tool (retired as the main path by `.8`, kept) and agent-driven browser-pane capture of 330 U.S. + 500 non-U.S. sites in three splits weighted 1 : 2 : 2 (two splits, 3 : 2, since `.10`); frozen 2026-10-08, merged with PR #76 (PRs #59–#76).
* [Phase 14 plan](phase-14-merchant-database.md) — merchant database: about 500 stores matched on the device, evidence-gated categories, hosted releases, a seed pipeline, measurement. Planned 2026-10-10.
* [Phase 13c plan](phase-13c-cart-detection.md) — cart and checkout page detection at any store, the badge on all sites at install, rates view with no typing, detector measured on the frozen set and live home pages, one reader coverage round. Planned 2026-10-09; merged 2026-10-10 (PR #79).
* [Phase 13 plan](phase-13-reader.md) — generic cart reader v1: Fable 5.1 develops `readCart` on development pages (generic rules only), review, held-out A score, report; then extension integration (13b). Done: reader v1 merged as PR #77 and 13b as PR #78 (2026-10-09).
* [Phase 9 plan](phase-9-freshness.md) — catalog freshness: review app for batches, pipeline fixes, hash-only `pipeline freshness`, renewal run, agent publish path; done 2026-10-05 (renewal published as release 3).
* [Phase 7 Stage 2 plan](phase-7-stage-2.md) — milestones M1–M11 from the verified expansion corpus to a published catalog v3 (178 cards, release 2) and pipeline readiness; done 2026-10-03.
