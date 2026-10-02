---
type: Decision
title: Model seven cash-back cards; engine covers only what an online checkout can hit
description: Seven named U.S. cash-back cards; full category taxonomy on the extraction side, a narrower rule set in the product engine.
status: accepted
tags: [decision, domain, scope]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Model seven cash-back cards; engine covers only what an online checkout can hit (2026-09-28)

## Context
A measurable corpus needed a fixed card set, and the product only runs at online retail checkouts.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Many cards, shallow | Broad | Labels unaffordable |
| **Seven cards, full extraction taxonomy, checkout-scoped engine** | Chosen | Real corpus is labelable; engine stays simple |

## Decision
- Cards: Citi Double Cash, Wells Fargo Active Cash, Chase Freedom Unlimited, Capital One Quicksilver and Savor, Amex Blue Cash Everyday and Preferred.
- Extraction models every category; the engine applies `all-purchases`, `online-retail`, merchant-category rules matching the merchant profile, and paid-on-payment timing. Portal rules never apply at a retail checkout.

## Consequences
- See [cards](../domain/cards.md) and [reward rules](../domain/reward-rules.md).

## Status
Accepted 2026-09-28 by Evan Liu. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
