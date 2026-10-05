---
type: Product
title: Phase 10 plan (merchant coverage, draft v6)
description: Draft v6 after three review rounds (Fable 5.1 ×3, Opus 5.5), awaiting Evan's decisions D1–D14 — recommend a card at any U.S. online checkout with a hosted merchant database matched on the device and a deterministic generic cart reader proven on real top-merchant pages; Release A (click-to-use anywhere) inside the phase, then consented telemetry without browsing data and the optional automatic badge (Release B); a measured LLM merchant pipeline; value metrics and a data room.
status: draft
tags: [product, plan, phase-10, merchants, telemetry]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T10:00:00Z
sources:
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design
  - resource: ../system/telemetry-design.md
    title: Telemetry, operations and value metrics design
  - resource: ../archive/phase2-goal.md
    title: Archived Phase 2–6 plan (Phase 6 site coverage harness)
---

# Phase 10 plan: merchant coverage (draft v6)

**Draft, not approved.** Evan answers D1–D14 before any Phase 10 work starts. History (all 2026-10-05): v1–v3 planned bundled per-site adapters for 10, then 100–500, merchants; v4 followed Evan's direction to work at any merchant like official products, with telemetry and future affiliate offers; v5 folded in two Fable 5.1 reviews (technical; product and business); **v6** folds in a parallel Fable 5.1 and Opus 5.5 review of v5 (all agent-verified). Design: [merchant coverage](../system/merchant-coverage-design.md); [telemetry, operations and value metrics](../system/telemetry-design.md).

## Goal

A shopper gets a correct card recommendation at **any U.S. online checkout**: the store recognized from a reviewed merchant database or treated as a generic U.S. online store, the cart amount read automatically where the page allows and confirmed or typed otherwise, uncertain categories shown as ranges. The product can **prove its value with data** without collecting browsing activity, and is ready for affiliate card offers later. The LLM keeps a measured job: drafting merchant profiles and category evidence, evaluated like the card extraction.

## Success criteria

Y is set in the milestone 2 protocol; X and Z are set after 4 weeks of Release B data and reported with n.

1. **Reader on real pages:** on the active held-out split (A, or B once A is retired) 0 false-found results, 95% upper bounds reported at the page-state and site level; found-correct ≥ Y% on the one-item state; p95 reading time within budget.
2. **Category correctness:** every profiled domain whose plausible category is a catalog bonus category has class 1 or 2 evidence, or its recommendation is a range; the share of range recommendations is reported.
3. **Coverage (field):** ≥ X% of recommendations at named profiles.
4. **Merchant pipeline (LLM):** drafted profiles and category evidence measured against the adjudicated held-out profiles frozen in milestone 2.
5. **Field quality:** amount correction rate ≤ Z%.
6. **Compliance:** listing, consent screen, privacy policy and event dictionary agree before any release that sends events.
7. **Value pack:** the [value metrics and data room](../system/telemetry-design.md#value-metrics-what-a-buyer-or-partner-asks-for) exist and are current.

**Phase 10 is done** when 1, 2, 4, 6 and 7 pass and 3 and 5 have been reported once on at least 4 weeks of Release B data.

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
| Phase order 9 → 10 → Web Store release (2026-10-03) | Release A ships inside Phase 10 (D8); Release B at milestone 8 |
| Catalogs only are published by the coordinator on chat approval (2026-10-05) | Also merchant releases, on "publish merchants <version>" |
| Privacy policy and listing: no analytics; runs on no other site; fetches only on click | Consented telemetry; URL-gated injection on candidate checkouts; weekly background refresh of catalog and merchant database |
| `goal.md`: nothing leaves the device; few users expected; non-goal "broad scraping" | Nothing leaves without consent; real users and value metrics are goals; bounded capture of cart pages for evaluation is not scraping |
| `docs/release/privacy-review.md`: no analytics added to elaborate the policy | Analytics added for product operation at the owner's direction (2026-10-05) |
| Roadmap Phase 6 (site coverage harness) | Folded into milestones 2, 4 and 10 and closed |

## Milestones

One branch (`phase10-mN-<slug>`) and PR each from the latest `main`; an independent reviewer subagent and CI before the coordinator merges; hosted migrations by the coordinator under the standing authorization. Each milestone updates the wiki pages it touches.

| # | Milestone | Verify |
| --- | --- | --- |
| 0 | **Approval:** Evan answers D1–D14; directive rows, decision records, roadmap and goal updated; designs marked accepted (not built) | Lint; decision records exist |
| 1 | **Feasibility probe** (no product code): 25 sites from the D6 source, stratified by rank band and platform (shadow DOM, a third-party checkout), persistent non-Evan profile under a gitignored path; reachability, bot walls, prompts, strict-CSP badge frame, storage quota; prototype reader steps 1–3. Docs in parallel: single-purpose statement and privacy memo in `docs/release/`, event dictionary draft | `docs/evals/merchant-probe-2026-10.md`; go/no-go; proposed Y |
| 2 | **Protocols and capture:** `docs/evals/generic-reader-protocol.md` (splits, states, labeling and adjudication, bounds, peek policy, capture posture) and the merchant-pipeline protocol (held-out domains and adjudicated profiles frozen); capture tool with recipes; all three splits captured | Reviewer subagent signs both protocols before any tuning or drafting; capture tool refuses sign-in and field input by test |
| 3 | **Any-merchant popup and engine:** engine takes a passed-in profile and returns ranges (`packages/rewards-core`, `engine-shared.ts`), generic profile, popup merchant search and tab prefill (`extension/src/checkout/merchants.ts`, popup), bundled `processor` seed | Engine tests for generic profiles and ranges; `rewards-v3` golden ladders unchanged; axe on the new screens |
| 4 | **Generic reader v1**, tuned on development only; the 3 adapters become bundled seed store configs; manifest host list pinned (`e2e/hosts.ts`) | `docs/evals/generic-reader-v1.md` with bounds; criterion 1 |
| 5 | **Merchant database:** schema (Zod/SQL parity, 2 MiB, regex lint), migration (`npm run supabase -- migration new merchant_releases`), `GET /v1/merchants` with `ETag` and in-memory cache, CLI publish in `tools/catalog-pipeline`, extension download, suffix match, weekly `alarms` refresh, `disabled`, degradation; seeded with the 3 legacy merchants and probe/capture domains at the default category only | Parity, API, worker and kill-switch tests; cold-start test; a published merchant release |
| 6 | **Release A** (Evan submits): click-to-use at any U.S. checkout; hosted build with weekly catalog and merchant refresh (`alarms`, no new warnings); the 3-site automatic badge per D13; no telemetry; policy, single purpose, permission justifications and privacy review reconciled; Phase 5 prerequisites (publisher, support email, order-URL checks) done | Package check, `test:browser`; reviewer subagent confirms policy, listing and build agree |
| 7 | **Telemetry:** consent screen, events and per-click "Suggest this store" / "Report a problem", ingest RPC, retention, reviewer dashboard, stop switch; policy, listing, site, support and runbook updated | Prominent-disclosure check against the User Data FAQ by a reviewer subagent; threat-model review of the ingest path; contract, retention and axe tests |
| 8 | **Optional automatic badge** (`https://*/*` optional, URL-gated injection, site-access handling) → **Release B** with telemetry | `test:browser`, no new required hosts, CPU budget test |
| 9 | **Merchant pipeline (LLM, measured):** list from license-safe sources (D6); profiles and category evidence drafted by gpt-5.6-luna `xhigh` via Codex, verified and adjudicated by Claude Code subagents; store configs where the reader fails; skill `expand-merchants`; growth from "Suggest this store" toward 1,000 domains | `docs/evals/merchant-pipeline-v1.md` against the frozen held-out set; merchant releases on Evan's approval |
| 10 | **Operate:** monthly replays for store-config domains and the top 100; reader v2 from development data; dashboard review | Drift report; versioned reader results |

**Sizing:** v4 estimated 8–11 weeks of sessions; reviewers expect about double for one developer with agents. **Stop rule:** if fewer than half the probe sites show a logged-out cart, Evan re-decides scope before milestone 2; if reader v1 fails criterion 1 on both A and B, before milestone 6.

## Decisions for Evan (one word each)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Telemetry is **off until the shopper agrees** on a dedicated screen; the opportunity event waits for the affiliate phase | Approve |
| D2 | Merchant data as a **separate, versioned merchant release**; the coordinator publishes it on your chat "publish merchants <version>"; store configs fall back to bundled if Web Store review objects | Approve |
| D3 | All-sites access **optional**, asked on a click (not required at install) | Optional |
| D4 | **Real-page capture:** one known item in a logged-out cart on ~150–200 top sites, non-Evan profile, no CAPTCHAs, monthly replays for a subset | Approve |
| D5 | **Category evidence:** issuer statements and business-type inference with ranges; the paid Mastercard API only later, by a new directive | Approve |
| D6 | **Merchant list:** Tranco or Chrome UX Report ∩ agent-classified retail, with attribution; NRF Top 100 cross-check; no paid rankings | Approve |
| D7 | **MVP size:** 3 legacy merchants plus ~250–300 domains at the default category; bonus-category profiles from the measured pipeline; 1,000 after launch | Approve |
| D8 | **Release A inside Phase 10**, with weekly background refresh of catalog and merchant data (new disclosed network behaviour) | Approve |
| D9 | **Licensing:** (a) MIT for everything; (b) MIT for code, future merchant data, eval labels and snapshots proprietary (files already published stay MIT) | a / b |
| D10 | **LLM role:** merchant profiles and category evidence drafted by gpt-5.6-luna and measured | Approve |
| D11 | **No automatic browsing data:** events never carry domains or merchants; the growth list comes from "Suggest this store" and "Report a problem" clicks | Approve |
| D12 | **Affiliate hard rule:** never touch retailer affiliate links or cookies; offers only as labelled, user-initiated links in the extension | Approve |
| D13 | **Release A keeps the automatic badge on Amazon, Best Buy and Newegg** (required hosts unchanged) until Release B | Keep / drop |
| D14 | **Hosting:** stay on Render and Supabase free tiers until a usage trigger (weekly installs or egress) you set | Approve, with the trigger |

Later options, not decisions now: licensing the catalog as an API to fintechs; bank linking for real category data; accounts.

## Related

* [Merchant coverage design](../system/merchant-coverage-design.md)
* [Telemetry design](../system/telemetry-design.md)
* [Roadmap](roadmap.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
