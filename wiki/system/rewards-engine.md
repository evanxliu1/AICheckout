---
type: System Component
title: Rewards engine
description: packages/rewards-core — the catalog v1/v2 Zod contract, the bundled 7-card catalog, compareRewards, rule applicability, uncertainty ranges and ranking.
status: stable
tags: [system, rewards-core, catalog, engine]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
stale_after: 2026-10-29T00:00:00Z
sources:
  - resource: ../../packages/rewards-core/src/types.ts
    title: Domain types and enums
  - resource: ../../packages/rewards-core/src/schema.ts
    title: Catalog Zod schemas
  - resource: ../../packages/rewards-core/src/engine.ts
    title: compareRewards and v1 engine
  - resource: ../../packages/rewards-core/src/engine-v2.ts
    title: v2 engine
  - resource: ../../packages/rewards-core/src/engine-shared.ts
    title: Validation, unavailability, ranking
  - resource: ../../packages/rewards-core/src/money.ts
    title: Integer money math
  - resource: ../../packages/rewards-core/src/catalog-v2.ts
    title: Generated CATALOG_V2
  - resource: ../../packages/rewards-core/test-cases.ts
    title: Cross-layer parity cases
  - resource: ../../packages/rewards-core/README.md
    title: Package README
  - resource: ../archive/phase2-goal.md
    title: Phase 3 decisions (archived)
---

# Rewards engine

`packages/rewards-core` (`@ai-checkout/rewards-core`) is pure TypeScript with no browser, network, database, model or clock access: callers pass the catalog, wallet, purchase and `now`. It owns the catalog contract (strict Zod, schema 1 and 2 as a discriminated union on `schemaVersion`), the bundled catalogs, and `compareRewards`, which ranks owned cards by **guaranteed minimum** reward and reports a range when a condition is unknown. Money is integer cents, rates are basis points, products are summed in BigInt and truncated once. The same contract is enforced in the extension, the API, the review app and, mirrored in SQL, the database ([Database](database.md)).

Verified 2026-10-02 by reading the code; parity case counts verified by importing `test-cases.ts` with Node (28 v1, 53 v2). The bundled catalog expires 2026-10-29, hence `stale_after`.

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Bundled real catalog | `CATALOG_V2`, version `2026-09-29.real.1`, `verifiedAt` 2026-09-29, `expiresAt` 2026-10-29; 7 cards, 3 merchants (`best-buy-us`, `newegg-us`, `amazon-us`) | [`src/catalog-v2.ts`](../../packages/rewards-core/src/catalog-v2.ts) (generated, do not edit) |
| Pilot catalog | `PILOT_CATALOG` (schema 1), kept for v1 tests and old cached releases | [`src/catalog.ts`](../../packages/rewards-core/src/catalog.ts) |
| Size and age limits | `MAX_CATALOG_BYTES` 262,144; validity window ≤ 30 days (`CATALOG_MAX_AGE_MS`) | [`src/schema.ts`](../../packages/rewards-core/src/schema.ts) |
| Amount limit | `MAX_AMOUNT_CENTS` 10,000,000 | [`src/money.ts`](../../packages/rewards-core/src/money.ts) |
| Reward categories | `all-purchases`, `online-retail`, `supermarkets`, `gas`, `ev-charging`, `dining`, `drugstores`, `entertainment`, `streaming`, `transit`, `travel-portal`, `entertainment-portal`, `other` | `REWARD_CATEGORIES` in [`src/types.ts`](../../packages/rewards-core/src/types.ts) |
| Payment paths | `card` (default), `paypal`, `digital-wallet`, `bnpl` | `PAYMENT_PATHS` |
| Uncertainty codes | `online-category-unknown`, `annual-usage-unknown`, `activation-unknown`, `cap-usage-unknown`, `cap-unstated`, `payment-path-uncertain` | `UNCERTAINTIES` |
| Rule statuses (v2) | `applied`, `may-apply`, `base`, `not-at-merchant`, `not-eligible`, `expired`, `cap-reached` | `RuleStatus` |
| Unavailable reasons | `catalog-expired`, `catalog-not-yet-valid`, `unsupported-merchant`, `no-owned-cards`, `unknown-owned-card`, `purchase-not-confirmed`, `ineligible-purchase` | `UnavailableComparison` |
| Parity cases | `catalogCases` 28 (v1), `catalogV2Cases` 53 (v2) | [`test-cases.ts`](../../packages/rewards-core/test-cases.ts) |

## Catalog v2 contract

`catalogV2Schema`: `{schemaVersion: 2, version, verifiedAt, expiresAt, merchants[1..20], sources[1..30], cards[1..30]}`.

- **Rule** (`rewardRuleV2Schema`): `category`, `issuerWording`, `rateBps` (total, including any paid-on-payment part), `paidOnPaymentBps`, `cap` = `{kind:'none'}` | `{kind:'spend', amountCents, period, rateAfterCapBps}` | `{kind:'unstated'}`, `activation` = `none|enroll-once|recurring|unstated`, `usMerchantsOnly`, `excludedPaymentPaths`, `limitedTime {endsOn|null}|null`, `sourceIds` (≥ 1).
- **Card**: `id`, `name`, `shortName`, `issuer`, `rewardCurrency` (`cash-back|points`), `pointValueHundredthsOfCent` (required iff points), `rules[1..20]`, `exclusions[]`.
- **Merchant profile**: `onlineRetail`, `physicalGoods`, `usMerchant`, `expectedCategory` (`MERCHANT_CATEGORIES`), `mcc {code|null, confidence, sourceIds}`, `notes`.
- **Invariants** (superRefine): unique merchant/card IDs, globally unique rule IDs; exactly one `all-purchases` rule per card with no spend cap, no `enroll-once`/`recurring` activation, no time limit, no excluded paths; bonus rate ≥ base; `paidOnPaymentBps` ≤ rate; `base ≤ rateAfterCapBps ≤ rate`; every source reference resolves; a stated MCC needs a source; an unknown MCC is `low` confidence; plus common window and size checks.
- `publishedReleaseSchema` wraps a catalog with `sequence`, `version` (must equal the catalog's), `catalog_hash` (64-hex, identifies the DB payload; not a signature), `published_at` (inside the validity window). `catalogResponseSchema = {release: … | null}` is the `/v1/catalog` wire format.

## How compareRewards works (v2)

[`engine.ts:compareRewards`](../../packages/rewards-core/src/engine.ts) dispatches on `schemaVersion`; v2 is [`engine-v2.ts:compareV2`](../../packages/rewards-core/src/engine-v2.ts).

1. Validate purchase, wallet and catalog (throws on malformed input); return an `UnavailableComparison` for expiry, unknown merchant, empty or unknown wallet cards, or unconfirmed/ineligible purchase ([`engine-shared.ts:unavailableReason`](../../packages/rewards-core/src/engine-shared.ts)).
2. Per owned card, classify each non-base rule (`blocked`):
   - `travel-portal`, `entertainment-portal`, `other` → `not-at-merchant`.
   - `limitedTime.endsOn` before the purchase date or before the catalog's `verifiedAt` → `expired`.
   - `online-retail` needs `merchant.onlineRetail && physicalGoods`; shopper-declared ineligible → `not-eligible`.
   - Any other category applies only if it equals `merchant.expectedCategory`.
   - `usMerchantsOnly` at a non-U.S. merchant, an excluded non-card payment path, or activation reported `inactive` → `not-eligible`.
3. Evaluate the rest (`evaluate`): uncertainty from unknown online-retail eligibility, non-card payment path, `enroll-once`/`recurring` activation not confirmed `active`, or `unstated` cap. With a spend cap, spend up to the remaining cap earns `rateBps` and the rest `rateAfterCapBps`; unknown usage gives a range (`annual-usage-unknown` for yearly periods, else `cap-usage-unknown`). An uncertain rule contributes `[min(base, rule), max(base, rule)]`.
4. Rules do not stack. The card's minimum is the best rule minimum and its maximum the best rule maximum, never below the base reward. `appliedRuleId` is the rule with the highest possible reward (or the base); `paidOnPaymentBps` is reported for the Citi pay-later note.
5. [`rankEstimates`](../../packages/rewards-core/src/engine-shared.ts): sort by `minRewardCents` desc, then the default card, then card ID. `rankingMayChange` if any other card's maximum exceeds the leader's minimum; `tied` if minima are equal.

Usage rows count only for the same calendar year **and** the same `recordedOn` date as the purchase; older usage is treated as unknown, not zero. Activation `unstated` is treated as `none` (coordinator decision 2026-10-01, recorded in the archived [Phase 3 plan](../archive/phase2-goal.md); the [Decisions](../decisions/index.md) directory owns any later record).

The v1 engine (`compareV1`) supports only one base `all-eligible` rule and at most one `us-online-retail` bonus with an annual cap; see [`README.md`](../../packages/rewards-core/README.md).

## Gotchas

- `CATALOG_V2` is generated by `npm run catalog:v2` from `evals/curation/real/corpus.v2.json` gold labels, the capture manifest and `evals/curation/real/merchants.json` — never from model output. CI runs `catalog:v2:check`; editing the TS file by hand fails it.
- Expiry is real: after 2026-10-29 the bundled catalog returns `catalog-expired` unless a newer published release is cached. Browser tests re-date it with `redateCatalog` via `VITE_E2E_CATALOG_DATE`.
- Any Zod change must be mirrored in `catalog_private.valid_catalog_v2` (new migration) and covered by a parity case; `scripts/test-catalog-parity.mjs` runs both lists through both validators.
- `stableJson` is local equality, not PostgreSQL JSONB hashing.
- The package has no test script of its own; its tests live in `extension/tests/rewards.test.ts`, `rewards-v2.test.ts`, `catalog-schema.test.ts`.

## Related

* [Extension](extension.md)
* [Cart badge](cart-badge.md)
* [Database](database.md)
* [Review app](review-app.md)
* [Glossary](../domain/glossary.md)
