---
name: AI Checkout Extension
description: A compact, legible comparison of estimated rewards on cards the shopper owns.
colors:
  primary: "#2563eb"
  primary-deep: "#1d4ed8"
  canvas: "#f9fafb"
  surface: "#ffffff"
  divider: "#e5e7eb"
  control-border: "#9ca3af"
  ink: "#111827"
  supporting: "#4b5563"
  placeholder: "#6b7280"
  secondary: "#e5e7eb"
  secondary-hover: "#d1d5db"
  secondary-ink: "#374151"
  error: "#991b1b"
  error-surface: "#fef2f2"
  error-border: "#fecaca"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  amount:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontWeight: 500
rounded:
  action: "4px"
  field: "6px"
  alert: "8px"
  surface: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.action}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.action}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  inline-action:
    textColor: "{colors.primary-deep}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    width: "100%"
  surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "16px"
  error-message:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.alert}"
    padding: "12px"
  checkbox:
    width: "16px"
    height: "16px"
---

# Design System: AI Checkout Extension

## Overview

**Creative North Star: "A clear checkout comparison"**

The extension is a compact working form. Light surfaces, blue actions, system typography, and visible labels keep the shopper's cards, purchase inputs, conditions, and reward estimates readable inside a Chrome popup. Information earns its emphasis through hierarchy and placement.

This system describes the active popup, protected-input setup and unlock forms, wallet editor, comparison result, and shared cart identity under `extension/`. It preserves the incumbent interface established in `src/styles/globals.css`, `tailwind.config.js`, `src/popup/Popup.tsx`, `src/components/WalletEditor.tsx`, and `src/components/ComparisonResult.tsx`. `src/components/VaultGate.tsx`, `src/components/DataProtectionDetails.tsx`, and `src/components/DeleteSavedData.tsx` extend those same patterns. The cart mark in `assets/cart-mark.svg` preserves the shopping identity and existing primary blue with crisp vector geometry. Other applications in this repository have separate visual authority.

**Key Characteristics:**
- Compact, single-column forms with ordinary system typography.
- White panels and fine gray boundaries on a quiet gray canvas.
- Blue primary actions, underlined supporting actions, and visible keyboard focus.
- A recognizable white geometric cart on the existing blue field, without tiny icon text.
- Estimates paired with merchant, amount basis, conditions, and sources.
- Plain-language protection disclosures and explicit confirmation before permanent deletion.

## Colors

The palette uses a clear action blue, cool neutral surfaces, and a restrained red treatment for errors and deletion.

### Primary

- **Action Blue** (`primary`): filled save and compare actions, native checkbox accents, and the cart mark's blue field.
- **Deep Action Blue** (`primary-deep`): primary-button hover, text actions, source links, and keyboard focus outlines.

### Neutral

- **Quiet Canvas** (`canvas`) sits behind **White Surface** (`surface`) panels and the header.
- **Fine Divider** (`divider`) separates panels, the header, and estimate rows. **Control Border** (`control-border`) gives inputs a stronger boundary.
- **Dark Ink** (`ink`) carries headings, labels, input values, and estimates. **Supporting Gray** (`supporting`) carries explanations and conditions. **Placeholder Gray** (`placeholder`) marks an empty field hint.
- **Secondary Fill** (`secondary`), **Secondary Hover** (`secondary-hover`), and **Secondary Ink** (`secondary-ink`) identify supporting filled actions such as reading a cart and cancelling an edit.

Error red is semantic: `error`, `error-surface`, and `error-border` form the recurring error message. The same dark red identifies deletion. There is no separate secondary brand accent.

**The Action Color Rule.** Use blue for the cart identity, actions, and focus states; keep comparison amounts and card names in dark ink.

## Typography

The interface uses the system font stack recorded in the frontmatter. There is no separate display or decorative typeface. Compact headings, normal sentence case, and readable explanatory text establish hierarchy.

### Hierarchy

- **Headline:** semibold section headings for protected-input forms, the wallet editor, purchase form, and comparison result.
- **Body:** regular supporting text with extra line spacing for multi-line conditions and explanations.
- **Label:** medium field labels and card names, with ordinary small text sharing the same size and line height at regular weight.
- **Amount:** semibold reward values, with tabular numerals and no wrapping within a value or range.
- **Button:** medium weight. The existing filled buttons inherit their font size from the document. The native Chrome popup was observed at 12px with 18px line height; this system does not turn that browser-dependent size into a token.

The application heading is a compact bold heading (20px with 28px line height), not a hero treatment. Inputs and selects explicitly use readable text (14px). Source links and confirmation labels use the small-text scale.

**The Amount Legibility Rule.** Keep reward values on one line with tabular numerals; let the adjacent card name and supporting explanation wrap naturally.

## Layout

The active popup is a fixed single column (360px wide) with a scrolling viewport capped at 600px high. Its outer root can occupy more width, but the popup itself does not expand into a wider layout. Wide tab screenshots and screenshots with the height cap removed are inspection views, not responsive layout commitments. No popup breakpoint is implemented.

Store images and demonstration video in `docs/release/assets/` are fixed-format presentations of the existing interface. Their explanatory panels, larger captions, crops, and output dimensions do not define popup layout, typography, spacing, or breakpoints. Preserve the captured interface's geometry and distinguish presentation copy from actual UI; sample inputs and offline evidence remain explicitly labeled.

The header uses horizontal spacing from step 4 and vertical spacing from step 3. The content column uses step 4 for outer padding, panel padding, and the gap between panels. Fields stack vertically. Labels sit above their controls with step 2 separation; related help follows with step 2 separation. Form groups use step 4, while action groups use step 5 above them. Checkbox rows use step 3 between the control and wrapping copy.

Estimate rows align card names and reward values on a baseline, separate them with a step 4 gap, and use fine horizontal dividers between rows. The footer continues in normal document flow. Long text can wrap anywhere to protect the narrow viewport.

**The Single Column Rule.** Extend the popup through vertical flow and scrolling; retain its fixed width and full-width form fields.

## Elevation & Depth

The active form and comparison surfaces are flat. White fills, fine borders, and spacing separate groups without shadows. Focus is an interaction state: buttons, inputs, selects, disclosure summaries, and links receive a deep-blue outline (2px with a 3px offset). The comparison container also receives programmatic focus after a result appears; its visible browser focus outline is not a permanent result-card border.

The stylesheet still contains shadowed card and modal utilities, but those do not establish the shared surface treatment of this popup flow.

**The Bordered Surface Rule.** Use the shared white, rounded, bordered surface for recurring content groups; express hierarchy with type and spacing rather than added elevation.

## Shapes

Surfaces have the broadest corners; fields are moderately rounded; filled buttons use a smaller corner. Error messages sit between fields and surfaces in corner softness. Boundaries are thin (1px). Native square checkboxes retain their browser affordance and use the action-blue accent. There is no pill or chip vocabulary in the active popup.

The cart identity uses a rounded blue square with a white basket, handle, and two round wheels. Rounded strokes keep the silhouette legible at small sizes. Its enclosing square and internal geometry belong to the identity asset; they do not add a new radius or control shape to the popup.

## Components

### Cart Identity

`assets/cart-mark.svg` is the shared source for the extension icon and release branding. `scripts/render-brand.mjs` renders the same geometry to `public/icons/icon16.png`, `icon48.png`, and `icon128.png` at their native export sizes. The largest square export (128px) contains blue artwork (96px) centered within transparent padding (16px on each edge); smaller exports scale the same composition proportionally. Preserve transparency and inspect the native sizes on light and dark backgrounds.

**The Cart Silhouette Rule.** Keep the white geometric cart and existing blue field recognizable at small sizes; export from the shared vector without adding tiny lettering, a gradient, or extra detail to the icon.

### Buttons

Filled buttons are compact, direct actions. Primary buttons use the action-blue fill and white text; secondary buttons use the neutral fill and darker gray text. Both share the action radius and padding in the frontmatter. Compare, protect-input, and unlock actions span the form width, while save, cancel, and read-cart actions use their content width.

Hover changes only the fill. Color transitions use the framework's standard easing over 150ms. Disabled filled buttons use half opacity and a not-allowed cursor. Underlined blue text buttons handle editing, reloading, manual-entry switching, and term checks. Deletion is an underlined red action. The shared keyboard focus outline applies to every button.

### Cards / Containers

The shared surface groups protected-input forms, the wallet summary, wallet editor, purchase form, and result. It uses a white fill, fine gray border, surface radius, and step 4 padding. It has no resting shadow. A semibold heading leads, followed by supporting text or controls in normal flow.

### Inputs / Fields

Text inputs, password inputs, and native selects use the same full-width white field, control border, field radius, dark input text, and internal padding. Each field has a visible label. Supporting copy remains adjacent to the field it explains. Empty hints use placeholder gray. Keyboard focus uses the shared outline rather than changing the field geometry.

Checkboxes remain native controls, fixed at the checkbox size in the frontmatter and aligned near the first text line. Confirmation text wraps beside them. Busy states disable relevant controls without introducing a separate visual theme. Errors appear in the recurring red message container with alert semantics and specific recovery text.

### Protected Inputs

Setup and unlock forms retain the shared surface, heading, labeled fields, adjacent help, native confirmation checkbox, and full-width primary action. Setup explains what will be stored, where it stays, and the consequence of losing the passphrase before the fields and acceptance control. Unlock uses the same form language with a single passphrase field. Progress appears as status or action text; relevant fields, confirmation controls, and actions are disabled while an operation is running.

The native data-protection disclosure uses the shared underlined blue summary and supporting text. Its explanation follows the actual storage state: setup describes future protection, migration identifies earlier inputs as still unencrypted, unreadable records do not claim verified protection, and locked or unlocked records describe established protection. Essential setup and recovery facts remain visible above the form; the disclosure adds detail.

**The State-Accurate Disclosure Rule.** Match protection wording to the current storage state, and keep the information needed to accept setup beside the form.

### Permanent Deletion

Locked and unlocked views share one inline deletion disclosure. A red, underlined native summary opens ordinary supporting text that states the deletion scope and permanence, followed by a native confirmation checkbox with wrapping copy and an underlined red action. The action is disabled until the user explicitly confirms; the checkbox and action are disabled while busy. This uses the existing disclosure and control language without a separate dialog or added elevation.

**The Explicit Deletion Rule.** Keep the permanent-delete consequence, confirmation, and final action together; opening the disclosure alone does not authorize deletion.

### Comparison Results

The result starts with a conditional heading, then a saved-estimate sentence containing the purchase amount and merchant. A subtotal basis is named in that sentence and explained immediately below it. Each estimate row pairs a card name and reward value or range, with rate and uncertainty copy beneath. Conditions remain visible before the source disclosure.

**The Visible Basis Rule.** Keep merchant, amount, and subtotal qualifications adjacent to the estimate; do not rely on a colored badge or a hidden disclosure to communicate them.

### Source Disclosure

The native disclosure uses an underlined blue summary and ordinary text. Expanding it reveals verification and expiry context plus underlined source links. It keeps evidence available without changing the surrounding panel style. The summary and links retain the common keyboard focus treatment.

### Motion

The active shared controls use short color transitions. Reduced-motion preference disables animation and transition globally. Loading and saving communicate progress through changing button or status text; decorative animation is not part of this popup's shared system.

## Do's and Don'ts

### Do:

- **Do** preserve the fixed single-column popup and its scrolling flow.
- **Do** export the cart identity from its shared vector and preserve its transparent square-icon padding.
- **Do** distinguish presentation captions from actual UI and label sample inputs and offline evidence.
- **Do** use visible labels and adjacent help for protected-input, purchase, merchant, and eligibility forms.
- **Do** keep merchant, amount basis, and uncertainty visible with the estimate they qualify.
- **Do** use underlined text actions and visible keyboard focus alongside color cues.
- **Do** use the shared flat surface, field, button, and error treatments before adding a new variant.
- **Do** match protection details to the current state and reuse the explicit deletion confirmation in locked and unlocked views.
- **Do** disable relevant inputs, confirmation controls, and actions while an operation is running.

### Don't:

- **Don't** treat a wider inspection screenshot or release-media composition as an implemented responsive layout.
- **Don't** turn release-caption typography, presentation dimensions, or cart artwork geometry into popup design tokens.
- **Don't** turn the result's transient focus outline into a permanent accent border.
- **Don't** color reward amounts as an unsupported success claim or hide their conditions in the source disclosure.
- **Don't** inherit unused modal, shadow, animation, oversized radius, or spacing utilities as the popup's shared design language.
