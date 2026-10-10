---
type: Decision
title: The automatic badge at any store, with access to all https sites at install (Phase 13c)
description: Evan chose to request https://*/* at install so the badge recognises cart and checkout pages at any store from the start, instead of an opt-in runtime permission; the badge moves out of Phase 17, telemetry stays there; Phase 15's privacy policy and store listing widen accordingly.
status: accepted
tags: [decision, phase-13, extension, badge, permissions, privacy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-09T23:55:00Z
sources:
  - resource: ../product/phase-13c-cart-detection.md
    title: Phase 13c plan
  - resource: ../system/cart-badge.md
    title: Cart badge
---

# The automatic badge at any store, with access to all https sites at install (2026-10-09)

## Context
After trying the Phase 13b build, Evan found the badge appears only at Best Buy, Newegg and Amazon (its content script is declared for their cart URLs only) and asked for cart, basket and checkout recognition at any website. Recognising a cart at an unknown site needs a content script on every site, so the extension needs host access to all sites. The roadmap had an *optional* automatic badge on all sites in Phase 17 (Release B).

## Options considered
| Option | For | Against |
| --- | --- | --- |
| Opt-in toggle with `optional_host_permissions` (coordinator's recommendation) | Small install warning; easier Web Store review; the three stores work with no prompt | The badge works elsewhere only after the shopper finds and enables the toggle |
| `https://*/*` at install (chosen by Evan) | The badge works at any store from the start | Chrome shows "Read and change all your data on all websites" at install; stricter, slower Web Store review; the privacy policy and listing must justify it |

## Decision
Evan, 2026-10-09 (answering the coordinator's question in chat): always on at install. `host_permissions` and the badge content script cover `https://*/*`; a settings toggle and per-site "Don't show on this store" let the shopper turn it off. Done in Phase 13c, before Phase 14 ("Now, as Phase 13c").

## Consequences
- The content script runs on every https page; it must stay cheap on pages with no cart hint (URL and title only, no observer) and send nothing but readings from recognised cart pages.
- The badge iframe page becomes web-accessible on every https site, which lets any site detect the extension; 13c evaluates `use_dynamic_url`.
- Phase 15: `docs/release/privacy-policy.md`, `store-listing.md` (permission justification, single purpose), `support.md`, `reviewer-instructions.md` and `extension/README.md` must describe the badge at any store.
- Phase 17 keeps consented telemetry; its "optional automatic badge on all sites" is done by 13c.

## Status
Accepted 2026-10-09 (Evan).
