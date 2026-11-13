---
type: Decision
title: "The generic reader reads an amount drawn one character per element, takes a currency code written before the symbol, and reads a collapsed order summary's control"
description: Three generic reader rules added on 2026-11-13 after Evan found Shopify checkouts whose total was not read; each fires only on a narrow structure, none changes any development page-state, and none has a held-out measurement.
status: accepted
tags: [decision, cart-reader, extension, shopify, checkout]
generated:
  by: claude-code/claude-fable-5-2
  at: 2026-11-13T02:25:00Z
sources:
  - resource: ../../packages/cart-reader/src/reader.ts
    title: Generic cart reader (isCharRun, summaryToggle)
  - resource: ../../packages/cart-reader/src/amounts.ts
    title: Amount grammar (a code before the symbol)
  - resource: ../../packages/cart-reader/src/words.ts
    title: Label vocabulary (SUMMARY_NAME_RE)
  - resource: ../../packages/cart-reader/tests/read-cart.test.ts
    title: Reader unit tests (2026-11-13 blocks)
  - resource: ../../extension/e2e/badge-any-store.spec.ts
    title: Badge browser test on synthetic checkouts
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Reader protocol (states exported; never checkout-1)
---

# Split amounts, a code before the symbol, and a collapsed order summary (2026-11-13)

## Context

Evan tested the extension on stores at random and reported that on some Shopify stores the reader did not find the price, with the page source of one checkout. Reproduced in Chromium on a scratch fixture rebuilt from that source with Shopify's own stylesheets (nothing from the page is in the repository):

- **Animated total.** Shopify's checkout script has a per-shop flag that animates the order total. With it, the server sends the total as plain text and the script redraws it once the page runs: one `<span>` per character, and the amount being replaced kept beside the new one at opacity 0 until it has faded. `readVisibleText` separates letters or digits that touch across elements, so the row read `Total USD $8 4.0 0` and the reader withheld `amount-unreadable` (rates view). Shops without the flag read correctly, which is why only some stores failed.
- **Collapsed summary.** Under 1,000 px the checkout hides the summary column and shows a control, "Order summary" with the total, whose only label ("Total price") is for screen readers. The reader found no row and the detector answered `none`: no badge.
- **Currency.** The total is written code, symbol, number ("USD $84.00"). The amount grammar attached a code only directly before or after the number, so `Total CAD $92.00` on an English page with a generic TLD resolved to USD by the storefront rule: a wrong currency, shown. A plain-text Shopify total in another currency had this before the change; reading animated totals would have exposed more of it.

Checkout steps are not in the frozen set (the protocol exports six cart states and never `checkout-1`), so none of this was measured before.

## Options considered

**Split amounts**

1. Read the element's `aria-label` (Shopify puts the formatted amount there). It trusts an attribute over what is shown and only helps where the page sets one.
2. Join neighbouring elements whose boxes touch. Needs layout, which the unit tests (jsdom) and offline rebuilds do not give reliably.
3. A structural rule: an element whose children are all same-tag inline or inline-block elements holding exactly one character each, three or more, with no text between them, is one word when every character is shown.

**Collapsed summary**

1. Let any screen-reader-only label count. Too wide: hidden labels sit on line totals and product prices too.
2. Read the control itself: a disclosure (`aria-expanded`, or `<summary>`) whose short text names the order summary and holds exactly one amount and nothing else. The kind comes from the control's own label, shown or hidden, and is an order total without one.
3. Read a total from a checkout button ("Checkout · $45.00"). Rejected: the one development store with that shape has two such buttons with different amounts, and protection add-ons put other amounts on these buttons.

**Currency**

1. Name the code at page level (`namedCurrencies`). It would only block the storefront rule (withhold), not give the row its currency.
2. Let three capitals followed by a symbol marker belong to the amount, as a code only when `isCode` accepts them; any other word stays in the label.

## Decision

Option 3 for split amounts, option 2 for the collapsed summary, option 2 for currency.

- **Split amounts** (reader.ts). `isCharRun` is the run rule above. `readVisibleText` reads a run as one word only when every character is plainly shown (`charState`: opacity of 0.99 or more, a colour that paints, a box, no clip path or mask), nothing from the run to six levels above it is part-way through a fade or under a clip path or a mask (`fading`), and, where there is layout, the characters stand in one line (`charLine`: every box within the height of the tallest, each after the one before without overlap in one direction, each whole inside every box within six levels that cuts off its overflow; sideways a scrolling box counts as one, downwards it does not, so a summary further down a scrolling panel is still read). A wholly hidden run (the amount fading out) is left out. Any other run is read element by element as before, so it stays unreadable instead of becoming another number. `collectRows` climbs once from the run with its whole text, so the label may sit as far up as for an ordinary amount.
- **Collapsed summary** (reader.ts, words.ts). `summaryToggle` finds the control (a disclosure outside the page header whose short text matches `SUMMARY_NAME_RE`, the summary's name in 14 languages); it is a candidate row and counts as a cart summary for rows inside it. `toggleKind` reads it only when the visible label is the name alone (with "show" or "hide", an item count and articles at most) beside one amount; the hidden label decides the kind, and a hidden label that is no total label leaves it unread.
- **Currency** (amounts.ts). `AMOUNT_RE` takes three capitals before a symbol marker as the amount's code when `isCode` accepts them and the symbol does not itself name another currency ("CAD US$92.00" keeps the result on `main`). Any other word stays in the label ("TAX $5.00" is still a tax row), and a dash counts as the amount's sign before a code only when it touches it ("Total – USD $92.00" is positive).

## Consequences

- **Measured on development (2026-11-13, `dev.mjs` and `detect.mjs` quick loops, not scored runs):** every one of the 722 real page-states and 1,088 variants gives the same output as on `main` (405 / 0 / 317 and 898 / 0 / 190, p95 read time 9.6 ms, no harness error), and the detector is unchanged (recall 388 / 414, no false show on 119 open mini-carts and 189 empty carts). No development page has these shapes, so development shows no regression and no gain. No held-out run measures the change, and no held-out page was opened.
- **Measured on the scratch fixture:** the server-rendered state, four hydrated states (total equal to the subtotal, with taxes, with shipping and taxes, with thousands) and the mid-change state read the correct total at 1,440 px, and the collapsed control reads it at 900 px; on `main` the hydrated states withheld and the narrow window gave `none`. The fixture is rebuilt from one page source and Shopify's public stylesheets and script, not the live page, and no live checkout was read.
- **Tests:** 15 unit tests (14 in `read-cart.test.ts`, one in `detect.test.ts`; synthetic pages), eight Chromium tests with layout in `evals/reader/tests/browser/split-amounts.test.mjs` (`npm run test:reader:browser`, not in CI), and one browser test in `extension/e2e/badge-any-store.spec.ts` on three synthetic checkouts: the total redrawn per character beside the fading old amount (amount view), the same with "CAD" before the "$" (no badge), and a collapsed summary control (amount view).
- **Review (independent Opus reviewer, agent-verified, three passes on the working tree and a confirmation of the last fixes):** the first pass found a blocker, an old digit left among the new ones and hidden by clipping, a transform or a transparent colour read as "$919.35" for "$99.35", and that the control accepted any words but savings, shipping and tax; the second found a digit half-way through a roll, a fade set on the layer, near-transparent colours, gradient lettering and short words ("Tip", "ea", two-character CJK words) still passing; the third found no blocker and one low path the second round of fixes had opened (an extra digit scrolled out of sight in a sideways-scrolling box with a hidden scrollbar), plus a clip path or a mask hiding a digit. Each is fixed and has a test. The confirmation pass found no new path to a wrong amount and the reviewer's own passing cases still read. The reviewer's remaining paths to a wrong amount are the two named under Risk, both rated low and contrived.
- **Risk:** the rules open paths that show an amount on pages no frozen set covers. What the split-amount checks cannot see is a character hidden by a colour equal to its background or by another element drawn over it. The badge reads 500 ms after the last change to the page and a redraw is a change, so a read in mid-animation is unlikely but not excluded for an animation run through `style` attributes, which the observer does not watch.
- **Not read (withheld, as before):** a split amount in mixed writing directions (Arabic currency letters after digits), a rolling-digit counter that keeps every digit 0–9 in the tree, a split amount under a clip path or a mask within six levels (a card whose rounded corners are a `clip-path`, a fade mask on the panel) or out of view in a sideways-scrolling box, a gift card applied at a Shopify checkout (`credit-unclear`: the label stays "Total"), and the three development Shopify cart misses (a checkout button's amount with an optional add-on, a total only on two checkout buttons, an amount captured at opacity 0).
- The content scripts change (`npm run build` on 2026-11-13: badge 45,572 bytes, manual reader 42,010; last measured 40,408 and 36,846 on 2026-10-20), so the ZIP built at `db465df1` does not have this; a store upload after it needs a new build and version.

## Status

Accepted 2026-11-13 on Evan's instruction to make the reader work on Shopify-based stores ("as many as possible"); the rule designs are the implementer's. Agent-verified by the tests, runs and review above, not human-verified, and not checked on a live checkout.
