---
type: Decision
title: The extension bundles catalog v3, and usage rows are compared in v3 form
description: Stage 2 M5 swaps the extension's bundled fallback to CATALOG_V3; a usage row survives a v2 → v3 switch when its rule, lifted to v3 with neutral values for the new fields, equals the v3 rule, so release 1 wallets keep every reported limit.
status: accepted
tags: [decision, extension, catalog, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T00:50:00Z
sources:
  - resource: ../../extension/src/state/catalog.ts
    title: BUNDLED_CATALOG import
  - resource: ../../extension/src/state/wallet.ts
    title: ruleTerms and reconcileWallet
  - resource: ../../extension/tests/state-migration.test.ts
    title: Schema 2 wallet of the seven real cards on cached release 1 moves onto bundled v3
  - resource: ../../extension/tests/state-v3.test.ts
    title: reconcileWallet from CATALOG_V2 to CATALOG_V3
---

# The extension bundles catalog v3, and usage rows are compared in v3 form (2026-10-03)

## Context
M6 made the newest valid catalog the one in effect ([decision](2026-10-03-newest-valid-catalog-wins.md)) and left the bundled fallback as one import for M5 to swap. An installed extension that cached hosted release 1 (`CATALOG_V2`, verified 2026-09-29) moves to the bundled `CATALOG_V3` (verified 2026-10-02) on update. On that switch `reconcileWallet` keeps a usage row only when the old rule and the new rule are identical JSON. M5 kept release 1's card IDs and rule IDs and checks their terms (`checkRealCards`), but a v3 rule always has six more fields (`brandIds`, `excludedBrandIds`, `sharedCapId`, `choice`, `requires`, `requiredPaymentPaths`) and a `limitedTime` with `startsOn`. The JSON never matched, so every reported limit and activation of every existing user would have been dropped with the "review your cards" notice.

## Options considered
| Option | Chosen | Why not |
| --- | --- | --- |
| Compare rules in v3 form: a v2 rule gets the v3 fields with neutral values (empty lists, null, `startsOn: null`) before `stableJson` | Yes | — |
| Compare only the v2 keys of the old rule | | A v3 rule that gained brand scope, a gate or a required payment path would keep a limit reported for broader terms |
| Keep raw JSON equality and accept the drop | | Every release 1 user re-enters spend and activation for terms that did not change |
| Give the real cards new rule IDs in v3 | | Drops the same rows by ID; M5 deliberately pinned them |

## Decision
`state/catalog.ts` imports `CATALOG_V3 as BUNDLED_CATALOG`. `wallet.ts:ruleTerms` lifts a v1/v2-shaped rule (no `brandIds`) to v3 form before comparing; v3 rules compare as they are. Rule IDs of the seven real cards are identical in v2 and v3 (26 rules), so a schema 2 state on cached release 1 migrates onto bundled v3 with its wallet unchanged and no notice. A rule whose rate, cap or any v3 field differs under the same ID still loses its row.

## Consequences
- Release 1 stays cached as the reference for the sequence check; Evan's M10 publish (sequence 2, `CATALOG_V3` or later) takes over from the bundle on a later `verifiedAt` or a tie.
- The worker chunk grows from 42,737 to 587,077 bytes (gzip 11,291 to 52,727); popup, onboarding and content scripts are unchanged and carry no catalog. The upload ZIP grows from 166,831 to 208,313 bytes.
- The wallet editor lists all 178 cards grouped by issuer with no search and refuses to save more than `MAX_WALLET_CARDS` (20, the state schema's limit) with a message, instead of the worker's generic rejection; M7 owns wallet search and the editors for choices, gates and point values.
- When both the cached release and the bundle have expired, the cached release is in effect (M6 rule); with release 1 cached after 2026-11-01 that is v2, and reconciliation would drop v3-only shopper options (choices, gates, point values). None exist before M7's editors; left open for the coordinator.
- The bundle expires 2026-11-01T00:00Z and is valid from 2026-10-02T00:00Z, so tests that fix the clock use dates in that window.

## Status
Accepted 2026-10-03 (Stage 2 M5, coordinator-delegated agent). Evan or the coordinator can revise.
