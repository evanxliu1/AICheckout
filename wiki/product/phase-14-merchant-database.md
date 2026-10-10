---
type: Product
title: Phase 14 plan (merchant database)
description: A hosted, reviewed merchant database matched on the device. About 500 U.S. stores, each recognised by website, with its brands, kind, online-retail flags and a category; a bonus category is applied only on issuer evidence or two agreeing public sources, otherwise the general rate. Published like the catalog, bundled in the extension and refreshed weekly. Seeded by a small version of the card pipeline (gpt-5.6-luna drafts, Claude subagents verify) and measured on held-out stores before Release A.
status: stable
tags: [product, plan, phase-14, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-10T15:00:00Z
sources:
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design
  - resource: phase-10-merchant-expansion.md
    title: Phases 10–17 plan
  - resource: ../domain/merchants.md
    title: Merchants
  - resource: ../domain/reward-rules.md
    title: Reward rules
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline
  - resource: ../decisions/2026-10-10-merchant-database-evidence.md
    title: Decision, merchant database scope and evidence
  - resource: ../decisions/2026-10-10-audit-calls.md
    title: Decision, audit calls A1–A6
  - resource: ../decisions/2026-10-10-data-collection.md
    title: Decision, data collection
---

# Phase 14 plan: merchant database

Planned 2026-10-10. Evan, in chat that day:
- "before we release to the chrome web store, we should do the merchant database … the goal is to be able to recognize what merchant we are in, in order to know what category the merchant is, to calculate the best credit card based on that category and rewards";
- then "plan and explain phase 14 FULLY and THOROUGHLY … for me to approve".

Phase 14 comes before Phase 15 (Release A).

## 1. Why: what is wrong today

Since Phase 13c the badge shows at any https store. But every store except Amazon, Best Buy and Newegg is "Another U.S. online store" (`generic-us-online`), so:

| Problem | Example (bundled catalog `2026-10-05.renewal.1`, 178 cards) |
| --- | --- |
| **Category bonuses never apply.** The generic profile is `general-merchandise`, so supermarket, dining, drugstore, streaming and other category rules are `not-at-merchant` | 72 cards have supermarket rules, 99 dining, 19 streaming, 11 drugstores; at instacart.com, doordash.com or netflix.com none of them is considered |
| **Brand rules never apply.** The generic profile has no brands | 140 catalog brands; Walmart appears in 21 cards' rules or exclusions, Target 20, BJ's 9, Sam's Club 8, Costco 7, airlines and hotels 3–4 each (Delta, United, Marriott, Hilton…); the Target store card at target.com is "not accepted" |
| **Brand exclusions can't fire.** | "Grocery, excluding Walmart and Target" can't exclude anything at walmart.com; the OnePay first-90-days rule is a known wrong answer there ([merchants](../domain/merchants.md)) |
| **Wrong channel assumptions.** The generic profile says online retail of physical goods | At delta.com or marriott.com (services, not goods) online-retail rules such as Amex Blue Cash Everyday's 3% would be counted |
| **Payment pages look like stores.** | On a PayPal or Shop Pay checkout page the badge treats the page as a store |

The merchant database fixes all five by telling the extension, for each known website, who the store is and what can be assumed about it.

## 2. Evan's decisions this plan follows

All 2026-10-10:
- [merchant database evidence](../decisions/2026-10-10-merchant-database-evidence.md);
- [audit calls](../decisions/2026-10-10-audit-calls.md);
- [data collection](../decisions/2026-10-10-data-collection.md).

1. **About 500 stores** in the first release. The long tail stays on the generic profile, which is right for stores that code as general retail.
2. **Weak evidence gives the general rate**, never a range. This supersedes D5's ranges.
3. **A bonus category needs evidence:**
   - **`issuer`:** the issuer names the store in its card terms;
   - **`corroborated`:** the store's own official pages show the business type, and a public merchant-code lookup agrees.
4. **Public sources only.**
   - Lookup pages are cited by URL, date, SHA-256 and quotes of 25 words or fewer, never copied as data.
   - Top-store lists contribute domain names only.
   - Card statements are never used.
5. **Competitors' architecture, not their data flow:**
   - a hosted, reviewed list, refreshed, with a remote off switch and a generic fallback;
   - downloaded whole and matched on the device, so no per-site lookups.
6. **Releases:**
   - merchant data is a separate, versioned release (D2), published on Evan's chat "publish merchants <version>";
   - the extension refreshes it, and the card catalog, weekly in the background (D8).
7. **Growth.** After Release A, a shopper's tap on "Store not recognised? Suggest it" sends that store's domain. That button comes with Release A telemetry (Phase 15), not in Phase 14.

**Still open:** D9, the licence of future merchant data, eval labels and snapshots (MIT like the code, or proprietary). It is asked before the first publish (14.7).

## 3. What a merchant record says

Schema `merchant-release.1`, validated in Zod (`packages/rewards-core`) and in SQL, with shared parity cases like catalog v3.

**Release:**

| Field | Rule |
| --- | --- |
| `schemaVersion` | `1` |
| `version` | `YYYY-MM-DD.<label>.<n>`, like catalogs |
| `verifiedAt`, `expiresAt` | `expiresAt` at most 90 days after `verifiedAt` (merchant coding changes slowly; card terms keep 30 days) |
| `sources` | `{ id, url, kind: issuer-terms \| store-page \| mcc-lookup, capturedAt, sha256 }` |
| `merchants` | 1–5,000 records |
| Size | Whole release at most 2 MiB |

**Merchant record:**

| Field | Meaning | Example |
| --- | --- | --- |
| `id` | Stable id | `kroger-us` |
| `name` | Display name, at most 60 characters, letters, digits and basic punctuation | "Kroger" |
| `hosts` | 1–20 registrable domains or exact subdomains it sells and checks out on | `["kroger.com"]` |
| `kind` | `merchant`, `marketplace` or `processor` | `merchant` |
| `onlineRetail`, `physicalGoods`, `usMerchant` | As in today's profiles; online-retail rules need the first two | true, true, true |
| `category` | One merchant category; `general-merchandise` unless the evidence rule is met | `supermarkets` |
| `evidence` | `basis`: `issuer`, `corroborated` or `default`; `sourceIds`; `quote` (≤ 25 words, optional) | `corroborated`, store page and lookup |
| `brandIds` | Catalog brands sold under this site; ids missing from the catalog in effect are ignored | `[]` (Kroger is not a catalog brand) |
| `disabled` | Remote off switch: the site falls back to the generic profile | `false` |

**Three more examples:**
- **`target-us`:**
  - `target.com`, merchant;
  - category `general-merchandise` with `default` basis: Target is a discount store, no issuer names it as a department store, and supermarket bonuses exclude it;
  - `brandIds: ["target"]`, so the Target store card is accepted and "excluding Target" rules fire.
- **`delta-us`:**
  - `delta.com`, merchant, `physicalGoods: false`, so online-retail rules don't apply;
  - category `general-merchandise`;
  - `brandIds: ["delta"]`, so Delta co-brand rules apply.
- **`paypal`:**
  - `paypal.com`, `kind: processor`;
  - no badge, no reader.

**Category list.** The categories are the catalog v3 merchant categories:
- `general-merchandise`, `electronics`, `supermarkets`, `gas`, `ev-charging`, `dining`, `drugstores`, `entertainment`, `streaming`, `transit`, `department-stores`, `home-improvement`, `wholesale-clubs`.

Two points about it:
- **No new categories.** A store whose real coding is something else (an airline, a hotel) is `general-merchandise` with `default` basis, which means "no category bonus claimed".
- **Brand rules carry those stores.** An issuer naming a brand already says where the rule pays, so brand rules, exclusions and closed-loop acceptance need no category evidence.

## 4. How it works at checkout

1. **Match, on the device.**
   - The tab's hostname is lowercased (punycode kept, trailing dot removed, `www.` not special) and matched by **label-boundary suffix**: `secure.newegg.com` matches `newegg.com`, `notnewegg.com` doesn't, `amazon.ca` never matches `amazon.com`.
   - The longest match wins; a `processor` record beats a merchant at equal length. Country domains must be listed explicitly.
   - IP addresses, `localhost` and non-http(s) URLs never match.
   - This replaces `merchantForTab`'s last-two-labels rule. The legacy adapters keep their exact cart URLs.
2. **Decide.**
   - A `processor` match: no badge and no reader; the popup says it can't compare on a payment page.
   - A `disabled` match or no match: the generic profile.
   - Otherwise the record becomes the merchant profile.
3. **Rank.**
   - `compareV3` takes the profile passed in instead of looking it up in `catalog.merchants`.
   - The profile is the record's `category` as `expectedCategory`, its flags, and its brands filtered to the catalog's.
   - Ranking itself is unchanged; engine ranges for uncertain caps, activation, payment paths, choices and gates stay.
4. **Show.**
   - The badge and popup name the store ("Kroger") instead of "Another U.S. online store".
   - The panel says why a category applies: "Codes as a supermarket (store pages and a public merchant-code lookup)" or "(Chase card terms)". A `default` record shows nothing about categories.
5. **Freshness.**
   - A snapshot of the latest published release is bundled in the extension.
   - Once a week a background `alarms` job fetches `GET /v1/merchants` and `GET /v1/catalog` with `If-None-Match`; "Check for updated terms" does the same at once.
   - A fetched release is kept only if valid, unexpired and not older than the one in use (rollback protection, as for catalogs).
   - Fallbacks: if the hosted release is expired or unreachable, the bundled one is used; if that has expired too, the generic profile. A comparison is never blocked.

**Out of scope for Phase 14:**
- order-confirmation pages and savings at generic stores (still only the three legacy stores);
- telemetry and the "Suggest it" button (Phase 15);
- non-U.S. stores (USD only, as today);
- per-store selectors (never).

## 5. The candidates: which ~500 stores

The candidate list is `evals/merchants/db/candidates.json`. It is committed, holds domains only, and is frozen before any drafting. It is then split 70 / 30 into development and held-out by a seeded draw, stratified by group.

| Group | About | How chosen |
| --- | ---: | --- |
| Catalog brands | 140 brands, ≈ 120 sites (some share sites, some have none) | Every brand in `CATALOG_V3`: its official U.S. site(s) |
| Supermarkets and grocery delivery | 40 | Leading U.S. grocery chains with online ordering, grocery delivery services |
| Dining and food delivery | 30 | Delivery apps, the largest restaurant chains with online ordering |
| Drugstores | 10 | National pharmacy chains |
| Streaming | 25 | Video, music and audio subscriptions |
| Entertainment | 20 | Ticketing, cinemas, live events, theme parks |
| Home improvement | 10 | National home-improvement retailers |
| Wholesale clubs | 5 | All U.S. warehouse clubs |
| Department stores | 20 | National department stores |
| Electronics | 15 | Electronics retailers |
| Transit and EV charging | 15 | Rideshare, rail, transit apps, charging networks |
| Payment processors | 15 | PayPal, Shop Pay, Klarna, Affirm, Afterpay, Bolt, Venmo, Amazon Pay and similar |
| Top U.S. online stores | to ≈ 500 | The U.S. stores in the frozen reader set, then a public top-site list (domains only), filtered to U.S. online stores |

Names in the bonus groups come from public sources at research time; the coordinator commits the list, not a model's memory.

## 6. How the records are built

A small merchant version of the [card pipeline](../system/card-expansion-pipeline.md): same CLI patterns, packets and gates. Phase 16 later hardens and scales it.

| Stage | Who | Output | Gate |
| --- | --- | --- | --- |
| 1 Research | `merchant-researcher` subagent (Claude, web), 25 stores per packet | Per store: official domains (U.S. checkout hosts), the store's own about or store-type page, any issuer page naming it, any public merchant-code lookup page; URLs only, no values | URLs resolve; domains are the store's own; no lookup site's terms forbid citation |
| 2 Capture | CLI (Playwright, logged out, robots respected) | Gitignored dated captures with a hashed manifest | Every cited URL captured or the source is dropped |
| 3 Draft | gpt-5.6-luna `xhigh` through Codex (project rule for curation); new prompt file `merchant-draft.1` | Per store from captures only: kind, flags, brands (from the catalog's brand list), candidate category, evidence quotes | Zod-valid; quotes found verbatim in captures, ≤ 25 words |
| 4 Verify | `merchant-verifier` subagent (Claude, captures only) | Findings per field | Every field checked |
| 5 Adjudicate | `merchant-adjudicator` subagent (a different run) | Each finding accepted, rejected or modified | All findings decided |
| 6 Apply | CLI, deterministic | Records. **The evidence rule sets `category`**: a candidate category stays only with an `issuer` source, or a store page plus an agreeing lookup; otherwise `general-merchandise` with `default`. Models never set `category` directly | Rule unit-tested |
| 7 Build | CLI | `packages/rewards-core/src/merchants-v1.ts` (generated, like `catalog-v3.ts`) plus the release JSON | `merchants:check` up to date |

**Size and cost:**
- About 20 packets of 25 stores.
- The card pipeline used about 20–40k Claude tokens per item for research and verification, which suggests about 15–30 million Claude tokens for 500 stores, plus the luna runs on the ChatGPT subscription. This is a rough estimate; the 14.4 dry run gives a real one.
- Live models run locally only, never on Render.

## 7. Measurement

The report is `docs/evals/merchant-db-v1.md`, run once on held-out (about 150 stores).

| Measure | How | Target (reporting, not a gate) |
| --- | --- | --- |
| **Wrong bonus category**, the costly error (a bonus shown where the store doesn't code that way) | Gold: an independent `merchant-labeller` subagent labels each held-out store from its captures under the same evidence rule, blind to the draft. Count records whose bonus category differs from gold | 0, with the exact Clopper–Pearson bound |
| Missed bonus category | Gold has a bonus category, the record says `default` | Reported; costs value, not trust |
| **Wrong brand** (a store card accepted where it isn't, or a wrong exclusion) | Gold brands vs record brands | 0 |
| Wrong kind (a processor missed or a store marked processor) | Gold vs record | 0 |
| **Wrong store match** | A URL test set: every candidate's checkout URL, the frozen reader set's U.S. cart URLs, and look-alike traps (`amazon.ca`, `target.com.au`, `walmartmoney.com`, deep subdomains, punycode) | 0 wrong matches |
| Engine scenarios | Unit tests: Prime Visa at amazon.com and wholefoodsmarket.com; Target card accepted at target.com only; Freedom Flex grocery excluded at walmart.com; OnePay first-90-days at walmart.com; kroger.com grocery (corroborated); costco.com warehouse club; delta.com with no online-retail rule; PayPal page with no badge; `disabled` → generic; expired → bundled → generic | All pass |
| Size and speed | Release bytes; match time on the device | ≤ 2 MiB; under 1 ms |

The draft prompt and pipeline are tuned on development only. Held-out is run once, as in Phases 12–13.

## 8. Milestones

One branch and one PR per milestone, from the latest `main`. Each implementation milestone has a Fable 5.1 implementer and an independent Fable 5.1 reviewer; review findings are fixed and re-checked before the PR (agent-verified).

| # | Milestone | Contents | Done when | Rough size |
| --- | --- | --- | --- | --- |
| 14.1 | Schema, matcher, engine | `merchant-release.1` Zod schema and limits; the matcher; `compareV3` with a passed-in profile; record → profile conversion with brand filtering; the three legacy profiles and the generic profile as a seed release; engine scenarios | Tests green, review done | 1 day |
| 14.2 | Hosted | Migration `merchant_releases` (public release and head, private drafts, sources and publications, `publish_merchants` RPC); SQL validator with parity cases; `GET /v1/merchants` (ETag, 304, in-memory cache, 2 MiB cap, 503 when unusable); review routes and a merchant review page that shows only deviations from `default` with evidence; publish CLI `pipeline merchants publish` with the catalog's guards; `./scripts/db-push.sh` by the coordinator after merge | API, SQL and parity tests green; migration on hosted | 1–2 days |
| 14.3 | Extension | Bundled snapshot; fetch, validate and cache with rollback protection; weekly `alarms` refresh for merchants and catalog (`alarms` permission, no install warning); matching on the device; store names and evidence line in badge and popup; processor pages hidden; `disabled` and expiry fallbacks; **A5:** popup error copy reworded to never ask for an amount; unit and e2e tests | Gate and browser suite green | 1–2 days |
| 14.4 | Candidates and pipeline | The frozen candidate list and split; merchant stages in `tools/catalog-pipeline`; the four subagent briefs; the `merchant-draft.1` prompt; the evidence-rule apply step; a dry run on 10 development stores | Dry run complete, cost measured | 1 day |
| 14.5 | Seed | The pipeline on all ~500 candidates in packets of 25 | Every record agent-verified; release draft built | 2–3 days |
| 14.6 | Measure | Gold labels on held-out, the one held-out run, URL match test, report | Report committed | ½ day |
| 14.7 | Publish | D9 asked; Evan reviews the release in the review app; coordinator publishes on "publish merchants <version>"; the bundled snapshot updated to it | `GET /v1/merchants` serves it; the extension loads it | Evan's time |

**Order:**
- 14.1 and 14.4 start in parallel.
- 14.2 and 14.3 follow 14.1.
- 14.5 follows 14.4.
- 14.6 follows 14.5.
- 14.7 needs 14.2, 14.3 and 14.6.

The sizes are guesses from Phases 13–13c; the total is roughly a week of working sessions.

**The card catalog renewal is unrelated work in parallel.** It is due before 2026-11-04; prepare it around 2026-10-28.

## 9. What Evan does

| When | What |
| --- | --- |
| Now | Approve this plan |
| 14.2 | Nothing; `db-push` runs under the standing authorization |
| 14.7 | Answer D9; review the release in the review app (only the deviations: bonus categories with evidence, brands, processors); type `publish merchants <version>` |
| Any time | Change the evidence rule, the size or a store's record |

## 10. Risks and how the plan handles them

| Risk | Handling |
| --- | --- |
| Few stores reach a bonus category (issuers rarely name stores; lookups are spotty) | Expected and acceptable: brand rules and correct flags still change many answers; the report counts how many stores got a bonus category |
| A public lookup is wrong | It can't decide alone; it must agree with the store's own pages, and the costly error is measured |
| A wrong brand (a store card shown as accepted at the wrong site) | Brands come only from the catalog's list, are verified per store, and wrong brands are measured with a target of 0 |
| Look-alike domains | Label-boundary matching, explicit country domains, and a trap test set |
| Release skew (a merchant release names a brand or category the extension's catalog doesn't know) | Unknown brands are ignored and unknown categories fall back to `general-merchandise` (tested) |
| Render free tier sleeps | The client tolerates cold starts; weekly refresh retries; bundled fallback |
| Model cost or stalls | Small packets, frequent commits, resume by packet (as in Phase 8) |

## 11. Consequences for Phase 15

- The privacy policy and listing say the merchant list is downloaded whole and matched on the device.
- The `alarms` permission is added (no warning).
- The badge names stores. Brand names are for matching only and imply no partnership.
- The A4 adapter retirement check and the A6 site fix are Phase 15 tasks.

## Progress

- **2026-10-10: planned;** rewritten in full after the audit calls, for Evan's approval.
