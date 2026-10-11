---
type: Decision
title: "Merchant evidence: a third basis, `definition`, when the store's own pages show its business type and an issuer's published category definition covers it"
description: Evan's 2026-10-11 call ("Option 2") after the 14.3 dry run gave no bonus category. A store gets a bonus category on the `definition` basis when its own captured pages plainly show its business type, an issuer's published definition of the category (quoted verbatim, 25 words or fewer) covers that type, no captured issuer page excludes that kind of store or the store from the category, and the store sells directly (a delivery marketplace only for dining where the definition names delivery services). `issuer` stays the strongest basis; `corroborated` is unchanged.
status: accepted
tags: [decision, phase-14, merchants, evidence]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T04:30:00Z
sources:
  - resource: 2026-10-10-merchant-database-evidence.md
    title: Decision, merchant database scope and evidence (the two bases this adds to)
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 2, 3, 6, 7)
  - resource: ../system/merchant-pipeline.md
    title: Merchant pipeline (apply rule, dry run)
  - resource: ../../tools/catalog-pipeline/src/merchants/apply.ts
    title: applyStore, definitionBasis, issuerExcludes
---

# Merchant evidence: the `definition` basis (2026-10-11)

## Context
The [2026-10-10 evidence decision](2026-10-10-merchant-database-evidence.md) allowed a bonus category only when an issuer names the store as earning in it (`issuer`) or the store's own pages and a public merchant-code lookup agree (`corroborated`). The 14.3 dry run on ten development stores ([merchant pipeline](../system/merchant-pipeline.md#dry-run-development-batch-dev-2026-10)) reached no bonus category at all: issuers name stores mostly in exclusion lists, definitions and co-brand terms, and merchant-code lookups are rare and often forum threads. Kroger, CVS and Lowe's shipped at the general rate although their own pages and the issuers' category definitions plainly agree on what they are. The 14.3 implementer asked whether an issuer's category definition plus the store's own pages should be a basis.

## Options considered
| Question | Options | Chosen (Evan, 2026-10-11) |
| --- | --- | --- |
| A third basis | 1: keep the two bases and accept few bonus categories; **2: add `definition`** (store pages show the business type, an issuer's category definition covers it, no issuer exclusion, direct seller); 3: business type from the store's pages alone | Option 2 |
| Exclusions | Ignore; refuse the category when any captured issuer page excludes that kind of store (superstores, discount stores, warehouse clubs) or the store | Refuse: Walmart, Target and Costco never get grocery |
| Marketplaces and delivery services | Never; always; only where the issuer's definition itself names delivery services | The latter, so DoorDash or Uber Eats may qualify for `dining` under "restaurants, including takeout and delivery services" |
| Strength | `definition` equal to `issuer`; `issuer` strongest | `issuer` strongest; `corroborated` unchanged; `definition` third |
| Evidence line in the extension | Name the issuer; basis only | "Codes as a supermarket (its own pages; fits <Issuer>'s supermarket definition)." No partnership implied |

## Decision
A record's category may rest on `evidence.basis: 'definition'` when all four hold:
1. the store's own captured pages plainly show its business type (supermarket chain, pharmacy, home-improvement retailer, electronics retailer, restaurant, food-delivery service, …);
2. an issuer's published category definition, quoted verbatim (25 words or fewer) from a captured issuer page, covers that business type ("grocery stores and supermarkets", "drugstores and pharmacies", "restaurants, including takeout and delivery services");
3. no captured issuer page excludes that kind of store, or the store, from that category;
4. the store sells directly (`kind: merchant`), except where the definition itself names delivery services, when a delivery marketplace may qualify for `dining`.

Implemented deterministically in `applyStore` ([apply.ts](../../tools/catalog-pipeline/src/merchants/apply.ts)): the definition quote (`supports: 'definition'`, issuer sources only, prompt `merchant-draft.2`) must name the category's issuer words in a clause with no exclusion wording (`definitionQuoteCovers`); the store-page `category` quote must name the business type and no kind of store the category excludes (`storePageShowsType`, `BUSINESS_TYPE_WORDS`, `CATEGORY_EXCLUDED_TYPES`); no mined issuer capture may have a sentence naming the store with exclusion wording about the category or its excluded kinds of store (`issuerExcludes`, conservative: a sentence that both includes and excludes counts as an exclusion); a marketplace qualifies only for `dining` under a definition with delivery wording. The record cites the store page and the issuer page. The release schema requires a `store-page` and an `issuer-terms` source for `definition` and refuses it on a marketplace outside `dining`.

## Consequences
- `MERCHANT_EVIDENCE_BASES` is `issuer | corroborated | definition | default`; parity cases added (mirror in SQL in 14.6).
- `merchant-draft.2` asks luna for a business-type quote from the store's pages and a `definition` quote from each issuer document that has one; the drafter sees the issuer's definition sentences as well as the windows around the store's name. `merchant-draft.1` is unchanged and retired.
- The verifier's `evidence` verdict covers definition quotes (an inclusion statement of the drafted category, covering the business type shown, not an exclusion list); a disputed `evidence` still downgrades.
- `review.md` lists `definition` records with both quotes; Evan reads them before any publish.
- The 14.3 dry-run records are rebuilt under the new prompt and rule ([merchant pipeline](../system/merchant-pipeline.md#re-run-with-merchant-draft2-2026-10-11)); the full seed (14.4) follows.
- Measurement is unchanged: the blind audit labels every non-default record under the same four conditions.

## Review amendments (coordinator, 2026-10-11, within Evan's rules)
The independent review of the first implementation (`fb65ca4b`) required these, applied the same day with unit tests:
- **Delivery wording** is read on the covering clause of the definition only and must be unconditional: Amex "restaurants, including takeout and delivery", Citi "including restaurant delivery services" and Chase Sapphire "including takeout and eligible delivery services" qualify a delivery marketplace for `dining`; "restaurants, excluding third-party delivery services" and Chase's FAQ "included if they classify as a restaurant merchant" (conditional) do not. A refused candidate is listed in `review.md` with the rule's reason and the drafter's notes, so a conflict such as Chase naming ubereats.com under its separate food-delivery category is visible.
- **Excluded kinds of store** (superstore, supercenter, discount store, warehouse club, wholesale club, department store, general merchandise, online marketplace, third-party sellers; plus convenience stores, drugstores and pharmacies for supermarkets, grocery for drugstores and dining) are read over the **full store-page captures**, not only the drafter's quotes, and apply to every category minus the category's own type. A missing issuer or store capture is a refusal, never "no exclusion".
- **Forum threads are no lookups**: apply drops an `mcc-lookup` source whose URL matches the research gate's forum pattern, build refuses a release citing one, and a lookup quote backs a category only when it names the category's words (MCC 4899, pay television, never backs `streaming`).
- **A fixed set of issuer category-definition pages** (Chase category FAQ, Bank of America category choices, U.S. Bank Cash+ sample merchants, Citi Costco exclusions, Amex rewards-info retail, U.S. Bank Edward Jones categories, Wells Fargo Autograph categories) is attached as issuer sources to every non-processor store, named or not, so Lowe's sees the home-improvement definitions.
- **Business types are noun phrases** ("electronics retailer", "home improvement store", "streaming service", "gas station", "movie theater"), not department words ("Shop Electronics", "Buy event tickets", "Free parking", "Stream with Prime Video" show nothing).
- **A definition needs definition wording** (includes, such as, means, stores, merchants, providers…): "Earn points with our grocery rewards partners" defines nothing. **A bare "Not"** ("Not grocery stores:") is exclusion wording.
- **`issuer` also accepts an inclusion list under an earning category** ("Includes the following streaming providers: … Netflix", "The U.S. drugstore list is: CVS Pharmacy…"), which reverses the 14.3 review's reading of the Amex drugstore list.
- **An exclusion counts only within the drafted category**, or when it names the store as a kind that category excludes; "Merchants not in the grocery category include wholesale clubs such as Costco" is a grocery exclusion and a wholesale-clubs inclusion (read by direction around "include"/"such as").
- **A store page alone is never a bonus.** The extension says **"Treated as a supermarket (its own pages; fits U.S. Bank's supermarket definition)."** for `definition`; "Codes as" stays for `issuer` and `corroborated`.
- The verifier opens a full capture only when a sheet lacks the needed span and reads no captures for processors.

## Status
Accepted 2026-10-11 (Evan); amended the same day after the independent review (coordinator decisions above). Supplements, and does not replace, the [2026-10-10 evidence decision](2026-10-10-merchant-database-evidence.md).
