---
type: Decision
title: Catalog overlay pre-merge review — account-age gates and store-credit units
description: The M4 pre-merge review ran the merged v3 engine on the overlay's draft catalog and found two overlay errors — dateless account-age rates applied to every cardholder, and store-credit unit names in dollars where the engine counts cents — and fixed them with per-card account-age gates and "cents" units.
status: accepted
tags: [decision, catalog, overlay, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../evals/curation/expansion/catalog-overlay.json
    title: Catalog overlay
  - resource: ../../scripts/lib/catalog-overlay.mjs
    title: Overlay format, coverage check and draft catalog build
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: Engine v3
  - resource: ../../evals/curation/expansion/verification/conventions/general.md
    title: General conventions, overlay rules O20–O21
---

# Catalog overlay pre-merge review — account-age gates and store-credit units (2026-10-02)

## Context
M4 and M2 were built in parallel. The pre-merge review of `s2-m4-catalog-overlay` merged `main` (engine v3) and ran `compareRewards` on the in-memory draft catalog for 22 wallets at `amazon-us`, `best-buy-us` and `newegg-us`. `compareV3` reads only `limitedTime.startsOn` and `endsOn`, so a rule whose dates are both null always applies. Under O14 ("`limitedTime` with null dates and no gate") the OnePay CashRewards first-90-days 3% on everything outside Walmart ranked first at all three merchants for every holder, above Citi Double Cash, and Customized Cash's first-year 6% was the ceiling for every holder. Separately, 13 of the 18 store-credit programs named dollar units (Verizon Dollars, Bean Bucks, OneKeyCash) while the engine reports a cash-back program's units in cents, so $10 would read as "1000 Verizon Dollars".

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Account-age rates | Keep the dateless `limitedTime` and add a per-card gate (inside the period or after it); unanswered shows a range with the standing rate as the floor | Hold the rules out: loses a stated rate new cardholders do earn. Change the engine to treat dateless limited time as uncertain: an engine contract change after M2 merged, and the overlay can express it now. One shared "new account" gate: gates are answered once per wallet, so two cards of different ages could not both be right |
| Store-credit unit names | `unitName` "cents" (the program `name` keeps the merchant's term); TJX Rewards Points keep their name, one point being one cent | Keep dollar names and let the UI convert: the contract says `unitName` is shown with the unit amounts |

## Decision
O20 and O21 in [`general.md`](../../evals/curation/expansion/verification/conventions/general.md). Ten gates were added (Customized Cash ×4, Key Rewards ×4, OnePay, JCPenney), each anchored on the capture that states the period; `checkOverlay` rejects a dateless limited-time rule without a gate and a `programDetails` entry that differs from its store-credit program. Agent-verified (review subagent), not human-verified.

## Consequences
- Gates rise from 14 to 24; the draft catalog is about 607 KB.
- M6/M7 must word the account-age questions; they appear only for owners of those ten cards.
- If the engine later learns account dates, these gates can be replaced by dates without touching the corpus.

## Status
Accepted 2026-10-02 by the M4 pre-merge reviewer; amends O14 of the [overlay conventions](2026-10-02-catalog-overlay-conventions.md). Evan or the coordinator can revise.
