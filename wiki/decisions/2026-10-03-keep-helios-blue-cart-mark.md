---
type: Decision
title: Keep the Helios-blue cart mark for the icons and promo tile under the Ocean theme
description: Evan kept the existing cart mark in Helios action blue (#2563eb) for the toolbar icons and the Web Store promo tile instead of recolouring it to the Ocean navy.
status: accepted
tags: [decision, frontend, design, release]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T06:45:00Z
sources:
  - resource: ../../extension/assets/cart-mark.svg
    title: Cart mark (source of the icons and promo tile)
  - resource: ../ops/release-media.md
    title: Release media
---

# Keep the Helios-blue cart mark for the icons and promo tile under the Ocean theme (2026-10-03)

## Context
The [Ocean theme](2026-10-02-ocean-theme.md) restyled the popup, badge, review app and site, and the release media were regenerated in that look on 2026-10-03. The toolbar icons and the 440×280 promo tile are rendered by `render-brand.mjs` from [`extension/assets/cart-mark.svg`](../../extension/assets/cart-mark.svg), which still uses the Helios action blue `#2563eb`. Whether to move the mark to the Ocean navy was left open for Evan.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| **Keep the Helios-blue mark** | Chosen | Evan's call; the mark stays recognisable and nothing needs regenerating |
| Recolour the mark to Ocean navy (`#0c2a4d`) | Rejected | A change to `cart-mark.svg` and a rerun of `npm run release:media` for a brand change Evan did not want |

## Decision
The cart mark stays `#2563eb` in `extension/assets/cart-mark.svg`, and the toolbar icons and promo tile keep using it alongside the Ocean-themed UI and media.

## Consequences
- No change to `cart-mark.svg` or the pinned release media.
- The icon and promo blue differ from the Ocean palette by design; a later rebrand is a new decision.

## Status
Accepted 2026-10-03 by Evan Liu.
