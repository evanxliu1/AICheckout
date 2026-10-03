---
type: Decision
title: When both catalogs have expired, use the one verified later and keep the shopper's answers
description: Of an expired cached release and an expired bundled catalog, the one verified later is in effect (not always the cached release), and an expired catalog in effect never prunes chosen categories, gate answers or point values, over the M6 review rule that fell back to the cached release.
status: accepted
tags: [decision, extension, catalog, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T02:30:00Z
sources:
  - resource: ../../extension/src/state/catalog.ts
    title: currentCatalog
  - resource: ../../extension/src/state/wallet.ts
    title: reconcileWallet keepOptions, validateWallet, engineWallet
  - resource: ../../extension/src/state/migrate.ts
    title: reconcileState
  - resource: ../../extension/tests/catalog-newest.test.ts
    title: Both-expired tests
---

# When both catalogs have expired, use the one verified later and keep the shopper's answers (2026-10-03)

## Context
The [newest valid catalog decision](2026-10-03-newest-valid-catalog-wins.md) kept the cached release in effect when neither catalog is valid. The M5 review noted that after both hosted release 1 (catalog v2, expires 2026-10-29) and the bundled v3 catalog (expires 2026-11-01) expire, the cached v2 release would take effect and reconciliation would drop every v3 choice, gate answer and point value, which a later valid v3 release could not bring back. The coordinator decided on 2026-10-03.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Both expired | The one verified later (the cached release on a tie); when one is only not yet valid, the cached release as before | Cached always: the case above |
| Shopper options under an expired catalog | Kept: reconciliation with an expired catalog in effect drops usage rows as before but never choices, gate answers or point values; saving keeps them too; comparisons get a pruned copy (`engineWallet`), and report the expiry | Pruning as for a valid catalog: loses answers to an expiry the shopper cannot fix |

## Decision
As in the "Chosen" column, in `currentCatalog` (`state/catalog.ts`), `reconcileWallet(…, { keepOptions })`, `reconcileState(state, catalog, now, before)` and `validateWallet(wallet, catalog, now)`.

## Consequences
- When a valid catalog takes effect again, the stamp differs and the wallet is reconciled against it as usual, so only IDs that catalog lacks are dropped.
- Tests: `catalog-newest.test.ts` (later `verifiedAt` when both expired, not-yet-valid fallback, answers kept and then reconciled against a fresh release).

## Status
Accepted 2026-10-03 by the coordinator; implemented in Stage 2 M7. Supersedes the "neither is valid, the cached release" part of the [newest valid catalog decision](2026-10-03-newest-valid-catalog-wins.md).
