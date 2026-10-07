---
type: Product
title: Phase 11 plan (any store, typed amount)
description: The popup recommends a card at any U.S. online store — the store detected from the active tab, unknown stores answered with a generic "Another U.S. online store" profile the engine supplies, the amount typed by the shopper; the three supported stores, the badge, savings and catalogs unchanged.
status: stable
tags: [product, plan, phase-11, merchants, engine, extension]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
sources:
  - resource: phase-10-merchant-expansion.md
    title: Merchant coverage plan (Phases 10–17)
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: compareV3 (merchant lookup, ruleCoversMerchant)
  - resource: ../../extension/src/popup/Popup.tsx
    title: Popup (merchant select, typed amount)
---

# Phase 11 plan: any store, typed amount

**Done 2026-10-05:** merged as PR #57 (`f041fef`) after an independent review (agent-verified) and CI. Started 2026-10-05, in parallel with Phase 10 ([merchant coverage plan](phase-10-merchant-expansion.md)). Before this phase the popup had a manual merchant select of the three supported stores and the engine answered `unsupported-merchant` for anything else. Since this phase, opening the popup on any U.S. online store gives a recommendation with an amount the shopper types. Scope reduced by Evan on 2026-10-05: no store search, no category ranges ([decision](../decisions/2026-10-05-merchant-coverage-phases.md)).

## Design

| Part | Change |
| --- | --- |
| Generic profile | `GENERIC_MERCHANT_PROFILE` in `packages/rewards-core`: id `generic-us-online`, name "Another U.S. online store", `expectedCategory: general-merchandise`, `onlineRetail` and `physicalGoods` and `usMerchant` true, `mcc` null with `low` confidence, no brands. Supplied by the engine, not the catalog, so every v3 release (bundled or hosted, already published) supports it with no schema, SQL or migration change |
| Engine | `compareV3` uses the generic profile when `purchase.merchantId` is `generic-us-online` and the catalog has no profile of that id; v1 and v2 catalogs still answer `unsupported-merchant`. Under the existing rules: all-purchases and online-retail rules apply; MCC-group and brand-scoped rules do not; closed-loop cards are not accepted |
| Online-retail eligibility | Derived from the profile as the badge already does for named stores (`autoPurchase`), so online-retail bonuses apply without a range; the popup's existing eligibility select still lets the shopper override |
| Popup | On open, the active tab's URL (granted by `activeTab`) picks the store: a supported store by the existing host match, any other `http(s)` page the generic profile. The existing select gains "Another U.S. online store" so the shopper can correct it; no search. "Read cart amount" stays for supported stores only; at a generic store the amount is typed |
| Names | `merchantName` returns "Another U.S. online store" for the generic id (results, saved purchase restore) |
| Unchanged | Badge, content-script hosts, `host_permissions`, savings and order recognition (popup never asks; generic stores never do), catalog data, payment pages (PayPal, Shop Pay) get the generic answer |

Known limit, tested and documented: the generic profile carries no brands, so a rule's `excludedBrandIds` (for example "excluding Walmart and Target") cannot fire at a generic store. **Brand websites are deferred (Evan, 2026-10-05):** at the website of a brand the catalog knows (walmart.com, target.com, costco.com, kohls.com, …) the generic answer can be wrong: brand-scoped rules (166 in the catalog) do not apply, closed-loop store cards are not accepted, and exclusions such as OnePay's "excluding Walmart" do not fire. No shopper sees this build before Release A (Phase 15); Phase 14 gives brand websites their brands before then. A guard test on the bundled catalog lists every rule that can apply at the generic profile and has exclusions; today it should be none (the online-retail rules have no exclusions). Named profiles for such stores come with the merchant database (Phase 14).

## Steps

| # | Step | Verify |
| --- | --- | --- |
| 1 | Generic profile and engine change | `rewards-v3` tests: generic id on the fixture (applies all-purchases and online-retail, rejects MCC-group and brand rules, closed-loop not accepted, v1/v2 still unsupported); golden ladders on the real catalog unchanged; guard test on exclusions |
| 2 | Popup tab detection, generic option, names | `popup.test.tsx` cases: supported host preselects it, other host preselects generic, non-web page keeps today's default; generic restore |
| 3 | Browser and accessibility | `test:browser`: popup on a fixture at an unsupported host shows a recommendation from a typed amount; axe at 360 and 480 px; `host_permissions` assertions unchanged |
| 4 | Wiki | [Merchants](../domain/merchants.md), [reward rules](../domain/reward-rules.md), [rewards engine](../system/rewards-engine.md), [extension](../system/extension.md), now, log |

Done when steps 1–4 pass, an independent reviewer subagent approves and CI passes on one PR from branch `phase11-any-store`.

## Progress

Steps 1–4 built on `phase11-any-store` on 2026-10-05 (claude-code/claude-opus-5-5); the independent reviewer approved (agent-verified, fixes applied), CI passed and the branch merged as PR #57 (`f041fef`, 2026-10-05T21:33Z). Where the build differs from the design above ([decision](../decisions/2026-10-05-generic-store-profile.md)):

- **Store match by site, not exact host.** The Newegg adapter's only host is `secure.newegg.com` (the cart), so an exact host match would call a Newegg product page a generic store. `merchantForTab` matches a supported store when the tab's host shares its last two labels with an adapter host; every adapter host is a `.com`, so `amazon.co.uk` stays generic.
- **The exclusion guard is not empty.** One bundled rule can apply at the generic profile and has a brand exclusion: Synchrony OnePay CashRewards `onepay-cashrewards-all-first-90-days-v2` (3% on all purchases, excluding Walmart, gated on the first 90 days). The guard pins that list, so any new such rule fails the test; the limit is documented in [Merchants](../domain/merchants.md#another-us-online-store-phase-11). Evan deferred brand websites, and with them this rule's Walmart exclusion (per the brand-websites deferral above), to Phase 14 on 2026-10-05.
- **Profile module.** `GENERIC_MERCHANT_PROFILE` lives in `packages/rewards-core/src/generic-merchant.ts` (exported as `@ai-checkout/rewards-core/generic-merchant`, no Zod, no catalog) because `extension/src/checkout/merchants.ts`, which content scripts import, needs its name; content-script bundles are unchanged in size. `catalogMerchantIds` includes the generic id for v3 catalogs, so the popup shows no "terms do not cover" warning for it.
- **Eligibility default.** The popup preselects "Eligible goods, paid directly online" only for the generic store (tab detection or select); supported stores keep "I'm not sure", as before.

## Related

* [Merchant coverage plan](phase-10-merchant-expansion.md)
* [Merchants](../domain/merchants.md)
