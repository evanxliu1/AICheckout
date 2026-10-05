---
type: Decision
title: Generic "Another U.S. online store" profile supplied by the engine
description: Phase 11 answers any U.S. online store with an engine-supplied merchant profile `generic-us-online` (all-purchases and online-retail rules only), the popup picks the store from the active tab by site, and the one bundled rule whose brand exclusion cannot fire there is pinned by a guard test.
status: accepted
tags: [decision, phase-11, merchants, engine, extension]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T20:45:00Z
sources:
  - resource: ../product/phase-11-any-store.md
    title: Phase 11 plan (any store, typed amount)
  - resource: ../../packages/rewards-core/src/generic-merchant.ts
    title: GENERIC_MERCHANT_PROFILE
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: compareV3, merchantProfilesV3
  - resource: ../../extension/src/checkout/merchants.ts
    title: merchantForTab
---

# Generic "Another U.S. online store" profile supplied by the engine (2026-10-05)

## Context
Phase 11 lets the popup recommend a card at any U.S. online store from a typed amount ([plan](../product/phase-11-any-store.md)). The engine answered `unsupported-merchant` for any merchant id outside the catalog, and hosted v3 releases are already published, so the profile could not wait for a new catalog. Building it raised three questions the plan left open: where the profile lives, how the popup recognises a supported store from the tab, and what to do because the plan's exclusion guard was expected to be empty and is not.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Where the profile lives | A catalog merchant (schema, SQL, every release); engine-supplied constant | Engine-supplied (as the plan says), in its own Zod-free module `generic-merchant.ts` so the extension's content-script-reachable `merchants.ts` can import its name without pulling Zod or the catalog |
| Catalog with the same id | Engine profile wins; catalog profile wins | Catalog profile wins (`merchantProfilesV3`), so a future release can refine it |
| Store from the tab | Exact adapter host plus cart path (`merchantForCheckout`); exact host; same site (last two host labels) | Same site: the Newegg adapter host is only `secure.newegg.com`, so the stricter matches would call Newegg product pages generic; all adapter hosts are `.com`, so two labels name the site |
| Exclusion guard finds `onepay-cashrewards-all-first-90-days-v2` (excludes Walmart) | Engine treats exclusions at a brandless profile as uncertain; drop the rule at the generic store; pin it in the guard and document | Pin and document: the plan names this a known limit, the rule is gated on a 90-day answer, and changing engine semantics was out of scope. Evan may choose otherwise |
| Online-retail eligibility in the popup | Derive for every store; derive for the generic store only | Generic store only (`eligible`); supported stores keep today's "I'm not sure" so their behaviour does not change |

## Decision
`GENERIC_MERCHANT_PROFILE` (`generic-us-online`, "Another U.S. online store", online retail, physical goods, U.S., `general-merchandise`, MCC null `low`, no brands) is exported by `@ai-checkout/rewards-core`; `compareV3` adds it unless the catalog defines that id; v1 and v2 stay unsupported; `catalogMerchantIds` lists it for v3. The popup reads the active tab URL on open with `merchantForTab` and offers the generic store in its Merchant select, without "Read cart amount". A guard test lists the bundled rules whose brand exclusions cannot fire there.

## Consequences
- No schema, SQL, migration, host permission or badge change; already-published v3 releases support the generic store.
- At walmart.com, OnePay CashRewards with the first-90-days answer shows 3% instead of the card's Walmart rate; any new rule of this kind fails the guard test until reviewed. Named profiles come with Phase 14.
- Amazon Pay pages on `pay.amazon.com` would be detected as Amazon; the shopper can change the select.

## Status
Accepted 2026-10-05 by the Phase 11 builder (claude-code/claude-opus-5-5) under the plan Evan approved; the OnePay handling is open for Evan.
