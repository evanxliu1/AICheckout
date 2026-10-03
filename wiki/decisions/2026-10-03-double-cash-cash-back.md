---
type: Decision
title: Citi Double Cash is cash back in the catalog, and savings are worded by what the cards pay
description: Stage 2 M10 part 2 — Citi Double Cash maps to the cash-back program under general labelling rule 1 (its terms state a percentage cash back), through a pinned corpusLabel override because its real.v2.2 eval label is frozen as points at 1¢; the extension's cashLikePoints name heuristic goes; the badge's recorded-order line and the savings history stop calling points, miles and store rewards "cash back", and a program with no value is not counted as $0.
status: accepted
tags: [decision, catalog, valuation, extension, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T04:30:00Z
sources:
  - resource: ../../evals/curation/expansion/reward-programs.json
    title: Reward-program table (Double Cash entry with corpusLabel)
  - resource: ../../scripts/lib/reward-programs.mjs
    title: corpusLabel schema and check
  - resource: ../../scripts/lib/catalog-v3.mjs
    title: checkRealCards (unit value instead of currency)
  - resource: ../../evals/curation/expansion/verification/conventions/general.md
    title: General labelling rules 1 and 13
  - resource: ../../extension/src/components/estimates.ts
    title: rewardsWording; cashLikePoints removed
  - resource: ../../extension/src/state/savings.ts
    title: Savings math (unvalued programs not counted)
---

# Citi Double Cash is cash back in the catalog, and savings are worded by what the cards pay (2026-10-03)

## Context
Citi Double Cash's terms say "Earn unlimited 1% cash back when you buy, plus an additional 1% as you pay", paid as ThankYou Points. M3 mapped it to `citi-thankyou` with a card-stated 1¢ because its `real.v2.2` eval label says `points` with `pointValueHundredthsOfCent` 100. That label is older than the expansion's [general labelling rules](../../evals/curation/expansion/verification/conventions/general.md), and rule 1 says a card whose terms state a percentage back is `cash-back`, "even if the issuer tracks it internally as points". Chase Freedom Unlimited and Freedom Flex, which also pay points, are cash back. M7 papered over the difference with `cashLikePoints`, a name heuristic in the extension ("Cash" in the card name, points valued at exactly 1¢) that made Double Cash read "2%" ([extension UI decision](2026-10-03-extension-ui-v3.md), "Points rates" row). The coordinator decided on 2026-10-03 to remap the card and remove the heuristic. Separately, the badge's recorded-order line and the popup's savings history called every amount "cash back", even when the cards earned points, miles or store rewards. An unvalued program's card also counted as $0.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Where to change Double Cash | `reward-programs.json`: `programId` `cash-back`, no stated value, a percentage anchor, plus a `corpusLabel` block that repeats the frozen label (points, 100) with the reason | Editing the `real.v2.2` label: eval labels are frozen (eval integrity), and the label also feeds the published dev results. A catalog-overlay patch: the overlay does not handle the real cards, and the program mapping already lives in `reward-programs.json` |
| What the override may do | Only points at a stated 1¢ may become `cash-back` with no stated value. The check fails if the label changes or the mapping goes elsewhere | A free-form override: it could change a card's value without the check noticing |
| `checkRealCards` | Compares the value of one rate unit (cash back counts as 100) and requires the cash-back program for all seven real cards | Keeping the strict currency comparison against release 1: it would forbid a change that leaves the engine's cents the same |
| Catalog version | Keep `2026-10-02.expansion.1` | A new counter: the catalog has not been published and no released extension bundles it, so no installed copy holds the old contents |
| Other cards | None remapped. Every points-program card's labels and anchors were searched for a stated percentage back. Only Double Cash qualifies. Barclays Barnes & Noble pays a 5% rebate at Barnes & Noble and points elsewhere (mixed, unvalued, no catalog merchant). Luxury Card's "redemption rate of 1%/1.5%/2%" is a redemption value, not an earn rate | — |
| Savings wording | Recorded order: "more cash back" when both cards pay cash back. Otherwise "more in rewards", plus what the non-cash rewards were counted at ("Counts Capital One miles at 1¢ each (estimate).") or, for a program with no value, that the order is not added. History: "All-time: $x extra in rewards", with how points count | Storing each entry's kind for an adaptive history header: a change to the state schema for a heading |
| Unvalued programs in savings | `minimumReward` returns null, so the entry is "not counted" | $0: reads as a real loss against the default card |

## Decision
As in the "Chosen" column. `npm run catalog:v3` rebuilds `CATALOG_V3`. Only Double Cash's `programId` (`citi-thankyou` → `cash-back`) and `statedValueHundredthsOfCent` (100 → null) change, 3 bytes smaller. The reward-programs table version becomes `reward-programs.2026-10-02.2`. The extension shows Double Cash as cash back without special code: "2%" rates, "$2.00 back" in the pill, no value basis line.

## Consequences
- Engine cents are unchanged for every real card and every golden ladder. A before/after run over 12,816 comparisons (all 178 cards alone, with Double Cash, and in three-card wallets; three merchants; two amounts; card and pay-later; with and without a ThankYou override) differed only where a wallet held Double Cash **and** set a ThankYou value. That value no longer applies to Double Cash, which is intended: cash back is not points.
- The ThankYou point-value question no longer appears for a wallet whose only Citi card is Double Cash. An override already saved for `citi-thankyou` stays and is unused (the version did not change, so nothing prunes it). It applies again if a ThankYou card is added.
- The eval label stays `points` at 1¢. The extraction results and [`docs/evals/results.md`](../../docs/evals/results.md) are unaffected; the [cards page](../domain/cards.md) notes the catalog mapping.
- The "Points rates" row of the [extension UI decision](2026-10-03-extension-ui-v3.md) is superseded for its Double Cash exception; points cards keep "points per $1".
- Public copy (site, `docs/release/store-listing.md` and `support.md`) says "extra rewards" instead of "extra cash back".

## Status
Accepted 2026-10-03: the remap by the coordinator under general rule 1; the wording and the not-counted rule by the M10 part 2 implementing agent at the coordinator's request.
