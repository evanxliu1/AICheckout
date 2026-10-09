---
type: Decision
title: Phase 13b manual read: adapter on its cart URLs, readCart everywhere else, merchant from the tab
description: The popup's "Read cart" splits by URL, not by store: a legacy adapter reads the URLs it matches (unchanged), the generic reader reads every other http(s) page, including a legacy store's product pages, and the reading names the store the popup resolved for the tab; generic readings carry `generic-reader-v1` at any merchant id; a generic store keeps "Eligible" after a read.
status: accepted
tags: [decision, phase-13, extension, reader]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-09T22:00:00Z
sources:
  - resource: ../product/phase-13-reader.md
    title: Phase 13 plan (Phase 13b section)
  - resource: ../../extension/src/checkout/manual-reader.ts
    title: readManualCart
  - resource: ../../extension/src/checkout/contracts.ts
    title: Probe and cart snapshot contracts
---

# Phase 13b manual read: adapter on its cart URLs, readCart everywhere else, merchant from the tab (2026-10-09)

## Context
The Phase 13b plan says the legacy adapters "keep their three stores and run first there" and that a generic reading's merchant is "the store the popup already resolved, usually the generic store profile". Building it raised two questions the plan left open: what happens on a legacy store's pages its adapter does not match (a Best Buy product page, an `http:` URL), and what the contracts accept for the generic version string.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Where the generic reader runs | Only when `merchantForTab` is the generic profile (a legacy site's other pages stay `unsupported-page`); on every URL no adapter matches | Every URL no adapter matches: `readManualCart` tries `merchantForCheckout(url)` first and falls back to `readCart`. The adapters' behaviour on their cart URLs is unchanged, and a shopper on a legacy store's checkout-like page the adapter does not cover gets the generic read instead of a refusal |
| Merchant of a generic reading | Always `generic-us-online`; `merchantForTab(url)` | `merchantForTab(url)`, as the plan says: on a Best Buy product page the reading names `best-buy-us`, so the comparison uses that store's profile, not the generic one |
| Contract for `extractorVersion` | `generic-reader-v1` only with the generic merchant id; `generic-reader-v1` with any merchant id | Any merchant id, since the previous row makes a generic reading at a legacy id possible; a legacy id with a wrong adapter version, and the generic id with any adapter version, are still refused, so legacy readings validate exactly as before |
| Eligibility after a generic read | Reset to "I'm not sure" as after a legacy read; keep the generic store's "Eligible" default | Keep the store's default (`storeOnlineRetail`): legacy stores still reset to "I'm not sure", the generic store stays "Eligible" as Phase 11 set it |
| Where the version constant lives | `contracts.ts` (Zod); `merchants.ts` (Zod-free) | `merchants.ts`, so the content script shares it without bundling Zod |

## Decision
As chosen above. The withheld message is one new copy string ("The cart total could not be read with certainty on this page. Enter the amount you will pay."); the unsupported-page message no longer names the three stores. The automatic badge is untouched.

## Consequences
- The manual reader bundle grows from 8,908 to 34,458 bytes (it now carries `readCart`); it is injected only on the shopper's click.
- `docs/release/support.md` ("Unsupported page" row), `docs/release/reviewer-instructions.md` step 2 and the capture-manifest popup texts describe the three-store manual read and are now inaccurate; they are Phase 15 material ([plan](../product/phase-13-reader.md)).

## Status
Accepted 2026-10-09 (implementer's choice within the plan; review before the PR pending).
