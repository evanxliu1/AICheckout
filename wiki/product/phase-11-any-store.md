---
type: Product
title: Phase 11 plan (any store, typed amount)
description: The popup recommends a card at any U.S. online store — the store detected from the active tab, unknown stores answered with a generic "Another U.S. online store" profile the engine supplies, the amount typed by the shopper; the three supported stores, the badge, savings and catalogs unchanged.
status: stable
tags: [product, plan, phase-11, merchants, engine, extension]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T19:40:00Z
sources:
  - resource: phase-10-merchant-expansion.md
    title: Merchant coverage plan (Phases 10–17)
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: compareV3 (merchant lookup, ruleCoversMerchant)
  - resource: ../../extension/src/popup/Popup.tsx
    title: Popup (merchant select, typed amount)
---

# Phase 11 plan: any store, typed amount

Started 2026-10-05, in parallel with Phase 10 ([merchant coverage plan](phase-10-merchant-expansion.md)). Today the popup has a manual merchant select of the three supported stores and the engine answers `unsupported-merchant` for anything else. After this phase, opening the popup on any U.S. online store gives a recommendation with an amount the shopper types. Scope reduced by Evan on 2026-10-05: no store search, no category ranges ([decision](../decisions/2026-10-05-merchant-coverage-phases.md)).

## Design

| Part | Change |
| --- | --- |
| Generic profile | `GENERIC_MERCHANT_PROFILE` in `packages/rewards-core`: id `generic-us-online`, name "Another U.S. online store", `expectedCategory: general-merchandise`, `onlineRetail` and `physicalGoods` and `usMerchant` true, `mcc` null with `low` confidence, no brands. Supplied by the engine, not the catalog, so every v3 release (bundled or hosted, already published) supports it with no schema, SQL or migration change |
| Engine | `compareV3` uses the generic profile when `purchase.merchantId` is `generic-us-online` and the catalog has no profile of that id; v1 and v2 catalogs still answer `unsupported-merchant`. Under the existing rules: all-purchases and online-retail rules apply; MCC-group and brand-scoped rules do not; closed-loop cards are not accepted |
| Online-retail eligibility | Derived from the profile as the badge already does for named stores (`autoPurchase`), so online-retail bonuses apply without a range; the popup's existing eligibility select still lets the shopper override |
| Popup | On open, the active tab's URL (granted by `activeTab`) picks the store: a supported store by the existing host match, any other `http(s)` page the generic profile. The existing select gains "Another U.S. online store" so the shopper can correct it; no search. "Read cart amount" stays for supported stores only; at a generic store the amount is typed |
| Names | `merchantName` returns "Another U.S. online store" for the generic id (results, saved purchase restore) |
| Unchanged | Badge, content-script hosts, `host_permissions`, savings and order recognition (popup never asks; generic stores never do), catalog data, payment pages (PayPal, Shop Pay) get the generic answer |

Known limit, tested and documented: the generic profile carries no brands, so a rule's `excludedBrandIds` (for example "excluding Walmart and Target") cannot fire at a generic store. A guard test on the bundled catalog lists every rule that can apply at the generic profile and has exclusions; today it should be none (the online-retail rules have no exclusions). Named profiles for such stores come with the merchant database (Phase 14).

## Steps

| # | Step | Verify |
| --- | --- | --- |
| 1 | Generic profile and engine change | `rewards-v3` tests: generic id on the fixture (applies all-purchases and online-retail, rejects MCC-group and brand rules, closed-loop not accepted, v1/v2 still unsupported); golden ladders on the real catalog unchanged; guard test on exclusions |
| 2 | Popup tab detection, generic option, names | `popup.test.tsx` cases: supported host preselects it, other host preselects generic, non-web page keeps today's default; generic restore |
| 3 | Browser and accessibility | `test:browser`: popup on a fixture at an unsupported host shows a recommendation from a typed amount; axe at 360 and 480 px; `host_permissions` assertions unchanged |
| 4 | Wiki | [Merchants](../domain/merchants.md), [reward rules](../domain/reward-rules.md), [rewards engine](../system/rewards-engine.md), [extension](../system/extension.md), now, log |

Done when steps 1–4 pass, an independent reviewer subagent approves and CI passes on one PR from branch `phase11-any-store`.

## Related

* [Merchant coverage plan](phase-10-merchant-expansion.md)
* [Merchants](../domain/merchants.md)
