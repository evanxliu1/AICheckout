---
name: AI Checkout Extension
description: A compact, legible comparison of estimated rewards on cards the shopper owns, in the AI Checkout Ocean theme over Helios tokens and component specs.
source: "Ocean theme (packages/ui/src/theme.css) layered over the Helios token file (@hashicorp/design-system-tokens 5.1.0, MPL-2.0) via @ai-checkout/ui; fonts self-hosted from @fontsource-variable (SIL OFL 1.1). Values below are the resolved values; the code uses the --token-* and --ac-* variables."
colors:
  page: "#eef4fb" # --token-color-page-faint
  surface: "#ffffff" # --token-color-surface-primary
  surface-faint: "#f6f9fd" # --token-color-surface-faint
  border: "#5a6b8233" # --token-color-border-primary
  ink-strong: "#0f1b2b" # --token-color-foreground-strong
  ink: "#2a3a52" # --token-color-foreground-primary
  ink-faint: "#5a6b82" # --token-color-foreground-faint
  navy: "#0c2a4d" # --ac-color-navy / --token-color-palette-blue-200 (primary button, badge pill, winner hero)
  navy-strong: "#081f3a" # --ac-color-navy-strong (pill hover)
  navy-hover: "#0a2342" # --token-color-palette-blue-300 (primary button hover)
  navy-line: "#1d4573" # --ac-color-navy-line (badges and dividers on navy)
  sky: "#7cc4ff" # --ac-color-sky (accent on navy only)
  on-navy: "#ffffff" # --ac-color-on-navy
  on-navy-soft: "#a9c6ea" # --ac-color-on-navy-soft
  action: "#1d5fb4" # --token-color-foreground-action (links on white)
  focus-internal: "#1d5fb4" # --token-color-focus-action-internal
  focus-external: "#4a8ad6" # --token-color-focus-action-external
  critical: "#c00005" # --token-color-foreground-critical-on-surface
  critical-surface: "#fff5f5" # --token-color-surface-critical
  highlight-surface: "#eaf3fd" # --token-color-surface-highlight
  warning-surface: "#fff9e8" # --token-color-surface-warning
typography:
  stack: "Figtree Variable, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" # --token-typography-font-stack-text
  display: "Bricolage Grotesque Variable, Figtree Variable, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" # --ac-font-display
  app-title: { fontFamily: display, fontSize: "1.125rem", fontWeight: 800, lineHeight: 1.3333 } # display-300
  section-title: { fontFamily: display, fontSize: "1rem", fontWeight: 700, lineHeight: 1.5 } # display-200
  body: { fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.4286 } # body-200
  supporting: { fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.3846 } # body-100
  amount: { fontFamily: display, fontSize: "1rem", fontWeight: 700, fontVariantNumeric: tabular-nums } # display-200
  hero-amount: { fontFamily: display, fontSize: "2.75rem", fontWeight: 800, lineHeight: 1 } # .estimate-amount--hero
  hero-rate: { fontSize: "1.25rem", color: sky } # .estimate-rate
rounded:
  control: "8px" # --token-form-control-border-radius, buttons (border-radius-small)
  card: "12px" # --token-border-radius-medium
  large: "16px" # --token-border-radius-large (badge panel)
  hero: "18px" # --ac-radius-hero (winner hero)
spacing: { "1": "4px", "2": "8px", "3": "12px", "4": "16px" }
focus: "inset 0 0 0 1px #1d5fb4, 0 0 0 3px #4a8ad6" # --token-focus-ring-action-box-shadow
components: "@ai-checkout/ui (Helios specs): Button, TextInput, Select, Checkbox, Field, Fieldset, Badge, AlertInline, Card, ApplicationState, Link, Disclosure, Icon"
---

# Design System: AI Checkout Extension

## Overview

**North star: "A clear checkout comparison."** The popup is a compact working form. It is built on
[Helios](https://helios.hashicorp.design) (HashiCorp's design system) through `packages/ui`: Helios
design tokens and React components written to the Helios specs. Since 2026-10-02 the AI Checkout
"Ocean" theme (`packages/ui/src/theme.css`) replaces the Helios token values with a navy, pale sky
and sky-accent palette, Figtree text and Bricolage Grotesque headings
([decision](../wiki/decisions/2026-10-02-ocean-theme.md)). AI Checkout keeps its own name and cart
icon; no HashiCorp branding is used.

This document covers the protected-input gate, the wallet editor, the purchase form, the comparison
result, and the shared cart identity under `extension/`. Sources: `src/styles/globals.css` (layout
and the token-mapped Tailwind `@theme` scales), `src/popup/Popup.tsx`, `src/components/*`.

**Key characteristics**

- One fixed 360 px column (Chrome allows up to 800 × 600; the popup never exceeds 480 px wide or
  600 px high) that scrolls vertically.
- Ocean surfaces: white bordered cards on the pale sky page color; no shadows in the flow. The one
  dark element is the navy winner hero.
- Helios controls everywhere: labelled fields with helper and error text, native checkboxes and
  selects styled by tokens, primary/secondary/tertiary/critical buttons.
- Every estimate carries its basis: merchant, amount type, the rule in the issuer's words, its
  conditions, and sources.

## Colors and type

All color, type, radius and shadow values come from theme variables: the Helios `--token-*` names,
set to Ocean values by the theme layer, plus brand-only `--ac-*` tokens. Tailwind remains
for layout utilities only; its color, font-size, font-weight, radius and shadow scales are replaced
by token variables, so a utility cannot introduce an off-system value. Preflight is off; components
bring their own resets.

- Navy is the brand color: the app title and header icon, primary buttons, checked controls, the
  badge pill and the winner hero. On white, links, focus and selected states use action blue
  `#1d5fb4` (6.3:1); faint ink `#5a6b82` is 5.4:1 on white. Sky `#7cc4ff` and the soft on-navy text
  `#a9c6ea` appear only on navy. Reward amounts and card names stay in strong ink outside the hero.
- Alerts use Helios semantic surfaces: critical for errors and expired terms, warning for a merchant
  the terms don't cover, highlight for a read cart amount, neutral for notices.
- Type is Figtree for text and Bricolage Grotesque for the app title, section titles and amounts,
  both self-hosted from `@fontsource-variable` (SIL OFL 1.1) as same-origin `woff2`. Section titles
  use display-200 bold; body text body-200; conditions and explanations body-100 in faint ink.
  Amounts use tabular numerals; a row's amount stays on one line (it moves under the card name when wide), and the winner block's amount may wrap after a range's dash.

## Layout

The popup is a single column: a white header (navy cart icon, navy Bricolage name, one-line
purpose), then 16 px padding
and 16 px gaps between cards. Inside cards, fields stack with 16 px between groups; labels sit above
controls with helper text between, per the Helios form spec. Estimate rows put the card name and
amount on one baseline, separated by faint dividers; a wide amount moves under the name,
right-aligned (`.estimate-head`). A clear winner (not tied, ranking stable) is
instead a navy block with an 18 px radius: card name in white, the amount at 2.75rem in white
Bricolage as the largest text in the popup, and its rate beside it in sky. When both amounts are
exact dollar amounts, each other row shows "$X less" in faint ink before its amount ("est. $X less"
when either rests on a published-estimate point value). A single card that guarantees nothing
gets no block. Long text wraps anywhere; the page never
scrolls horizontally (checked by the popup accessibility test at 360 and 480 px).

## Components (from `@ai-checkout/ui`)

- **Header** (`PopupHeader`): Flight `shopping-cart` icon and "AI Checkout" in navy, purpose line.
- **Protected inputs** (`VaultGate`): a Card with the setup/unlock form (Field + TextInput, Checkbox
  for the acknowledgement, full-width primary Button with a loading state), a `Disclosure` with
  state-accurate protection details, and the deletion `Disclosure`.
- **Wallet editor** (`WalletEditor`, catalog v3 since Stage 2 M7): the "Add a card" `Combobox`
  over the bundled cards grouped by issuer (active option on the action surface with a 3 px navy
  bar), the owned list (`.wallet-list`, card name in semibold strong ink above its issuer, tertiary
  Remove), a `Select` for the default card, then sections with Bricolage `subsection-title`
  headings: "Card options" (chosen categories as `Checkbox`es), "About you" (gate questions as
  `Radio`s with "Not sure"), "Bonus limits" (spend fields and activation selects derived from the
  catalog rules) and "Point values" (program name, Estimate / Issuer-stated / "No published value"
  `Badge`s, a cents field with "Reset to default" beside it in `.value-field`).
- **Purchase form**: merchant `Select` (Best Buy, Newegg, Amazon), "Read cart amount" secondary
  button, the read result as a highlight `AlertInline` with "Use manual entry instead", amount
  `TextInput`, payment path `Select` (card, PayPal, digital wallet, buy now pay later), online retail
  eligibility `Select`, the confirmation `Checkbox`, and a full-width primary "Compare my cards".
- **Comparison result**: a Card with a conditional heading ("Use …", "Compare the conditions",
  "Rewards are tied", "Your card estimate") and the saved-estimate sentence. Each card row shows the
  amount or range; the rule in the issuer's words ("3% on “U.S. online retail purchases” …;
  otherwise 1% on “all other eligible purchases”"); condition `Badge`s (U.S. merchants only, spend
  cap and after-cap rate, enrollment/activation required); "Activation is not mentioned on the
  issuer's pages" for unstated activation; the pay-later note ("2% if the balance is paid (1% at
  purchase)"); uncertainty notes; and a collapsed `Disclosure` of "Rules that don't apply here" with
  the reason (not at this merchant, not eligible, promotion ended, spend limit reached). Sources sit
  in a `Disclosure` of external `Link`s. Catalog v3 rows add the reward in units or store rewards,
  a basis `Badge` (Estimate and Issuer-stated neutral, Your value highlight; on navy the neutral
  badge is navy-line with white text) with the value lines, "Nothing is guaranteed" for a $0
  minimum, and after the list the store cards not accepted here and, when the order may change,
  the ranking note. The winner block uses 1.75rem for ranges, "Up to $x" and units.
- **States**: loading (`ApplicationState`), errors and expired terms (critical `AlertInline`,
  `role="alert"`), notices (`AlertInline`, `role="status"`), render failures (`ErrorBoundary` with an
  `ApplicationState` error and a reload action).

## Cart badge (Phase 3b)

- **Pill**: a single `button` fixed bottom-right in the merchant page, navy (`--ac-color-navy`, hover navy-strong) with white text on a full pill radius with the high elevation shadow, credit-card icon and one line: "Use Blue Cash Everyday · $3.00 back", where the reward (`pillReward`: "$3.00 back", "$5.00 in store rewards", "est. $1.20 in miles", "1,000 miles"; `.badge-pill__amount`) is sky Bricolage. Its accessible name carries the whole message ("Use Blue Cash Everyday · $3.00 back on this cart (AI Checkout). Show details"). Prompts use the same pill: "Pick your cards to see your best card", "Unlock to see your best card" (lock icon), "Can't read this cart — enter the amount".
- **Panel** (360 px, white surface, overlay elevation, 16 px large radius): header with the navy cart icon, the focusable heading "Best card for this cart" and an icon-only Collapse button; a scrolling body with the amount basis ("Based on $27.23 cart order total at Best Buy US."), an Amount field with Update / Use cart amount, the Payment method select, the ranked list (the popup's `EstimateRow`, with the same navy winner hero and "$X less" deltas: amount, issuer rule, condition badges, the Citi pay-later note, rules that don't apply; v3 rows add the basis badge and value lines), the ranking note when the order may change, and not-accepted store cards; a footer with **Dismiss for this tab** (secondary) and **Not on this site** (tertiary). Esc collapses and returns focus to the pill; nothing animates.
- **Order question**: the panel opens itself with "Did you pay with {card}?" and Yes / Another card (a select) / Not sure, then "Order recorded" with the estimated extra versus the default card, called cash back when both cards pay cash back and rewards otherwise (with the value points or miles were counted at).
- **Frame**: the panel is an extension page in an iframe inside a closed shadow root; the iframe reports only its size, and the host clamps it to the window (the body scrolls). The page's CSS cannot restyle it.
- **Onboarding tab** (on install): a 640 px column with the cart mark, "Welcome to AI Checkout", the wallet editor and a "You're set" confirmation that takes focus.
- **Popup additions**: an **All-time** savings card (total, history disclosure, JSON export, delete) and a **Settings** disclosure (per-site badge `Toggle`s, passphrase protection on/off).

## Accessibility

Every control has a visible label; helper and error text are wired with `aria-describedby`. Focus
uses the theme's focus ring (1 px action blue inside a 3 px `#4a8ad6` ring) on every interactive element. Reduced motion shortens all animation and
transitions. `e2e/popup-a11y.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on vault setup, wallet setup,
bonus limits, purchase, comparison (collapsed and expanded), buy now pay later, cart-read error,
expired terms and locked, at 360 and 480 px, plus the catalog v3 states (card search, wallet options,
comparison, winner block, the widest amounts on a $99,999.99 purchase, no accepted card, onboarding)
and the bundled catalog's longest card names; it fails on any violation, inline style, horizontal
scroll, or overflow inside the popup.

## Cart identity

`assets/cart-mark.svg` is the shared source for the extension icon and release branding;
`scripts/render-brand.mjs` renders it to `public/icons/icon{16,48,128}.png`. Keep the white geometric
cart on its blue field; no tiny lettering, gradient or extra detail.

## Release media

`docs/release/assets/` holds store images and the demo video, captured from the actual popup by
`npm run release:media`. Their caption panels and dimensions are presentation, not popup layout.
Sample inputs and offline evidence stay labelled as such.

## Do's and Don'ts

- **Do** use `@ai-checkout/ui` components and `--token-*` variables before adding anything new.
- **Do** keep merchant, amount basis, the issuer's rule wording, conditions and uncertainty next to
  the estimate they qualify.
- **Do** derive card-specific inputs and labels from catalog rules; never hard-code card or rule IDs.
- **Do** keep protection wording accurate to the storage state, and the deletion consequence,
  confirmation and action together.
- **Don't** add raw colors, font sizes, radii or shadows; extend the token mapping instead.
- **Don't** color reward amounts as a success claim or hide conditions inside the sources.
- **Don't** widen the popup beyond 480 px or add a second column.
