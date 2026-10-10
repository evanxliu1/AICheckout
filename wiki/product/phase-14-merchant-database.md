---
type: Product
title: Phase 14 plan (merchant database)
description: A hosted, reviewed merchant database matched on the device. It recognises about 500 U.S. stores by website, gives each its brands, kind and category, and applies a category bonus only on issuer evidence or two agreeing public sources (otherwise the general rate). It is published like the catalog, bundled and refreshed weekly, and seeded by a small version of the card pipeline (gpt-5.6-luna drafts, Claude subagents verify). Measured on held-out stores before Release A.
status: stable
tags: [product, plan, phase-14, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-10T12:00:00Z
sources:
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design
  - resource: phase-10-merchant-expansion.md
    title: Phases 10–17 plan
  - resource: ../domain/merchants.md
    title: Merchants
  - resource: ../domain/reward-rules.md
    title: Reward rules
  - resource: ../decisions/2026-10-10-merchant-database-evidence.md
    title: Decision, merchant database scope and evidence
---

# Phase 14 plan: merchant database

Planned 2026-10-10. Evan, in chat that day: "before we release to the chrome web store, we should do the merchant database … the goal is to be able to recognize what merchant we are in, in order to know what category the merchant is, to calculate the best credit card based on that category and rewards." Then: "is this similar to how honey or capital one shopping do this? … we should follow a similar approach". Phase 14 comes before Phase 15 (Release A), as the roadmap already orders it.

## Why

- **Rewards follow the store, not the cart.** A card's bonus depends on the merchant category code (MCC) that the store's payment processor assigns. That code isn't public and can surprise: walmart.com codes as a discount store, not a supermarket, so grocery bonuses (Freedom Flex: "excluding Walmart and Target") don't apply; costco.com is a warehouse club.
- **Today:**
  - Every store but the three legacy ones is "Another U.S. online store" (`generic-us-online`), so only base and online-retail rules apply.
  - Brand rules (Prime Visa at Amazon, store cards) work only at the three stores.
  - Brand exclusions can't fire at a generic store; the guard test lists the OnePay first-90-days rule at walmart.com ([merchants](../domain/merchants.md#another-us-online-store-phase-11)).
- **The database fixes all three.** For about 500 stores it says which brands a site carries, what kind of site it is, and which category it codes as, when that's backed by evidence.

## Evan's decisions (2026-10-10)

Recorded in the [decision](../decisions/2026-10-10-merchant-database-evidence.md).

1. **About 500 stores** in the first release:
   - the catalog's 140 brands that have websites;
   - the leading U.S. online stores in each bonus category;
   - the top U.S. online stores.

   The long tail stays on the generic profile, which is correct for stores that code as general retail.
2. **Weak evidence means the general rate.**
   - A store whose category isn't established gets `general-merchandise`.
   - Recommendations never show a category range ("1–5% depending on how the store codes").
   - This supersedes the range rule (D5) in the [merchant coverage design](../system/merchant-coverage-design.md#category-evidence).
3. **Enough evidence for a category bonus.** Either:
   - **(a) the issuer names the store** in captured card terms (class 1), or
   - **(b) two independent public sources agree:**
     - the store's own official pages show that it is that kind of business (a supermarket, a drugstore);
     - a public merchant-code lookup shows a code in that category.

   So kroger.com and cvs.com qualify, while walmart.com (discount store) and costco.com (warehouse club) don't get grocery.
4. **Public sources only.** Issuer terms, the store's official pages and public merchant-code lookups (recorded by URL, date and hash, quotes of 25 words or fewer, never copied as a dataset). Card statements are never used.
5. **Competitors' architecture, not their data collection.** Like Honey, Capital One Shopping and Kudos: a hosted, reviewed store list, refreshed regularly, with a remote off switch and a generic fallback. Unlike them:
   - the list is downloaded whole and matched on the device, so no per-site lookup and no browsing data leave the device;
   - there are no affiliate deals and no bank linking.

## What a merchant record says

`merchant-release.1`, validated in Zod (`packages/rewards-core`) and in SQL with parity cases, like catalog v3.

| Field | Meaning |
| --- | --- |
| `id`, `name` | `target-us`, "Target". The name is length- and charset-limited |
| `hosts` | Registrable domains or exact subdomains the store checks out on (`target.com`). Matched by label-boundary suffix; `amazon.ca` never matches `amazon.com` |
| `kind` | `merchant`, `marketplace` or `processor`. Processor pages (PayPal, Shop Pay, Klarna, Affirm, Afterpay, Bolt and similar): no badge, no reader |
| `onlineRetail`, `physicalGoods`, `us` | As in today's profiles; decide online-retail rules and U.S.-only rules |
| `category` | One `MerchantCategoryV3`; `general-merchandise` unless the evidence bar is met |
| `evidence` | `{ basis: 'issuer' \| 'corroborated' \| 'default', sourceIds, note }`: why `category` is what it is. `default` means no bonus category is claimed |
| `brandIds` | Catalog brands this site sells under (`target`). A brand id missing from the catalog in effect is ignored, which covers release skew |
| `disabled` | Remote off switch: the store falls back to the generic profile |

The release also has `schemaVersion`, `version`, `verifiedAt`, `expiresAt` (at most 90 days after `verifiedAt`; merchant coding changes slowly, unlike card terms), `sources` (URL, kind, captured date, SHA-256) and a 2 MiB cap.

**Brand rules don't need category evidence.** An issuer naming a brand ("Prime Visa: 5% at Amazon and Whole Foods") already says where the rule pays, so a matched brand applies its brand rules, exclusions and closed-loop acceptance whatever the category.

## How it works at checkout

1. **Match.**
   - The tab's host is matched against the release's `hosts` on the device: longest suffix wins, `processor` first.
   - No match gives the generic profile.
   - This replaces `merchantForTab`'s last-two-labels rule; the three legacy adapters keep their cart URLs.
2. **Profile to engine.**
   - `compareV3` takes the matched profile passed in, instead of looking it up in `catalog.merchants`.
   - The three legacy profiles move into the merchant release; the catalog's `merchants` stays until no supported catalog needs it.
3. **Rank.** Unchanged ranking. Brands, exclusions and closed-loop acceptance now work at every matched store, and category rules work where `category` is a bonus category.
4. **Show.**
   - The badge and popup name the store ("Target") instead of "Another U.S. online store".
   - The panel says why a category applies: "Codes as a supermarket (issuer terms)" or "(store pages and a public merchant-code lookup)". A `default` store says nothing about categories.
5. **Freshness.**
   - A bundled snapshot ships in the extension.
   - The hosted release refreshes weekly in the background (`alarms`, `If-None-Match`/`ETag`), with "Check for updated terms" also checking it.
   - An expired or unreachable release falls back to the bundled one, then to the generic profile, and never blocks a comparison.
   - The card catalog gets the same weekly refresh, so an installed extension doesn't expire on a shopper who never clicks.

## How the store list is built (14.5)

A small version of the [card pipeline](../system/card-expansion-pipeline.md), reusing its pattern; Phase 16 hardens and scales it.

| Stage | Who | Output |
| --- | --- | --- |
| Candidates | Coordinator | `evals/merchants/db/candidates.json`, committed, domains only, frozen before drafting. Sources: the 140 catalog brands, the leading stores per bonus category (supermarkets and grocery delivery, drugstores, wholesale clubs, home improvement, department stores, electronics, dining and delivery, streaming, entertainment), the U.S. stores in the frozen reader set, public top-store lists (domains only). Split into development and held-out by a seeded draw |
| Research | Claude subagent (web) | Per store: official domains, the official "about" or store-type page, any issuer page naming the store, any public merchant-code lookup page. URLs only |
| Capture | CLI (Playwright) | Gitignored dated captures with a hashed manifest, as for issuer pages |
| Draft | gpt-5.6-luna `xhigh` through Codex (the project's curation rule) | Profile draft from captures only: kind, flags, brands, candidate category, evidence quotes (≤ 25 words) |
| Verify, adjudicate | Independent Claude subagents | Each draft field checked against the captures; findings accepted, rejected or modified by a different run (agent-verified) |
| Apply | CLI (deterministic) | The evidence rule decides `category`: a candidate becomes the category only with an issuer source or a corroborated pair; otherwise `general-merchandise`. Drafts never set `category` directly |
| Build, review, publish | Coordinator, Evan | The release; the review app shows only deviations from the default (non-general categories, brands, processors, disabled) with their evidence; Evan approves; the coordinator publishes on Evan's chat "publish merchants <version>" |

## Measurement (14.6)

- **Category correctness, the costly error.** A wrong bonus category (a bonus shown at a store that doesn't code that way) is like a wrong amount.
  - **Gold:** an independent Claude labeller assigns each held-out store's category from its captures under the same evidence rule (agent-verified).
  - **Report:** precision of applied bonus categories on held-out stores (target: no wrong bonus category), how many stores got a bonus category, and agreement on `default`.
  - Prompt and pipeline changes are tuned on development only; held-out is run once.
- **Store recognition.**
  - Match precision and recall on a URL set: the frozen reader set's U.S. cart URLs, each candidate's checkout URL, and look-alike traps (`amazon.ca`, `target.com.au`, subdomains, `walmart.com` vs `walmartmoney.com`).
  - Target: no wrong store.
- **Engine scenarios (tests, not a metric):**
  - Prime Visa at amazon.com and wholefoodsmarket.com;
  - Target store card accepted at target.com only;
  - Freedom Flex grocery excluded at walmart.com;
  - OnePay first-90-days at walmart.com;
  - kroger.com grocery with corroboration;
  - costco.com warehouse club;
  - a processor page with no badge;
  - a disabled store falling back to generic;
  - an expired release falling back to bundled, then generic.
- **Size and time:** release bytes, and match time on the device (target under 1 ms).

## Milestones

One branch and one PR per milestone, cut from the latest `main`.

| Milestone | Who | What | Done when |
| --- | --- | --- | --- |
| 14.1 Schema and engine | Fable implementer, Fable reviewer | `merchant-release.1` in Zod; `compareV3` with a passed-in profile; the matcher (suffix, longest, processor first) in `packages/rewards-core`; brand and acceptance at matched stores; the three legacy profiles as a seed release; engine scenarios above | Tests green, review fixes applied |
| 14.2 Hosted | Fable implementer, Fable reviewer, coordinator | Migration `merchant_releases` (public releases and head, private drafts, sources and publications, `publish_merchants`), SQL validation with parity cases, `GET /v1/merchants` (ETag, in-memory cache, 2 MiB cap, 503 when unusable), review routes and a merchant review page (deviations only), publish CLI in `tools/catalog-pipeline`; `./scripts/db-push.sh` by the coordinator after merge | API, SQL and parity tests green; migration on hosted |
| 14.3 Extension | Fable implementer, Fable reviewer | Bundled snapshot, fetch and cache with rollback protection, weekly `alarms` refresh for merchants and catalog (`alarms` permission, no install warning), matching on the device, store name and evidence line in badge and popup, processor pages hidden, `disabled` and expiry fallbacks; unit and e2e tests | Gate and browser suite green |
| 14.4 Candidates and pipeline | Coordinator, Fable implementer | The candidate list (frozen, split), pipeline stages for merchants (packets, research, capture, luna draft, verify, adjudicate, apply with the evidence rule), the merchant subagents' briefs | A dry run on 10 development stores |
| 14.5 Seed | Coordinator with subagents and luna | Run the pipeline on all ~500 candidates in batches | Release draft built, every row agent-verified |
| 14.6 Measure | Coordinator | Held-out category and match measurement, report `docs/evals/merchant-db-v1.md` | Report committed |
| 14.7 Publish | Evan, coordinator | Review in the review app; publish on "publish merchants <version>"; the extension's bundled snapshot updated to it | `GET /v1/merchants` serves it; extension loads it |

14.1 and 14.4 can run in parallel; 14.2 and 14.3 follow 14.1.

## Rules that carry over

- Captures stay gitignored; commit URLs, hashes and quotes of 25 words or fewer only.
- No store configs: no per-store selectors; the reader stays generic.
- Merchant rows say nothing about the cart page.
- Never edit an applied migration.
- Subagents never merge or push `main`; the coordinator merges after CI and runs `db-push.sh` (standing authorization).
- Nobody but Evan signs in to hosted services; publishing needs his chat message for that release.
- Reviews by independent subagents, recorded as agent-verified.

## Consequences for Phase 15

- **Privacy policy and listing:** the merchant list is downloaded whole and matched on the device; no browsing data is sent.
- **`alarms` permission:** added, with no install warning.
- **Badge and popup wording:** they name stores. Brands are names for matching only and imply no affiliation or partnership.

## Growth after the seed

- Since Release A carries telemetry ([data collection](../decisions/2026-10-10-data-collection.md)), a shopper's tap on "Store not recognised? Suggest it" (badge) or "Suggest this store" (popup) sends that store's domain.
- Counts by domain choose the next stores for the pipeline. They are advisory only: nothing is promoted into a release without review.
- No shopper is asked how a purchase posted.

## Open questions

- **Public merchant-code lookups:** which sites' terms allow citing their pages (D9, licensing). Until settled, use them only as recorded URLs, hashes and short quotes, never as a copied dataset.
- **Not planned:** asking shoppers which category a purchase posted as (a Kudos-style confirmation). Evan declined it on 2026-10-10; categories come from public sources only.

## Progress

- **2026-10-10: planned.**
