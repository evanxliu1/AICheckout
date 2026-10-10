---
type: Decision
title: Merchant database: about 500 stores, a category bonus only on issuer evidence or two agreeing public sources, otherwise the general rate
description: Evan's Phase 14 calls on 2026-10-10. The first release has about 500 U.S. stores. Weak category evidence gives the general rate, never a range (this supersedes D5's ranges). A bonus category needs an issuer naming the store, or the store's own pages plus a public merchant-code lookup agreeing. Public sources only, never card statements. It follows competitors' hosted-list architecture with matching on the device.
status: accepted
tags: [decision, phase-14, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-10T13:00:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design
---

# Merchant database: about 500 stores, a category bonus only on issuer evidence or two agreeing public sources, otherwise the general rate (2026-10-10)

## Context
Evan, 2026-10-10: "before we release to the chrome web store, we should do the merchant database … the goal is to be able to recognize what merchant we are in, in order to know what category the merchant is, to calculate the best credit card based on that category and rewards." A card's category bonus follows the store's merchant category code, which is not public; issuers rarely name stores.

## Options considered
| Question | Options | Chosen (Evan) |
| --- | --- | --- |
| First release size | About 150 (catalog brands), about 500, 2,000 or more | About 500 |
| Weak evidence | A range ("1–5% depending on how this store codes"), the general rate | The general rate |
| Evidence bar | Issuer naming the store only; issuer or two agreeing sources (official pages show the business type and a public merchant-code lookup agrees); business type alone | Issuer or two agreeing sources |
| Card statements as evidence | Public sources only; statements kept local | Public sources only |
| Competitors | Follow Honey, Capital One Shopping and Kudos | Their architecture (hosted, reviewed list, refreshed, remote off switch, generic fallback), with matching on the device; no shopper category questions (2026-10-10) |

## Decision
As chosen.
- `category` is a bonus category only with `issuer` or `corroborated` evidence; otherwise `general-merchandise`.
- Brand rules apply at any matched store regardless of category, because the issuer names the brand.
- This supersedes the range rule (D5) in the [merchant coverage design](../system/merchant-coverage-design.md#category-evidence).

## Consequences
- **Coverage.** kroger.com and cvs.com can get grocery and drugstore bonuses; walmart.com and costco.com don't get grocery. Most other stores show the general rate.
- **The engine needs no range output for categories.**
- **Merchant release.** Its records carry `evidence.basis` (`issuer`, `corroborated`, `default`), and the review app shows only deviations from the default.
- **Measurement.** The costly error is a wrong bonus category, so the target is none on held-out stores.

## Status
Accepted 2026-10-10 (Evan).
