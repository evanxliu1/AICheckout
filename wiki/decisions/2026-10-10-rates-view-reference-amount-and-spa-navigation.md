---
type: Decision
title: Phase 13c.2 implementation choices: rates at a $100 reference amount, Navigation API for single-page carts, static badge URL kept
description: The rates view ranks owned cards with the engine at $100.00 (below every catalog cap, so cents equal basis points) and notes spend caps; single-page navigation is followed through the Navigation API's currententrychange with a popstate and hashchange fallback; the badge page keeps a static URL (use_dynamic_url false) because the worker identifies the frame by that URL and the content script cannot obtain a dynamic one.
status: accepted
tags: [decision, phase-13, extension, badge, reader]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-10T08:00:00Z
sources:
  - resource: ../product/phase-13c-cart-detection.md
    title: Phase 13c plan
  - resource: ../../extension/src/background/badge-service.ts
    title: Worker badge service
  - resource: ../../extension/src/badge/content.ts
    title: Badge content script
  - resource: ../../extension/vite.config.ts
    title: Manifest generation
---

# Phase 13c.2 implementation choices (2026-10-10)

## Context
The [Phase 13c plan](../product/phase-13c-cart-detection.md) left three choices to the implementer: how the rates view ranks cards when no amount is read (the engine needs an amount ≥ 1 cent), which mechanism follows single-page navigation into and out of a cart, and whether the badge page should use `use_dynamic_url` now that it is web-accessible on every https site.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Rates without an amount | A new engine entry point that reports rates; ranking at a reference amount | Ranking at `RATES_REFERENCE_CENTS` = $100.00 with the unchanged engine. Every rule earns linearly below its cap, and no catalog cap is under $100, so an estimate's cents at $100 are its rate in basis points (`rateWording`: "2% back", "1%–3% back", "2 miles per $1 (est. 2%)"). `ratesCapped` shows a note when an applied rule has a spend cap, since the order can differ at the real amount; the engine's `rankingNote` covers conditions |
| Popup compare in the rates view | Compute in the popup from the catalog slice; a worker request | `checkout:rates`, a read-only worker request (nothing stored), so the engine path is the worker's as for the badge. The popup fills a certain amount in but leaves "Compare my cards" to the shopper, which keeps the eligibility confirmation |
| Single-page navigation | `tabs.onUpdated` sent to the tab; the Navigation API in the content script; a URL check on the debounce | The Navigation API's `currententrychange` (pushState, replaceState, hash and traversal; `popstate` and `hashchange` where it is missing), then one debounce (500 ms) before the check so the page has rendered. Pages with no URL or title hint attach no observer |
| `use_dynamic_url` | `true` (sites cannot fetch the badge page at a guessable URL); `false` | `false`, kept. The worker routes `badge:*` by the sender's exact static URL (`chrome.runtime.getURL(BADGE_PAGE)`), and the content script has no API that yields the dynamic URL, so a dynamic resource could not be framed. The per-frame nonce still stops page-made copies. Consequence: any https site can detect the extension by fetching `src/badge/index.html` |
| Which unavailable readings show the rates view | Every unavailable reading; none; a set | `withheld`, `summary-missing` and `ambiguous-amount` (a cart or checkout whose amount is uncertain); `page-loading`, `empty-cart`, `unsupported-currency` and `unsupported-page` hide the badge, as before |
| Where the per-site host lives | Settings only; the tab entry too | The tab entry (`host`, session storage) holds the hostname so "Not on this site" can record it; never the path |
| Popup read on open, when to skip (review fix) | Skip when a comparison is saved for the tab's merchant id; key by tab and legacy id | A cart read in this tab (`cart.tabId`), or a comparison saved for the tab's **legacy** store, is kept; the generic id is every other store, so a saved generic comparison never suppresses the read |
| Detector `none` in the popup (review fix) | Collapse into `withheld` (rates view); a distinct reason | `not-a-cart`: the read on open says nothing (a non-store tab looks as it did before 13c), the button shows a message |
| Host-only checkout hint (coordinator's call) | Count `checkout.example.com` as a checkout; require a path, query, fragment or heading signal | The latter: SaaS and payment-provider billing pages live at `checkout.*`; a host label can still name the cart |

## Decision
As chosen above.

## Consequences
- The rates view's order equals the amount view's order for any amount under the smallest binding cap; the cap note names the exception.
- Fingerprinting by the web-accessible badge page is a known, accepted exposure for Phase 15's privacy policy.
- The title rule is strict: a title or heading hints only when a segment is the cart word plus filler, so a product named after a bag or basket never opens the badge; two title-hinted development pages were lost to it (90.6% recall).
- A single-page store that renders its cart later than 500 ms after the URL change is still followed when the URL hints at a cart (the observer attaches on the hinted page); a cart reached at an unhinted URL whose title changes later is not.

## Status
Accepted 2026-10-10 (implementer's choice within the plan; review in 13c.3).
