---
type: Decision
title: The newest valid catalog is in effect, not always the cached release
description: Of the cached published release and the bundled catalog, the extension uses the one valid now, and the one verified later when both are; the cached release keeps its sequence rollback protection and stays cached when it is not in effect.
status: accepted
tags: [decision, extension, catalog, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T00:25:00Z
sources:
  - resource: ../../extension/src/state/catalog.ts
    title: currentCatalog, catalogByVersion and prepareCatalogUpdate
  - resource: ../../extension/src/state/service.ts
    title: load(now), reconciliation on a catalog switch
  - resource: ../../extension/src/state/migrate.ts
    title: migrateState and reconcileState
  - resource: ../../extension/tests/catalog-newest.test.ts
    title: Newest-wins tests
---

# The newest valid catalog is in effect, not always the cached release (2026-10-03)

## Context
The [M6 extension state decision](2026-10-02-extension-state-v3.md) kept the earlier rule that a cached published release always wins over the bundled catalog, and left the alternative to the coordinator. After M5 bundles `CATALOG_V3` (verified 2026-10-02), a shopper who cached hosted release 1 (the v2 catalog verified 2026-09-29, expiring 2026-10-29) would keep the older 7-card terms until a refresh, and after 2026-10-29 every comparison would report expired terms although the extension ships valid ones. The coordinator decided at the M6 pre-merge review that the newer valid catalog wins.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Which catalog is in effect | The one valid now (`verifiedAt` ≤ now < `expiresAt`); if both are, the later `verifiedAt`; on a tie the cached release; if neither is valid, the cached release | Cached always wins: the M5 problem above. Compare by `version`: release and bundle versions are free-form strings with no order. Compare by schema version on a tie: a published correction of the same day's terms must take effect |
| Rollback protection | Unchanged: `prepareCatalogUpdate` compares an incoming release with the cached one by sequence, whichever catalog is in effect | Comparing with the bundled catalog: it has no sequence |
| A refresh that brings a release older than the bundled catalog | Cached (it is the reference for the next sequence check and takes over if the bundled catalog expires first); the state is not written; notice "The terms bundled with this extension are newer" | Refusing it: the next refresh would accept a lower sequence |
| Switching as time passes (a cached release expires, or it outlives the bundle) | On load the stamp `walletCatalogVersion` differs from the catalog in effect and the wallet is reconciled; when the old catalog is still at hand (cached or bundled, `catalogByVersion`) usage rows whose rule changed are dropped too, as on a refresh | Reconciling by ID only: a changed spend cap would keep a limit reported for other terms |
| Schema 2 → 3 with a cache under the new key and one inside the state | The one with the higher release sequence (the key's on a tie) | The key's always: correct only while a newer worker is the only writer |

## Decision
As in the "Chosen" column. `currentCatalog(cache, now)` in `state/catalog.ts` takes the time; the worker loads with one `now` per request.

## Consequences
- After M5, an extension update moves shoppers with hosted release 1 cached to the bundled v3 catalog at once; the v2-only card IDs stay in the wallet and block comparisons (`unknown-owned-card`) until removed, as for any missing card. M10's v3 release (verified later than the bundle) then takes over on a refresh.
- A cached release that expires gives way to a valid bundled catalog, so "These card terms have expired" now needs both to be invalid. The popup browser spec checks the fallback and runs its axe check on another unavailable result (a saved card the catalog lacks).
- Tests that relied on an older cached v1 release beating the bundled v2 catalog now use a cached release verified later than the bundle.

## Status
Accepted 2026-10-03 by the coordinator; implemented in the M6 pre-merge review (agent-verified). Supersedes the "cached release always wins" consequence and the schema 2 → 3 cache row of the [M6 extension state decision](2026-10-02-extension-state-v3.md). Partly superseded 2026-10-03 by [when both catalogs have expired, use the one verified later and keep the shopper's answers](2026-10-03-expired-catalogs-keep-answers.md) (the "neither is valid" case).
