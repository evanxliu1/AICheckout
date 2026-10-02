---
type: Decision
title: Value points with published cents-per-point estimates per program, issuer-stated values first, user overrides
description: Points and miles cards are ranked by cash-equivalent value from a reward-program table of published cents-per-point estimates (labelled with source and date), with issuer-stated cash values taking precedence and a per-program override in the extension, over ranking at a flat 1¢ or leaving points cards unranked.
status: accepted
tags: [decision, catalog, engine, valuation, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T20:30:00Z
sources:
  - resource: ../system/catalog-expansion.md
    title: Catalog expansion (corpus counts and the rate_not_in_evidence gap)
  - resource: ../../evals/curation/expansion/verification/conventions/general.md
    title: Expansion labelling conventions (rules 1, 3, 13, 14, 18, 20)
---

# Value points with published cents-per-point estimates per program, issuer-stated values first, user overrides (2026-10-02)

## Context
The agent-verified expansion corpus (`expansion.v1`) has 102 points or miles cards out of 173. Rates are stored as the card's own multiple × 100 (4X → 400, convention rule 1), never converted with a point value. Only 18 points cards have `pointValueHundredthsOfCent`, set only when a capture states a fixed cash, statement-credit, deposit or store-certificate value (rule 3); airline, hotel and transfer values are null (rule 20). Catalog v2 has no way to rank the other 84: its engine multiplies spend by `rateBps` as if every unit were worth 1¢, and it requires a point value on every points card. The extraction validator's `rate_not_in_evidence` findings (408 on 98 cards) come from the same gap. Evan decided the approach on 2026-10-02.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Flat 1¢ per point for every program | Simple | Overvalues weak currencies (store points at 0.2¢), undervalues transferable ones; presents an assumption as a number |
| Rank points cards only by issuer-stated cash value; leave the rest unranked | Strictly evidenced | 84 cards, most co-brand airline and hotel cards, could never be recommended |
| Show points earned only, no cash value | Honest | Points and cash cards cannot be compared, which is the product's whole question |
| **Program table of published cents-per-point estimates, issuer-stated values first, user override per program** | Chosen (Evan) | Comparable cash-equivalent ranking, every non-evidenced value is labelled with its publisher and date, the shopper can disagree |

## Decision
1. The catalog carries a **reward-program table**: one row per program (Chase Ultimate Rewards, Amex Membership Rewards, Citi ThankYou, Capital One miles, Wells Fargo Rewards, Bank of America points, U.S. Bank programs, each airline and hotel program, store programs, plus `cash-back`). Each row has a value in hundredths of a cent per unit, a basis (`cash` for cash back at 1¢ per unit, `published-estimate`, or `issuer-stated`) and, for estimates, the publisher, URL and the date the value was read. Only numbers, URLs and dates are committed, never publisher text.
2. Every card maps to one program, backed by a 25-word-or-shorter anchor naming the currency in its captures.
3. **Value used for a card**, in order: the shopper's override for the program, then the card's issuer-stated value (`pointValueHundredthsOfCent` from the verified corpus), then the program's published estimate. Issuer-stated values take precedence over estimates, as Evan directed. The override comes first because it is the shopper's explicit choice; see open question 3 in the [Stage 2 plan](../product/phase-7-stage-2.md#open-questions-for-evan).
4. The engine computes reward units from the earn rate and converts them to cents with that value. Integer math throughout: `floor(Σ spendCents × rateBps × valueHundredthsOfCent / 1,000,000)`. Cash back is the program `cash-back` at 100 (1¢ per unit), so cash-back results do not change.
5. Ranking uses the cash-equivalent value. The extension shows units and value together ("≈ 2,400 miles, about $28 at 1.2¢ — estimate, <publisher>, <date>") and labels every estimate as one.
6. Researching and checking the table is agent work: one subagent collects values with sources, an independent subagent re-checks every value against the cited page, disagreements are adjudicated, and the result is recorded `agent-verified`.

## Consequences
- Catalog v3 adds `programs[]` and a card `programId`; points rates keep their corpus meaning (units per dollar × 100). See [catalog v3 decision](2026-10-02-catalog-v3-schema.md).
- Published estimates age. Every catalog release repeats the source date, and the program table is refreshed with the catalog; a value older than the release's 30-day window is flagged by the builder.
- Store-only currencies keep their issuer-stated value and are labelled as store credit; whether to discount them is not part of this decision.
- The extraction validator gap (`rate_not_in_evidence` for "4X" quotes) is fixed separately in the pipeline work by recognising multiples; the catalog no longer needs the extraction to assume 1¢.

## Status
Accepted 2026-10-02 by Evan Liu (approach); details 4–6 by the planning agent, in the [Stage 2 plan](../product/phase-7-stage-2.md).
