---
type: Product
title: Phase 14 plan (merchant database)
description: A hosted, reviewed merchant database matched on the device. About 500 U.S. stores, each recognised by website, with its brands, kind, goods flag and a category; a bonus category is applied only on issuer evidence or two agreeing public sources, otherwise the general rate. Bundled in the extension first, then published as its own release and refreshed weekly. Built in two tiers (deterministic records for the long tail, a small pipeline with gpt-5.6-luna drafts and Claude verification for the ~200 stores where a model's judgment matters) and audited blind before Release A. Revised after the 2026-10-10 design review.
status: stable
tags: [product, plan, phase-14, merchants]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-10T23:30:00Z
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
  - resource: ../system/rewards-engine.md
    title: Rewards engine (compareV3, merchantProfilesV3)
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: compareV3 (merchant lookup at line 579)
  - resource: ../../extension/src/checkout/merchants.ts
    title: merchantForTab (last-two-labels rule)
  - resource: ../../extension/src/background/badge-service.ts
    title: autoPurchase, badgeCatalog, TabEntry
  - resource: ../../evals/merchants/pipeline-heldout-domains.json
    title: Frozen merchant-pipeline held-out list (60 domains, 2026-10-06)
  - resource: ../decisions/2026-10-10-merchant-database-evidence.md
    title: Decision, merchant database scope and evidence
  - resource: ../decisions/2026-10-10-audit-calls.md
    title: Decision, audit calls A1–A6
  - resource: ../decisions/2026-10-10-data-collection.md
    title: Decision, data collection
  - resource: ../decisions/2026-10-10-phase-14-design.md
    title: Decision, Phase 14 design review choices
---

# Phase 14 plan: merchant database

Planned 2026-10-10. Evan, in chat that day:
- "before we release to the chrome web store, we should do the merchant database … the goal is to be able to recognize what merchant we are in, in order to know what category the merchant is, to calculate the best credit card based on that category and rewards";
- then "plan and explain phase 14 FULLY and THOROUGHLY … for me to approve";
- then "have a fable 5.1 look over the plan, and implementation, is this the right approach, what other approaches are possible, and have it compare and implement the best version".

This is the version after the Fable 5.1 design review of 2026-10-10 ([section 12](#12-design-review-2026-10-10), [decision](../decisions/2026-10-10-phase-14-design.md)). The first version (same day, Opus 5.5) is in git history. Phase 14 comes before Phase 15 (Release A).

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

All 2026-10-10, binding for this plan:
- [merchant database evidence](../decisions/2026-10-10-merchant-database-evidence.md);
- [audit calls](../decisions/2026-10-10-audit-calls.md);
- [data collection](../decisions/2026-10-10-data-collection.md).

1. **About 500 stores** in the first release. The long tail stays on the generic profile, which is right for stores that code as general retail.
2. **Weak evidence gives the general rate**, never a range. This supersedes D5's ranges.
3. **A bonus category needs evidence:**
   - **`issuer`:** the issuer names the store in its card terms;
   - **`corroborated`:** the store's own official pages show the business type, and a public merchant-code lookup agrees.
4. **Public sources only.** Lookup pages are cited by URL, date, SHA-256 and quotes of 25 words or fewer, never copied as data; top-store lists contribute domain names only; card statements are never used.
5. **Competitors' architecture, not their data flow:** a hosted, reviewed list with a remote off switch and a generic fallback, downloaded whole and matched on the device, so no per-site lookups.
6. **Releases:** merchant data is a separate, versioned release (D2), published on Evan's chat "publish merchants <version>"; the extension refreshes it, and the card catalog, weekly in the background (D8).
7. **Brand rules apply at a matched store regardless of its category**, because the issuer names the brand.
8. **Models:** drafting runs gpt-5.6-luna `xhigh` through Codex locally; verification by Claude subagents. No store configs. Release A telemetry (the "Suggest it" button) is Phase 15, not Phase 14.
9. **D9 (provisional):** merchant data, eval labels and snapshots stay MIT for now. Evan: "not a set decision, can always change".

## 3. What a merchant record says

Schema `merchant-release.1`, validated in Zod (`packages/rewards-core/src/merchant-release.ts`) and in SQL (14.6), with shared parity cases like catalog v3.

**Release:**

| Field | Rule |
| --- | --- |
| `schemaVersion` | `1` |
| `version` | `YYYY-MM-DD.<label>.<n>`, like catalogs |
| `verifiedAt` | The newest capture date among the cited sources. **No `expiresAt`:** merchant coding changes slowly, the catalog's own 30-day expiry already stops an abandoned install, and one fewer fallback state ([why](#12-design-review-2026-10-10)) |
| `sources` | `{ id, url, kind: issuer-terms \| store-page \| mcc-lookup, capturedAt, sha256 }`; issuer sources reuse the catalog's source ids and hashes where the page is one the catalog already cites |
| `merchants` | 1–5,000 records; every `hosts` entry unique across the release |
| Size | At most 2 MiB (`MERCHANT_RELEASE_LIMITS.bytes`) |

**Merchant record:**

| Field | Meaning | Example |
| --- | --- | --- |
| `id` | Stable id; the three legacy stores keep `amazon-us`, `best-buy-us`, `newegg-us` so the badge's `disabledMerchants` and savings history keep working | `kroger-us` |
| `name` | Display name, at most 60 characters, letters, digits and basic punctuation | "Kroger" |
| `hosts` | 1–20 registrable domains or exact subdomains the store sells and checks out on; never a public suffix or a shared platform domain (gate, offline) | `["kroger.com"]` |
| `kind` | `merchant`, `marketplace` or `processor` | `merchant` |
| `physicalGoods` | Whether the store sells physical goods (online-retail rules need it); `false` for services, subscriptions and processors | `true` |
| `category` | One of the catalog v3 merchant categories; `general-merchandise` unless the evidence rule is met | `supermarkets` |
| `evidence` | `basis`: `issuer`, `corroborated` or `default`; `sourceIds` (empty for `default`). Quotes are not shipped; they stay in the committed evidence files for review | `corroborated`, store page and lookup |
| `brandIds` | Catalog brands **whose official store this site is** (not brands it resells); ids missing from the catalog in effect are ignored | `[]` (Kroger is not a catalog brand) |
| `disabled` | Remote off switch: the site falls back to the generic profile | `false` |

Compared with the first plan, `onlineRetail` and `usMerchant` are gone from the record: every record is an online U.S. store in this release, so the conversion to a `MerchantProfileV3` fills them with `true`, and `mcc` with `{ code: null, confidence: 'low', sourceIds: [] }`. A later non-U.S. release adds a field then, not now.

**Three more examples:**
- **`target-us`:** `target.com`, merchant, goods; category `general-merchandise` with `default` basis (Target is a discount store, no issuer names it as a department store, and supermarket bonuses exclude it); `brandIds: ["target"]`, so the Target store card is accepted and "excluding Target" rules fire.
- **`delta-us`:** `delta.com`, merchant, `physicalGoods: false`, so online-retail rules don't apply; category `general-merchandise`; `brandIds: ["delta"]`, so Delta co-brand rules apply.
- **`paypal`:** `paypal.com`, `kind: processor`, `physicalGoods: false`; no badge, no reader.

**Category list.** The catalog v3 merchant categories (`MERCHANT_CATEGORIES_V3`): `general-merchandise`, `electronics`, `supermarkets`, `gas`, `ev-charging`, `dining`, `drugstores`, `entertainment`, `streaming`, `transit`, `department-stores`, `home-improvement`, `wholesale-clubs`. No new categories: an airline or hotel is `general-merchandise` with `default` basis ("no category bonus claimed"); brand rules carry those stores.

## 4. How it works at checkout

1. **Match, on the device** (`packages/rewards-core/src/merchant-match.ts`, Zod-free like `generic-merchant.ts`).
   - The tab's hostname is lowercased (punycode kept, trailing dot removed, `www.` not special) and matched by **label-boundary suffix**: `secure.newegg.com` matches `newegg.com`, `notnewegg.com` doesn't, `amazon.ca` never matches `amazon.com`. The longest matching host wins; hosts are unique across records, so there is no tie.
   - Country domains must be listed explicitly. IP addresses, `localhost` and non-http(s) URLs never match.
   - This replaces `merchantForTab`'s last-two-labels rule in `extension/src/checkout/merchants.ts`. The legacy adapters keep their exact cart URLs (`merchantForCheckout`, `merchantForOrderConfirmation`).
2. **Decide.** A `processor` match: no badge and no reader; the popup says it can't compare on a payment page. A `disabled` match or no match: the generic profile. Otherwise the record becomes the merchant profile (`recordToProfile`).
3. **Rank.** `compareRewards(catalog, wallet, purchase, now, { merchant })`: an optional profile that replaces the catalog lookup when its id equals `purchase.merchantId`; without it `merchantProfilesV3` behaves as today. The profile is the record's `category` as `expectedCategory`, `physicalGoods`, `onlineRetail: true`, `usMerchant: true`, and its brands filtered to the catalog's. Ranking itself is unchanged; engine ranges for uncertain caps, activation, payment paths, choices and gates stay.
4. **Show.** The badge and popup name the store ("Kroger") instead of "Another U.S. online store". The panel says why a category applies: "Codes as a supermarket (store pages and a public merchant-code lookup)" or "(Chase card terms)". A `default` record shows nothing about categories.
5. **Freshness** (14.6). A snapshot of the latest published release is bundled (`MERCHANTS_V1`). Once a week a background `alarms` job fetches `GET /v1/merchants` and `GET /v1/catalog`; "Check for updated terms" does the same at once. A fetched release is kept only if valid and its sequence is not below the cached one (rollback protection, as for catalogs); of the cached and bundled releases the newer `verifiedAt` is in effect. If the service is unreachable, the release in hand is used. A comparison is never blocked.

**Out of scope for Phase 14:** order-confirmation pages and savings at generic stores (still only the three legacy stores); telemetry and the "Suggest it" button (Phase 15); non-U.S. stores (USD only, as today); per-store selectors (never); a merchant page in the review app (Evan reviews the committed review table and the publish dry run instead).

## 5. The candidates: which ~500 stores

The candidate list is `evals/merchants/db/candidates.json`: committed, domains only, each with its group and tier, frozen before any drafting. It includes all 60 domains of the frozen `merchant-pipeline-heldout.1` list (`evals/merchants/pipeline-heldout-domains.json`, 2026-10-06), which become the blind audit set ([section 7](#7-measurement)).

| Group | About | Tier | How chosen |
| --- | ---: | --- | --- |
| Catalog brands | 140 brands, ≈ 120 sites | B | Every brand in `CATALOG_V3`: its official U.S. site(s) |
| Supermarkets and grocery delivery | 40 | B | Leading U.S. grocery chains with online ordering, grocery delivery services |
| Dining and food delivery | 30 | B | Delivery apps, the largest restaurant chains with online ordering |
| Drugstores | 10 | B | National pharmacy chains |
| Streaming | 25 | B | Video, music and audio subscriptions; the issuers' own streaming lists (Amex, Chase) first |
| Entertainment | 20 | B | Ticketing, cinemas, live events, theme parks |
| Home improvement | 10 | B | National home-improvement retailers |
| Wholesale clubs | 5 | B | All U.S. warehouse clubs |
| Department stores | 20 | B | National department stores |
| Electronics | 15 | B | Electronics retailers |
| Transit and EV charging | 15 | B | Rideshare, rail, transit apps, charging networks |
| Payment processors | 15 | B (hand-authored, verified) | PayPal, Shop Pay, Klarna, Affirm, Afterpay, Bolt, Venmo, Amazon Pay and similar |
| Top U.S. online stores | to ≈ 500 | A | The U.S. eligible domains of the frozen `retail-frame-3.json` (agent-classified physical-goods retail, most popular bucket first), minus any domain already in a tier-B group |

**Tiers.** Tier B (about 200) is where a model's judgment matters: a bonus category, a brand or a processor is possible. Tier A (about 300) is the long tail that, under the evidence rule, can only ever be `general-merchandise` with `default` basis and no brands; its records are built without a model. A gate moves a tier-A domain to tier B when its label matches a catalog brand name (normalised), so no brand site hides in tier A.

Names in the bonus groups come from public sources at research time; the coordinator commits the list, not a model's memory.

## 6. How the records are built

Records are committed one JSON file per store under `evals/merchants/db/records/`, with evidence files (URL, date, SHA-256, quote ≤ 25 words) beside them; captures are gitignored. `scripts/build-merchants-v1.mjs` builds `packages/rewards-core/src/merchants-v1.ts` and the release JSON from them, and `npm run merchants:check` keeps the generated file current (like `catalog:v3:check`). A `merchants` command group in `tools/catalog-pipeline` holds the stages (same text-free state, packets and gates as the card pipeline, [internals](../system/card-pipeline-internals.md)); Phase 16 hardens and scales it.

**Tier A (deterministic, no model):**

| Stage | Output |
| --- | --- |
| Homepage capture (Playwright, logged out, robots recorded) | `og:site_name`, `application-name` or `<title>` for the display name, falling back to the domain's own label capitalised; the capture's hash in the manifest |
| Build | `kind: merchant`, `physicalGoods: true` (the frame's classification), `category: general-merchandise`, `evidence: default`, `brandIds: []`, `disabled: false` |
| Gates | Name charset and length; host not a public suffix or platform domain (offline PSL and a short platform list); brand-name gate (moves the store to tier B) |

**Tier B (the small pipeline):**

| Stage | Who | Output | Gate |
| --- | --- | --- | --- |
| 1 Research | `merchant-researcher` subagent (Claude, web), 25 stores per packet | Per store: official U.S. checkout domains, the store's own about or store-type page, any public merchant-code lookup page; URLs only, no values. Issuer pages are not researched: the existing issuer captures of the 178-card catalog are searched deterministically for the store's name, and matches become `issuer` sources | URLs resolve; domains are the store's own; no lookup site's terms forbid citation |
| 2 Capture | CLI (Playwright, logged out, robots recorded) | Gitignored dated captures with a hashed manifest | Every cited URL captured or the source is dropped |
| 3 Draft | gpt-5.6-luna `xhigh` through Codex; new prompt file `merchant-draft.1` | Per store from captures only: kind, `physicalGoods`, brands (from the catalog's brand list), candidate category, evidence quotes with source ids | Zod-valid; quotes found verbatim in captures, ≤ 25 words |
| 4 Verify | `merchant-verifier` subagent (Claude, captures only), 25 stores per packet | Per field: confirmed, or disputed with the reason | Every field decided |
| 5 Apply | CLI, deterministic | Records. **The evidence rule sets `category`**: a candidate stays only with an `issuer` source, or a store page plus an agreeing lookup; otherwise `general-merchandise` with `default`. **Any disputed field holds the whole record out of the release** and lists it in the handoff for Evan; there is no adjudicator | Rule unit-tested; held-out records listed |
| 6 Build | CLI | `merchants-v1.ts`, the release JSON, and `evals/merchants/db/review.md`: only the deviations from the default (bonus categories with their evidence quotes, brands, processors, `physicalGoods: false`, disabled, held-out records) | `merchants:check` up to date |

**Size and cost:** tier B is about 8 research and 8 verify packets. At the card pipeline's 20–40k Claude tokens per item that is about 4–8 million Claude tokens for 200 stores (the first plan's 15–30 million covered 500), plus the luna runs on the ChatGPT subscription; the 14.3 dry run gives a real figure. Live models run locally only, never on Render.

## 7. Measurement

The report is `docs/evals/merchant-db-v1.md`. There is no 70/30 split: the released data is a reviewed list, not a model, so the useful question is "how often is a shipped record wrong", asked of the records that can be wrong in a costly way, plus a frozen sample for the misses.

| Measure | How | Target (reporting, not a gate) |
| --- | --- | --- |
| **Wrong bonus category**, the costly error | A `merchant-auditor` subagent labels, blind to the records and from the captures only, **every** record whose category is not `default` and all 60 domains of the frozen held-out list, under the same evidence rule; labels are written before any record is read. Count records whose category differs from gold | 0, with the exact Clopper–Pearson 95% upper bound |
| Missed bonus category | Gold has a bonus category, the record says `default` (on the 60) | Reported; costs value, not trust |
| **Wrong brand** (a store card accepted where it isn't, or a wrong exclusion) | Gold vs record brands on every record with brands and on the 60 | 0 |
| Wrong kind | Gold vs record on every processor and on the 60 | 0 |
| **Wrong store match** | A URL test set: every candidate's checkout URL, the frozen reader set's U.S. cart URLs, and look-alike traps (`amazon.ca`, `target.com.au`, `walmartmoney.com`, deep subdomains, punycode, `myshopify.com` stores) | 0 wrong matches |
| Engine scenarios | Unit tests: Prime Visa at amazon.com and wholefoodsmarket.com; Target card accepted at target.com only; Freedom Flex grocery excluded at walmart.com; OnePay first-90-days at walmart.com; kroger.com grocery (corroborated); costco.com warehouse club; delta.com with no online-retail rule; PayPal page with no badge; `disabled` → generic; a release naming an unknown brand or category | All pass |
| Size and speed | Release bytes; match time on the device | ≤ 2 MiB; under 1 ms |

**Discipline.** `merchant-draft.1` and the pipeline are tuned only on the 14.3 dry run's 10 development stores, which are excluded from the audit. The audit runs once, after the full build. Disagreements are fixed in the release **after** the report records the pre-fix numbers; the report says which records changed.

## 8. Milestones

One branch and one PR per milestone, from the latest `main`. Each implementation milestone has a Fable 5.1 implementer and an independent Fable 5.1 reviewer; review findings are fixed and re-checked before the PR (agent-verified). The coordinator runs `db-push`, the audit and the publish.

| # | Milestone | Contents | Files | Tests | Done when | Rough size |
| --- | --- | --- | --- | --- | --- | --- |
| 14.1 | Contract, matcher, engine | `merchant-release.1` Zod schema and limits; `recordToProfile` with brand filtering; the Zod-free matcher; `compareRewards`/`compareV3` optional `{ merchant }`; the seed release (the three legacy stores with their brands, the 15 processors) as `MERCHANTS_V1`; `scripts/build-merchants-v1.mjs` and `merchants:check` | `packages/rewards-core/src/merchant-release.ts`, `merchant-match.ts`, `merchants-v1.ts` (generated), `engine-v3.ts`, `engine.ts`; `evals/merchants/db/records/*.json`; `scripts/build-merchants-v1.mjs` | `extension/tests/merchant-release.test.ts` (schema cases, also added to `test-cases.ts` for 14.6 parity), `merchant-match.test.ts` (traps), `rewards-v3.test.ts` (the engine scenarios) | Tests green, review done | 1 day |
| 14.2 | Extension on the bundled release | Matching in the worker (`merchantForTab` replaced; `TabEntry` keeps the matched id and host); the profile passed at every compare (badge, popup, manual read); store names and the evidence line in badge and popup; processor pages hidden; `disabled` → generic; **A5:** popup error copy reworded to never ask for an amount | `extension/src/checkout/merchants.ts`, `background/badge-service.ts`, `state/service.ts`, `popup/Popup.tsx`, `components/RatesResult.tsx`, `ComparisonResult.tsx`, `badge/BadgeApp.tsx` | `badge-service.test.ts`, `state-service.test.ts`, `popup.test.tsx`, `e2e/badge-any-store.spec.ts` (a named store, a processor page) | Gate and browser suite green | 1–2 days |
| 14.3 | Candidates and the merchant pipeline | The frozen candidate list with tiers (the 60 held-out domains included); tier-A builder; tier-B stages under `pipeline merchants`; two agent files (`merchant-researcher`, `merchant-verifier`); `merchant-draft.1`; the apply rule and hold-out rule; `review.md` generator; a dry run on 10 development stores | `evals/merchants/db/candidates.json`, `tools/catalog-pipeline/src/merchants/*.ts`, `.claude/agents/merchant-researcher.md`, `merchant-verifier.md`, `apps/api/src/curation/prompts/merchant-draft.1.*` (or the harness's prompt location), `scripts/build-merchants-v1.mjs` | `tools/catalog-pipeline/tests/merchants-*.test.ts` (apply rule, hold-out rule, tier gates, agent files), `scripts/lib/*.test.mjs` | Dry run complete, cost measured, review done | 1–2 days |
| 14.4 | Seed run | Tier A for all its domains; tier B in packets of 25; every record committed; `review.md` and `merchants-v1.ts` built | `evals/merchants/db/records/`, `evidence/`, manifests; `merchants-v1.ts` | `merchants:check`, quote check | Every tier-B record verified or held out; build green | 2 days |
| 14.5 | Audit and report | `merchant-auditor` agent file; blind labels on every non-default record and the 60; URL match test set; `docs/evals/merchant-db-v1.md`; fixes applied after reporting | `.claude/agents/merchant-auditor.md`, `evals/merchants/db/audit/`, `docs/evals/merchant-db-v1.md` | `merchant-match.test.ts` (the full URL set) | Report committed | ½–1 day |
| 14.6 | Hosted release and weekly refresh | Migration `merchant_releases` (`public.merchant_releases`, `public.merchant_head`, `valid_merchant_release_v1`, `publish_merchant_release` under `require_reviewer`; no drafts or capture tables); parity cases; `GET /v1/merchants` (`no-store`, 503 when unusable, like `/v1/catalog`); `POST /v1/review/merchants` publish route with the token pre-check; `pipeline merchants publish` (dry run, `--confirm <version> --instruction-at`) with the catalog publish's guards; extension fetch, validate, cache and rollback protection; the `alarms` weekly refresh for merchants and catalog (`alarms` permission, no install warning); `./scripts/db-push.sh` by the coordinator after merge | `supabase/migrations/<ts>_merchant_releases.sql`, `supabase/tests/merchant_releases.test.sql`, `apps/api/src/app.ts`, `merchant-repository.ts`, `review-routes.ts`, `packages/catalog-client/src/index.ts`, `tools/catalog-pipeline/src/merchants/publish.ts`, `extension/src/state/merchants.ts`, `background/index.ts`, `manifest.json` | pgTAP, `scripts/test-catalog-parity.mjs` (merchant cases), `apps/api/tests/merchants.test.ts`, `extension/tests/merchant-refresh.test.ts`, `background.test.ts` | API, SQL and parity tests green; migration on hosted | 1–2 days |
| 14.7 | Publish | Evan reads `review.md` and the report and types `publish merchants <version>`; the coordinator publishes from the CLI with Evan's session; the bundled snapshot is updated to the published release | `merchants-v1.ts`; [catalog release](../ops/catalog-release.md) gains a merchant section | `merchants:check` | `GET /v1/merchants` serves it; a `build:hosted` extension loads it | Evan's time |

**Order:**
- 14.1 and 14.3 start in parallel.
- 14.2 follows 14.1; 14.4 follows 14.3 and 14.1 (the schema).
- 14.5 follows 14.4.
- 14.6 follows 14.2.
- 14.7 needs 14.5 and 14.6.
- A Release A build is possible after 14.2 and 14.4 with the bundled release alone; 14.6 adds the refresh and the off switch before the store submission.

The sizes are guesses from Phases 13–13c; the total is roughly a week of working sessions, as before, with less model time.

**The card catalog renewal is unrelated work in parallel.** It is due before 2026-11-04; prepare it around 2026-10-28.

## 9. What Evan does

| When | What |
| --- | --- |
| Now | Approve this plan |
| 14.4 | Nothing, unless the handoff lists held-out records (disputed fields) he wants decided |
| 14.6 | Nothing; `db-push` runs under the standing authorization |
| 14.7 | Read `evals/merchants/db/review.md` (only the deviations: bonus categories with evidence, brands, processors, services) and `docs/evals/merchant-db-v1.md`; type `publish merchants <version>` |
| Any time | Change the evidence rule, the size or a store's record |

## 10. Risks and how the plan handles them

| Risk | Handling |
| --- | --- |
| Few stores reach a bonus category (issuers rarely name stores; lookups are spotty) | Expected and acceptable: brand rules and the goods flag still change many answers; the report counts how many stores got a bonus category |
| A public lookup is wrong, or its terms forbid citation | It can't decide alone (it must agree with the store's own pages); a lookup whose terms forbid citation is dropped at research; the costly error is audited at 100% |
| A wrong brand (a store card shown as accepted at the wrong site) | Brands come only from the catalog's list, mean "this is the brand's own store", are verified per store, and every record with brands is audited |
| Look-alike and platform domains | Label-boundary matching, explicit country domains, the offline public-suffix and platform gate, and a trap test set |
| Release skew (a merchant release names a brand or category the extension's catalog doesn't know) | Unknown brands are ignored and an unknown category fails Zod and keeps the release in hand (tested) |
| Render free tier sleeps | The client tolerates cold starts; weekly refresh retries; the bundled release is always there |
| Model cost or stalls | Tier A needs no model; tier B in small packets, frequent commits, resume by packet (as in Phase 8) |
| A disputed field | The record is held out, not guessed; Evan sees the list |

## 11. Consequences for Phase 15

- The privacy policy and listing say the merchant list is downloaded whole and matched on the device.
- The `alarms` permission is added (no warning).
- The badge names stores. Brand names are for matching only and imply no partnership.
- The A4 adapter retirement check and the A6 site fix are Phase 15 tasks.

## 12. Design review (2026-10-10)

Fable 5.1 reviewed the first plan against the code as it is (`compareV3`, `merchantForTab`, `autoPurchase`, `prepareCatalogUpdate`, the release tables, `tools/catalog-pipeline`). Verdict: the approach is right (hosted reviewed list, on-device suffix match, passed-in profile, evidence-gated category) and correct against the engine, but three parts were over-built for a 500-row data product: a 100%-model pipeline with an adjudication stage for stores that can only be `default`, a review-app page plus draft and capture tables for a release Evan can read as a table, and a 70/30 held-out split for data that is not a model. It also missed the frozen `merchant-pipeline-heldout.1` list from Phase 12. The choices below are recorded in the [decision](../decisions/2026-10-10-phase-14-design.md).

| Choice | Chosen | Main alternatives | Why |
| --- | --- | --- | --- |
| (a) Data delivery | Separate hosted release (binding), **bundled first**: the extension works on the bundled snapshot after 14.2; hosting is 14.6 | Fold records into the catalog release: hits `CATALOG_V3_LIMITS.merchants` 100, inherits the 30-day expiry, makes every catalog publish carry 500 stores and their captures, needs schema v4 in Zod and SQL. Bundled-only: simplest, but no remote off switch and against D2 | Binding, and the ordering removes hosting from Release A's critical path |
| (b) Engine integration | Optional `{ merchant }` on `compareRewards`/`compareV3`, replacing the lookup when its id matches | Splice records into `catalog.merchants` before calling: confuses the catalog's identity (`version`, `stableJson`, wallet pruning, the badge slice) and hits the 100 limit. A merged lookup `merchantProfilesV3(catalog, release)`: the engine would import the release contract | One optional argument; the engine stays release-agnostic and `engine-v3.ts` keeps importing no Zod |
| (c) Record shape | `id, name, hosts, kind, physicalGoods, category, evidence{basis, sourceIds}, brandIds, disabled`; no `expiresAt` on the release | The first plan's record with `onlineRetail`, `usMerchant`, quotes and a 90-day expiry; `plausibleCategories[]` with classes (the pre-decision design) | Two constant flags and shipped quotes removed; the expiry only added an "expired → bundled → generic" ladder that the catalog's own expiry makes redundant |
| (d) Matching | Label-boundary suffix on authored hosts; PSL offline as a gate | Public Suffix List in the extension (hundreds of KB in the worker, still wrong for brands with several registrable domains); exact hosts (every `secure.`/`checkout.` subdomain authored) | Same as the first plan, plus the platform-domain gate (`myshopify.com`) |
| (e) Building the 500 | Two tiers: deterministic records for the long tail; research → capture → luna draft → Claude verify → deterministic apply for the ~200 where a category, brand or processor is possible; disputed records held out, no adjudicator; issuer evidence mined from the existing issuer captures | The full card-pipeline variant for all 500 (15–30M tokens, an adjudicator stage, research of issuer pages already captured); brand domains hand-authored from issuer captures only (no category evidence at all) | The evidence rule makes a model useless on tier A; the three legacy merchant profiles were authored this way already |
| (f) Evaluation | Blind audit of every non-default record plus the frozen 60-domain held-out list; exact bounds; fix after reporting | The first plan's 70/30 split with gold on ~150 stores (labels twice what the pipeline already verified, sample dominated by `default` records); no audit (review only) | Audits the costly error at 100% and reuses the list Phase 12 froze for this purpose |
| Review surface | `evals/merchants/db/review.md` in the PR and the publish dry run | A merchant review page in `apps/review` with draft, source and publication tables | Evan already reviews PRs; the page would have been the largest piece of 14.2 for a list he can read in a table |

**Binding decisions the review would question** (kept as decided):
- *About 500 stores.* Under the evidence rule, roughly 300 of them can only ever be `general-merchandise` with no brands, so they change the ranking at no store; they change only the displayed name and the goods flag. The plan keeps 500 but makes those 300 free of model cost. If the count were open, about 200 (brands, bonus groups, processors) would give the same rankings.
- *Corroboration by a public merchant-code lookup.* Those sites are crowdsourced from card statements and may forbid citation; where that is so, the store falls to `default` and the feature is mostly brand rules plus issuer-named stores. The report will say how many stores reached `corroborated`.

## Progress

- **2026-10-10: planned;** rewritten in full after the audit calls, for Evan's approval.
- **2026-10-10: design review** (Fable 5.1, agent-verified): approach confirmed; pipeline split into tiers, adjudicator and review-app page dropped, held-out split replaced by a blind audit on the frozen list, record shape trimmed, bundled-first order. Awaiting Evan's approval.
- **2026-10-11 (UTC): 14.1 built** on `phase14-1-contract-engine` (Fable 5.1 implementer; independent review pending): `merchantReleaseSchema` and `MERCHANT_RELEASE_LIMITS` ([contract](../system/rewards-engine.md#merchant-release-contract-phase-141)), the Zod-free matcher and `recordToProfile` ([matcher](../system/rewards-engine.md#store-matcher-phase-141)), `compareRewards`/`compareV3` `{ merchant }` ([engine](../system/rewards-engine.md#a-merchant-release-profile-phase-141)), the seed release `2026-10-10.seed.1` (18 records: the three legacy stores with brands on the default category, 15 processors; [merchants](../domain/merchants.md#merchant-release-records-phase-141)) generated by `npm run merchants` and checked in CI. Reviewed the same day (agent-verified; fixes applied: `releaseProfileFor`, processor rules, Amazon Pay hosts). Tests: 57 contract cases in `test-cases.ts`, `merchant-release.test.ts` 67, `merchant-match.test.ts` 16, 10 engine scenarios in `rewards-v3.test.ts`, builder test. Choices in the [details decision](../decisions/2026-10-11-merchant-release-seed-and-contract-details.md). Not in 14.1: `wholefoodsmarket.com` (no seed record; the fixture covers it), the Target store card (not in the bundled catalog; a synthetic closed-loop card stands in), the processor-page popup copy and all extension wiring (14.2).
- **2026-10-11 (UTC): 14.3 built** on `phase14-3-candidates-pipeline` (Fable 5.1 implementer): the frozen [candidate list](../../evals/merchants/db/candidates.json) (692: tier A 380, tier B 312, the 60 held-out domains marked), the tier-A builder, `pipeline merchants` (init, claim/accept research and verify, run capture/draft/apply/build, status, review), the agent files `merchant-researcher` and `merchant-verifier`, prompt `merchant-draft.1`, the apply and hold-out rules and 29 tests ([merchant pipeline](../system/merchant-pipeline.md), [decision](../decisions/2026-10-11-merchant-pipeline-14-3-details.md)). Dry run `dev-2026-10` (10 development stores): research 95,707 Claude tokens / 233 s (Opus); capture 22 pages (2 bot-walled) and 39 issuer captures mined; luna drafts 10 of 10 after one prompt tuning, 97,286 input / 2,478 output tokens, 353 s model time (5–123 s per store); the quote gate caught 3 non-verbatim quotes. Drafted candidates: kroger, instacart, wholefoodsmarket supermarkets; cvs drugstores; netflix streaming; costco wholesale-clubs; lowes home-improvement; ubereats dining; delta services; paypal processor. Verify (Opus, final brief with the issuer-exclusion rule): 385,449 tokens, 306 s, 5 of 10 confirmed. Apply: 5 records (`cvs-us` drugstores with `issuer` basis; `delta-us`, `wholefoodsmarket-us` with brands; `paypal`; `lowes-us`) and 5 held out on disputed evidence (kroger, netflix, instacart, costco, ubereats: issuer quotes that exclude the store, name another category or a credit, or a host in no capture). Release `2026-10-11.dev.1` (22 records), `review.md` written. Issuer quotes count as category evidence only when they name the store and state earning (`issuerQuoteEarns`). Details and the cost projection: [merchant pipeline, dry run](../system/merchant-pipeline.md#dry-run-development-batch-dev-2026-10).
