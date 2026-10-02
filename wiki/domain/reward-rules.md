---
type: Domain Concept
title: Reward rules
description: Rule categories, when each applies at an online checkout, null and unstated semantics, payment paths, caps, and how cards are ranked.
status: stable
tags: [domain, rewards, engine]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../packages/rewards-core/src/types.ts
    title: Catalog v2 types (RewardRuleV2, RuleCap, PaymentPath, Uncertainty)
  - resource: ../../packages/rewards-core/src/engine-v2.ts
    title: Catalog v2 engine (compareV2)
  - resource: ../../packages/rewards-core/src/engine-shared.ts
    title: Shared validation and ranking (rankEstimates)
  - resource: ../../packages/rewards-core/README.md
    title: Rewards core README
  - resource: ../../docs/research/cashback-card-terms-2026.md
    title: Research report, seven cashback cards (checked 2026-09-28)
---

# Reward rules

A catalog v2 rule is one earning rule as an issuer states it: a category, a total rate, the part of that rate paid only on payment, a cap, an activation requirement, a U.S.-only flag, any excluded payment paths, and an optional promotion end date. The engine (`compareV2` in [`engine-v2.ts`](../../packages/rewards-core/src/engine-v2.ts)) decides whether each rule applies at one merchant checkout. When it cannot be sure, it reports a range from the base reward to the bonus. Cards are ranked by guaranteed minimum. The rules for the seven real cards are listed in [Cards](cards.md).

## Facts

### Categories and applicability at a retail checkout

| Category | Basis (research taxonomy) | Applies when |
| --- | --- | --- |
| `all-purchases` | flat base | Always. Exactly one per card. It cannot have a spend cap or required activation |
| `online-retail` | channel | Merchant is `onlineRetail` and `physicalGoods`; U.S. merchant if `usMerchantsOnly`; the shopper has not marked the purchase not-online; payment path not excluded |
| `supermarkets`, `gas`, `ev-charging`, `dining`, `drugstores`, `entertainment`, `streaming`, `transit` | MCC group (streaming is a merchant list) | Only when the merchant profile's `expectedCategory` equals the rule category |
| `travel-portal`, `entertainment-portal` | portal | Never at a retail checkout (`not-at-merchant`) |
| `other` | anything else | Never |

Rules do not stack. Each card earns its best applicable rule, and never less than its base.

### Rule fields (`RewardRuleV2` in [`types.ts`](../../packages/rewards-core/src/types.ts))

| Field | Values | Meaning |
| --- | --- | --- |
| `rateBps` | int, ≥ base rate, ≤ 10,000 | Total rate, including any paid-on-payment part. Not an increment |
| `paidOnPaymentBps` | 0..rateBps | Part earned only when the balance is paid (Citi "1% as you pay") |
| `cap` | `none` / `spend` {amountCents, period, rateAfterCapBps} / `unstated` | Spend beyond the cap earns `rateAfterCapBps` |
| cap `period` | calendar-year, cardmember-year, billing-cycle, quarter, month, year-unspecified | The three yearly periods are treated alike |
| `activation` | none, enroll-once, recurring, unstated | `unstated`: the issuer pages don't mention it; treated as `none` |
| `usMerchantsOnly` | bool | False also when the issuer is silent (builder maps null to false) |
| `excludedPaymentPaths` | subset of paypal, digital-wallet, bnpl | Card is the baseline and cannot be excluded |
| `limitedTime` | null or {endsOn} | Expired (never applied) if `endsOn` is before the purchase date or before the catalog's `verifiedAt` date |

### Uncertainty codes (produce a range)

| Code | Trigger |
| --- | --- |
| `online-category-unknown` | Online-retail rule, shopper's `onlineRetail` is `unknown` |
| `payment-path-uncertain` | Payment path is not `card` (PayPal, digital wallet, BNPL) |
| `activation-unknown` | Rule needs `enroll-once`/`recurring` activation and usage is not `active` |
| `cap-unstated` | Cap kind `unstated` |
| `annual-usage-unknown` / `cap-usage-unknown` | Spend cap with no usage recorded for today (yearly / other period) |

A code is reported only when it can move that card's estimate (max > min).

### Rule statuses (shown per rule)

`applied`, `may-apply`, `base`, `not-at-merchant`, `not-eligible`, `expired`, `cap-reached`.

## How it works

1. `validatePurchaseAndWallet` and `validateCatalog` reject malformed input. Unsupported rule shapes fail closed (`Unsupported catalog rules.`).
2. `unavailableReason` ([`engine-shared.ts`](../../packages/rewards-core/src/engine-shared.ts)) returns, in this order: `catalog-not-yet-valid`, `catalog-expired`, `unsupported-merchant`, `no-owned-cards`, `unknown-owned-card`, `purchase-not-confirmed`, `ineligible-purchase`.
3. `engine-v2.ts:blocked` filters each rule by category, expiry, merchant, U.S.-only, payment path, and known-inactive activation.
4. `engine-v2.ts:evaluate` computes the rule's min and max. With a spend cap and unknown usage, bonus spend ranges from 0 to min(amount, cap). Usage only counts if it was recorded on the purchase date in the same year. Older usage counts as unknown, not as zero.
5. `engine-v2.ts:estimateCard` takes the best floor and the best ceiling across the card's rules, clamped to the base reward.
6. `engine-shared.ts:rankEstimates` orders cards by `minRewardCents`, then default card, then id. It sets `rankingMayChange` when another card's max beats the leader's min, and `tied` on equal minimums.

Money is integer cents and rates are bps. Exact products are summed before truncation ([`money.ts`](../../packages/rewards-core/src/money.ts)). Results are purchase estimates and do not reproduce issuer billing-period rounding.

## Payment paths

| Path | Effect |
| --- | --- |
| `card` (default) | Baseline |
| `bnpl` | Blocks rules that exclude it. BCE online retail excludes it, because Amex terms explicitly exclude third-party BNPL. Otherwise `payment-path-uncertain` |
| `paypal`, `digital-wallet` | `payment-path-uncertain`. Bonus becomes a range. Chase, Capital One and Amex all warn that third-party accounts and wallets "may not" earn bonus categories (research report) |

## Citi pay-later

Citi Double Cash earns 2% total on every purchase: 1% at purchase and 1% when the balance is paid. The catalog stores `rateBps: 200, paidOnPaymentBps: 100`. The estimate counts the full 200 bps and exposes `paidOnPaymentBps` on `CardEstimate`. The research report suggests showing it as "2% if paid (1% at purchase)"; how the extension words it is not covered here. The research report notes that the payment must be at least the minimum due, and that points need a current account.

## Catalog v3 rule shapes (contract only)

Stage 2 M1 adds the catalog v3 contract ([rewards engine](../system/rewards-engine.md#catalog-v3-contract)); the v3 engine that applies these is M2, so the meanings below are what the fields are for, not yet behavior.

| Field or concept | Meaning |
| --- | --- |
| Base rule | The card's one `all-purchases` rule with no condition at all. Open-loop cards need exactly one; closed-loop store cards need none. Other `all-purchases` rules may carry conditions (PayPal Cashback's rate when paying through PayPal) |
| `acceptance` | `open-loop`, or `closed-loop` with the brands where the card works (Amazon Store Card, Harbor Freight) |
| `brandIds` | Merchant scope: the rule pays only at merchants carrying one of these brands (Prime Visa at Amazon and Whole Foods) |
| `excludedBrandIds` | The rule never pays at merchants carrying one of these brands (Freedom Flex grocery "excluding Walmart and Target", Edward Jones top categories excluding Amazon); a base rule has none |
| `sharedCapId` | Rules of one card with the same ID share one spend cap (Cash+ "$2,000 in combined purchases" across both 5% picks, Freedom Flex and Discover quarters, Customized Cash); each has a spend cap with the same amount and period |
| `choice` | The rule pays only while that option of a card choice is in effect: `chosen` by the cardholder (Cash+, Customized Cash) or `automatic` top-spend categories (Edward Jones) |
| `requires` | Gates the cardholder must meet: membership, tier or relationship options (Prime, store loyalty tiers, Smartly balances) |
| `requiredPaymentPaths` | The rule pays only through these paths; `excludedPaymentPaths` gains `venmo` |
| `limitedTime.startsOn` | Rotating or future rules start on this date (Freedom Flex Q1 2027) |
| Program value | Units convert to cents with the shopper's override, else the card's issuer-stated value, else the program's published estimate ([decision](../decisions/2026-10-02-points-valuation-published-estimates.md)); `none` means units only |

**How the M4 overlay uses these fields** ([decision](../decisions/2026-10-02-catalog-overlay-conventions.md)): a brand-scoped rule always has category `other` and matches on brand alone; `excludedBrandIds` appear only on category rules; a statement that third-party payment accounts or wallets "may not" earn a bonus puts those paths in `excludedPaymentPaths` (the base rate is then counted for them); gates ask about the cardholder only, never about the purchase (financing, minimum amounts and store-brand items are noted or the rule is held out); the lowest tier every cardholder holds stays ungated; first-year and first-30-days rates are `limitedTime` with null dates.

Statuses `not-accepted`, `not-started`, `choice-not-selected`, `condition-not-met` and uncertainties `choice-unknown`, `automatic-category`, `condition-unknown` are defined for M2.

## Gotchas

- `activation: unstated` is a product decision. Issuers state enrollment requirements explicitly, so silence is treated as no activation, and the shopper is never asked to confirm (comment in `engine-v2.ts`).
- Validation allows an after-cap rate below the base (0..rateBps). The base is always an option, so no rule can pull a card below it.
- The MCC is never observed at checkout. MCC-group rules depend on a predicted merchant category (see [Merchants](merchants.md)). Channel rules (online retail) and portal rules can be decided with more confidence.
- Catalog v1 (schema 1: base plus one U.S. online-retail bonus, `engine.ts`) is still parsed for cached releases.

## Related

* [Cards](cards.md)
* [Merchants](merchants.md)
* [Glossary](glossary.md)
* Tests: [`packages/rewards-core/test-cases.ts`](../../packages/rewards-core/test-cases.ts), [`extension/tests/rewards-v2.test.ts`](../../extension/tests/rewards-v2.test.ts)
