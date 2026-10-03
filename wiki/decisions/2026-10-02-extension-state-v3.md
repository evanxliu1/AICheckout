---
type: Decision
title: Extension state schema 3 for catalog v3 (Stage 2 M6)
description: The catalog cache moves to its own plain storage key, the wallet records which catalog it was checked against and is pruned on load when that changes, responses carry the catalog in effect so pages bundle none, stale v3 wallet inputs are dropped by ID, and the badge receives only the owned cards' slice of the catalog.
status: accepted
tags: [decision, extension, state, catalog, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../extension/src/state/contracts.ts
    title: appStateSchema (schema 3), catalogCacheSchema, walletSchema
  - resource: ../../extension/src/state/migrate.ts
    title: migrateState and reconcileState
  - resource: ../../extension/src/state/wallet.ts
    title: reconcileWallet and validateWallet
  - resource: ../../extension/src/state/catalog.ts
    title: Bundled catalog and prepareCatalogUpdate
  - resource: ../../extension/src/background/badge-service.ts
    title: badgeCatalog
  - resource: ../../extension/tests/state-v3.test.ts
    title: Migration, vault size, v3 refresh, pruning and badge payload tests
---

# Extension state schema 3 for catalog v3 (Stage 2 M6) (2026-10-02)

## Context
The [Stage 2 plan](../product/phase-7-stage-2.md) M6 wires catalog v3 and the v3 engine into the extension. Until now the cached published release lived inside the app state, which the optional vault encrypts into an envelope of at most 512 KiB; a v3 catalog may be 1 MiB. The [engine semantics](2026-10-02-engine-v3-semantics.md) and [review](2026-10-02-engine-v3-review-gates-and-shared-caps.md) decisions make the engine throw on wallet choices, gate answers, point values and usage rows whose IDs the catalog lacks, and the [M1 contract details](2026-10-02-catalog-v3-contract-details.md) left the extension refusing v3 releases. M5 will replace the bundled `CATALOG_V2` with the 180-card `CATALOG_V3`, possibly with different rule IDs.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Where the catalog cache lives | Its own key `checkoutCatalogV1` in `chrome.storage.local`, never encrypted, written in the same `local.set` as the state it belongs with; the state (`checkoutStateV1`, schema 3) no longer holds it | Inside the envelope: a 1 MiB catalog exceeds the 512 KiB vault limit. Raising the limit: encrypts public data and re-encrypts it on every wallet write |
| An unreadable catalog cache | Ignored (bundled terms) and replaced on the next refresh | Treating it as damaged saved data: the shopper would have to delete the wallet over public data the service can send again |
| Wallet saved under another catalog (a new bundled catalog after an extension update, a dropped cache) | State records `walletCatalogVersion`; on load a mismatch drops what the catalog in effect lacks (by ID), with the migration notice; when nothing is dropped only the stamp changes and the revision stays | Migrating per bundle change: every bundled catalog swap (M5) would need its own migration code. Bumping the revision on every stamp: open popups would fail their next write |
| What a catalog update drops | Usage rows whose rule is gone or changed (as before); choices, gate answers and point values only when their IDs no longer resolve (or a choice no longer fits `picks`, or a program is no longer points) | Dropping choices and answers whenever their definition changed: label edits would wipe the shopper's own facts |
| Schema 2 → 3 with a cache already under the new key | The cache under the key wins over the one inside the old state | Overwriting it: only possible if a newer worker wrote it, so it is the newer one |
| How pages get the catalog | Every `checkout:*` response carries `catalog` (the catalog in effect); pages import storage keys and limits from `state/keys.ts` and never load the bundled catalog | Pages importing the bundle: with M5 that is about 750 KB parsed in every popup and badge frame. Pages reading `chrome.storage` directly: breaks the thin-client rule |
| What the badge `ready` view sends | `badgeCatalog`: the owned cards, the merchant, their programs, the brands and gates their rules name, and the sources they cite | The whole catalog: most of 1 MiB per view at 180 cards |
| Wallet limits | Usage rows per card 10 → 30 (v3 allows 30 rules a card); choices ≤ 5 per card with ≤ 5 options each; gates and point values ≤ 100 each (catalog limits). The largest valid state is under the 512 KiB vault limit (tested) | Unbounded arrays: the vault could refuse to save |

## Decision
As in the "Chosen" column. The bundled fallback stays `CATALOG_V2` (imported once, as `BUNDLED_CATALOG`, in `state/catalog.ts`); M5 changes only that import. `prepareCatalogUpdate` accepts v3 releases under the same rules as v1 and v2 releases (schema, validity window, no lower sequence, an equal sequence must be identical, no reused version; the hash is not a signature, HTTPS and the fixed endpoint establish origin). The catalog client's response cap is `CATALOG_V3_LIMITS.bytes` + 2 KiB.

## Consequences
- Measured (2026-10-02, tests): with a 1,036,594-byte catalog cached and a 20-card v3 wallet under the vault, the envelope is under 64 KiB; the badge slice for 20 of 240 cards is under 160 KiB and for one card under 16 KiB.
- The popup and onboarding no longer bundle a catalog; the worker chunk holds it (checked in the build output).
- A cached release always wins over the bundled catalog, even when the bundled one is newer (unchanged behaviour). After M5 ships `CATALOG_V3` in an update, a shopper who cached hosted release 1 (v2, expiring 2026-10-29) keeps it until a refresh brings the v3 release; after its expiry comparisons show "terms expired" until then. M10 publishes the v3 release before 2026-10-28, so a refresh resolves it; choosing the newer of cached and bundled is left to the coordinator.
- M7 builds the editors for choices, gates and point values; `WalletEditor` keeps the existing ones when saving cards. `purchaseSchema` and the badge payment selector still list the v2 payment paths (Venmo is M7).

## Status
Accepted 2026-10-02 by the M6 implementing agent within the [Stage 2 plan](../product/phase-7-stage-2.md); the coordinator or Evan can revise any row. Supersedes the "Extension before M6" row of the [M1 contract details](2026-10-02-catalog-v3-contract-details.md).
