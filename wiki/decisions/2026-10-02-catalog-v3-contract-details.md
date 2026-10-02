---
type: Decision
title: Catalog v3 contract details for Stage 2 M1
description: Choices made while implementing the catalog v3 Zod schema and SQL validator — separate v3 enums, per-version size limits, categories as replaceable SQL functions, the unconditional-base rule, brand exclusions and shared caps, the program valuation union, the published-estimate date window, and refusing v3 releases in the extension until the v3 engine ships.
status: accepted
tags: [decision, catalog, schema, database, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:00:00Z
sources:
  - resource: ../../packages/rewards-core/src/schema.ts
    title: catalogV3Schema
  - resource: ../../packages/rewards-core/src/types.ts
    title: Catalog v3 types and enums
  - resource: ../../supabase/migrations/20261002222425_catalog_v3.sql
    title: valid_catalog_v3 and raised limits
  - resource: ../../packages/rewards-core/test-cases.ts
    title: CATALOG_V3_FIXTURE and catalogV3Cases
---

# Catalog v3 contract details for Stage 2 M1 (2026-10-02)

## Context
The [catalog v3 decision](2026-10-02-catalog-v3-schema.md) fixes the shape (programs, brands, gates, choices, closed-loop cards, rule scope fields, limits). Implementing it in Zod and SQL ([Stage 2 plan](../product/phase-7-stage-2.md) M1) needed several smaller choices that the plan leaves open, while v1/v2 behavior had to stay unchanged and the engine (M2), overlay (M4), extension (M6/M7) and review app (M8) come later.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| New enum members (Venmo, uncertainties, statuses, categories) | Separate `*_V3` constants (`PAYMENT_PATHS_V3`, `UNCERTAINTIES_V3`, `RULE_STATUSES_V3`, `REWARD_CATEGORIES_V3`, `MERCHANT_CATEGORIES_V3`) | Extending the shared v2 constants would change the v2 engine's purchase validation and break exhaustive UI label records before M2/M7 handle them |
| Size limit | `MAX_CATALOG_BYTES` stays 262,144 for v1/v2; `CATALOG_V3_LIMITS.bytes` is 1,048,576 | Raising `MAX_CATALOG_BYTES` would loosen v1/v2 validation; the catalog client's response cap (built on it) is left to M6/M8 |
| How M4 adds categories | SQL functions `catalog_v3_reward_categories()` / `catalog_v3_merchant_categories()` that a later migration replaces; the parity script compares them with the TS constants | A JSON-schema `enum` inside `valid_catalog_v3` would force M4 to restate the whole validator in a new migration |
| Base rule | Open-loop: exactly one **unconditional** `all-purchases` rule (no spend cap, enroll-once/recurring activation, time limit, excluded or required payment path, brand scope, choice or gate). Closed-loop: at most one. Other `all-purchases` rules with conditions are allowed | "Exactly one `all-purchases` rule" (v2) cannot hold PayPal Cashback's 3% via PayPal or a gated relationship bonus on all purchases |
| Point value fields | Program `valuation` union: `cash` (literal 100, only and always for `cash-back` programs), `published-estimate` (value, publisher, HTTPS URL, `retrievedOn`), `issuer-stated` (value, source IDs), `none` (units only). Card keeps `statedValueHundredthsOfCent` (points programs only). The card's `rewardCurrency` is dropped; the program's `currency` replaces it | Flat optional fields would allow an estimate without a publisher or a cash program with another value |
| Estimate date | `retrievedOn` between 30 days before `verifiedAt` and the `expiresAt` date | Requiring it on or before `verifiedAt` (like sources) would reject values M3 reads after the 2026-10-02 capture date that the catalog is verified on |
| Gates and choices | Gates are catalog-level questions with 2–10 options; a rule `requires` some, not all, options of up to 5 distinct gates. Choices are per card (≤ 5), `chosen` or `automatic`, `picks` fewer than options, defaults only for `chosen`; a rule names one `{choiceId, optionId}` | Per-card gates would duplicate shared questions (Prime, BofA Rewards) across cards |
| Brand exclusions and combined caps (added in the pre-merge review) | Rule `excludedBrandIds` (resolves, disjoint from `brandIds`, none on a base) and card-scoped `sharedCapId` (every rule with the ID has a spend cap of the same amount and period) | Without them M4 must drop "excluding Walmart and Target" (Freedom Flex, Carnival), Edward Jones's Amazon/Walmart/Target exclusion and the combined caps of Cash+, Customized Cash, Freedom Flex, Discover and Southwest, and per-rule caps overstate the headroom left |
| Provisional categories | `electronics`, `department-stores`, `home-improvement`, `wholesale-clubs` (reward and merchant lists; `electronics` was already a merchant category) | Others named by options (travel, utilities, fitness) never apply at the retail checkouts the extension supports; M4 adds any it needs |
| Extension before M6 | `prepareCatalogUpdate` refuses a v3 release and keeps saved terms; `compareRewards` throws for v3 | Accepting v3 in the shared `catalogSchema` would otherwise let the current extension cache a release its engine cannot run |
| Size measure | Zod counts `JSON.stringify` bytes, SQL `octet_length(payload::text)` (JSONB text adds spaces), as in v2 | An exact match is not available in SQL; M5 targets ≤ 75% of the limit, far from the boundary |

## Decision
As in the "Chosen" column. Draft source references rise to 600 (`drafts` CHECK, `save_catalog_draft`, `@ai-checkout/catalog-review`) and captured source text to 250,000 characters (`source_documents` CHECK, `MAX_SOURCE_BODY_CHARS`) in the same migration, `20261002222425_catalog_v3`.

## Consequences
- M2 adds the v3 engine and widens `Purchase.paymentPath` and estimate types to the `*_V3` enums; until then a v3 catalog cannot be compared.
- M6 removes the extension's v3 refusal and raises the catalog client's response cap (`MAX_RESPONSE_BYTES` is still `MAX_CATALOG_BYTES` + 2 KiB); M8 raises the API's draft body limit (270,336 bytes) and shows v3 fields in the review app (it shows only the program today).
- M4 handles, without contract changes: spend caps whose after-cap rate the corpus leaves null (9 rules: Southwest, Discover it Student, Instacart, State Farm) by stating the base rate with a disposition; caps on rewards earned rather than spend (Sam's Club's $5,000 Sam's Cash a year) as `noted`; store-credit cash back (Verizon Dollars, OneKeyCash, Walgreens Cash, Key Rewards and My Best Buy certificates) as separate `cash-back` programs with `redemptionBrandIds`, since M3's table maps them all to `cash-back`; percentage boosts (Atmos +10% with a BofA account) as gated duplicate rules; account-age promotions (first-year 6%, first 30 days) as `limitedTime` without dates or a gate.
- M4 extends categories by replacing the two SQL functions in a new migration and the TS constants in the same PR; `db:test:catalog` fails if they differ.

## Status
Accepted 2026-10-02 by the M1 implementing agent within the accepted [catalog v3 decision](2026-10-02-catalog-v3-schema.md); the coordinator or Evan can revise any row before M2/M4 build on it.
