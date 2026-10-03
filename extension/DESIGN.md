---
name: AI Checkout Extension
description: A compact, legible comparison of estimated rewards on cards the shopper owns, built on the Helios design system.
source: "Helios design tokens (@hashicorp/design-system-tokens 5.1.0, MPL-2.0) via @ai-checkout/ui; values below are the token values, the code uses the --token-* variables."
colors:
  page: "#fafafa" # --token-color-page-faint
  surface: "#ffffff" # --token-color-surface-primary
  surface-faint: "#fafafa" # --token-color-surface-faint
  border: "#656a7633" # --token-color-border-primary
  ink-strong: "#0c0c0e" # --token-color-foreground-strong
  ink: "#3b3d45" # --token-color-foreground-primary
  ink-faint: "#656a76" # --token-color-foreground-faint
  action: "#1060ff" # --token-color-palette-blue-200 (primary button) / --token-color-foreground-action
  action-hover: "#0c56e9" # --token-color-palette-blue-300
  focus-internal: "#0c56e9" # --token-color-focus-action-internal
  focus-external: "#5990ff" # --token-color-focus-action-external
  critical: "#c00005" # --token-color-foreground-critical-on-surface
  critical-surface: "#fff5f5" # --token-color-surface-critical
  highlight-surface: "#f9f2ff" # --token-color-surface-highlight
  warning-surface: "#fff9e8" # --token-color-surface-warning
typography:
  stack: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" # --token-typography-font-stack-text
  app-title: { fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.3333 } # display-300
  section-title: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.5 } # display-200
  body: { fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.4286 } # body-200
  supporting: { fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.3846 } # body-100
  amount: { fontSize: "1rem", fontWeight: 600, fontVariantNumeric: tabular-nums } # display-200
rounded:
  control: "5px" # --token-form-control-border-radius, buttons (border-radius-small)
  card: "6px" # --token-border-radius-medium
spacing: { "1": "4px", "2": "8px", "3": "12px", "4": "16px" }
focus: "inset 0 0 0 1px #0c56e9, 0 0 0 3px #5990ff" # --token-focus-ring-action-box-shadow
components: "@ai-checkout/ui (Helios specs): Button, TextInput, Select, Checkbox, Field, Fieldset, Badge, AlertInline, Card, ApplicationState, Link, Disclosure, Icon"
---

# Design System: AI Checkout Extension

## Overview

**North star: "A clear checkout comparison."** The popup is a compact working form. It is built on
[Helios](https://helios.hashicorp.design) (HashiCorp's design system) through `packages/ui`: Helios
design tokens and React components written to the Helios specs. AI Checkout keeps its own name and
cart icon; no HashiCorp branding is used.

This document covers the protected-input gate, the wallet editor, the purchase form, the comparison
result, and the shared cart identity under `extension/`. Sources: `src/styles/globals.css` (layout
and the token-mapped Tailwind `@theme` scales), `src/popup/Popup.tsx`, `src/components/*`.

**Key characteristics**

- One fixed 360 px column (Chrome allows up to 800 × 600; the popup never exceeds 480 px wide or
  600 px high) that scrolls vertically.
- Helios surfaces: white bordered cards on the faint page color; no shadows in the flow.
- Helios controls everywhere: labelled fields with helper and error text, native checkboxes and
  selects styled by tokens, primary/secondary/tertiary/critical buttons.
- Every estimate carries its basis: merchant, amount type, the rule in the issuer's words, its
  conditions, and sources.

## Colors and type

All color, type, radius and shadow values come from Helios tokens (`--token-*`). Tailwind remains
for layout utilities only; its color, font-size, font-weight, radius and shadow scales are replaced
by token variables, so a utility cannot introduce an off-system value. Preflight is off; components
bring their own resets.

- Blue (`action`) is reserved for actions, links, focus and the cart mark. Reward amounts and card
  names stay in strong ink.
- Alerts use Helios semantic surfaces: critical for errors and expired terms, warning for a merchant
  the terms don't cover, highlight for a read cart amount, neutral for notices.
- Type is the Helios system stack. Section titles use display-200; body text body-200; conditions and
  explanations body-100 in faint ink. Amounts use tabular numerals and never wrap.

## Layout

The popup is a single column: a white header (cart icon, name, one-line purpose), then 16 px padding
and 16 px gaps between cards. Inside cards, fields stack with 16 px between groups; labels sit above
controls with helper text between, per the Helios form spec. Estimate rows put the card name and
amount on one baseline, separated by faint dividers. Long text wraps anywhere; the page never
scrolls horizontally (checked by the popup accessibility test at 360 and 480 px).

## Components (from `@ai-checkout/ui`)

- **Header** (`PopupHeader`): Flight `shopping-cart` icon, "AI Checkout", purpose line.
- **Protected inputs** (`VaultGate`): a Card with the setup/unlock form (Field + TextInput, Checkbox
  for the acknowledgement, full-width primary Button with a loading state), a `Disclosure` with
  state-accurate protection details, and the deletion `Disclosure`.
- **Wallet editor** (`WalletEditor`): one `Fieldset` per issuer (Citi, Wells Fargo, Capital One,
  Chase, American Express) of card `Checkbox`es; a `Select` for the tie-break card; "Bonus limits"
  fields derived from the catalog rules: a spend field for each spend-capped bonus that can apply at
  a supported merchant, and an activation select only for enroll-once or recurring rules.
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
  in a `Disclosure` of external `Link`s.
- **States**: loading (`ApplicationState`), errors and expired terms (critical `AlertInline`,
  `role="alert"`), notices (`AlertInline`, `role="status"`), render failures (`ErrorBoundary` with an
  `ApplicationState` error and a reload action).

## Cart badge (Phase 3b)

- **Pill**: a single `button` fixed bottom-right in the merchant page, action blue (`--token-color-palette-blue-200`, hover blue-300) on a full pill radius with the high elevation shadow, credit-card icon and one line: "Use Blue Cash Everyday · $3.00 back". Its accessible name carries the whole message ("AI Checkout: use Blue Cash Everyday, $3.00 back on this cart. Show details"). Prompts use the same pill: "Pick your cards to see your best card", "Unlock to see your best card" (lock icon), "Can't read this cart — enter the amount".
- **Panel** (360 px, white surface, overlay elevation, large radius): header with cart icon, the focusable heading "Best card for this cart" and an icon-only Collapse button; a scrolling body with the amount basis ("Based on $27.23 cart order total at Best Buy US."), an Amount field with Update / Use cart amount, the Payment method select, the ranked list (the popup's `EstimateRow`: amount, issuer rule, condition badges, the Citi pay-later note, rules that don't apply); a footer with **Dismiss for this tab** (secondary) and **Not on this site** (tertiary). Esc collapses and returns focus to the pill; nothing animates.
- **Order question**: the panel opens itself with "Did you pay with {card}?" and Yes / Another card (a select) / Not sure, then "Order recorded" with the estimated extra cash back versus the default card.
- **Frame**: the panel is an extension page in an iframe inside a closed shadow root; the iframe reports only its size, and the host clamps it to the window (the body scrolls). The page's CSS cannot restyle it.
- **Onboarding tab** (on install): a 640 px column with the cart mark, "Welcome to AI Checkout", the wallet editor and a "You're set" confirmation that takes focus.
- **Popup additions**: an **All-time** savings card (total, history disclosure, JSON export, delete) and a **Settings** disclosure (per-site badge `Toggle`s, passphrase protection on/off).

## Accessibility

Every control has a visible label; helper and error text are wired with `aria-describedby`. Focus
uses the Helios focus ring on every interactive element. Reduced motion shortens all animation and
transitions. `e2e/popup-a11y.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on vault setup, wallet setup,
bonus limits, purchase, comparison (collapsed and expanded), buy now pay later, cart-read error,
expired terms and locked, at 360 and 480 px, and fails on any violation or horizontal scroll.

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
