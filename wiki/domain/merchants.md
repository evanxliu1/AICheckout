---
type: Domain Concept
title: Merchants
description: What the engine may assume about a store — the merchant release records (release 2026-10-11.mcc.3, 640 records) matched on the device, the engine's generic "Another U.S. online store" profile, and the three catalog merchant profiles (Best Buy, Newegg, Amazon) with their MCC predictions and caveats.
status: stable
tags: [domain, merchants, mcc]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
sources:
  - resource: ../../evals/curation/real/merchants.json
    title: Merchant profiles (input to the catalog builder)
  - resource: ../../evals/curation/expansion/merchants.json
    title: Brands and merchant profiles for catalog v3
  - resource: ../../packages/rewards-core/src/catalog-v2.ts
    title: CATALOG_V2 merchants
  - resource: ../../packages/rewards-core/src/types.ts
    title: MerchantProfile type
  - resource: ../../packages/rewards-core/src/generic-merchant.ts
    title: GENERIC_MERCHANT_PROFILE (Phase 11)
  - resource: ../../packages/rewards-core/src/merchants-v1.ts
    title: MERCHANTS_V1 bundled merchant release
  - resource: ../../evals/merchants/db/records/
    title: Authored merchant records
  - resource: ../../docs/research/cashback-card-terms-2026.md
    title: Research report, section on electronics retailers (checked 2026-09-28)
stale_after: 2026-11-04T00:00:00Z
---

# Merchants

A merchant profile says what the engine may assume about a retailer: whether it is online retail selling physical goods, whether it is U.S., which merchant category it is expected to code as, and the catalog brands whose store it is. At checkout the profile comes from the **merchant release** ([records](#merchant-release-records-phase-141)): the extension matches the tab's host against release `2026-10-11.mcc.3` (640 records, 89 with a bonus category) on the device; a site no enabled record matches gets the engine's [generic profile](#another-us-online-store-phase-11). The MCC is never observed at checkout. Catalogs v2 and v3 still carry three authored profiles (Best Buy, Newegg, Amazon, below); the release's own record for a store is what the extension passes to the engine ([Rewards engine](../system/rewards-engine.md#a-merchant-release-profile-phase-141)).

## Catalog profiles

| `id` | Online retail | Physical goods | U.S. | `expectedCategory` | MCC | Confidence | MCC source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `best-buy-us` | yes | yes | yes | electronics | 5732 | low | CheckMCC community lookup, undated (checked 2026-09-28) |
| `newegg-us` | yes | yes | yes | electronics | 5732 | low | CheckMCC community lookup, undated (checked 2026-09-28) |
| `amazon-us` | yes | yes | yes | general-merchandise | null | low | none collected |

Both CheckMCC pages were re-checked unchanged (same SHA-256) by `pipeline freshness` on 2026-10-05, which dates them 2026-10-05 in catalog v3 `2026-10-05.renewal.1` ([freshness record](../../evals/curation/freshness/2026-10-05.json)). MCC 5732 is the network code for electronics stores. The research report found no evidence for the alternatives 5734, 5999 or 5311, and no data that separates online coding from in-store coding.

## Caveats (recorded in profile `notes`)

| Merchant | Caveat |
| --- | --- |
| Best Buy | Online retail only when paid online. Buy online, pick up in store counts only if Best Buy codes it as online. Geek Squad services and protection plans may count as services, not retail (inference, not confirmed by Amex) |
| Newegg | Newegg Marketplace third-party sellers may post differently. No evidence either way |
| Amazon | Amex names Amazon.com as an eligible online retailer and says online superstores such as Amazon are not supermarkets. Third-party marketplace sellers may post differently. Digital goods and services are not physical goods |

**Marketplace caveat.** Amex's terms say a purchase "may not" earn additional rewards when the merchant uses a third party to sell or to process the transaction. Marketplace items (Newegg Marketplace, Amazon third-party sellers) are therefore uncertain, not ineligible. The profile does not model per-item sellers. The flag lives only in `notes`.

## How it works

- Profiles are authored in [`evals/curation/real/merchants.json`](../../evals/curation/real/merchants.json) and copied into `CATALOG_V2.merchants` by [`scripts/build-catalog-v2.mjs`](../../scripts/build-catalog-v2.mjs). Merchant MCC page captures are gitignored (`evals/curation/real/merchant-captures/`). Only `merchant-manifest.json` and `merchant-sources.json` are committed.
- A purchase at a merchant not in `merchants` returns `unsupported-merchant`, except the generic id `generic-us-online` with a v3 catalog (see [Another U.S. online store](#another-us-online-store-phase-11)).
- `expectedCategory` gates MCC-group rules. With `electronics` or `general-merchandise`, no supermarket, gas, dining or other category rule can apply.

## Catalog v3 (Stage 2 M4)

[`evals/curation/expansion/merchants.json`](../../evals/curation/expansion/merchants.json) carries the same three profiles plus `brandIds` (`amazon-us` → `amazon`, `best-buy-us` → `best-buy`, `newegg-us` → `newegg`) and the 140 brands that overlay rules, closed-loop cards and store-credit programs refer to. A brand is a merchant name for matching only and implies no affiliation; UI copy must not present brands as partners. Rules scoped to `amazon`, `best-buy` or `newegg` (Prime Visa, Amazon Store Card, My Best Buy Visa, Newegg Store Credit Card) are the ones that change rankings at the supported merchants today ([overlay decision](../decisions/2026-10-02-catalog-overlay-conventions.md)).

## Another U.S. online store (Phase 11)

The engine, not the catalog, supplies one more profile: `GENERIC_MERCHANT_PROFILE` in [`generic-merchant.ts`](../../packages/rewards-core/src/generic-merchant.ts) ([decision](../decisions/2026-10-05-generic-store-profile.md)). The popup and the cart badge use it for any page whose host `storeForTab` matches to no release record, or to a `disabled` one ([Extension](../system/extension.md#store-matching-phase-142), [Cart badge](../system/cart-badge.md)).

| `id` | Name | Online retail | Physical goods | U.S. | `expectedCategory` | MCC | Brands |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `generic-us-online` | Another U.S. online store | yes | yes | yes | general-merchandise | null, `low` | none |

- `compareV3` adds it to the catalog's merchants unless the catalog has a profile with that id (`merchantProfilesV3`), so every v3 release, bundled or hosted, supports it with no schema, SQL or migration change. v1 and v2 catalogs still answer `unsupported-merchant`. `catalogMerchantIds` lists it for v3 catalogs.
- What applies there: `all-purchases` and `online-retail` rules. MCC-group rules do not (no reward category is `general-merchandise`), brand-scoped rules do not, and closed-loop cards are not accepted.
- **Known limit.** It has no brands, so a rule's `excludedBrandIds` cannot fire at a generic store. A guard test in `extension/tests/rewards-v3.test.ts` lists every bundled rule that can apply there and has exclusions; in `2026-10-05.renewal.1` there is one, the Synchrony OnePay CashRewards first-90-days 3%, which excludes Walmart. walmart.com itself is a release record with brand `walmart`, so there the exclusion fires and the Walmart rate applies (`rewards-v3.test.ts`).
- The amount comes from the generic cart reader ([`packages/cart-reader`](../../packages/cart-reader/)); the shopper is never asked to type one: when the reader is not certain, the badge and popup show the best card by rate (the rates view), and an optional amount field remains ([decision](../decisions/2026-10-09-never-ask-for-an-amount.md)). Online-retail eligibility starts at "Eligible", which the shopper can change.
- **Brand websites:** at a matched store, brand rules apply regardless of its category, and the store gets a bonus category only on `issuer`, `mcc`, `corroborated` or `definition` evidence, otherwise the general rate, never a range ([decision](../decisions/2026-10-10-merchant-database-evidence.md), [definition basis](../decisions/2026-10-11-definition-evidence-basis.md), [mcc basis](../decisions/2026-10-11-mcc-evidence-basis.md), [Phase 14 plan](../product/phase-14-merchant-database.md)).
- **Generic reader only:** no store configs anywhere; when the generic reader is not certain of an amount it withholds and the recommendation shows rates only ([decision](../decisions/2026-10-06-reader-shows-only-certain-amounts.md), [adapters retired](../decisions/2026-10-19-retire-legacy-adapters.md)).

## Merchant release records (Phase 14.1)

The merchant release (`merchant-release.1`; [contract](../system/rewards-engine.md#merchant-release-contract-phase-141), [plan](../product/phase-14-merchant-database.md#3-what-a-merchant-record-says)). A record says who a website is (`hosts`, `name`), its `kind` (`merchant`, `marketplace`, `processor`), whether it sells `physicalGoods`, its `category` with the `evidence` behind it (`issuer`, `mcc`, `corroborated`, `definition` or `default`; [mcc decision](../decisions/2026-10-11-mcc-evidence-basis.md)), the catalog `brandIds` whose official store it is, and a remote `disabled` switch. A matched record becomes a `MerchantProfileV3` (`recordToProfile`: online U.S. store, no MCC) that the engine takes as `{ merchant }`. The extension matches every tab against the bundled release and passes that profile at every comparison; a `processor` page gets no badge, no reader and a popup notice; a `disabled` record is the generic store ([Extension](../system/extension.md#store-matching-phase-142), [Cart badge](../system/cart-badge.md), [decision](../decisions/2026-10-11-extension-on-the-merchant-release.md)).

**Bundled release `2026-10-11.mcc.3`** (`MERCHANTS_V1`, generated from [`evals/merchants/db/records/`](../../evals/merchants/db/records/) by `npm run merchants`; how records are researched, verified and released: [Merchant pipeline](../system/merchant-pipeline.md)):

| Item | Value |
| --- | --- |
| Records | 640: 605 merchants, 20 marketplaces, 15 payment processors (PayPal, Venmo, Shop Pay, Klarna, Affirm, Afterpay, Bolt, Amazon Pay, Sezzle, Zip, Stripe Checkout, Link, Google Pay, Cash App Pay, Splitit) |
| Bonus categories | 89 records: 13 `issuer`, 14 `definition`, 62 `mcc`; the other 551 are `default` (`general-merchandise`) |
| Sources | 37 (issuer terms, store pages, openly licensed MCC datasets) |
| Examples | `best-buy-us` and `newegg-us` `electronics` on the `mcc` basis; `amazon-us` and `walmart-us` `general-merchandise` (`default`) with brands `amazon` and `walmart` |

## Gotchas

- The research report recommends the label "community, medium-low confidence". The catalog stores `low`.
- The release's own record decides a store's category, not the catalog's profile: Best Buy and Newegg are `electronics` on the `mcc` basis (2,907 and 507 matched dataset rows, 99% electronics stores and computer software stores), so the Cash+ and Edward Jones electronics bonuses apply there.
- At a generic store, and at a release store, the online-retail answer defaults to "Eligible", so a BCE-style online-retail bonus applies unless the shopper changes it (a record with `physicalGoods: false` blocks the rule in the engine regardless). A payment processor page (PayPal, Shop Pay) is compared nowhere: the popup says it is a payment page and the badge stays hidden.
- Browser cart observations do not show how a transaction will post. The shopper's `onlineRetail` answer and the payment path decide whether BCE's 3% is certain or a range.

## Related

* [Reward rules](reward-rules.md)
* [Cards](cards.md)
* [Glossary](glossary.md)
