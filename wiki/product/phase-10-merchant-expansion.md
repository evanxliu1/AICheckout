---
type: Product
title: Merchant coverage plan (Phases 10–17)
description: Plan v6.1 after four review rounds by Fable 5.1 and Opus 5.5, split on 2026-10-05 into Phases 10–17, each with its own exit check and the decisions it needs (D4 and D6 approved) — recommend a card at any U.S. online checkout with a hosted merchant database matched on the device and a deterministic generic cart reader proven on real top-merchant pages; Release A (click-to-use anywhere, replacing Phase 5), then consented telemetry without browsing data and the optional automatic badge (Release B); a measured LLM merchant pipeline; value metrics and a data room.
status: stable
tags: [product, plan, phase-10, phase-11, phase-12, phase-13, phase-14, phase-15, phase-16, phase-17, merchants, telemetry]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T19:14:03Z
sources:
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design
  - resource: ../system/telemetry-design.md
    title: Telemetry, operations and value metrics design
  - resource: ../archive/phase2-goal.md
    title: Archived Phase 2–6 plan (Phase 6 site coverage harness)
---

# Merchant coverage plan (Phases 10–17)

**Split into Phases 10–17 by Evan on 2026-10-05** ([decision](../decisions/2026-10-05-merchant-coverage-phases.md)): each phase is small, ships on its own, has its own exit check and asks only the decisions it needs; Phases 10 and 11 run in parallel. D4 and D6 are approved; the other decisions are asked when their phase starts. History (all 2026-10-05): v1–v3 planned bundled per-site adapters for 10, then 100–500, merchants; v4 followed Evan's direction to work at any merchant like official products, with telemetry and future affiliate offers; v5 folded in two Fable 5.1 reviews (technical; product and business); **v6** folds in a parallel Fable 5.1 and Opus 5.5 review of v5 (all agent-verified); a final parallel Fable 5.1 and Opus 5.5 check of v6 found only line-level fixes, applied in v6.1; the coordinator's review of v6.1 split the ten milestones into eight phases. Design: [merchant coverage](../system/merchant-coverage-design.md); [telemetry, operations and value metrics](../system/telemetry-design.md).

## Goal

A shopper gets a correct card recommendation at **any U.S. online checkout**: the store recognized from a reviewed merchant database or treated as a generic U.S. online store, the cart amount read automatically where the page allows and confirmed or typed otherwise, uncertain categories shown as ranges. The product can **prove its value with data** without collecting browsing activity, and is ready for affiliate card offers later. The LLM keeps a measured job: drafting merchant profiles and category evidence, evaluated like the card extraction.

## Success criteria

Y is set in the Phase 12 protocol; X and Z are set after 4 weeks of Release B data and reported with n.

1. **Reader on real pages:** on the active held-out split (A, or B once A is retired) 0 false-found results, 95% upper bounds reported at the page-state and site level; found-correct ≥ Y% on the one-item state; p95 reading time within budget.
2. **Category correctness:** every profiled domain whose plausible category is a catalog bonus category has class 1 or 2 evidence, or its recommendation is a range; the share of range recommendations is reported.
3. **Coverage (field):** ≥ X% of recommendations at named profiles.
4. **Merchant pipeline (LLM):** drafted profiles and category evidence measured against the adjudicated held-out profiles frozen in Phase 12.
5. **Field quality:** amount correction rate ≤ Z%.
6. **Compliance:** listing, consent screen, privacy policy and event dictionary agree before any release that sends events.
7. **Value pack:** the [value metrics and data room](../system/telemetry-design.md#value-metrics-what-a-buyer-or-partner-asks-for) exist and are current.

Each phase closes on its own exit check (below). Criteria 1, 2, 4, 6 and 7 are met inside Phases 13–17; 3 and 5 are field metrics reported by the operating runbook after 4 weeks of Release B data and do not hold any phase open.

## Decisions taken (Evan, 2026-10-05)

- Future affiliate card offers and aggregate internal analytics are wanted; user data is never sold.
- Collect all proposed event groups. The reviewers found two limits Evan confirms in D1 and D11: consent must be an affirmative opt-in, and Chrome's Limited Use forbids automatic browsing data (domains, merchants), so those travel only on a shopper's click; the opportunity event waits for the affiliate phase.
- Account-free until after the MVP. Affiliate offers are a later phase.

## Rules kept and rules superseded

Kept: no model at checkout; every catalog and merchant release human-approved; never sign in, create accounts, type secrets, fill or submit fields, place orders, bypass bot walls or solve CAPTCHAs on retailer sites; captures gitignored, quotes ≤ 25 words; subscription CLIs only, curation and drafting on gpt-5.6-luna `xhigh`; eval integrity; Web Store submission is Evan's.

Superseded on approval (each gets a decision record and a directive row):

| Earlier statement | Becomes |
| --- | --- |
| Site adapters bundled in the extension (2026-09-29) | Store configs are reviewed data in the merchant database, with a bundled fallback if review objects |
| Zero-click badge through required host permissions (2026-10-01), "local-first" | Click-to-use everywhere; automatic badge after the optional all-sites grant; local-first except consented telemetry |
| Phase order 9 → 10 → Web Store release (2026-10-03) | Phases 10–17 (2026-10-05); Release A is Phase 15 and replaces Phase 5 (D8); Release B closes Phase 17 |
| Catalogs only are published by the coordinator on chat approval (2026-10-05) | Also merchant releases, on "publish merchants <version>" |
| Privacy policy and listing: no analytics; runs on no other site; fetches only on click | Consented telemetry; URL-gated injection on candidate checkouts; weekly background refresh of catalog and merchant database |
| `goal.md`: nothing leaves the device; few users expected; non-goal "broad scraping" | Nothing leaves without consent; real users and value metrics are goals; bounded capture of cart pages for evaluation is not scraping |
| `docs/release/privacy-review.md`: no analytics added to elaborate the policy | Analytics added for product operation at the owner's direction (2026-10-05) |
| Roadmap Phase 6 (site coverage harness) | Folded into Phases 12, 13 and the operating runbook, and closed |

## Phases

Each phase is one or more branches (`phaseN-<slug>`, one PR per branch) from the latest `main`; an independent reviewer subagent and CI before the coordinator merges; hosted migrations by the coordinator under the standing authorization. When a phase starts it gets a short plan page (like the [Phase 9 plan](phase-9-freshness.md)) and asks Evan the decisions it needs. Each phase updates the wiki pages it touches. "Was" is the milestone number in v6.1.

| Phase | Delivers | Was | Needs | Exit check |
| --- | --- | --- | --- | --- |
| **10 Feasibility probe** | No product code: 25 sites from the D6 source, stratified by rank band and platform (shadow DOM, a third-party checkout), persistent non-Evan profile under a gitignored path; reachability, logged-out carts, bot walls, prompts, strict-CSP badge frame, storage quota; prototype reader steps 1–3 | M1 | D4, D6 (approved) | `docs/evals/merchant-probe-2026-10.md`; go/no-go; proposed Y |
| **11 Any store, typed amount** | At any U.S. online store the popup recommends a card instead of "unsupported": the engine accepts a passed-in profile (`packages/rewards-core/src/engine-v3.ts` merchant lookup, `engine-shared.ts` unsupported-merchant check), a generic profile "Another U.S. online store" (`general-merchandise`, online retail) chosen from the tab's URL, amount typed by the shopper; the 3 supported stores unchanged. No store search and no category ranges (Evan, 2026-10-05): the generic profile always uses the general rate; category ranges and D5 move to Phase 14 | M3 (reduced) | — | Engine tests for the generic profile; `rewards-v3` golden ladders unchanged; axe on the changed popup screens |
| **12 Eval protocols and captures** | `docs/evals/generic-reader-protocol.md` (splits, states, labeling and adjudication, bounds, peek policy, capture posture) and the merchant-pipeline protocol (held-out domains and adjudicated profiles frozen); capture tool with recipes; all three splits captured | M2 | Phase 10 go | Reviewer subagent signs both protocols before any tuning or drafting; capture tool refuses sign-in and field input by test |
| **13 Generic reader v1** | Tuned on development only; the 3 adapters become bundled seed store configs; manifest `host_permissions` pinned to the 3 seed hosts as a literal list in `extension/vite.config.ts` (today derived from the adapters as `BADGE_HOSTS`) and `extension/e2e/hosts.ts` | M4 | — | `docs/evals/generic-reader-v1.md` with bounds; criterion 1 |
| **14 Merchant database** | Schema (Zod/SQL parity, 2 MiB, regex lint), migration (`npm run supabase -- migration new merchant_releases`), `GET /v1/merchants` with `ETag` and in-memory cache, CLI publish in `tools/catalog-pipeline`, extension download, suffix match, weekly `alarms` refresh, `disabled`, degradation; seeded with the 3 legacy merchants and probe/capture domains at the default category only | M5 | D2, D5, D7, D9 | Parity, API, worker and kill-switch tests; cold-start test; a published merchant release |
| **15 Release A** (Evan submits; replaces Phase 5) | Click-to-use at any U.S. checkout; hosted build with weekly catalog and merchant refresh (`alarms`, no new warnings); the 3-site automatic badge per D13; no telemetry; single-purpose statement, policy, permission justifications and privacy review reconciled; Phase 5 prerequisites (publisher name and verification, support email per `docs/release/README.md`; order-confirmation URLs of the 3 legacy sites checked on real orders by Evan, per `now.md`, or their savings prompt stays off) | M6 | D8, D13, D14 | Package check, `test:browser`; reviewer subagent confirms policy, listing and build agree |
| **16 Merchant pipeline (LLM, measured)** | List from license-safe sources (D6); profiles and category evidence drafted by gpt-5.6-luna `xhigh` via Codex, verified and adjudicated by Claude Code subagents; store configs where the reader fails; skill `expand-merchants`; growth toward 1,000 domains (from "Suggest this store" once Phase 17 ships) | M9 | D10; Phases 12 and 14 | `docs/evals/merchant-pipeline-v1.md` against the frozen held-out set; merchant releases on Evan's approval |
| **17 Telemetry and Release B** | Privacy memo and event dictionary; consent screen, events and per-click "Suggest this store" / "Report a problem", ingest RPC, retention, reviewer dashboard, stop switch; then the optional automatic badge (`https://*/*` optional, URL-gated injection, site-access handling) → Release B; policy, listing, site, support and runbook updated. May split into two phases when it starts | M7, M8 | D1, D3, D11, D12 | Prominent-disclosure check against the User Data FAQ by a reviewer subagent; threat-model review of the ingest path; contract, retention and axe tests; `test:browser`, no new required hosts, CPU budget test |

**Order:** 10 ∥ 11 → 12 → 13 → 14 → 15; 16 may run beside 15 once 12 and 14 are merged; 17 after 15. **Operating** (was M10) is a runbook, not a phase: monthly replays for store-config domains and the top 100, reader v2 from development data, dashboard review, and the field criteria 3 and 5.

**Sizing:** v4 estimated 8–11 weeks of sessions; reviewers expect about double for one developer with agents. **Stop rules:** if fewer than half the probe sites show a logged-out cart, Evan re-decides scope before Phase 12; if reader v1 fails criterion 1 on both A and B, before Phase 15.

## Decisions for Evan (one word each, asked when their phase starts)

| # | Decision | Recommendation | Needed by | Status |
| --- | --- | --- | --- | --- |
| D1 | Telemetry is **off until the shopper agrees** on a dedicated screen; the opportunity event waits for the affiliate phase | Approve | Phase 17 | Open |
| D2 | Merchant data as a **separate, versioned merchant release**; the coordinator publishes it on your chat "publish merchants <version>"; store configs fall back to bundled if Web Store review objects | Approve | Phase 14 | Open |
| D3 | All-sites access **optional**, asked on a click (not required at install) | Optional | Phase 17 | Open |
| D4 | **Real-page capture:** one known item in a logged-out cart on ~150–200 top sites, non-Evan profile, no CAPTCHAs, monthly replays for a subset | Approve | Phase 10 | Approved 2026-10-05 |
| D5 | **Category evidence:** issuer statements and business-type inference with ranges; the paid Mastercard API only later, by a new directive | Approve | Phase 14 | Open |
| D6 | **Merchant list:** Tranco or Chrome UX Report ∩ agent-classified retail, with attribution; NRF Top 100 cross-check; no paid rankings | Approve | Phase 10 | Approved 2026-10-05 |
| D7 | **MVP size:** 3 legacy merchants plus ~250–300 domains at the default category; bonus-category profiles from the measured pipeline; 1,000 after launch | Approve | Phase 14 | Open |
| D8 | **Release A inside Phase 10**, with weekly background refresh of catalog and merchant data (new disclosed network behaviour) | Approve | Phase 15 | Open |
| D9 | **Licensing:** (a) MIT for everything; (b) MIT for code, future merchant data, eval labels and snapshots proprietary (files already published stay MIT) | a / b | Phase 14 | Open |
| D10 | **LLM role:** merchant profiles and category evidence drafted by gpt-5.6-luna and measured | Approve | Phase 16 | Open |
| D11 | **No automatic browsing data:** events never carry domains or merchants; the growth list comes from "Suggest this store" and "Report a problem" clicks | Approve | Phase 17 | Open |
| D12 | **Affiliate hard rule:** never touch retailer affiliate links or cookies; offers only as labelled, user-initiated links in the extension | Approve | Phase 17 | Open |
| D13 | **Release A keeps the automatic badge on Amazon, Best Buy and Newegg** (required hosts unchanged) until Release B | Keep / drop | Phase 15 | Open |
| D14 | **Hosting:** stay on Render and Supabase free tiers until a usage trigger (weekly installs or egress) you set | Approve, with the trigger | Phase 15 | Open |

Later options, not decisions now: licensing the catalog as an API to fintechs; bank linking for real category data; accounts.

## Related

* [Merchant coverage design](../system/merchant-coverage-design.md)
* [Telemetry design](../system/telemetry-design.md)
* [Roadmap](roadmap.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
