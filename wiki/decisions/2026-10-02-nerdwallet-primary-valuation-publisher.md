---
type: Decision
title: Use NerdWallet's baseline and program values as the one primary points-valuation publisher
description: The reward-program table values points programs with NerdWallet's published cents-per-point figures (its baseline value for bank currencies, its median program value for airline and hotel currencies), read 2026-10-02, over The Points Guy, Upgraded Points, CardRatings, Bankrate or Frequent Miler; uncovered programs use an issuer-stated fixed redemption value from the captures or none.
status: accepted
tags: [decision, catalog, valuation, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:30:00Z
sources:
  - resource: ../../evals/curation/expansion/reward-programs.json
    title: Reward-program valuation table (52 programs, 180 cards)
  - resource: https://www.nerdwallet.com/travel/learn/airline-miles-and-hotel-points-valuations
    title: NerdWallet points and miles valuations (updated 2026-10-02, read 2026-10-02)
---

# Use NerdWallet's baseline and program values as the one primary points-valuation publisher (2026-10-02)

## Context
The [points valuation decision](2026-10-02-points-valuation-published-estimates.md) values points cards with published cents-per-point estimates per program. Decision 2 of the [Stage 2 plan](../product/phase-7-stage-2.md#decisions-on-the-plans-open-questions) narrows it: one conservative primary publisher (cash-like rather than best-case travel values) with the widest coverage of the catalog's programs; programs it does not cover take an issuer-stated value from the captures where one exists, else none (the extension shows points only and asks for a value). Milestone M3 had to pick the publisher. The 180 cards earn 52 programs: cash back plus 51 points or miles currencies (8 bank currencies, 20 airline, 6 hotel, 5 cruise and timeshare, 12 store and other co-brand programs).

## Options considered
Pages read 2026-10-02; counts are programs of this catalog with a value on the page.

| Publisher | Coverage of the 51 points programs | Basis of the value | Why not / why |
| --- | --- | --- | --- |
| **NerdWallet** (points and miles valuations) | 24 | Airline: median of cash vs award searches for main-cabin economy; hotel: median from booking data; bank currencies: a **baseline value** (the issuer's own travel-portal or fixed value) beside a transfer-partner value | Chosen: the widest coverage among publishers that give a non-transfer value for bank currencies; covers Bank of America and Discover; states a median methodology |
| The Points Guy (monthly valuations) | 24 | Best-case: transferable currencies at about 1.75–2.05 cents | Values transferable points at their transfer best; not conservative |
| Upgraded Points | about 30 | Transferable currencies valued through transfer partners (Amex 2.2 cents) | Widest coverage outright (adds Aer Lingus, Iberia, Lufthansa, Cathay, Korean Air, Frontier, Breeze), but best-case for the bank currencies most cards earn |
| CardRatings | about 10 | Mixed examples, transfer values | Narrow |
| Bankrate | no per-program table found | — | No table |
| Frequent Miler (Reasonable Redemption Values) | about 24, in per-program articles | Median redemptions; bank currencies at transfer values (1.4–1.5 cents) | No single dated table; bank currencies best-case |

## Decision
1. **NerdWallet is the primary publisher.** Published estimates use its baseline value for bank currencies (Amex Membership Rewards, Chase Ultimate Rewards, Citi ThankYou, Capital One miles, Wells Fargo Rewards, Bank of America points, Discover miles: all 100 hundredths of a cent) and its program value for airline and hotel currencies. The baseline is the issuer's travel-portal or fixed value, not a cash value: Amex and Capital One pay less as a statement credit. NerdWallet's airline and hotel values are medians, not the lowest published figures (American 1.7 cents against 1.4–1.45 elsewhere, Hyatt 1.8 against 1.5–1.65; Virgin, Flying Blue and Aeroplan are lower than elsewhere). Each estimate records publisher, URL and the date read; no publisher text is committed.
2. **Uncovered programs** take an issuer-stated value only when a capture states a fixed number of units for a fixed dollar amount in cash, statement credit, deposit, or credit toward the program's or merchant's own purchases (store money, travel or cruise credit), recorded with its ≤ 25-word quote; gift cards and "approximate", "up to" or retail values do not count. This is deliberately broader than corpus conventions 3 and 20, which keep card-level `pointValueHundredthsOfCent` null for travel-only and onboard-credit values: the program table follows decision 2, the corpus labels stay as verified. Sun Country, Allegiant, Royal ONE and Norwegian get 100 this way. Otherwise the program has no value (`none`).
3. **Program identity follows the account the points land in**: Aer Lingus and Iberia Avios are their own programs, without a value, because the publisher values British Airways Avios only and no capture states that Avios move between the three accounts (so the three near-identical Chase Avios cards rank differently; parity needs a decision by Evan); Virgin Red's Virgin Points share the Virgin Atlantic Flying Club value (one currency). The Barclays Titanium, Black and Gold cards carry card-specific issuer values (100, 150, 200), so their program has none.
4. Cash back is the program `cash-back` at 100 with basis `cash`; every card the corpus labels `cash-back` uses it, because those rates are already percentages (convention rule 1). Store-only redemption for those cards is an M4 overlay label, not a program value.

## Consequences
- 24 programs have published estimates, 11 have issuer-stated values, 16 have none; the full table and card counts are on [catalog expansion](../system/catalog-expansion.md#reward-program-valuation-m3).
- A large program without a value (U.S. Bank Altitude, Korean Air SKYPASS, Lufthansa, Cathay, Frontier) leaves its cards unranked against cash until the shopper sets a value; a second publisher would change that and needs a new decision.
- The estimates age: the table's `readOn` must be within 30 days of the catalog release, so the table is re-read with each release.

## Status
Accepted 2026-10-02 by the M3 agent under decision 2 of the Stage 2 plan; agent-verified (see the review entry in the [log](../log.md)). Evan can choose another publisher.
