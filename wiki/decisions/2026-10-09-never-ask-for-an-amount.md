---
type: Decision
title: Never ask for a typed amount; the best card and its rate when the reader is not certain (Phase 13c)
description: Evan does not want manual typing; the reader still shows an amount only when certain (it cannot be certain on every page without showing wrong amounts), and otherwise the badge and popup show the best card and its rate with no input prompt; an optional amount edit stays in the expanded panel; the store's category comes from its merchant profile, never from the page's products.
status: accepted
tags: [decision, phase-13, extension, badge, reader]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-09T23:55:00Z
sources:
  - resource: ../product/phase-13c-cart-detection.md
    title: Phase 13c plan
  - resource: 2026-10-06-reader-shows-only-certain-amounts.md
    title: The cart reader shows an amount only when certain
  - resource: ../../docs/evals/reader-v1.md
    title: Generic cart reader v1 results
---

# Never ask for a typed amount; the best card and its rate when the reader is not certain (2026-10-09)

## Context
Asked what the badge should do on a recognised cart page when the reader withholds, Evan answered: "we need it so the reader is sure every time, i do not want any manual typing at all". The reader is certain on about 79% of held-out `cart-1` pages ([report](../../docs/evals/reader-v1.md)); the rest show no total, keep it in an unreadable iframe or are ambiguous, so no reader can be certain everywhere without showing wrong amounts. Evan then asked whether the best card is decided by the merchant's category and how category relates to recognising the cart page.

## Options considered
| Option | Result |
| --- | --- |
| Best card and its rate, no input prompt (coordinator's recommendation) | Always a recommendation, never typing; amounts stay correct when shown |
| Hide the badge when not certain | No typing, but nothing on about one cart in five |
| Always show the reader's best guess | Reverses the [2026-10-06 rule](2026-10-06-reader-shows-only-certain-amounts.md); some amounts wrong |

## Decision
Coordinator's recommendation, within Evan's "no manual typing" and consistent with the 2026-10-06 rates-only fallback: the badge and popup show the best card and its rate when the reader withholds; neither asks for an amount. The expanded badge panel and the popup keep an optional amount field. The best card is decided by the store's category (its merchant profile: how its payments are expected to be coded), not by the cart's products; the amount changes the choice only through caps, minimum spend and thresholds, which the ranking note flags. Stores not in the catalog use the generic profile until the Phase 14 merchant database gives them categories. Cart-page recognition (from the page) and category (from the domain) are separate; the merchant database may later help suppress false shows on non-store domains, without per-store rules. 13c also runs one reader round to raise coverage on development.

## Consequences
- The legacy stores' "Can't read this cart — enter the amount" badge state becomes the rates view; the popup reads on open and compares without an amount.
- The engine path for "no amount" (rates view) is new and reviewed in 13c.
- The ranking at an unknown amount can differ from the ranking at the real amount when caps or thresholds bind; the existing ranking note says so.

## Status
Accepted 2026-10-09 (Evan's directive; option chosen by the coordinator, open to Evan's change). Built in 13c.2 on 2026-10-10: the rates view ranks at $100 ([record](2026-10-10-rates-view-reference-amount-and-spa-navigation.md)).
