---
type: Decision
title: Building the 178-card catalog v3 (Stage 2 M5)
description: How the release catalog v3 is built from the corpora and the M3/M4 files — semantic short rule IDs, real cards pinned to release 1, corpus exclusions omitted when listing them together would quote more than 25 capture words, unused programs, brands, gates and sources dropped, and the local seed regenerated from v3.
status: accepted
tags: [decision, catalog, build, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../scripts/build-catalog-v3.mjs
    title: Catalog v3 builder (CLI and build report)
  - resource: ../../scripts/lib/catalog-v3.mjs
    title: Build logic, real-card check, size measures
  - resource: ../../evals/curation/expansion/catalog-build-report.md
    title: Build report
  - resource: ../../extension/tests/catalog-v3-golden.test.ts
    title: Golden ladders
---

# Building the 178-card catalog v3 (Stage 2 M5) (2026-10-02)

## Context
M4's `draftCatalogV3` already turns the corpora, reward programs, merchants and overlay into a valid catalog v3, with rule IDs `<cardId>-r<index>` and corpus card names. A release needs stable rule IDs (the extension stores usage per rule ID), readable short names, the version and dates fixed by the plan (`2026-10-02.expansion.1`, verified 2026-10-02, expiring 2026-11-01T00:00Z), the seven real cards unchanged from release 1, and a catalog that passes the 25-word quote check as committed text.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Rule IDs | `<prefix>-base` for the unconditional base, else `<prefix>-<choice option, brand or category>[-<gate answer>][-<required path>][-<start month>]`, `-2` for collisions; prefix is the card ID without issuer and network words | `<cardId>-r<index>`: changes when a corpus revision reorders rules, and two IDs exceeded the 80-character limit. A per-card counter: shorter but also positional |
| Real cards | Release-1 names, short names and rule IDs (`double-cash-base`), rules sorted as v2; `checkRealCards` fails the build on any difference from `CATALOG_V2` | Rebuild them like expansion cards: would rename rule IDs and drop usage rows of every existing extension user |
| Exclusions that join into long quotes | Omit 8 corpus exclusions on 7 cards (listed in the build report) whose capture text abuts or overlaps a neighbour into a run of more than 25 words; the corpus keeps them | Paraphrase them: unverified editorial text in a catalog that otherwise carries only labelled issuer wording. Leave them: breaks the copyright rule once the strings sit in one array |
| Unused objects | Drop programs, brands, gates and sources no included card, merchant or program uses | Keep the M4 draft's full lists: the two held-out cards leave nothing unused today, but the rule keeps future builds small |
| Seed | `supabase/seed.sql` from `CATALOG_V3` (one unapproved local draft) | Keep v2: the plan says regenerate, and the review app now starts drafts from v3 by default. The seed is local only; hosted never applies it |

## Decision
As chosen above. Version `2026-10-02.expansion.1`; 178 cards (2 held out by the overlay), 820 rules, 602,441 bytes JSON and 643,327 bytes JSONB text (≤ 75% of 1 MiB, checked by the builder, a unit test and the SQL parity harness). The quote check scans the built catalog and the build report; it needs the real capture folders too, because the real cards quote them. Golden ladders for 17 wallets at the three merchants were computed by hand and reviewed against the captures by an independent subagent (agent-verified, not human-verified; the reviewer added W17).

## Consequences
- The extension still bundles `CATALOG_V2` and refuses v3 releases until M6; tree shaking keeps `CATALOG_V3` out of `extension/dist`. The review app bundles it and offers it first.
- A corpus or overlay change that renames a rule's choice, brand or category changes that rule's ID; M6's pruning drops the old usage row.
- Closed-loop store cards with no stated cap guarantee $0 (Amazon Store Card 0..500 at Amazon), so they rank below a flat 2% card; this follows rule 21 and the engine, and M7 should word it so the 5% is visible.

## Status
Accepted 2026-10-02 (Stage 2 M5, coordinator-delegated agent). Evan or the coordinator can revise.
