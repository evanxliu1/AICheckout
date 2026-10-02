---
type: Decision
title: Catalog v3 engine semantics for Stage 2 M2
description: How the v3 engine ranks cards whose program has no value (after valued cards, in units, with `value-unknown`), leaves closed-loop cards out (`notAccepted`, `no-accepted-card`), records shared caps, treats unanswered choices and gates, and limits value overrides, over assuming 1¢ or hiding unvalued cards.
status: accepted
tags: [decision, engine, valuation, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: compareV3
  - resource: ../../packages/rewards-core/src/types.ts
    title: Wallet, CardEstimate and Comparison types
  - resource: ../../extension/tests/rewards-v3.test.ts
    title: v3 engine table tests and ranking ladders
---

# Catalog v3 engine semantics for Stage 2 M2 (2026-10-02)

## Context
The [Stage 2 plan](../product/phase-7-stage-2.md) M2 fixes the v3 engine's rules (value precedence, integer money, brand scope, closed-loop, choices, gates, payment paths, rotating dates, shared caps) but leaves open how a card with no value is ranked, what the result looks like for a card that is not accepted, where the spend toward a shared cap is recorded, and what the shopper may override. The [points valuation decision](2026-10-02-points-valuation-published-estimates.md) and decision 2 of the plan forbid assuming 1¢ for a program without a value. v1 and v2 results had to stay byte-identical.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Card whose program has no value (no override, no issuer-stated value, valuation `none`) | Ranked **after every valued card**, among unvalued cards by guaranteed units; cent amounts 0, `unitValue: null`, uncertainty `value-unknown` when it earns units; `rankingMayChange` is true when it earns any units, because a value the shopper sets could make it best | Assume 1¢ (forbidden; presents an assumption as a number). Leave it out of the results (the shopper could not see what it earns). Rank by units against cash (compares different currencies) |
| Ties and `rankingMayChange` among unvalued cards | Comparable only within one program (units against units); a card of another program "may beat" the leader when it earns any units | Comparing units across programs would rank miles against points as if they were worth the same |
| Closed-loop card outside its brands | Not in `estimates`; listed in a new `Comparison.notAccepted` with every rule `not-accepted`; when no owned card is accepted the result is unavailable with the new reason `no-accepted-card` | Keeping it in `estimates` at 0 could make it the named card when every other card also earns 0 |
| Shared cap (`sharedCapId`) | The spend toward the combined cap is recorded once, on the group's first rule in catalog order (`capHolder`); activation stays per rule. `usageInputs` lists that rule (label "combined …") whenever any rule of the group covers a catalog merchant | Summing per-rule rows would ask the shopper to split one combined figure by category |
| Unanswered chosen category | Unknown (range, `choice-unknown`), even when the card has `defaultOptionIds`; the UI may prefill the defaults as the shopper's answer | Using defaults silently would rank on a choice the shopper may have changed |
| Wallet inputs | Per card: `choices` (complete selection, 1 to `picks` options of a `chosen` choice) and `gates` (one answer per gate); wallet `valueOverrides` (points programs only, 1–10,000 hundredths of a cent). All optional; v1 and v2 ignore them. Unknown IDs throw, as v2 does for usage | Overrides for cash-back programs (store-credit discounting is out of scope of the valuation decision); per-wallet gate answers (the plan names per-card gates; the UI can fan one answer out) |
| Brand-scoped `other` or `all-purchases` rule | Needs only the brand match; other categories still need their category match as well | Requiring a category for "5% at Amazon and Whole Foods" would block it at both |
| Which amounts decide that a condition "moves the estimate" | The shown amount: cents for a valued card, units for an unvalued one | Comparing exact numerators would report conditions that change less than one cent |

## Decision
As in the "Chosen" column. Money is `floor(Σ spend × rateBps × value / 1,000,000)` from one BigInt numerator per range end (`portionNumerator`, `numeratorCents`, `numeratorUnits` in `money.ts`), so cash back (value 100) equals the v2 amounts and points are never rounded twice. Estimates gain `programId`, `minRewardUnits`, `maxRewardUnits` and `unitValue` (`{hundredthsOfCent, basis: override | card-stated | cash | published-estimate | issuer-stated}` or null).

## Consequences
- v1 and v2 results are unchanged: 33,000 comparisons over `CATALOG_V2` and `PILOT_CATALOG` (wallets, merchants, payment paths, eligibility, amounts, usage) are byte-identical before and after (checked 2026-10-02).
- M6 must prune wallet `choices`, `gates`, usage rows and `valueOverrides` that a new catalog no longer has, since the engine throws on them; the state schema and `responseSchema` still list only the v2 statuses, uncertainty codes and reasons.
- M7 words `value-unknown`, `not-accepted`, `no-accepted-card` and the other v3 codes (placeholder copy is in `ComparisonResult.tsx` and `estimates.ts`), shows units with the value basis, and asks for a value when an owned card is unvalued; the badge always names `preferredCardId`.
- M5's golden ladders should expect unvalued cards (U.S. Bank Altitude, SKYPASS, Lufthansa and others) below every valued card unless an override is set.

## Status
Accepted 2026-10-02 by the M2 implementing agent within the Stage 2 plan; the coordinator or Evan can revise any row before M6/M7 build on it.
