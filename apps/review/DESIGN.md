---
name: "AI Checkout · Catalog review"
description: "A restrained reading workspace for reviewing reward terms and their evidence, in the AI Checkout Ocean theme over Helios tokens and component specs."
source: "Ocean theme (packages/ui/src/theme.css) layered over the Helios token file (@hashicorp/design-system-tokens 5.1.0, MPL-2.0) via @ai-checkout/ui; fonts self-hosted from @fontsource-variable (SIL OFL 1.1). The code uses the --token-* and --ac-* variables, values below are for reference."
colors:
  page: "#eef4fb" # --token-color-page-faint (shell behind the queue)
  surface: "#ffffff" # --token-color-surface-primary (review content, cards, selected draft)
  ink-strong: "#0f1b2b" # --token-color-foreground-strong (headings, values)
  ink: "#2a3a52" # --token-color-foreground-primary
  ink-faint: "#5a6b82" # --token-color-foreground-faint (supporting text)
  border: "#5a6b8233" # --token-color-border-primary
  navy: "#0c2a4d" # --ac-color-navy / --token-color-palette-blue-200 (header, primary button, selected-draft bar)
  navy-line: "#1d4573" # --ac-color-navy-line (header divider)
  sky: "#7cc4ff" # --ac-color-sky (header icon, on navy only)
  on-navy: "#ffffff" # --ac-color-on-navy (header brand)
  on-navy-soft: "#a9c6ea" # --ac-color-on-navy-soft (header text)
  action: "#1d5fb4" # --token-color-foreground-action (links on white)
  current-border: "#b9d3f0" # --token-color-border-action (selected draft)
  critical-surface: "#fff5f5" # --token-color-surface-critical
  warning-surface: "#fff9e8" # --token-color-surface-warning
  success-surface: "#f2fbf6" # --token-color-surface-success
typography:
  stack: "Figtree Variable, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" # --token-typography-font-stack-text
  display: "Bricolage Grotesque Variable, Figtree Variable, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" # --ac-font-display (h1-h3, brand)
  code: "ui-monospace, Menlo, Consolas, monospace" # --token-typography-font-stack-code
  page-title: { fontFamily: display, fontSize: "1.5rem", fontWeight: 700 } # display-400
  section-title: { fontFamily: display, fontSize: "1.125rem", fontWeight: 700 } # display-300
  body: { fontSize: "0.875rem", lineHeight: 1.4286 } # body-200
  small: { fontSize: "0.8125rem", lineHeight: 1.3846 } # body-100
rounded:
  control: "8px" # --token-form-control-border-radius, buttons (border-radius-small)
  card: "12px" # --token-border-radius-medium
  dialog: "16px" # --token-border-radius-large
focus: "inset 0 0 0 1px #1d5fb4, 0 0 0 3px #4a8ad6" # --token-focus-ring-action-box-shadow
components: "@ai-checkout/ui (Helios specs): Button, TextInput, Select, Checkbox, Field, Fieldset, Badge, AlertInline, Card, Table, Tabs, Modal, ApplicationState, Link, Disclosure, Icon"
---

# Design System: Catalog review

## Overview

**North star: "The Review Desk."** A quiet reading environment for one task: decide whether a draft
catalog's reward rules match their issuer evidence, then approve an exact revision. It is built on
[Helios](https://helios.hashicorp.design) through `packages/ui`, shares tokens and components with the
extension popup, keeps AI Checkout's own name and cart icon, and uses no HashiCorp branding. Since
2026-10-02 the Ocean theme (`packages/ui/src/theme.css`) sets the token values: navy, a pale sky page,
Figtree text and Bricolage Grotesque headings
([decision](../../wiki/decisions/2026-10-02-ocean-theme.md)). The sky accent and soft on-navy text
appear only on the navy header; on white, links, focus and the selected draft use action blue
`#1d5fb4` (6.3:1) or navy, and faint text `#5a6b82` is 5.4:1.

Sources: `src/styles.css` (layout only, `--token-*` and `--ac-*` values), `src/App.tsx`, `src/ReviewWorkspace.tsx`,
`src/DraftPanel.tsx`, `src/StructuredEditor.tsx`, `src/ChangesTable.tsx`, `src/ExtractionPanel.tsx`.

## Layout

- Header: a navy bar with the sky cart icon and white Bricolage name, "Catalog review" in soft
  on-navy text behind a navy-line divider, the signed-in email and a secondary Sign out button.
- Headings `h1` to `h3` use Bricolage Grotesque bold in strong ink.
- Workspace: a 260 px draft queue on the pale sky page color beside the white review content.
  Below 700 px the queue stacks above the content with its list capped and scrollable.
- Review content, top to bottom: version heading with a status `Badge`, revision summary, the
  "Before you publish" warning `AlertInline`, **What changes** (diff table) and **Source evidence**
  (side by side at ≥ 1500 px, stacked below), the editors, and the approval card.
- The diff table scrolls horizontally inside its own container; the page never scrolls sideways
  (checked at 390 px).

## Components and states

- **Sign-in**: labelled `Field` + `TextInput`, full-width primary `Button` with a loading state,
  critical `AlertInline` for failures. Loading, session-ended and access-required states use
  `ApplicationState`.
- **Start a new draft**: an `h1` page in the content area (automatic when the queue is empty, otherwise
  from a secondary button under the queue): `Radio` choice between the bundled catalog (facts in a
  bordered `Card` with a validity `Badge`) and pasted JSON (`Field` + textarea), critical `AlertInline`
  for refusals, and a confirmation `Modal` with focus on **Cancel**. The new draft opens with focus on
  its heading.
- **Queue**: plain list of draft buttons; the current one (`aria-current="page"`) is white with
  an action border, a 3 px navy inset bar on the left and the low elevation shadow. A tertiary Reload button.
- **What changes**: Helios `Table` (row header = field, Published, Proposed) with a hidden caption;
  `Disclosure`s for all proposed rules (summaries in plain language) and the full payload with its
  hash.
- **Source evidence**: one bordered `Card` per source with an external `Link`, the checked date, an
  evidence `Badge` ("Matching evidence captured" success / "Matching evidence needed" warning), and
  the captured text in a `Disclosure`.
- **Capture all missing sources** (`Disclosure`): load saved capture files named `<source id>.txt`
  or paste text per missing source; one submit captures them all and attaches them in a single new
  draft revision. **Capture source evidence** remains for one source at a time.
- **Correct draft data** (`Disclosure`): for schema 2 drafts, `Tabs` with **Cards and rules** (the
  structured editor) and **JSON**. The structured editor lays out catalog fields, then one card
  `Disclosure` per card (fields render only while open) and a `Fieldset` per rule: issuer wording,
  rate, paid-on-payment portion, cap kind/amount/period/after-cap rate, activation, promotion end,
  U.S.-only. Every edit is validated with the shared Zod schema; messages appear on the field
  (`aria-invalid`, described error) and in a critical summary. A disclosure previews the edited
  catalog against the published one. Numeric fields accept digits only; a newly chosen spend cap
  starts blank so the issuer's real amount, period and after-cap rate must be typed. There is no
  implicit submit: only **Save structured edits** saves. The problem summary is not a live region; it
  names the card and rule of each problem and offers to open a collapsed card at the field. Schema 1
  drafts keep the JSON editor and the extraction panel.
- **Unsaved input is never discarded silently.** Every save and capture creates a revision from the
  saved draft and reloads it, so each is disabled while another editor (JSON, Cards and rules, either
  capture form) has unsaved input, with the reason shown next to the button.
- **Capture hashes**: each captured source shows its SHA-256, and loaded or pasted capture text shows
  whether it matches the corpus manifests (`evals/curation/real/manifest.json`, the expansion and
  merchant manifests and every pipeline batch manifest; the capture dated the source's checkedOn when
  one exists, otherwise any recorded capture),
  which catches a mislabelled file before it is attached. Files too large to be a capture are skipped unread.
- **Approval**: a `Card` with the acknowledgement `Checkbox`, a Review note field, and "Publish
  reviewed terms". Publishing opens a warning `Modal` ("Publish {version}?") that restates the
  revision, cards, sources, changed-field count, expiry and the note. Focus starts on **Cancel**
  (`initialFocusRef`); **Publish release** is the only action that publishes. Esc, the dismiss button
  and the overlay close it and return focus. After publication focus moves to the refreshed draft
  heading.
- **Notices**: success `AlertInline` (role status) after saves, captures and publication; critical
  `AlertInline` (role alert) with "Reload latest draft" for stale or failed actions.
- **Extraction panel** (schema 1 only): native controls styled with the same tokens; its regions are
  labelled ("Extract from captured terms", "Extraction result", "Conditions and exclusions",
  "Proposed draft change") so tests and assistive technology address them by name.

## Content security

The API serves the app with `style-src 'self'` and `script-src 'self'` (no inline styles or eval)
and `img-src 'self' data:`, which the Helios form images need. Nothing in the built CSS or JS needs an
inline exception. zod runs jitless (`src/zod-config.ts`, imported first) so it never probes
`new Function`. `e2e/a11y.spec.ts` serves the production build with these exact headers and fails on
any CSP violation.

## Accessibility

Every control has a visible label; helper and error text are connected with `aria-describedby`.
Focus uses the theme's focus ring (1 px action blue inside a 3 px `#4a8ad6` ring). `e2e/a11y.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on sign-in, the
queue with a draft diff, the structured editor with validation errors, and the publish confirmation,
at 1280 and 390 px, against a mocked backend so it needs no database.

## Do's and Don'ts

- **Do** use `@ai-checkout/ui` components and `--token-*` variables; extend tokens, not raw values.
- **Do** keep changed values next to unchanged conditions and the exact captured evidence.
- **Do** keep publication an explicit, separately confirmed human action bound to one revision.
- **Don't** imply that matching captured text proves an interpretation is correct.
- **Don't** add inline styles or scripts; the CSP forbids them.
