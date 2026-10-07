---
type: Decision
title: Label the expansion by shared general conventions plus one conventions file per issuer
description: Expansion verifiers and adjudicators follow general labelling rules set by the coordinator (rules 1–12 after the verifier pass, 13–19 after adjudication) and issuer-specific decisions kept in one file per issuer; a final consistency pass applied rules 13–19 to every issuer before the agent-verified corpus was written.
status: accepted
tags: [decision, catalog, curation, expansion, verification]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
sources:
  - resource: ../system/catalog-expansion.md
    title: Catalog expansion (Phase 7)
  - resource: ./2026-10-02-expansion-quote-limit-and-verification-format.md
    title: 25-word expansion quotes and the verification format
  - resource: ./2026-09-29-agent-verified-labels.md
    title: Agent-verified labels
---

# Label the expansion by shared general conventions plus one conventions file per issuer (2026-10-02)

## Context

Nine verifier subagents (one per issuer, plus a second opinion on Chase) checked the 180 expansion drafts against the captures, and eight adjudicator subagents decided their findings. The first verifier pass showed the same judgment calls made differently across issuers: points versus percentage rates, which redemption values count as a point value, single-merchant rules, chosen and rotating categories, activation, store credit. The conventions began as one file (`verification/CONVENTIONS.md`) and grew long with issuer detail.

## Options considered

| Option | Why not / why |
| --- | --- |
| Let each adjudicator decide per issuer | Inconsistent labels across issuers for the same mechanic; the eval would measure label noise |
| One conventions file for everything | Hard to read and easy to contradict as issuer detail grows |
| **General rules plus one file per issuer** (chosen, at Evan's request) | General rules apply everywhere; each issuer file records only that issuer's decisions with dates and must not contradict the general rules |

## Decision

- `evals/curation/expansion/verification/conventions/general.md` holds the rules for every issuer; `conventions/<issuer>.md` holds that issuer's decisions. The old single file was reduced to a "moved" stub and then deleted.
- Key general rules: `rateBps` is the card's per-dollar multiple × 100 for points and miles and the percentage × 100 for cards that state a percentage back (1); only the card's own earn counts, not partner or status earn (2); a point value only from a stated fixed cash, statement-credit or store-reward value (3), and a `cash-back` card never has one (13); store-only points get the stated store value plus an `ambiguous` store-only issue (14); single-merchant rules are `other`, program-run travel booking is `travel-portal` (4) and program-run ticketing is `entertainment-portal` (15); only the current rotating quarter is kept (5); chosen categories become one rule per option with one `ambiguous` issue (6), and an option narrower than its shared category adds another (19); issues without an anchor that states the problem are removed (11, 16); gated rates keep the stated rate with an issue naming the condition (17).
- Rules 13–19 came after adjudication, so a final consistency pass (2026-10-02) applied them across all issuers. Each change is an accepted finding in the issuer's findings file, noted "rule NN, final consistency pass 2026-10-02", and the issuer conventions were updated where a decision changed.

## Consequences

- Labels are consistent across issuers for the same mechanic. The final pass changed Gap Inc. Encore point values (null → 20), added store-only, gate and partial-option issues, and removed two issues that stated no problem; it reopened no other adjudicated decision.
- Gated rates (17) and redemption values that are not point values (18) are known gaps until Stage-2 engine work.
- A new issuer decision goes into that issuer's file with its date, not into the general rules, unless it applies across issuers.

## Status

Accepted 2026-10-02 by the Phase 7 verification session (claude-code/claude-opus-5-5); merged with PR #17. Status section added 2026-10-07 by the wiki audit.
