---
type: Decision
title: "A sample cart for reviewers at /sample-cart/ on the public site, titled \"Your cart\" so the cart reader recognizes it, with fixed amounts and inert controls"
description: Evan approved the R8 sample cart on 2026-11-07 without the "Nothing here is for sale" wording; the page is a static site page that the badge reads as a $100.00 cart, proved by a site unit test and an extension browser test on the built page under the site's headers.
status: accepted
tags: [decision, phase-15, release, site, cart-reader]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-11-07T10:30:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan, 9.8 R8
  - resource: ../../apps/site/src/pages.tsx
    title: SampleCart page
  - resource: ../../packages/cart-reader/src/detect.ts
    title: Cart page detector
  - resource: ../../extension/e2e/sample-cart.spec.ts
    title: Badge on the built sample cart
---

# A sample cart for reviewers (2026-11-07)

## Context
The 15.7 plan's risk R8: a Chrome Web Store reviewer with no cart to hand may report "functionality not working" (Yellow Magnesium). The plan recommended serving the fictional cart of the release screenshots (`extension/tests/fixtures/sample-cart.html`) at `/sample-cart/` on the public site and linking it from the test instructions. Evan approved it on 2026-11-07: "yes we can do it, but get rid of the Nothing Here is for Sale text". The detector needs a cart word in the URL or the main heading as a whole phrase (filler words only beside it), and the path segment `sample-cart` is not one: "sample" is not a filler word.

## Options considered
1. Copy the fixture file into the site's `public/` as is. Fast, but it carries its own inline `<style>`, which the site CSP (`style-src 'self'`) blocks, and it bypasses the site's layout and tests.
2. A path the URL rule accepts (`/cart/`). Recognized from the URL alone, but `/cart/` on the project's site reads like a real store page; the agreed path was `/sample-cart/`.
3. A site page at `/sample-cart/` rendered like the others, with "Your cart" as the title's first segment and the h1, and "Sample cart for testing AI Checkout" as the eyebrow above it.

## Decision
Option 3. The page uses the site layout and Ocean tokens, `noindex`, no form and no new script; it is in `OTHER_PAGES`, not the navigation. Two sample items with read-only quantity inputs and disabled **Remove** buttons (the detector's line-item signal; they change nothing, and the lead says so) and an order summary table: Subtotal $92.59, Estimated tax $7.41, Total $100.00. No prose names an amount or a total, so the reader finds only the summary. The words "for sale" appear nowhere (Evan's instruction; a site test refuses them). The test instructions open the sample cart first and say real stores work the same way.

## Consequences
- The detector recognizes the page by its title hint and h1 (`heading-summary`), and the reader shows `estimatedTotal` 10000 USD (`apps/site/tests/sample-cart.test.ts`, jsdom). `extension/e2e/sample-cart.spec.ts` serves the built site through the built API (production headers, CSP included) at `https://ai-checkout-api.onrender.com/sample-cart/` by `context.route`, saves the reviewer's two cards and expects "Use Blue Cash Everyday · $3.00 back on this cart" and "Based on $100.00 cart estimated total at Another U.S. online store." It needs `npm run build` first, as CI already runs.
- Renaming the h1 or the title's first segment, or adding prose with an amount, can break detection or reading; both tests catch it.
- The quantity-change step of the manual script (2.2) still needs a real store.
- Review amendment (2026-11-07, independent Opus reviewer, agent-verified): the Test instructions block names the expected badge by behavior (the saved card that earns the most, its estimate, "for example" Blue Cash Everyday $3.00, following the current card terms) and covers the "Checking for updated terms…" and no-cards pills, so a renewal that changes Blue Cash Everyday's terms does not make the block wrong. The page lead says what the badge shows without saved cards, and the browser test checks that pill on the sample cart before the cards are saved. The browser test still expects $3.00 from the bundled catalog and fails, as intended, if the bundled terms change.

## Status
Accepted 2026-11-07 (Evan approved the page; the implementation choices are the implementer's). Agent-verified by the tests above, not human-verified.
