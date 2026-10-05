---
type: Product
title: Phase 10 plan (merchant expansion, draft)
description: Draft proposal, awaiting Evan's approval — more checkout merchants through a merchant-expansion pipeline that reuses the card pipeline's pattern to add site adapters (extension), merchant profiles and brand links (catalog), with an execution-based adapter gate; current state, constraints, milestones and open questions.
status: draft
tags: [product, plan, phase-10, merchants, site-adapters, pipeline]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:47:59Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Archived Phase 2–6 plan (Phase 6 site coverage harness design)
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (the pattern to reuse)
  - resource: ../../extension/src/checkout/adapters/schema.ts
    title: Site adapter schema
  - resource: ../../evals/curation/expansion/merchants.json
    title: Merchant profiles and brands for catalog v3
  - resource: ../../packages/rewards-core/src/schema.ts
    title: Catalog v3 limits
  - resource: ../decisions/2026-10-02-agent-driven-card-pipeline.md
    title: Decision, agent-driven card pipeline (point 8, merchant pipeline)
---

# Phase 10 plan: merchant expansion (draft)

**Draft proposal written 2026-10-05; not approved.** Evan approves this plan, or changes it, before any Phase 10 work starts. Nothing here authorizes a branch, a capture run or a model run. The open questions at the end are his.

## Goal

Let the extension recommend a card at more online checkouts. A merchant is usable only when the extension has a **site adapter** for its cart page (the popup's merchant list is the bundled adapters, `MERCHANT_IDS`) **and** the catalog in effect has a **merchant profile** for it; otherwise the engine returns `unsupported-merchant`. Merchant-specific rules apply only when the profile's **brand links** (`brandIds`) match the rule's brands. Phase 10 builds a merchant-expansion pipeline that produces all three the way the [card-expansion pipeline](../system/card-expansion-pipeline.md) produces cards: a deterministic CLI holds state, hashes and gates; Claude Code subagents do the judgment work; every output passes a gate; a human approves each release. It builds on the archived Phase 6 design (site coverage harness, [archived plan](../archive/phase2-goal.md) section 6) and Evan's order of 2026-10-03: Phase 10 comes before the Chrome Web Store release ([roadmap](roadmap.md)).

## Current state (checked against the code 2026-10-05)

| Area | Today | Where |
| --- | --- | --- |
| Site adapters | 3 declarative JSON specs: `best-buy-us`, `newegg-us`, `amazon-us` (`schemaVersion: 1`), interpreted by one generic reader | [`extension/src/checkout/adapters/`](../../extension/src/checkout/adapters), [`page-reader.ts`](../../extension/src/checkout/page-reader.ts) |
| Adapter registry | `MERCHANT_IDS` is a hand-written `as const` list and `SITE_ADAPTERS` imports each JSON by name; `siteAdapterSchema.merchantId` is `z.enum(MERCHANT_IDS)` | [`ids.ts`](../../extension/src/checkout/adapters/ids.ts), [`index.ts`](../../extension/src/checkout/adapters/index.ts), [`schema.ts`](../../extension/src/checkout/adapters/schema.ts) |
| Permissions | Host permissions and content-script matches are generated from the adapters (`BADGE_HOSTS`, `BADGE_MATCHES`); the release package check pins them | [`extension/vite.config.ts`](../../extension/vite.config.ts), [`extension/scripts/release-package.mjs`](../../extension/scripts/release-package.mjs) |
| Order confirmation | `orderConfirmation.verified` is `false` on all 3 adapters (URL guesses until Evan checks a real order) | [Extension](../system/extension.md) |
| Fixtures and tests | 10 HTML fixtures (3 per merchant plus `mock-cart.html`), redacted structure; `site-adapters.test.ts`, `adapter-interpreter.test.ts`, reader tests, Playwright `checkout.spec.ts`, `newegg.spec.ts` | [`extension/tests/`](../../extension/tests), [`extension/e2e/`](../../extension/e2e) |
| Cart observation | One script, Amazon only: logged out, adds a generic item to the anonymous cart, never checks out, writes structure only (not committed) | [`extension/scripts/observe-amazon-cart.mjs`](../../extension/scripts/observe-amazon-cart.mjs) |
| Merchant profiles | 3 profiles (same as catalog v2 plus `brandIds`; MCC confidence `low` on all three, Amazon with no MCC code or source), 140 brands, 2 MCC sources (CheckMCC community lookups for Best Buy and Newegg); the build config's `merchants` points at this one file | [`evals/curation/expansion/merchants.json`](../../evals/curation/expansion/merchants.json), [`catalog-batches.json`](../../evals/curation/catalog-batches.json), [Merchants](../domain/merchants.md) |
| Catalog limits | `CATALOG_V3_LIMITS`: 100 merchants, 400 brands, 20 `brandIds` per merchant; mirrored in SQL (`20261002222425_catalog_v3`). Merchant categories: 13 (`MERCHANT_CATEGORIES_V3`, including `department-stores`, `home-improvement`, `wholesale-clubs`) | [`schema.ts`](../../packages/rewards-core/src/schema.ts), [`types.ts`](../../packages/rewards-core/src/types.ts) |
| What the catalog could use | In `CATALOG_V3` `2026-10-05.renewal.1`: 816 rules, 166 brand-scoped; only 9 name a brand of the three supported merchants. 4 closed-loop cards (Amazon Store, Amazon Secured, Newegg Store, Harbor Freight), 3 usable today. 27 programs name redemption brands (Gap, Williams-Sonoma Key Rewards, Macy's, TJX, Wayfair, REI, Sam's Club and others) | computed 2026-10-05 from [`catalog-v3.ts`](../../packages/rewards-core/src/catalog-v3.ts) |
| Pipeline | The card pipeline has no merchant stage; `pipeline freshness` re-checks the 2 MCC pages (merchant layer) and a changed one is re-captured by hand | [Card pipeline internals](../system/card-pipeline-internals.md#freshness) |
| Phase 6 | Not started: no `capture-checkout-pages.mjs`, no site `ExtractionTask`, no `eval:sites`, no kill switch, no drift detection | [Roadmap](roadmap.md) |

## Constraints

From [user directives](user-directives.md) and [`AGENTS.md`](../../AGENTS.md); the plan breaks none of them.

- **Retailer sites:** never sign in, create an account, type a secret or password, enter an address or payment details, or place an order. Sites that show a cart only after sign-in are out of scope (Phase 6 design).
- **No model at checkout:** adapters are declarative data read by the fixed interpreter; the engine stays deterministic.
- **Bundled, not downloaded:** adapters ship inside the extension package (Web Store remote-code policy, checked 2026-09-29), so a new merchant needs an extension release; profiles and brand links are catalog data and ship in a catalog release.
- **Copyrighted captures:** retailer page snapshots and MCC captures stay gitignored; commit URLs, hashes, labels, redacted structure fixtures and quotes of 25 words or fewer.
- **Models:** subscription CLIs only, locally (Claude Code subagents, Codex for OpenAI models); nothing on Render or in CI. Curation and extraction runs use gpt-5.6-luna `xhigh`.
- **Eval integrity:** captures are never re-taken to fit, labels never edited to fit results, held-out sites never used for prompt tuning; new prompt versions are new files.
- **Releases:** subagents never touch hosted services; a catalog release is published only on Evan's per-release approval ([catalog release](../ops/catalog-release.md)); the Web Store submission is Evan's.
- **Boundary:** `extension/`, `packages/` and `apps/` never import `tools/`.

## Proposed milestones

One branch and PR each from the latest `main`, an independent reviewer subagent and CI before the coordinator merges, as in Phases 8 and 9. Each is `step → verify`.

| # | Milestone | Verify |
| --- | --- | --- |
| 0 | Evan approves this plan and answers the open questions → record them in [user directives](user-directives.md) and a decision | Plan `status: stable`; directives row dated |
| 1 | **Adapter registry from files.** Derive `MERCHANT_IDS`, `SITE_ADAPTERS` and the schema's `merchantId` from the adapter folder so a new adapter is one JSON file plus fixtures | Extension build, `site-adapters.test.ts`, package check and Playwright unchanged with the 3 adapters; a synthetic fourth adapter appears in permissions only through its file |
| 2 | **Merchant layers in the catalog builder.** A pipeline batch may add or replace merchant profiles and brands (newest layer wins, as for cards), with MCC sources dated by manifests and freshness | With no merchant batch, `catalog:v3:check` byte for byte; synthetic merchant batch test; Zod/SQL parity cases |
| 3 | **Checkout capture tool.** Generalize the Amazon observer into a logged-out capture script: anonymous cart with a generic item, no checkout; redacted structure snapshot (gitignored), committed manifest (URL, date, hash) and a labelled expectation (amount, kind or `unavailable` reason) | Re-captures the 3 current merchants and produces fixtures equivalent to today's; refuses sign-in, checkout and form fields by test |
| 4 | **Execution-based adapter gate.** Run the real interpreter (jsdom) on every fixture of a merchant: exact amount and kind, `unavailable` where labelled, selectors inside the summary, schema and host refinements; DOM variants `class-rename`, `promo-row`, `loading`, `empty-cart`, `injection` | Passes on the 3 shipped adapters; rejects mutated adapters and every variant failure |
| 5 | **Merchant pipeline CLI and agents.** Reuse the card pipeline's batch directory, text-free state, hashing, packets, `claim`/`accept`, `status`/`next`/`handoff`, with merchant stages (research → capture → adapter draft → adapter gate → profile draft → verify → adjudicate → apply → build → eval) and a skill plus pinned subagents | Synthetic-fixture tests; boundary lint; agent-file test as for the card agents |
| 6 | **Acceptance run** on one new merchant Evan picks, end to end from one chat request, measured (fixture pass rate, false-found rate, variant robustness) | Results page in `docs/evals/`; ready branch; `handoff` lists the catalog and extension changes |
| 7 | **Expansion run** over Evan's merchant list, with held-out sites for the eval; new catalog version and extension build | Catalog published on Evan's approval; extension `test:browser` and package check pass; `orderConfirmation` still `verified: false` until Evan checks real orders |

## Open questions for Evan

1. **Which merchants, how many?** Phase 6 aimed at 10 or more. Candidates that the catalog already rewards through brand rules or store programs include Walmart, Costco, Sam's Club, BJ's, Macy's, Bloomingdale's, Dillard's, the Gap and Williams-Sonoma families, Wayfair, L.L.Bean, REI, Harbor Freight, Tractor Supply, Bass Pro Shops and Cabela's, the TJX stores, Barnes & Noble and J.Crew. Travel, airline and service brands are not online retail of physical goods.
2. **Is adding a generic item to a logged-out, anonymous cart acceptable for capture** (as the Amazon observer did on 2026-09-30)? It places no order and creates no account.
3. **Scope against Phase 6:** fold the site-coverage eval (`eval:sites`, held-out sites, variants) into Phase 10, or build the pipeline first and measure later? The eval is the portfolio's natural second headline.
4. **Who drafts adapters:** a Claude Code subagent, or a Codex `ExtractionTask` through the harness with gpt-5.6-luna (the Phase 6 design)? Profiles: the same agents as cards?
5. **Shared core:** refactor `tools/catalog-pipeline` into a shared core with card and merchant stage sets, or a second workspace that imports it?
6. **Kill switch and drift detection** (Phase 6 steps 6–7): in Phase 10, or with Phase 4 terms-change detection later?
7. **MCC evidence:** are community lookups at `low` confidence acceptable for new profiles, as for Best Buy and Newegg (Amazon's profile has no MCC)?
8. **Release order:** one extension release with all new adapters before the Web Store submission, or the Web Store release first with three merchants?

## What a fresh session reads first

1. [`AGENTS.md`](../../AGENTS.md), [now](../now.md), this plan and the [roadmap](roadmap.md).
2. [Card-expansion pipeline](../system/card-expansion-pipeline.md), [CLI commands](../system/card-pipeline-commands.md) and [internals](../system/card-pipeline-internals.md): the pattern to reuse.
3. [Extension](../system/extension.md) (site adapters section), [cart badge](../system/cart-badge.md), [merchants](../domain/merchants.md) and [rewards engine](../system/rewards-engine.md).
4. Archived [Phase 2–6 plan](../archive/phase2-goal.md), section 6 (site coverage harness), for the original design.
5. [User directives](user-directives.md) and the [catalog release](../ops/catalog-release.md) runbook.

## Related

* [Roadmap](roadmap.md)
* [Phase 9 plan](phase-9-freshness.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
