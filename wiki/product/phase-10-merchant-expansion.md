---
type: Product
title: Phase 10 plan (merchant expansion, draft v3)
description: Draft v3 after a Fable 5.1 design review, awaiting Evan's decisions — cover the top 100–500 U.S. online merchants with a generic merchant plus named profiles only where the answer differs, cart-reading adapters for the top ~100 behind optional host permissions, a catalog kill switch, and a measured merchant pipeline; milestones and decisions D1–D10.
status: draft
tags: [product, plan, phase-10, merchants, site-adapters, pipeline]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T07:10:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Archived Phase 2–6 plan (Phase 6 site coverage harness design)
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (the pattern to reuse)
  - resource: ../../extension/src/checkout/adapters/schema.ts
    title: Site adapter schema
  - resource: ../../extension/vite.config.ts
    title: Host permissions generated from adapters
  - resource: ../../evals/curation/expansion/merchants.json
    title: Merchant profiles and brands for catalog v3
  - resource: ../../packages/rewards-core/src/schema.ts
    title: Catalog v3 limits
---

# Phase 10 plan: merchant expansion (draft v3)

**Draft, not approved.** Evan approves this plan and answers D1–D10 before any Phase 10 work starts. Nothing here authorizes a branch, a capture run or a model run. History: v1 (2026-10-05) assumed about 10 merchants; v2 (same day) set Evan's goal of the **top 100–500 U.S. online shopping merchants** with 500 catalog profiles and 100 required host permissions; v3 revises v2 after an independent Fable 5.1 design review (agent-verified; findings summarized under [Review](#review-fable-51-2026-10-05)).

## Goal

Today the extension works at 3 checkouts (Amazon, Best Buy, Newegg). Phase 10 makes it give a correct recommendation at any of the top 100–500 U.S. online merchants, and read the cart automatically at the top ~100 where that is feasible, without breaking the project's rules: no model at checkout, a human approves every release, every claim measured.

A merchant can have three pieces:

| Piece | What it is | Ships in |
| --- | --- | --- |
| **Merchant profile** | U.S. online retailer of physical goods, `expectedCategory`, optional MCC | Catalog release (data) |
| **Brand links** | `brandIds`, so brand-scoped rules and store cards apply | Catalog release |
| **Site adapter** | Declarative JSON for the fixed cart reader | Extension release (bundled) |

## Design

**Coverage without 500 profiles.** The engine tells merchants apart only by `brandIds` and `expectedCategory` ([rewards engine](../system/rewards-engine.md)). In `CATALOG_V3` the rules that differ by merchant are 166 brand-scoped rules and the bonus categories supermarkets 73, drugstores 15, home improvement 11, online retail 11, wholesale clubs 5, electronics 3, department stores 3 (counted 2026-10-05). A store that matches no brand and no bonus category ranks exactly like any other U.S. online store. So:

- A built-in **generic merchant**, "Another U.S. online store" (`general-merchandise`, online, physical goods, U.S., no MCC), covers the long tail.
- **Named profiles** only where the answer differs: merchants that match a catalog brand (store cards, co-brands, store-credit programs) or code to a bonus category. Expected 100–150, near today's limit of 100 merchants; brands and sources stay within limits.
- Marketplaces and digital-goods sellers get named profiles with notes, since "physical goods" may not hold.

**Cart reading for the top ~100, without install warnings.**

- Adapter hosts move to `optional_host_permissions`. The shopper grants a site (or all supported sites in onboarding) once, on a click; the extension then registers the bundled badge script for that host (`chrome.scripting.registerContentScripts`). The badge is zero-click **after that one grant**. Adding hosts on an update disables nothing; required hosts would disable the extension for every user on each wave.
- `activeTab` (already in the manifest) lets the popup, on open, prefill the merchant from the tab's domain for any named merchant, and read the cart on click at any adapter site without a grant.
- Adapters are drafted from per-platform templates (Shopify, Salesforce Commerce Cloud and others) and verified per site; the runtime schema stays flat.

**Safety and maintenance.**

- **Kill switch:** a `disabledAdapters` list in the catalog release (data, published through the same approval) makes the worker refuse a broken adapter's readings without an extension release. Built before the first wave.
- **Savings detection** stays only where Evan verified an order-confirmation path on his own order; new adapters ship without `orderConfirmation` (made nullable).
- **No MCC by default:** a profile carries `mcc: null` unless an issuer or network document states it; provenance for the other fields lives in the batch research files, so profiles add no catalog sources and no monthly freshness load.
- **Drift:** monthly replays of recorded capture recipes, highest rank first; no weekly scraping.

**Capture.** A browser agent explores each site once in a **fresh, logged-out Playwright profile** (never Evan's browser, which holds his sign-ins), adds one in-stock item, opens the cart, and writes a replayable recipe (product URL, add-to-cart step, cart URL, dismissals) plus redacted structure snapshots. The CLI replays recipes for re-capture and drift. Never checkout, sign-in, address or payment fields. Bot walls and sign-in walls leave the merchant profile-only.

**Merchant list.** Defined as: domains in a license-safe popularity list (Tranco or Chrome UX Report top 10k) that an agent classifies as U.S. online retail, each row approved by Evan, committed as domain, rank bucket, source, date, classification and tier target; the public NRF Top 100 Retailers is a cross-check only. Paid rankings (Digital Commerce 360, Similarweb) are not copied.

## Current state (checked against the code 2026-10-05)

| Area | Today |
| --- | --- |
| Site adapters | 3 JSON specs in [`extension/src/checkout/adapters/`](../../extension/src/checkout/adapters); `MERCHANT_IDS` hand-written; one generic reader |
| Permissions | `storage`, `activeTab`, `scripting`; adapter hosts are **required** `host_permissions`, generated in [`vite.config.ts`](../../extension/vite.config.ts) and pinned by the package check |
| Popup | Merchant list = adapter list; default `best-buy-us`; `readActiveCheckout` already uses `activeTab` + `executeScript` |
| Merchant profiles | 3 in [`merchants.json`](../../evals/curation/expansion/merchants.json), 140 brands; every page response carries all merchants (`catalog-slice.ts`) |
| Catalog limits | 100 merchants, 400 brands, 600 sources, 1 MiB; catalog 602,925 bytes |
| Order confirmation | `verified: false` on all 3 adapters; schema requires at least one path |
| Capture | Amazon-only observer (logged out, generic item, no checkout) |
| Phase 6 pieces | Not built: capture tool, `eval:sites`, kill switch, drift detection |

## Constraints

[User directives](user-directives.md) and [`AGENTS.md`](../../AGENTS.md): never sign in, create accounts, type secrets, enter addresses or payment details, or place orders on retailer sites; no model at checkout; adapters bundled; captures gitignored (URLs, hashes, labels, redacted fixtures and quotes of 25 words or fewer committed); subscription CLIs only; never re-capture an eval corpus to fit (held-out fixtures frozen; drift captures are new dated files); catalog releases on Evan's approval; Web Store submission is Evan's. Directives D2, D4 and D5 below amend existing ones and are recorded as such.

## Milestones

One branch and PR each from the latest `main`; an independent reviewer subagent and CI before the coordinator merges.

| # | Milestone | Verify |
| --- | --- | --- |
| 0 | Evan approves and answers D1–D10; directive rows and decision records | Plan `status: stable` |
| 1 | **Feasibility probe** (no product code): 25 sites stratified by rank band and platform in a fresh Playwright profile: logged-out cart reachable, bot wall, zip/store prompts, platform, subtotal structure | `docs/evals/merchant-probe-2026-10.md`; go/no-go and tier-1 target |
| 2 | **Merchant list + generic merchant**: committed list; "Another U.S. online store"; popup merchant search with active-tab prefill; click-to-read at adapter sites; merchant slicing | Popup tests with 200 synthetic profiles; engine golden cases for the generic merchant |
| 3 | **Optional host permissions**: grant UX (per site, onboarding bulk), dynamic badge registration, package check updated | `test:browser`, package spec, install prompt reviewed |
| 4 | **Kill switch** (`disabledAdapters`): schema, migration, Zod/SQL parity, worker refusal | A disabled adapter shows `unavailable` without an extension release |
| 5 | **Capture tool, recipes, adapter gate**; registry from files; nullable `orderConfirmation`; platform templates | Re-captures the 3 merchants; refuses sign-in, checkout and forms by test; gate passes the 3 and rejects mutated adapters |
| 6 | **Eval protocol** pre-registered (`docs/evals/merchant-pipeline-protocol.md`): site split, N, metrics (false-found rate first, pass rate, variant robustness, held-out success), models | Reviewer subagent sign-off before any pilot run |
| 7 | **Merchant pipeline CLI, skill, agents** on a minimal shared core with the card pipeline | Synthetic tests, boundary lint, agent-file tests |
| 8 | **Pilot: 10 merchants**, mixed platforms and bot-wall risk, measured (minutes per merchant included); breakage watched 4 weeks | `docs/evals/merchant-pipeline-v1.md` |
| 9 | **First Web Store submission** with the pilot set and optional permissions, or a recorded deferral | Listing live or decision recorded |
| 10 | **Wave 1: top-100 candidates**: adapters where feasible, named profiles where the answer differs, held-out eval; catalog and extension release | Results published; catalog on Evan's approval |
| 11 | **Drift job** (monthly recipe replays) and further waves only if the numbers justify them | Breakage and freshness numbers recorded |

**Sizing (estimate, replaced by the pilot):** 20–40 agent-minutes per tier-1 merchant when it works; pilot 1–2 days; 100 candidates at about 60% success 2–4 weeks of sessions, excluding Web Store review. **Stop rule:** if the pilot's held-out false-found rate is above 0, or fewer than half the probe sites are reachable, Evan re-decides the tier-1 target before wave 1.

## Decisions for Evan

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Long-tail coverage | (a) ~500 named profiles; (b) generic "Another U.S. online store" + named profiles only where brands or bonus categories change the answer (~100–150) | (b) |
| D2 | Permissions | (a) required host permissions for every adapter site (zero-click from install, big install warning, every wave disables the extension until users re-approve, heavier review); (b) optional host permissions, one grant per site or in onboarding, plus click-to-read everywhere | (b); amends the 2026-10-01 zero-click directive to "zero-click after one grant" |
| D3 | Merchant list source | (a) a paid ranking (not license-safe to commit); (b) Tranco/CrUX top 10k ∩ agent-proposed retail classification, Evan approves rows; NRF Top 100 as cross-check | (b) |
| D4 | Capture method and posture | (a) scripted Playwright only; (b) browser agent in a fresh logged-out Playwright profile writing replayable recipes; (c) Evan's own browser (never: it holds his sign-ins) | (b); add-to-cart in a logged-out cart accepted; monthly re-captures, not weekly |
| D5 | Adapter drafting model | (a) gpt-5.6-luna one-shot (the extraction directive); (b) Claude subagent iterating against the deterministic gate, luna as a measured comparison arm | (b); amends the luna directive for adapters |
| D6 | MCC on profiles | (a) community MCC at `low` with a source per merchant; (b) none unless an issuer or network document states it | (b) |
| D7 | Web Store order | (a) first listing after wave 1 (~100 hosts); (b) first listing with the pilot set and optional permissions, then grow | (b) |
| D8 | Savings detection at new merchants | (a) ship guessed confirmation paths; (b) none until Evan verifies a real order there | (b) |
| D9 | Portfolio framing | (a) a second headline equal to the extraction eval; (b) a second measured result with N and confidence intervals; the extraction eval stays the headline | (b) |
| D10 | Scope gate | Each wave (rank band) needs Evan's approval, as issuers outside the top 10 do for cards | Yes |

## Review (Fable 5.1, 2026-10-05)

Independent design review of v2 (agent-verified, read-only). Main findings adopted in v3: 500 profiles change no answer beyond brands and bonus categories (C1); required host permissions disable the extension on every wave in MV3 (C2); no feasibility probe before building (H1); platform templates (H2); capture must not use Evan's signed-in browser and should leave replayable recipes (H3); pre-registered eval and a sober portfolio claim (H4); no MCC by default and merchant slicing (H5); kill switch before the first wave (H6); nullable order confirmation (M2); content-script size to measure (M3); Web Store order (M4); license-safe list sources (M5); monthly, not weekly, drift (M6); sizing and a stop rule (M8). The coordinator checked the rule-category counts and the manifest's `activeTab`/`scripting` against the code.

## Related

* [Roadmap](roadmap.md)
* [Phase 9 plan](phase-9-freshness.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
* [Cart badge](../system/cart-badge.md)
