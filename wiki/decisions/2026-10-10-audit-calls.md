---
type: Decision
title: Calls from the 2026-10-10 wiki audit (A1–A6)
description: Evan accepted the coordinator's recommendations on the six audit questions. Separate merchant releases (D2) and weekly background refresh (D8) are approved. Public merchant-code lookups are cited as links, hashes and short quotes only. Real users are a goal. Accounts are planned but not scheduled. The legacy adapters retire after a check on fresh captures of their own stores. The popup's leftover "enter the amount manually" copy is reworded. The public site's three-store wording is fixed with the Phase 15 docs.
status: accepted
tags: [decision, phase-14, phase-15, merchants, extension]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-10T15:00:00Z
sources:
  - resource: ../now.md
    title: Now (the audit's open calls)
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan
---

# Calls from the 2026-10-10 wiki audit (A1–A6) (2026-10-10)

## Context
The wiki audit of 2026-10-10 listed six calls for Evan. He answered: "follow your A1-A6 recommendations".

## Options considered
| Call | Question | Recommendation accepted |
| --- | --- | --- |
| A1 | Merchant data as its own release (D2); weekly background refresh (D8); use of public merchant-code lookup sites | D2 and D8 approved. Lookup pages are recorded as URL, date, SHA-256 and quotes of 25 words or fewer; their data is never copied as a dataset. Top-store lists contribute domain names only |
| A2 | The goal said "few real users are expected" | Real users and usage metrics are goals; quality and honest claims still come first |
| A3 | Accounts listed as not planned | Planned but not scheduled; none before the MVP |
| A4 | Evidence to retire the Amazon, Best Buy and Newegg adapters | Before Release A: fresh pane captures of those three stores' cart states (same protocol rules, never checkout). The adapters retire when `readCart` shows the same amount on every captured page where the adapter shows one, with no wrong amount; otherwise they stay and the gap is reported |
| A5 | The popup's error paths still say "enter the amount manually" | Reword in Phase 14.3 to the never-ask wording ("Couldn't read this cart; comparing by rate"); the optional amount field stays |
| A6 | The live public site's privacy and support pages still describe three stores | Fix with the Phase 15 docs; the extension is not published yet |

## Decision
As in the table. D9 in the [Phases 10–17 plan](../product/phase-10-merchant-expansion.md) is a different question and stays open: whether future merchant data, eval labels and snapshots stay MIT like the code, or become proprietary.

## Consequences
- Phase 14 adds the A5 copy fix to 14.3.
- Phase 15 adds the A4 retirement check and the A6 site fix.
- D9 is asked before the first merchant release (14.7).

## Status
Accepted 2026-10-10 (Evan).
