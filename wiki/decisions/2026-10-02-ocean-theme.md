---
type: Decision
title: Restyle all frontends with the AI Checkout Ocean theme over the Helios tokens
description: Evan picked the "Mint" layout in the Ocean palette (navy, pale sky, sky accent) with self-hosted Bricolage Grotesque and Figtree; a theme layer replaces the Helios token values, components and their tests stay.
status: accepted
tags: [decision, frontend, design]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:05:00Z
sources:
  - resource: ../../packages/ui/src/theme.css
    title: Ocean theme layer
  - resource: ../../extension/src/components/ComparisonResult.tsx
    title: Winner hero and "less" deltas
---

# Restyle all frontends with the AI Checkout Ocean theme over the Helios tokens (2026-10-02)

## Context
Evan wanted a better-looking UI for the popup, badge, review app and site, and said the [Helios decision](2026-09-28-helios-design-system.md) was not fixed. He compared 33 mockups (13 directions, 9 Dark pro palettes, 10 Mint colourways, 10 Mint and Dark pro hybrids) and chose the Mint layout in the Ocean colourway.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| **Ocean theme layer over the Helios tokens; keep `packages/ui` components** | Chosen | One file changes about 600 token references; components, keyboard behaviour and axe tests stay as they are |
| Replace `packages/ui` with shadcn/Radix and Tailwind (copy 21st.dev components) | Rejected | Rewrites and re-tests every component without improving the look; the look comes from colour, type and layout |
| Our own `--ac-*` token set everywhere, dropping the Helios token package | Deferred | Cleaner long term but touches every stylesheet; the layer can be inlined later without visual change |

## Decision
- `packages/ui/src/theme.css`, imported by `styles.css` after the Helios token file, sets the Helios semantic, palette, radius, elevation, focus and form-control tokens to the Ocean palette and adds brand tokens `--ac-color-navy`, `--ac-color-sky`, `--ac-color-on-navy(-soft)`, `--ac-font-display`, `--ac-radius-hero`.
- Palette: navy `#0c2a4d`, page `#eef4fb`, sky accent `#7cc4ff`, ink `#0f1b2b`, muted `#5a6b82`, action blue `#1d5fb4`. Sky and the soft on-navy text appear only on navy; links, focus and selected states on white use action blue.
- Fonts: Figtree (text) and Bricolage Grotesque (headings and figures), self-hosted from `@fontsource-variable` (SIL OFL 1.1) and bundled as same-origin `woff2`; CSPs unchanged.
- Popup and badge panel: a clear winner (not tied, ranking stable) is a navy block with the amount as the largest text and its rate in sky; other cards show "$X less" when both amounts are exact. Badge pill is navy with the reward in sky. Review app: navy header, Bricolage headings. Site: navy home hero.
- The mockup's cap ring ("$2,140 of $6,000 used") is not built: the wallet stores spend reported per day, not a running yearly total, so the ring would show invented numbers. The cap stays a text badge.
- Still no HashiCorp branding; components keep following the Helios specs and Flight icons stay.

## Consequences
- Release packaging accepts `assets/*.woff2` (`extension/scripts/release-package.mjs`).
- Release screenshots in `docs/release/assets/` and on the site show the old look until `npm run release:media` is rerun ([release media](../ops/release-media.md)).
- Light theme only, as before.

## Status
Accepted 2026-10-02 by Evan Liu. Supersedes the look of [2026-09-28-helios-design-system](2026-09-28-helios-design-system.md); its component approach stands.
