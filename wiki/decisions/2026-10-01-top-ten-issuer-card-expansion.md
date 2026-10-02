---
type: Decision
title: Expand the catalog to the top-10 U.S. issuers' consumer cards
description: Grow from seven cash-back cards to the personal rewards, co-branded, student and secured cards of the ten largest U.S. issuers, excluding business cards.
status: accepted
tags: [decision, catalog, cards, scope]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:10:00Z
---

# Expand the catalog to the top-10 U.S. issuers' consumer cards (2026-10-01)

## Context

The product covered seven named U.S. cash-back cards ([decision](2026-09-28-seven-cards-and-checkout-scope.md)), too few for most shoppers' wallets. On 2026-10-01 Evan chose a wider scope for Phase 7 (chat).

## Options considered

| Option | Fit | Why not / why |
| --- | --- | --- |
| Keep seven cash-back cards | Smallest | Most wallets have no supported card |
| **Top-10 U.S. issuers, consumer cards** (chosen) | Covers most U.S. cardholders | Needs points valuation, merchant-specific and rotating rules, larger catalog limits |
| Every U.S. card including business | Widest | Business terms differ; many more sources |

## Decision

- Issuers: Chase, American Express, Citi, Capital One, Bank of America, Wells Fargo, Discover, U.S. Bank, Barclays, Synchrony.
- In scope: personal rewards cards, co-branded cards, student and secured cards.
- Out of scope: business cards; cards without purchase rewards are recorded as exclusions with a reason.
- Rates still come only from captured issuer pages, extracted by the model and checked by independent verifiers before a catalog release.

## Consequences

- 180 cards, 65 exclusions and 321 sources in the first pass ([catalog expansion](../system/catalog-expansion.md)).
- The engine and catalog need new concepts (points currencies, merchant-specific rules, chosen and rotating categories, relationship tiers, closed-loop store cards) and the 30-card / 30-source catalog limits must rise through a new migration.
- This widens the card list of the [2026-09-28 scope decision](2026-09-28-seven-cards-and-checkout-scope.md) once Phase 7 ships; that record's checkout-scope rule (the engine covers only what an online checkout can hit) still holds.

## Status

Accepted 2026-10-01 by Evan Liu (chat). Recorded 2026-10-02.
