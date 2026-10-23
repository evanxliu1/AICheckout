---
type: Product
title: Merchant coverage plan (Phases 10–17)
description: Plan v6.1 split into Phases 10–17, each with its own exit check and the decisions it needs — recommend a card at any U.S. online checkout with a hosted merchant database matched on the device and a deterministic generic cart reader measured on real top-merchant pages; the automatic badge at any https store (Phase 13c); Release A with a minimal consented telemetry set (replacing Phase 5); a measured LLM merchant pipeline; Release B with value metrics and a data room.
status: stable
tags: [product, plan, phase-10, phase-11, phase-12, phase-13, phase-14, phase-15, phase-16, phase-17, merchants, telemetry]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
sources:
  - resource: ../archive/merchant-coverage-design.md
    title: Merchant coverage design
  - resource: ../system/telemetry-design.md
    title: Telemetry, operations and value metrics design
  - resource: ../archive/phase2-goal.md
    title: Archived Phase 2–6 plan (Phase 6 site coverage harness)
---

# Merchant coverage plan (Phases 10–17)

**Split into Phases 10–17 by Evan on 2026-10-05** ([decision](../decisions/2026-10-05-merchant-coverage-phases.md)): each phase is small, ships on its own, has its own exit check and asks only the decisions it needs; Phases 10 and 11 run in parallel. D4 and D6 are approved; the other decisions are asked when their phase starts. Plan v6.1 came out of four agent-verified review rounds by Fable 5.1 and Opus 5.5 (history in the [decision](../decisions/2026-10-05-merchant-coverage-phases.md) and [log](../log.md)). Design: [merchant coverage](../archive/merchant-coverage-design.md); [telemetry, operations and value metrics](../system/telemetry-design.md).

**Later decisions folded into this page.** Capture paused at a frozen set of 337 stores and the ≥ 99% bar made a quality target ([decision](../decisions/2026-10-08-pause-capture-quality-target.md)); one labeller per store ([decision](../decisions/2026-10-08-single-labeller.md)); Phase 13 without an isolation audit ([decision](../decisions/2026-10-08-phase-13-simplified.md)); the badge on every https site, never asking for a typed amount ([all sites](../decisions/2026-10-09-badge-on-all-sites.md), [no typing](../decisions/2026-10-09-never-ask-for-an-amount.md)); about 500 stores with evidence-gated categories ([decision](../decisions/2026-10-10-merchant-database-evidence.md), [plan](phase-14-merchant-database.md)); minimal consented telemetry in Release A ([decision](../decisions/2026-10-10-data-collection.md)); legacy adapters retired ([decision](../decisions/2026-10-19-retire-legacy-adapters.md)).

## Goal

A shopper gets a correct card recommendation at **any U.S. online checkout**: the store recognized from a reviewed merchant database or treated as a generic U.S. online store, the cart amount read automatically where the reader is certain and otherwise withheld (the recommendation then shows rates; nothing prompts for an amount), and a store without strong category evidence ranked at the general rate, never a range. The product can **prove its value with data** without collecting browsing activity, and is ready for affiliate card offers later. The LLM keeps a measured job: drafting merchant profiles and category evidence, evaluated like the card extraction.

**Scope of the extractor (Evan, 2026-10-05).** The generic cart reader is global: it must return the cart total **and its currency** on storefronts worldwide, and its Phase 12 evaluation includes non-U.S. stores ([decision](../decisions/2026-10-05-global-reader-protocol-2.md)). Recommendations stay U.S.: the Phase 11 generic profile ("Another U.S. online store") and the engine rank cards for U.S. stores in USD. Card recommendations for non-USD purchases (currency conversion, foreign transaction fees, non-U.S. category coding) are a later phase, after Phase 17 (listed under the decisions table).

## Success criteria

Criterion 1 is a quality target, not a pass gate ([decision](../decisions/2026-10-08-pause-capture-quality-target.md)); its method is the Phase 12 [protocol](../../docs/evals/generic-reader-protocol.md). X and Z are set after 4 weeks of Release B data and reported with n.

1. **Reader on real pages** ([decision](../decisions/2026-10-06-reader-shows-only-certain-amounts.md)): the reader shows an amount only when certain and otherwise withholds (no confirmation prompt; generic reader only, no per-store settings). Target: as accurate as possible on shown amounts (aim ≥ 99% correct; a wrong currency counts as wrong), measured on held-out A (U.S. and non-U.S. reported apart) and reported with exact one-sided 95% upper bounds at page-state and store level and the store count; coverage reported per stream and state (target 80% on `cart-1`); p95 reading time ≤ 50 ms.
2. **Category correctness:** a bonus category applies only on issuer or corroborated evidence; otherwise the store gets the general rate; Phase 14 reports the precision of applied bonus categories.
3. **Coverage (field):** ≥ X% of recommendations at named profiles.
4. **Merchant pipeline (LLM):** drafted profiles and category evidence measured against the adjudicated held-out profiles of the domains frozen in Phase 12 (profiles adjudicated at the start of Phase 16).
5. **Field quality:** rate of reported wrong amounts ≤ Z%.
6. **Compliance:** listing, consent screen, privacy policy and event dictionary agree before any release that sends events.
7. **Value pack:** the [value metrics and data room](../system/telemetry-design.md#value-metrics-what-a-buyer-or-partner-asks-for) exist and are current.

Each phase closes on its own exit check (below). Criteria 1, 2, 4, 6 and 7 are reported or met inside Phases 13–17; 3 and 5 are field metrics reported by the operating runbook after 4 weeks of Release B data and do not hold any phase open.

## Decisions taken (Evan, 2026-10-05)

- Future affiliate card offers and aggregate internal analytics are wanted; user data is never sold.
- Collect all proposed event groups. The reviewers found two limits Evan confirms in D1 and D11: consent must be an affirmative opt-in, and Chrome's Limited Use forbids automatic browsing data (domains, merchants), so those travel only on a shopper's click; the opportunity event waits for the affiliate phase.
- Account-free until after the MVP. Affiliate offers are a later phase.

## Rules kept and rules superseded

Kept: no model at checkout; every catalog and merchant release human-approved; never sign in, create accounts, type secrets, fill or submit fields, place orders, bypass bot walls or touch CAPTCHAs on retailer sites (such stores are skipped and reported; a store the browser pane is already signed in to is captured under guards); captures gitignored, quotes ≤ 25 words; subscription CLIs only, curation and drafting on gpt-5.6-luna `xhigh`; eval integrity; Web Store submission is Evan's.

Superseded on approval (each gets a decision record and a directive row):

| Earlier statement | Becomes |
| --- | --- |
| Site adapters bundled in the extension (2026-09-29) | No store configs anywhere: the generic reader alone; the three legacy adapters were retired in Phase 15.1 on 2026-10-20 ([decision](../decisions/2026-10-19-retire-legacy-adapters.md)) |
| Zero-click badge through required host permissions (2026-10-01), "local-first" | The automatic badge on every https site, `https://*/*` required at install (Phase 13c); local-first except consented telemetry |
| Phase order 9 → 10 → Web Store release (2026-10-03) | Phases 10–17 (2026-10-05); Release A is Phase 15 and replaces Phase 5 (D8); Release B closes Phase 17 |
| Catalogs only are published by the coordinator on chat approval (2026-10-05) | Also merchant releases, on "publish merchants <version>" |
| Privacy policy and listing: no analytics; runs on no other site; fetches only on click | Consented telemetry; the content script runs on every https page and shows the badge only where the detector recognises a cart or checkout; weekly background refresh of catalog and merchant database |
| `goal.md`: nothing leaves the device; few users expected; non-goal "broad scraping" | Nothing leaves without consent; real users and value metrics are goals; bounded capture of cart pages for evaluation is not scraping |
| `docs/release/privacy-review.md`: no analytics added to elaborate the policy | Analytics added for product operation at the owner's direction (2026-10-05) |
| Roadmap Phase 6 (site coverage harness) | Folded into Phases 12, 13 and 16 and the operating runbook, and closed |

## Phases

Each phase is one or more branches (`phaseN-<slug>`, one PR per branch) from the latest `main`; an independent reviewer subagent and CI before the coordinator merges; hosted migrations by the coordinator under the standing authorization. When a phase starts it gets a short plan page (like the [Phase 9 plan](phase-9-freshness.md)) and asks Evan the decisions it needs. Each phase updates the wiki pages it touches. "Was" is the milestone number in v6.1.

| Phase | Delivers | Was | Needs | Exit check |
| --- | --- | --- | --- | --- |
| **10 Feasibility probe** ([plan](phase-10-feasibility-probe.md)) | No product code: 25 sites from the D6 source, stratified by rank band and platform (shadow DOM, a third-party checkout), persistent non-Evan profile under a gitignored path; reachability, logged-out carts, bot walls, prompts, strict-CSP badge frame, storage quota; prototype reader steps 1–3 | M1 | D4, D6 (approved) | `docs/evals/merchant-probe-2026-10.md`; go/no-go; proposed Y |
| **11 Any store, typed amount** ([plan](phase-11-any-store.md)) | At any U.S. online store the popup recommends a card instead of "unsupported": the engine supplies a generic profile (as built: `merchantProfilesV3` in `packages/rewards-core/src/engine-v3.ts` appends `GENERIC_MERCHANT_PROFILE`; a passed-in profile from the merchant database is Phase 14), a generic profile "Another U.S. online store" (`general-merchandise`, online retail) chosen from the tab's URL, amount typed by the shopper; the 3 supported stores unchanged. No store search and no category ranges (Evan, 2026-10-05): the generic profile always uses the general rate; category ranges and D5 move to Phase 14 | M3 (reduced) | — | Engine tests for the generic profile; `rewards-v3` golden ladders unchanged; axe on the changed popup screens |
| **12 Eval protocols and captures** ([plan](phase-12-reader-eval.md)) | `docs/evals/generic-reader-protocol.md` (worldwide frame, splits, states, labelling, bounds, peek policy, capture posture) and the merchant-pipeline held-out domain list frozen (the adjudicated held-out profiles and the rest of that protocol move to the start of Phase 16, which needs D5); capture tool with recipes; the frozen set of 337 stores (332 pane + 5 robot) split 60/40 into development and held-out A (`.10`), one labeller per store, labels frozen | M2 | Phase 10 go | Reviewer subagent signs the reader protocol before any capture; capture tool refuses sign-in and field input by test; pane capture by `pane-operator` subagents with an operator checklist, a transcript audit and per-store records, paused on 2026-10-08 at the frozen set |
| **13 Generic reader v1** | Returns total and currency on storefronts worldwide (Evan, 2026-10-05); the extension still recommends only for U.S. stores in USD. Shows an amount only when certain, otherwise withholds (no `ask`). Generic rules only, no store-specific code; tuned from development pages, held-out A run by the coordinator ([decision](../decisions/2026-10-08-phase-13-simplified.md)); the 3 legacy adapters were scored apart and retired in Phase 15.1; host permissions per Phase 13c (`https://*/*`) | M4 | — | `docs/evals/generic-reader-v1.md` with bounds; criterion 1 reported |
| **14 Merchant database** | Profiles, categories, `processor` and `disabled` only (no store configs). Schema (Zod/SQL parity, 2 MiB), migration (`npm run supabase -- migration new merchant_releases`), `GET /v1/merchants` with `ETag` and in-memory cache, CLI publish in `tools/catalog-pipeline`, extension download, suffix match, weekly `alarms` refresh, `disabled`, degradation; **before Release A**, every catalog brand with a website gets its domains so brand rules, exclusions and closed-loop cards apply there. Detail (about 500 stores, evidence-gated categories, a seed pipeline) in the [Phase 14 plan](phase-14-merchant-database.md), which wins where they differ | M5 | D2, D5, D7, D9 | Parity, API, worker and kill-switch tests; cold-start test; a published merchant release |
| **15 Release A** (Evan submits; replaces Phase 5) | ([plan](phase-15-release-a.md)) The automatic badge at any https store (Phase 13c); hosted build with weekly catalog and merchant refresh (`alarms`, no new warnings); a minimal consented telemetry set (one onboarding opt-in, Stop sharing and Delete my data); legacy adapters, order detection and savings removed; single-purpose statement, policy, permission justifications and privacy review reconciled; Phase 5 prerequisites (publisher name and verification, support email per `docs/release/README.md`) | M6 | D8, D13, D14 | Package check, `test:browser`; reviewer subagent confirms policy, listing and build agree |
| **16 Merchant pipeline (LLM, measured)** | List from license-safe sources (D6); profiles and category evidence drafted by gpt-5.6-luna `xhigh` via Codex, verified and adjudicated by Claude Code subagents; no store configs; skill `expand-merchants`; growth toward 1,000 domains (from "Suggest this store" once Phase 17 ships) | M9 | D10; Phases 12 and 14 | `docs/evals/merchant-pipeline-v1.md` against the frozen held-out set; merchant releases on Evan's approval |
| **17 Telemetry and Release B** | Reviewer dashboard, value metrics and affiliate readiness (the consent screen, minimal events, ingest and settings controls ship in Release A; the automatic badge in Phase 13c); per-click "Suggest this store" / "Report a problem" → Release B; policy, listing, site, support and runbook updated. May split into two phases when it starts | M7, M8 | D1, D3, D11, D12 | Prominent-disclosure check against the User Data FAQ by a reviewer subagent; threat-model review of the ingest path; contract, retention and axe tests; `test:browser`, no new required hosts, CPU budget test |

**Order:** 10 ∥ 11 → 12 → 13 (13b, 13c) → 14 → 15; 16 may run beside 15 once 12 and 14 are merged; 17 after 15. **Operating** (was M10) is a runbook, not a phase: monthly replays for the top 100 stores, reader v2 from development data, dashboard review, and the field criteria 3 and 5.

**Sizing:** v4 estimated 8–11 weeks of sessions; reviewers expect about double for one developer with agents. **Stop rule:** if fewer than half the probe sites show a logged-out cart, Evan re-decides scope before Phase 12.

## Decisions for Evan (one word each, asked when their phase starts)

| # | Decision | Recommendation | Needed by | Status |
| --- | --- | --- | --- | --- |
| D1 | Telemetry is **off until the shopper agrees** on a dedicated screen; the opportunity event waits for the affiliate phase | Approve | Phase 15 | **Approved 2026-10-10** as one opt-in question at onboarding covering every metric ([decision](../decisions/2026-10-10-data-collection.md)) |
| D2 | Merchant data as a **separate, versioned merchant release**; the coordinator publishes it on your chat "publish merchants <version>"; it carries profiles, categories, `processor` and `disabled` only (no store configs) | Approve | Phase 14 | **Approved 2026-10-10** ([decision](../decisions/2026-10-10-audit-calls.md)) |
| D3 | All-sites access **optional**, asked on a click (not required at install) | Optional | Phase 17 | **Superseded 2026-10-09**: all `https` sites required at install for the badge (Phase 13c, [decision](../decisions/2026-10-09-badge-on-all-sites.md)) |
| D4 | **Real-page capture:** one known item in a logged-out cart on ~150–200 top sites, non-Evan profile, no CAPTCHAs, monthly replays for a subset | Approve | Phase 10 | Approved 2026-10-05; agent-driven in the browser pane, signed-in stores captured under guards, robots.txt recorded only (never excludes), CAPTCHAs never touched; paused on 2026-10-08 at the frozen 337-store set, split 60/40 ([decision](../decisions/2026-10-08-pause-capture-quality-target.md)) |
| D5 | **Category evidence:** issuer statements and business-type inference with ranges; the paid Mastercard API only later, by a new directive | Approve | Phase 14 | **Superseded 2026-10-10**: no ranges; a bonus category only on issuer evidence or two agreeing public sources, otherwise the general rate; public sources only ([decision](../decisions/2026-10-10-merchant-database-evidence.md)) |
| D6 | **Merchant list:** Tranco or Chrome UX Report ∩ agent-classified retail, with attribution; NRF Top 100 cross-check; no paid rankings | Approve | Phase 10 | Approved 2026-10-05 |
| D7 | **MVP size:** 3 legacy merchants plus ~250–300 domains at the default category; bonus-category profiles from the measured pipeline; 1,000 after launch | Approve | Phase 14 | Size answered 2026-10-10: about 500 stores in the first release ([decision](../decisions/2026-10-10-merchant-database-evidence.md)) |
| D8 | **Release A as Phase 15**, with weekly background refresh of catalog and merchant data (new disclosed network behaviour) | Approve | Phase 15 | **Approved 2026-10-10** (weekly background refresh; Release A also carries minimal telemetry) ([decision](../decisions/2026-10-10-audit-calls.md)) |
| D9 | **Licensing:** (a) MIT for everything; (b) MIT for code, future merchant data, eval labels and snapshots proprietary (files already published stay MIT) | a / b | Phase 14 | **(a) for now, 2026-10-10** (Evan: "can stay open source for now (not a set decision, can always change)") |
| D10 | **LLM role:** merchant profiles and category evidence drafted by gpt-5.6-luna and measured | Approve | Phase 16 | Open |
| D11 | **No automatic browsing data:** events never carry domains or merchants; the growth list comes from "Suggest this store" and "Report a problem" clicks | Approve | Phase 17 | **Approved 2026-10-10**: no automatic domains; domains only on a shopper's tap ([decision](../decisions/2026-10-10-data-collection.md)) |
| D12 | **Affiliate hard rule:** never touch retailer affiliate links or cookies; offers only as labelled, user-initiated links in the extension | Approve | Phase 17 | Open |
| D13 | **Release A keeps the automatic badge on Amazon, Best Buy and Newegg** (required hosts unchanged) until Release B | Keep / drop | Phase 15 | **Superseded 2026-10-09**: the badge runs at any https store (Phase 13c) |
| D14 | **Hosting:** stay on Render and Supabase free tiers until a usage trigger (weekly installs or egress) you set | Approve, with the trigger | Phase 15 | Open |

Later options, not decisions now: licensing the catalog as an API to fintechs; bank linking for real category data; accounts.

**Later phase (Evan, 2026-10-05): card recommendations for non-USD purchases.** Uses the global reader's currency: currency conversion, foreign transaction fees per card, non-U.S. category coding, and its own merchant-pipeline held-out list drawn from `retail-frame.2`. Not scheduled; after Phase 17. Bot-walled sites stay a reported gap: pane capture never solves or touches a CAPTCHA or bot check.

## Related

* [Merchant coverage design](../archive/merchant-coverage-design.md)
* [Telemetry design](../system/telemetry-design.md)
* [Roadmap](roadmap.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
