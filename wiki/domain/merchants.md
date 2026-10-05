---
type: Domain Concept
title: Merchants
description: The three merchant profiles in catalog v2 (Best Buy, Newegg, Amazon), their expected category and MCC with confidence, the caveats that make bonuses uncertain, and their catalog v3 brands.
status: stable
tags: [domain, merchants, mcc]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:26:46Z
sources:
  - resource: ../../evals/curation/real/merchants.json
    title: Merchant profiles (input to the catalog builder)
  - resource: ../../evals/curation/expansion/merchants.json
    title: Brands and merchant profiles for catalog v3
  - resource: ../../packages/rewards-core/src/catalog-v2.ts
    title: CATALOG_V2 merchants
  - resource: ../../packages/rewards-core/src/types.ts
    title: MerchantProfile type
  - resource: ../../docs/research/cashback-card-terms-2026.md
    title: Research report, section on electronics retailers (checked 2026-09-28)
stale_after: 2026-11-04T00:00:00Z
---

# Merchants

A merchant profile says what the engine may assume about a retailer: whether it is online retail selling physical goods, whether it is U.S., which merchant category it is expected to code as, and the predicted MCC with a confidence level. Both catalogs have the same three profiles. The MCC is a prediction. It is never observed at checkout. None of the seven release-1 [cards](cards.md) pays a bonus on the expected categories, so for them the deciding test is the Amex online-retail channel rule (see [Reward rules](reward-rules.md)). In the bundled catalog v3 (178 cards) brand-scoped rules and store cards also decide, and the `electronics` category pays at Best Buy and Newegg for the cards that offer it (U.S. Bank Cash+ and Cash+ Secured when chosen, Edward Jones Triple Rewards as an automatic top category); see [Catalog v3](#catalog-v3-stage-2-m4).

## Facts

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
- A purchase at a merchant not in `merchants` returns `unsupported-merchant`.
- `expectedCategory` gates MCC-group rules. With `electronics` or `general-merchandise`, no supermarket, gas, dining or other category rule can apply.

## Catalog v3 (Stage 2 M4)

[`evals/curation/expansion/merchants.json`](../../evals/curation/expansion/merchants.json) carries the same three profiles plus `brandIds` (`amazon-us` → `amazon`, `best-buy-us` → `best-buy`, `newegg-us` → `newegg`) and the 140 brands that overlay rules, closed-loop cards and store-credit programs refer to. A brand is a merchant name for matching only and implies no affiliation; UI copy must not present brands as partners. Rules scoped to `amazon`, `best-buy` or `newegg` (Prime Visa, Amazon Store Card, My Best Buy Visa, Newegg Store Credit Card) are the ones that change rankings at the supported merchants today ([overlay decision](../decisions/2026-10-02-catalog-overlay-conventions.md)).

## Gotchas

- The research report recommends the label "community, medium-low confidence". The catalog stores `low`.
- Browser cart observations do not show how a transaction will post. The shopper's `onlineRetail` answer and the payment path decide whether BCE's 3% is certain or a range.

## Related

* [Reward rules](reward-rules.md)
* [Cards](cards.md)
* [Glossary](glossary.md)
