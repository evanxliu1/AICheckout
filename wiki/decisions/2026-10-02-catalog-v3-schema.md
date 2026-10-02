---
type: Decision
title: Add catalog schema 3 for the expansion, built from the untouched corpus plus a verified overlay
description: The 180-card catalog is a new `schemaVersion: 3` (programs, brands, gates, chosen categories, closed-loop cards, larger limits) generated from the agent-verified corpus labels plus a separately verified product overlay, over extending schema 2 in place or editing corpus labels.
status: accepted
tags: [decision, catalog, schema, database, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T20:30:00Z
sources:
  - resource: ../../packages/rewards-core/src/schema.ts
    title: Catalog v1/v2 Zod schemas
  - resource: ../../supabase/migrations/20260930225732_catalog_v2.sql
    title: SQL validator for catalog v2
  - resource: ../../evals/curation/expansion/product-notes.verified.json
    title: Verified product notes (197 hints the extraction schema cannot express)
---

# Add catalog schema 3 for the expansion, built from the untouched corpus plus a verified overlay (2026-10-02)

## Context
Catalog v2 (`catalogV2Schema`, `valid_catalog_v2`) allows 30 cards, 30 sources, 20 merchants and 256 KiB, every card needs exactly one unconditional `all-purchases` rule, `rateBps` is a cash-equivalent rate, and every object is strict. The expansion needs 180 cards (173 expansion + the 7 real ones), about 340 sources, an estimated 0.5–0.7 MB of JSON, and rule shapes v2 cannot hold: 132 merchant-specific hints, 13 cardholder-chosen categories, 4 rotating quarters, 28 relationship or tier gates, 11 checkout-method rules, 8 closed-loop cards (9 cards have no single base rule), and a points valuation ([decision](2026-10-02-points-valuation-published-estimates.md)). The corpus labels are also eval labels and may not be edited to suit the product.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Extend v2 in place (new optional fields, higher limits) | Fewer moving parts | Changes what `rateBps` means for points cards in a schema that already has published releases; the strict v2 validator would need an edited meaning under the same version number; v2 parity cases would mix two semantics |
| Put the product structure into `corpus.json` labels | One file | Edits eval labels for product reasons; the extraction contract `issuer-extraction.2` has no slots for it |
| **New `schemaVersion: 3`, generated from the corpus plus a verified overlay** | Chosen | v1/v2 releases, cached copies and parity cases keep their meaning; v3 gets its own Zod schema, SQL validator and parity cases; corpus stays the eval truth |

## Decision
1. **Schema 3** in `packages/rewards-core`: `programs[]`, `brands[]`, `gates[]`, `merchants[]` (v2 profile plus `brandIds`), `sources[]`, `cards[]`. A card has `programId`, an optional issuer-stated value, `acceptance` (`open-loop`, or `closed-loop` with brand IDs), optional `choices[]` (chosen or automatic categories), rules and exclusions. A rule adds to v2: `brandIds` (merchant scope), `choice` (rule earns only on the chosen option), `requires` (gate options), `requiredPaymentPaths`, and `limitedTime.startsOn`. Open-loop cards keep exactly one unconditional base rule; closed-loop cards need none. The reward category list grows only by categories that a chosen or rotating option or a rule names (fixed in milestone M4 of the [Stage 2 plan](../product/phase-7-stage-2.md)); the extraction contract is unchanged.
2. **Limits** (Zod and SQL alike): 300 cards, 600 sources, 100 merchants, 400 brands, 100 programs, 100 gates, 30 rules per card, `MAX_CATALOG_BYTES` 1 MiB. The 30-day validity window and source-age rule stay.
3. `catalogSchema` becomes a union of 1, 2 and 3; `valid_catalog` in a **new** migration accepts v1, v2 or v3. Old releases stay valid and readable.
4. **Overlay.** Product structure the corpus cannot express lives in committed builder inputs next to the corpus (`evals/curation/expansion/catalog-overlay.json`, `reward-programs.json`, `merchants.json`), each entry with a 25-word-or-shorter anchor and a provenance field, authored and checked by independent subagents (`agent-verified`). The builder refuses any `other` rule, issue or product hint that the overlay does not give a disposition.
5. `scripts/build-catalog-v3.mjs` generates `packages/rewards-core/src/catalog-v3.ts` deterministically, never from model output, with a `--check` mode in CI, like v2.

## Consequences
- An extension built before v3 rejects a v3 release (schema fails closed). Acceptable: the extension is not yet in the Web Store; hosted builds must be updated before Evan publishes a v3 release.
- The v2 engine and `CATALOG_V2` stay for cached releases and tests; new work targets v3 only.
- The SQL validator for v3 is the largest piece of the migration; parity cases must cover every new invariant.
- The overlay is a second set of agent-verified facts with its own quote checks; `check-expansion-quotes.mjs` must scan it.

## Status
Accepted 2026-10-02 by the planning agent for the [Stage 2 plan](../product/phase-7-stage-2.md); Evan can reverse it before milestone M1 starts.
