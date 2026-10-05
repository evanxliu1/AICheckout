---
type: Product
title: Phase 10 plan (merchant coverage, draft v5)
description: Draft v5 after two Fable 5.1 reviews, awaiting Evan's decisions — recommend a card at any U.S. online checkout with a hosted merchant database matched on the device and a deterministic generic cart reader proven on real top-merchant pages; an early click-to-use Web Store release, then consented telemetry and the optional automatic badge; an LLM-drafted, measured merchant pipeline; value metrics and a data room for a buyer or partner.
status: draft
tags: [product, plan, phase-10, merchants, telemetry]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T09:00:00Z
sources:
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design
  - resource: ../system/telemetry-design.md
    title: Telemetry and value metrics design
  - resource: ../archive/phase2-goal.md
    title: Archived Phase 2–6 plan (Phase 6 site coverage harness)
---

# Phase 10 plan: merchant coverage (draft v5)

**Draft, not approved.** Evan approves this plan and answers D1–D12 before any Phase 10 work starts. History (all 2026-10-05): v1–v3 planned bundled per-site adapters for 10, then 100–500, merchants; v4 followed Evan's direction to work at any merchant like official products, with telemetry and future affiliate offers; **v5** folds in two independent Fable 5.1 reviews (technical, and product/business; agent-verified). Design: [merchant coverage](../system/merchant-coverage-design.md), [telemetry and value metrics](../system/telemetry-design.md).

## Goal

A shopper gets a correct card recommendation at **any U.S. online checkout**: the store recognized from a reviewed merchant database (or treated as a generic U.S. online store), the cart amount read automatically where the page allows it and confirmed or typed otherwise, and uncertain categories shown as ranges. The product can **prove its value with data** (users, retention, coverage, accuracy) and is ready for affiliate card offers later. The LLM keeps a measured job: drafting merchant profiles and category evidence through the pipeline pattern, evaluated like the card extraction.

## Success criteria (thresholds X/Y/Z set from the probe before milestone 4)

1. **Reader on real pages:** on held-out A, 0 false-found results, with the 95% upper bound reported at the page-state and the site level; found-correct ≥ Y% on the one-item state; p95 reading time under budget.
2. **Category correctness:** every profiled domain whose plausible category is a catalog bonus category has evidence class 1–3, or its recommendation is shown as a range; share of recommendations shown as ranges is tracked.
3. **Coverage (field):** ≥ X% of detected checkouts match a **named** profile (the generic profile alone would make any "recognized" metric 100% by construction).
4. **Merchant pipeline (LLM):** drafted profiles and category evidence measured against adjudicated held-out profiles; results published like the card evals.
5. **Field quality:** amount correction rate ≤ Z% once telemetry is live.
6. **Compliance:** store listing, consent screen, privacy policy and event dictionary agree (merge gate before any release that sends events).
7. **Value pack:** the metrics and data room in the [telemetry design](../system/telemetry-design.md#value-metrics-what-a-buyer-or-partner-asks-for) exist and are current.

## Decisions taken (Evan, 2026-10-05)

- Future affiliate card offers and aggregate internal analytics are wanted; user data is never sold.
- Collect all proposed event groups (D1 settles how consent works).
- Account-free until after the MVP.
- Affiliate offers are a later phase; Phase 10 prepares the metrics.

## What we copy from official products, and what we do not

Copied: a hosted store database with per-store configs as data, generic checkout detection, metrics. Not copied: all-sites data collection, browsing history, per-domain server lookups, bank linking, card-linked offers, retailer affiliate cookies. Details and sources: [design](../system/merchant-coverage-design.md#how-mainstream-products-do-it-researched-2026-10-05).

## Rules kept and rules superseded

Kept: no model at checkout; every catalog and merchant release human-approved; never sign in, create accounts, type secrets, enter addresses or payment details, place orders, bypass bot walls or solve CAPTCHAs on retailer sites; captures gitignored, quotes ≤ 25 words; subscription CLIs only; eval integrity (pre-registered protocol, held-out never tuned on); Web Store submission is Evan's.

Superseded on approval (each gets a decision record and a directive row):

| Earlier statement | Becomes |
| --- | --- |
| Site adapters bundled in the extension (2026-09-29) | Store configs are reviewed data in the hosted merchant database; reader code stays bundled |
| Zero-click badge on supported sites through required host permissions (2026-10-01) | Click-to-use everywhere; automatic badge at checkouts after the shopper grants optional all-sites access |
| Privacy policy draft: "no analytics", "does not run on other websites" | Consented telemetry as designed; injection only on candidate checkout URLs |
| `goal.md`: "nothing leaves the device"; non-goal "broad scraping" | Nothing leaves the device without consent; bounded capture of cart pages for evaluation (one item, logged out, no orders, snapshots gitignored) is not scraping of catalogs or prices |
| `docs/release/privacy-review.md`: no analytics added merely to elaborate the policy | Analytics added for product operation at the owner's direction (2026-10-05), under the telemetry design |

## Milestones

One branch and PR each from the latest `main`; an independent reviewer subagent and CI before the coordinator merges; hosted migrations by the coordinator under the standing authorization.

| # | Milestone | Verify |
| --- | --- | --- |
| 0 | **Approval:** Evan answers D1–D12; directive rows and decision records | Plan and designs `status: stable` |
| 1 | **Feasibility probe** (no product code): 25 sites stratified by rank band and platform (including shadow-DOM storefronts and a third-party checkout) in a persistent non-Evan profile; reachability, bot walls, prompts, CSP on the badge frame, storage quota; prototype reader steps 1–3 on the snapshots. In parallel, docs only: single-purpose statement, event dictionary draft, privacy memo | `docs/evals/merchant-probe-2026-10.md`; thresholds X/Y/Z and the go/no-go set |
| 2 | **Eval protocol and capture:** pre-registered protocol (three site splits, states, labeling by two agents, bounds, peek policy); capture tool with recipes; capture all three splits | Reviewer subagent signs the protocol before any tuning; capture tool refuses sign-in, checkout and form fields by test |
| 3 | **Any-merchant popup:** generic profile, popup merchant search, prefill from the tab domain, `processor` hosts recognized; the shopper can compare at any store by typing the amount | Popup and engine tests; works without the database |
| 4 | **Generic reader v1**, tuned on development only; the 3 current adapters become store configs | `docs/evals/generic-reader-v1.md` with bounds; gate per criterion 1 |
| 5 | **Merchant database service and extension use:** schema with Zod/SQL parity and 2 MiB cap, migration, `GET /v1/merchants`, CLI publish, download and cache, suffix matching, `disabled` kill switch, degradation to generic; seeded with the ~250–300 probe, capture and bonus-category domains | Parity cases, API and worker tests, kill-switch test, a published merchant release |
| 6 | **Release A** (Evan submits): click-to-use at any U.S. checkout, current narrow permissions, no telemetry | Package check, `test:browser`; listing updated |
| 7 | **Telemetry:** consent screen, batching with `alarms`, ingest endpoint, storage and retention, dashboard in the review app; policy, listing and site rewritten | Chrome prominent-disclosure test passed by a reviewer subagent against the User Data FAQ; contract and retention tests |
| 8 | **Optional automatic badge:** `https://*/*` optional grant, URL-gated injection, site-access handling → **Release B** with telemetry | `test:browser`, no new required hosts, CPU budget test |
| 9 | **Merchant pipeline (LLM, measured):** list from license-safe sources, profiles and category evidence drafted and agent-verified, store configs where the reader fails; growth driven by telemetry's growth list toward 1,000 domains | `docs/evals/merchant-pipeline-v1.md`; merchant releases on Evan's approval |
| 10 | **Operate:** replays monthly for store-config domains and the top 100 only, others triggered by telemetry spikes; reader v2 from development data | Drift report; versioned reader results |

**Sizing:** v4 estimated 8–11 weeks of sessions; the reviewers expect roughly double for one developer with agents. Release A is the first point with real users (milestone 6). **Stop rule:** if fewer than half the probe sites show a logged-out cart, or reader v1 cannot pass criterion 1 within its peek policy, Evan re-decides scope before milestone 5.

## Decisions for Evan

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | **Telemetry consent:** off until the shopper agrees on a dedicated screen (Chrome requires an affirmative action for checkout domains), versus default on | Off until agreed; the extension works fully either way |
| D2 | **Merchant database:** a separate, versioned merchant release reviewed and published like the catalog | Approve |
| D3 | **All-sites permission:** optional, requested on a click, versus required at install like Honey | Optional |
| D4 | **Real-page capture:** one known item in a logged-out cart on ~150–200 top sites, persistent non-Evan profile, no CAPTCHAs, monthly replays for a subset | Approve |
| D5 | **Category evidence:** issuer statements and business-type inference with ranges now; Mastercard merchant API evaluated later | Approve |
| D6 | **Merchant list source:** Tranco or Chrome UX Report ∩ agent-classified retail, with attribution; NRF Top 100 cross-check; no paid rankings | Approve |
| D7 | **MVP size:** ~250–300 domains (probe, capture and bonus-category merchants), 1,000 after launch from the growth list | Approve |
| D8 | **Release order:** Release A (click-to-use anywhere, no telemetry) before telemetry and the automatic badge; this moves part of the Web Store release ahead of the rest of Phase 10 | Approve |
| D9 | **Licensing:** the repository is MIT and public, so code is not an exclusive asset; keep MIT, or make future data/components proprietary | Your call; decide before investing in sellability |
| D10 | **Second monetization track:** licensing the curated catalog as an API to fintechs, alongside affiliate offers | Note as a later option |
| D11 | **LLM role in Phase 10:** merchant profiles and category evidence drafted by the pipeline and measured | Approve |
| D12 | **Affiliate hard rule:** never touch retailer affiliate links or cookies; offers only as labelled, user-initiated links in the extension's UI | Approve |

## Related

* [Merchant coverage design](../system/merchant-coverage-design.md)
* [Telemetry design](../system/telemetry-design.md)
* [Roadmap](roadmap.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
