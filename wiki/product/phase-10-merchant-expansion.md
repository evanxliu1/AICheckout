---
type: Product
title: Phase 10 plan (merchant coverage, draft v4)
description: Draft v4 awaiting review cycles and Evan's approval — make the extension work at any U.S. online checkout the way mainstream shopping extensions do (hosted merchant database matched on the device, a deterministic generic cart reader proven on real top-merchant checkout pages, per-store configs as data), add consented telemetry and affiliate-ready metrics, and make the product's value demonstrable to a buyer.
status: draft
tags: [product, plan, phase-10, merchants, telemetry]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T08:00:00Z
sources:
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design
  - resource: ../archive/phase2-goal.md
    title: Archived Phase 2–6 plan (Phase 6 site coverage harness)
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (pattern to reuse)
---

# Phase 10 plan: merchant coverage (draft v4)

**Draft, not approved.** Evan approves this plan before any Phase 10 work starts; nothing here authorizes a branch, a capture run or a model run. History: v1–v3 (2026-10-05) planned bundled per-site adapters for 10, then 100–500, merchants; v4 follows Evan's direction of 2026-10-05 to work at any merchant the way official products do, with telemetry and future affiliate offers. Design detail: [merchant coverage design](../system/merchant-coverage-design.md).

## Goal

A shopper with the extension gets a correct card recommendation at **any U.S. online checkout**, with the cart amount read automatically wherever the page allows it and a one-tap correction otherwise, and the product can **prove its value with data**: who uses it, where, how accurately, and how much reward it surfaces.

Success criteria (measured, not asserted):

1. **Coverage:** the extension identifies the store at ≥ 95% of checkouts it sees (named profile or the generic profile), from telemetry.
2. **Reader accuracy on real pages:** on a held-out set of real checkout pages from the top merchants, false-found rate 0 (upper 95% bound reported) and found-correct rate reported by state and platform.
3. **Merchant database:** the top 1,000 U.S. online retail domains profiled, each with evidence class and source, published through a reviewed release.
4. **Telemetry live** with consent, retention and a dashboard; privacy policy and Web Store disclosures match the implementation.
5. **Value pack:** the metrics, evals and provenance listed under [Showing the value](#showing-the-value) exist and are current.

## Decisions taken (Evan, 2026-10-05)

- Future affiliate card offers and aggregate internal analytics are wanted; user data is never sold (Chrome Limited Use forbids it anyway).
- Telemetry: collect all proposed event groups, under one consent screen in onboarding (coordinator's reading of "all"; Evan confirms in D1).
- Account-free until after the MVP; optional accounts later.
- Affiliate offers are a later phase; Phase 10 builds the metrics they need.

## How an official product does it, and what we copy

Honey, Capital One Shopping and Rakuten keep a **server-side list of supported stores with per-store configuration**, run with all-sites permission, and collect broad browsing and purchase data for commissions and ads. Kudos, a card recommender, recognizes known checkouts, matches cards to merchant categories, and learns real category codes from opt-in bank linking. We copy the architecture (hosted merchant database, configs as data, generic detection, metrics) and not the data appetite: lookup on the device, domain-level checkout events only, no browsing history, no cart contents ([design](../system/merchant-coverage-design.md#how-mainstream-extensions-do-it-researched-2026-10-05)).

## Constraints and the directives this changes

Kept: no model at checkout (the reader is deterministic code; store configs are data); a human approves every catalog and merchant release; never sign in, create accounts, type secrets, enter addresses or payment details, or place orders on retailer sites; captures gitignored, quotes of 25 words or fewer; subscription CLIs only; eval integrity (held-out sites frozen, never tuned on); Web Store submission is Evan's.

Superseded on approval (each gets a decision record and a directive row):

| Earlier rule | Becomes |
| --- | --- |
| Site adapters bundled in the extension (2026-09-29) | Store configs are reviewed data in a hosted merchant database; the reader code stays bundled |
| Zero-click badge on supported sites through required host permissions (2026-10-01) | Click-to-use on every site; automatic badge on any checkout after the shopper grants optional all-sites access |
| Local-first, "no analytics" (privacy policy draft, Web Store materials) | Consented telemetry as specified; still no sale, no ads, no browsing history |

## Milestones

One branch and PR each from the latest `main`; an independent reviewer subagent and CI before the coordinator merges; hosted migrations by the coordinator under the standing authorization.

| # | Milestone | Verify |
| --- | --- | --- |
| 0 | **Approval:** Evan answers D1–D8; directive rows and decision records written | Plan and design `status: stable` |
| 1 | **Feasibility probe** (no product code): 25 top sites stratified by rank band and platform in a fresh logged-out Playwright profile: cart reachable, bot wall, prompts, platform, summary structure; a throwaway prototype of reader steps 1–3 run on the snapshots | `docs/evals/merchant-probe-2026-10.md`; go/no-go and targets confirmed |
| 2 | **Eval protocol and capture tool:** pre-registered protocol (sites, split, states, ground truth, metrics); capture tool with recipes; capture the development and held-out sets | Protocol signed off by a reviewer subagent before any reader tuning; capture tool refuses sign-in, checkout and form fields by test |
| 3 | **Generic reader v1** in the extension, tuned on development pages only; the 3 current adapters become store configs | Held-out results published (`docs/evals/generic-reader-v1.md`); false-found 0 on held-out or the milestone does not merge |
| 4 | **Merchant database service:** schema (Zod + SQL parity), migration, `GET /v1/merchants`, review and publish (CLI `pipeline publish` pattern), expiry | Parity cases, API tests, a published release with the 3 current merchants |
| 5 | **Extension uses the database:** download and cache, domain lookup, generic profile, popup merchant search and prefill from the tab, store-config `disabled` as kill switch | Popup and worker tests, Playwright on fixtures, kill switch test |
| 6 | **Optional all-sites badge:** grant UX, badge on detected checkouts on any site | `test:browser`, package check, install prompt unchanged (no new required hosts) |
| 7 | **Telemetry:** consent screen, event batching, `POST /v1/events`, tables with 90-day raw retention and aggregates, IP dropped, dashboard in the review app; privacy policy, store listing and site rewritten | Contract tests, retention job test, privacy review subagent checks code vs policy line by line |
| 8 | **Merchant pipeline:** list (license-safe popularity data ∩ retail classification, Evan approves rows), profiles with category evidence, brand links, store configs where the reader fails; top 1,000 domains | Pipeline tests; agent-verified profiles; merchant release published on Evan's approval |
| 9 | **MVP release:** extension build with all of the above; Web Store submission by Evan | Package check, `test:browser`, listing disclosures match telemetry |
| 10 | **Operate:** monthly drift replays, reader v2 from field data (dev split only), dashboard review | Drift report; reader results versioned |

Sizing (estimate; the probe and milestone 3 replace it): probe 2–3 days; capture of 150–200 sites × states 1–2 weeks of sessions; reader v1 1 week; database service and extension 1–2 weeks; telemetry 1 week; pipeline to 1,000 domains 2–3 weeks. **Stop rule:** if fewer than half the probe sites show a logged-out cart, or reader v1 cannot reach false-found 0 on held-out, Evan re-decides scope before milestone 5.

## Showing the value

What a buyer or partner would ask for, and where it comes from:

| Evidence | Source |
| --- | --- |
| Users: installs, weekly and monthly actives, retention cohorts | Telemetry dashboard (milestone 7) |
| Engagement: checkouts seen, recommendations shown, badge interactions | Telemetry |
| Coverage: share of checkouts with a named profile; domains seen without one (the growth list) | Telemetry + merchant database |
| Quality: reader false-found and found-correct on held-out real pages; field correction rate | `docs/evals/generic-reader-v1.md`, telemetry |
| Opportunity: how often a better card than the shopper's exists, by category, in rate buckets (the affiliate market size) | Telemetry opportunity events |
| Data assets: card catalog (178+ cards, measured extraction accuracy), merchant database (1,000+ profiled domains with evidence), real-page eval sets | Repository, `docs/evals/` |
| Clean provenance: license-safe sources, no copyrighted captures committed, every release human-approved with a recorded note | Wiki, release history |
| Compliance: Chrome Limited Use, affiliate policy readiness, CCPA notice | Privacy policy, decision records |
| Operations: runbooks, freshness and drift jobs, kill switch | Wiki ops pages |

## Decisions for Evan

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Telemetry consent | (a) one onboarding consent for all groups, default on; (b) default off until accepted; (c) basic usage on by default, the rest opt-in | Confirm the coordinator's reading of "all" |
| D2 | Merchant database hosting and review | (a) separate versioned merchant release, reviewed and published like the catalog; (b) inside the card catalog | (a) |
| D3 | All-sites permission | (a) optional, requested on a click (no install warning); (b) required at install like Honey | (a) |
| D4 | Real-page capture | Adding one known item to a logged-out anonymous cart on ~150–200 top sites in a fresh browser profile, monthly replays | Approve |
| D5 | Category evidence | (a) issuer statements + business-type inference, ranges where uncertain; (b) also pursue the Mastercard merchant lookup API (keys, terms) | (a) now, (b) evaluated later |
| D6 | Merchant list source | License-safe popularity lists (Tranco or Chrome UX Report) ∩ retail classification, Evan approves rows; NRF Top 100 as a cross-check | Approve |
| D7 | Database size at MVP | Top 1,000 domains; growth from telemetry's "seen without a profile" list | Approve |
| D8 | Web Store timing | MVP release after milestone 9, or an earlier listing with the 3 merchants | After milestone 9 |

## Related

* [Merchant coverage design](../system/merchant-coverage-design.md)
* [Roadmap](roadmap.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
* [Cart badge](../system/cart-badge.md)
