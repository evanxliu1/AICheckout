---
type: System Component
title: Rewards engine
description: packages/rewards-core — the catalog v1/v2/v3 Zod contract, the bundled 7-card catalog, compareRewards, rule applicability, uncertainty ranges and ranking.
status: stable
tags: [system, rewards-core, catalog, engine]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
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
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: v3 engine
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
  - resource: ../decisions/2026-10-02-catalog-v3-contract-details.md
    title: Catalog v3 contract details (M1)
  - resource: ../decisions/2026-10-02-engine-v3-semantics.md
    title: Catalog v3 engine semantics (M2)
---

# Rewards engine

`packages/rewards-core` (`@ai-checkout/rewards-core`) is pure TypeScript with no browser, network, database, model or clock access: callers pass the catalog, wallet, purchase and `now`. It owns the catalog contract (strict Zod, schemas 1, 2 and 3 as a discriminated union on `schemaVersion`), the bundled catalogs, and `compareRewards`, which ranks owned cards by **guaranteed minimum** reward and reports a range when a condition is unknown. Money is integer cents, rates are basis points, products are summed in BigInt and truncated once. The same contract is enforced in the extension, the API, the review app and, mirrored in SQL, the database ([Database](database.md)).

Verified 2026-10-02 by reading the code; parity case counts verified by importing `test-cases.ts` with Node (28 v1, 53 v2, 117 v3). The v3 engine is Stage 2 M2 (branch `s2-m2-engine-v3`); the extension still refuses v3 releases until M6. The bundled catalog expires 2026-10-29, hence `stale_after`.

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Bundled real catalog | `CATALOG_V2`, version `2026-09-29.real.1`, `verifiedAt` 2026-09-29, `expiresAt` 2026-10-29; 7 cards, 3 merchants (`best-buy-us`, `newegg-us`, `amazon-us`) | [`src/catalog-v2.ts`](../../packages/rewards-core/src/catalog-v2.ts) (generated, do not edit) |
| Pilot catalog | `PILOT_CATALOG` (schema 1), kept for v1 tests and old cached releases | [`src/catalog.ts`](../../packages/rewards-core/src/catalog.ts) |
| Size and age limits | `MAX_CATALOG_BYTES` 262,144 (v1, v2); `CATALOG_V3_LIMITS` (v3): 1,048,576 bytes, 300 cards, 600 sources, 100 merchants, 400 brands, 100 programs, 100 gates, 30 rules per card; validity window ≤ 30 days (`CATALOG_MAX_AGE_MS`) | [`src/schema.ts`](../../packages/rewards-core/src/schema.ts) |
| Amount limit | `MAX_AMOUNT_CENTS` 10,000,000 | [`src/money.ts`](../../packages/rewards-core/src/money.ts) |
| Reward categories | `all-purchases`, `online-retail`, `supermarkets`, `gas`, `ev-charging`, `dining`, `drugstores`, `entertainment`, `streaming`, `transit`, `travel-portal`, `entertainment-portal`, `other`; v3 adds `electronics`, `department-stores`, `home-improvement`, `wholesale-clubs` (provisional; M4 finalizes) | `REWARD_CATEGORIES`, `REWARD_CATEGORIES_V3` in [`src/types.ts`](../../packages/rewards-core/src/types.ts) |
| Merchant categories | `MERCHANT_CATEGORIES` (10); v3 adds `department-stores`, `home-improvement`, `wholesale-clubs` | `MERCHANT_CATEGORIES_V3` |
| Payment paths | `card` (default), `paypal`, `digital-wallet`, `bnpl`; v3 adds `venmo` | `PAYMENT_PATHS`, `PAYMENT_PATHS_V3` |
| Uncertainty codes | `online-category-unknown`, `annual-usage-unknown`, `activation-unknown`, `cap-usage-unknown`, `cap-unstated`, `payment-path-uncertain`; v3 adds `choice-unknown`, `automatic-category`, `condition-unknown`, `value-unknown` | `UNCERTAINTIES`, `UNCERTAINTIES_V3` |
| Rule statuses | v2: `applied`, `may-apply`, `base`, `not-at-merchant`, `not-eligible`, `expired`, `cap-reached`; v3 adds `not-accepted`, `not-started`, `choice-not-selected`, `condition-not-met` | `RuleStatus`, `RULE_STATUSES_V3` |
| Unavailable reasons | `catalog-expired`, `catalog-not-yet-valid`, `unsupported-merchant`, `no-owned-cards`, `unknown-owned-card`, `purchase-not-confirmed`, `ineligible-purchase`; v3 adds `no-accepted-card` | `UnavailableComparison` |
| Parity cases | `catalogCases` 28 (v1), `catalogV2Cases` 53 (v2), `catalogV3Cases` 117 (v3, from the synthetic `CATALOG_V3_FIXTURE`) | [`test-cases.ts`](../../packages/rewards-core/test-cases.ts) |
| Engine tests | `rewards.test.ts` (v1), `rewards-v2.test.ts`, `rewards-v3.test.ts` (87: every v3 status and uncertainty, ladders at the three merchants, value precedence, shared caps, usage inputs, review edge cases: day boundaries, exhausted shared caps, all-unvalued wallets, gates with choices, malformed inputs) | [`extension/tests/`](../../extension/tests/rewards-v3.test.ts) |

## Catalog v2 contract

`catalogV2Schema`: `{schemaVersion: 2, version, verifiedAt, expiresAt, merchants[1..20], sources[1..30], cards[1..30]}`.

- **Rule** (`rewardRuleV2Schema`): `category`, `issuerWording`, `rateBps` (total, including any paid-on-payment part), `paidOnPaymentBps`, `cap` = `{kind:'none'}` | `{kind:'spend', amountCents, period, rateAfterCapBps}` | `{kind:'unstated'}`, `activation` = `none|enroll-once|recurring|unstated`, `usMerchantsOnly`, `excludedPaymentPaths`, `limitedTime {endsOn|null}|null`, `sourceIds` (≥ 1).
- **Card**: `id`, `name`, `shortName`, `issuer`, `rewardCurrency` (`cash-back|points`), `pointValueHundredthsOfCent` (required iff points), `rules[1..20]`, `exclusions[]`.
- **Merchant profile**: `onlineRetail`, `physicalGoods`, `usMerchant`, `expectedCategory` (`MERCHANT_CATEGORIES`), `mcc {code|null, confidence, sourceIds}`, `notes`.
- **Invariants** (superRefine): unique merchant/card IDs, globally unique rule IDs; exactly one `all-purchases` rule per card with no spend cap, no `enroll-once`/`recurring` activation, no time limit, no excluded paths; bonus rate ≥ base; `paidOnPaymentBps` ≤ rate; `base ≤ rateAfterCapBps ≤ rate`; every source reference resolves; a stated MCC needs a source; an unknown MCC is `low` confidence; plus common window and size checks.
- `publishedReleaseSchema` wraps a catalog with `sequence`, `version` (must equal the catalog's), `catalog_hash` (64-hex, identifies the DB payload; not a signature), `published_at` (inside the validity window). `catalogResponseSchema = {release: … | null}` is the `/v1/catalog` wire format.

## Catalog v3 contract

`catalogV3Schema` (decisions: [schema](../decisions/2026-10-02-catalog-v3-schema.md), [details](../decisions/2026-10-02-catalog-v3-contract-details.md)): `{schemaVersion: 3, version, verifiedAt, expiresAt, programs[1..100], brands[0..400], gates[0..100], merchants[1..100], sources[1..600], cards[1..300]}`.

- **Program**: `id`, `name`, `currency` (`cash-back|points`), `unitName` (plural, e.g. "miles"), `valuation` = `{basis:'cash', valueHundredthsOfCent:100}` | `{basis:'published-estimate', valueHundredthsOfCent, publisher, url, retrievedOn}` | `{basis:'issuer-stated', valueHundredthsOfCent, sourceIds}` | `{basis:'none'}`, `redemptionBrandIds` (store-only rewards; empty = unrestricted). Values are 1–10,000 hundredths of a cent.
- **Brand** `{id, name}`; **gate** `{id, question, options[2..10]{id,label}}` (membership, tier or relationship question shared across cards).
- **Merchant**: v2 profile with `expectedCategory` from `MERCHANT_CATEGORIES_V3`, plus `brandIds`.
- **Card**: `id`, `name`, `shortName`, `issuer`, `programId`, `statedValueHundredthsOfCent` (issuer-stated, points programs only; replaces v2 `pointValueHundredthsOfCent`; no `rewardCurrency`), `acceptance` = `{kind:'open-loop'}` | `{kind:'closed-loop', brandIds[1..]}`, `choices[0..5]` = `{id, kind: chosen|automatic, label, picks 1..5, options[2..30], defaultOptionIds}`, `rules[1..30]`, `exclusions[0..20]`.
- **Rule**: v2 fields with `category` from `REWARD_CATEGORIES_V3`, `excludedPaymentPaths` ⊆ `paypal, venmo, digital-wallet, bnpl`, `limitedTime {startsOn|null, endsOn|null}|null`, plus `brandIds` (merchant scope), `excludedBrandIds` (never at these brands; disjoint from `brandIds`), `sharedCapId` (card-scoped ID of a combined spend cap), `choice {choiceId, optionId}|null`, `requires [{gateId, optionIds}]` (≤ 5), `requiredPaymentPaths` (⊆ `PAYMENT_PATHS_V3`).
- **Invariants**: unique IDs per list, gate options, choices and choice options, globally unique rule IDs; every program, brand, gate, choice option and source reference resolves; cash back is valued as cash and nothing else is; a published estimate is read from 30 days before `verifiedAt` to the `expiresAt` date; open-loop cards have exactly one unconditional `all-purchases` rule (`isUnconditionalRuleV3`: no spend cap, enroll-once/recurring activation, time limit, excluded or required path, brands or excluded brands, choice or gate), closed-loop cards at most one; rates ≥ base and after-cap rules as v2 when a base exists; `startsOn ≤ endsOn`; a requirement lists some, not all, options of a gate, each gate once; a path cannot be both required and excluded, nor a brand both in scope and excluded; rules sharing a cap ID on one card all have spend caps with the same amount and period; `picks` < options, defaults ≤ picks and none for `automatic`; plus the common window, source-age and size checks.
- `compareRewards` runs v3 catalogs through `compareV3` (below); `usageInputs` covers v3; `redateCatalog` also moves `startsOn` and estimate `retrievedOn` dates.

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

## How compareRewards works (v3)

[`engine-v3.ts:compareV3`](../../packages/rewards-core/src/engine-v3.ts) keeps the v2 steps (validation, `unavailableReason`, rules do not stack, uncertain rules give a base-to-rule range, after-cap rates, same-day usage) and adds, per the [engine semantics decision](../decisions/2026-10-02-engine-v3-semantics.md) as amended by the [pre-merge review decision](../decisions/2026-10-02-engine-v3-review-gates-and-shared-caps.md):

- **Inputs.** `WalletCard.choices` `[{choiceId, optionIds}]` (complete selection of a `chosen` choice, 1 to `picks`), `Wallet.gates` `[{gateId, optionId}]` (one answer per gate, shared by every card: gates describe the cardholder), `Wallet.valueOverrides` `[{programId, valueHundredthsOfCent}]` (points programs, 1–10,000). All optional; v1/v2 ignore them; unknown IDs and malformed shapes throw (`Invalid wallet choices.`, `Invalid wallet gates.`, `Invalid value override.`). `Purchase.paymentPath` accepts `venmo` (a v2 catalog still rejects it).
- **Acceptance.** A closed-loop card whose `brandIds` miss the merchant's goes to `Comparison.notAccepted` (every rule `not-accepted`), not `estimates`; if no owned card is accepted the result is `no-accepted-card`.
- **Base.** The unconditional `all-purchases` rule (`baseRuleV3`); a closed-loop card may have none (base reward 0).
- **Blocking order** (`blocked`): portal, or `other` without brands → `not-at-merchant`; `endsOn` before the purchase or `verifiedAt` date → `expired`; `startsOn` after the purchase date → `not-started`; brand scope or excluded brand or category (`ruleCoversMerchant`: brand-scoped `other`/`all-purchases` need only the brand) → `not-at-merchant`; online retail ruled out, U.S.-only, excluded path, required path not used, known-inactive activation → `not-eligible`; a selected choice without this option → `choice-not-selected`; a gate answered outside the required options → `condition-not-met`.
- **Ranges** (`evaluate`): the v2 codes, except no `payment-path-uncertain` when the rule requires that path; `automatic-category` for an automatic choice; `choice-unknown` for an unanswered chosen choice (defaults are not assumed); `condition-unknown` for an unanswered gate. A shared cap reads its spend from the group's rule with the smallest ID (`capHolder`), whatever the rules' order.
- **Guaranteed minimum** (`guaranteed`): the best option's minimum, or, with unanswered gates, the worst case over the possible answers of the best minimum each answer allows (Prime Visa at Amazon with Prime unknown: 3–5%, not 1–5%). Answers are grouped by which requirements they meet; past 64 combinations per card (`MAX_GATE_COMBINATIONS`) it falls back to base-to-rule ranges.
- **Money.** Per range end one BigInt numerator Σ spend × bps; units = ⌊n / 10,000⌋; cents = ⌊n × value / 1,000,000⌋ with value = override → card `statedValueHundredthsOfCent` → program valuation (`unitValueFor`). A `cash` valuation must be 100. A program with valuation `none` and no override has no value: cents 0, `unitValue: null`, `value-unknown`. Codes and `may-apply` are reported when they move the shown amount (cents, or units when unvalued).
- **Estimate fields** added for v3: `programId`, `minRewardUnits`, `maxRewardUnits`, `unitValue` `{hundredthsOfCent, basis: override | card-stated | cash | published-estimate | issuer-stated}` or null; `appliedRuleId` is absent only for a base-less card with nothing applicable.
- **Ranking** (`rankV3`): valued cards by minimum cents, then unvalued cards by minimum units; default card, then card ID break ties. `rankingMayChange` when another valued card's maximum beats a valued leader's minimum, or any unvalued card earns units (or, among unvalued cards, a same-program card's maximum beats the leader's minimum, any units from another program). `tied` compares only comparable cards. `preferredCardId` always names one accepted card.

The v1 engine (`compareV1`) supports only one base `all-eligible` rule and at most one `us-online-retail` bonus with an annual cap; see [`README.md`](../../packages/rewards-core/README.md).

## Gotchas

- `CATALOG_V2` is generated by `npm run catalog:v2` from `evals/curation/real/corpus.v2.json` gold labels, the capture manifest and `evals/curation/real/merchants.json` — never from model output. CI runs `catalog:v2:check`; editing the TS file by hand fails it.
- Expiry is real: after 2026-10-29 the bundled catalog returns `catalog-expired` unless a newer published release is cached. Browser tests re-date it with `redateCatalog` via `VITE_E2E_CATALOG_DATE`.
- Any Zod change must be mirrored in the SQL validator for that version (new migration) and covered by a parity case; `scripts/test-catalog-parity.mjs` runs all three lists through both validators and compares the v3 category lists with their SQL functions.
- `catalogSchema` accepts v3, so the extension's `prepareCatalogUpdate` refuses v3 releases explicitly until M6 wires the v3 engine into the extension state; the extension's `responseSchema` still lists only the v2 codes.
- v3 wallet inputs (`Wallet.gates`, `valueOverrides`, card `choices`, usage rows) that reference IDs a catalog no longer has make `compareV3` throw (as v2 usage rows do); M6 prunes them on catalog updates.
- `engine-v3.ts` must not import `schema.ts` (Zod); shared rule predicates live in `rules-v3.ts`.
- v3 size is measured as `JSON.stringify` bytes in Zod and JSONB text bytes in SQL (spaces after `:` and `,`), so the SQL count is a little larger; stay well under 1 MiB.
- `stableJson` is local equality, not PostgreSQL JSONB hashing.
- The package has no test script of its own; its tests live in `extension/tests/rewards.test.ts`, `rewards-v2.test.ts`, `rewards-v3.test.ts`, `catalog-schema.test.ts` (which also runs `catalogV3Cases`).

## Related

* [Extension](extension.md)
* [Cart badge](cart-badge.md)
* [Database](database.md)
* [Review app](review-app.md)
* [Glossary](../domain/glossary.md)
