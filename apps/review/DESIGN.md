---
name: "AI Checkout · Catalog review"
description: "A restrained reading workspace for reviewing reward terms and their evidence."
colors:
  primary: "#1d4ed8"
  primary-hover: "#1e40af"
  action-wash: "#eff6ff"
  paper: "white"
  shell: "#f8fafc"
  ink: "#172033"
  muted: "#4b5b72"
  line: "#d6dee9"
  control-line: "#9aabc2"
  current-fill: "#eaf1ff"
  current-line: "#b9cdfb"
  status-fill: "#edf2f8"
  status-ink: "#34476b"
  error-fill: "#fff7f7"
  error-ink: "#991b1b"
  error-line: "#fecaca"
  warning-fill: "#fffbeb"
  warning-ink: "#75410c"
  warning-line: "#e8c68d"
  success-fill: "#f0fdf4"
  success-ink: "#14532d"
  success-line: "#b8dbc6"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "28px"
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "19px"
    lineHeight: 1.35
  subtitle:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    lineHeight: 1.55
  supporting:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
  small:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 600
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.6
rounded:
  status: "4px"
  field: "6px"
  button: "7px"
  feedback: "10px"
spacing:
  compact: "8px"
  control: "12px"
  regular: "16px"
  section: "24px"
  spacious: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.action-wash}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
  button-quiet-hover:
    backgroundColor: "{colors.action-wash}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
    width: "100%"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "12px"
    width: "100%"
  navigation-item-current:
    backgroundColor: "{colors.current-fill}"
  status-label:
    backgroundColor: "{colors.status-fill}"
    textColor: "{colors.status-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.status}"
    padding: "4px 8px"
  feedback-error:
    backgroundColor: "{colors.error-fill}"
    textColor: "{colors.error-ink}"
    rounded: "{rounded.feedback}"
    padding: "16px 18px"
  feedback-warning:
    backgroundColor: "{colors.warning-fill}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.feedback}"
    padding: "16px 18px"
  feedback-success:
    backgroundColor: "{colors.success-fill}"
    textColor: "{colors.success-ink}"
    rounded: "{rounded.feedback}"
    padding: "16px 18px"
  comparison-table:
    typography: "{typography.small}"
    width: "100%"
  disclosure-summary:
    textColor: "{colors.primary}"
    padding: "12px 0"
---

# Design System: AI Checkout · Catalog review

## Overview

**Creative North Star: "The Review Desk"**

The Review Desk is a quiet, practical reading environment. White working surfaces sit within a light slate shell, with blue identifying actions and soft borders organizing dense material. The established AI Checkout system-font identity is retained within this app; the interface has no separate display identity or decorative media.

The system gives precise content, readable controls, and visible states priority. Ordinary document structure, tables, and native disclosures provide the hierarchy. This record describes the implemented review app and does not redefine the extension's identity or elevate this screen's composition into a rule for other products.

**Key Characteristics:**
- White reading surfaces within a light slate shell.
- Blue actions and restrained, functional color washes.
- Compact type hierarchy with explicit labels and readable supporting text.
- Flat sections, thin dividers, and softly rounded controls.
- Native controls, visible keyboard focus, and layouts that stack on narrow screens.

## Colors

Cool white and slate neutrals carry the reading surface; blue marks action, while red, amber, and green communicate operational feedback.

### Primary
- **Action Blue** (`primary`): links, disclosure summaries, primary buttons, and the checkbox accent. Its source custom property is `--blue`.
- **Deep Action Blue** (`primary-hover`): the enabled primary button's hover treatment.
- **Action Wash** (`action-wash`): enabled button hover and the proposed-value column in comparisons.
- **Current Selection** (`current-fill`, `current-line`): a blue-tinted fill and boundary for the active queue item.

### Secondary
- **Error Feedback** (`error-fill`, `error-ink`, `error-line`): pale red containers with dark readable text and a distinct boundary.
- **Warning Feedback** (`warning-fill`, `warning-ink`, `warning-line`): pale amber containers for conditions requiring attention.
- **Success Feedback** (`success-fill`, `success-ink`, `success-line`): pale green containers for completed operations.

These are semantic feedback families, not additional brand accents. Source-evidence labels also use green or amber text accompanied by explicit matching/needed wording.

### Neutral
- **White Paper** (`paper`): the header, reading surface, and ordinary fields and buttons.
- **Slate Shell** (`shell`): the page surround and full-data reading surface.
- **Reading Ink** (`ink`): body text, titles, and ordinary controls.
- **Supporting Slate** (`muted`): metadata, table headings, helper copy, and secondary status. Its source custom property is `--muted`.
- **Section Line** (`line`): section and container boundaries. Its source custom property is `--line`.
- **Control Line** (`control-line`): a stronger border for editable fields and ordinary buttons.
- **Status Slate** (`status-fill`, `status-ink`): compact, noninteractive lifecycle labels.

**The State Has Words Rule.** Pair feedback color and selection tint with explicit text or an accessible state; color does not carry the meaning alone.

## Typography

**Body and interface family:** the incumbent system sans stack recorded in the frontmatter. There is no separate display font. **Code family:** the recorded system monospace stack, limited to structured data and identifiers.

**Character:** direct, familiar, and dense enough for inspection. Headings use the browser's semantic heading weight; controls and labels use deliberate semibold emphasis. The scale is a practical set of roles, not a mathematical ratio.

### Hierarchy
- **Headline:** the current draft or major state heading. A narrower variant reduces the draft heading on mobile; the sign-in heading has a local larger treatment.
- **Title:** primary content section headings.
- **Subtitle:** source and rule names; compact section headings also use this size.
- **Body:** paragraphs and form content inherit the browser's base text size and the root line height. Paragraphs are limited to a comfortable measure (72ch).
- **Supporting / Small:** evidence text, descriptive rules, comparison cells, account details, and helper copy. Captured prose retains the body family rather than becoming a code block merely because it preserves whitespace.
- **Label:** compact lifecycle and evidence states. General field labels and button captions also use semibold emphasis without imposing the compact label size.
- **Code:** structured catalog data, editable JSON, and technical identifiers. Long strings wrap where needed.

**The Reading Role Rule.** Use prose typography for human-readable evidence and monospace for structured payloads and identifiers.

## Layout

The app has a full-width white header and a centered workspace with a maximum width (1600px). The desktop workspace places a fixed queue (245px) beside a flexible reading area. Within that area, the comparison and evidence sections use a two-column ratio (1.5fr / 1fr), with an evidence minimum (270px) and a generous gap (32px). These measurements describe this app's current workspace, not a universal page template.

Spacing is clustered around compact control and content increments. Common interior spacing is the regular step; section separation often uses the spacious step. Header and content padding provide a wider desktop margin, while form groups remain aligned in the reading area. Long titles, source text, cells, and account identifiers wrap rather than forcing the whole page wider.

At the tablet breakpoint (1100px), comparison and evidence stack, with a divider introducing evidence and reduced content padding. At the mobile breakpoint (700px), the queue moves above the content, its list becomes scrollable when long (170px maximum height), account details wrap to a full header row, and the approval row stacks. Table text and cell padding reduce at this breakpoint. Source and payload panes have their own overflow regions so long content can be inspected without expanding the entire page indefinitely.

Extraction controls and their selected result stay inline in the reading area. Fact rows pair a muted label column (150px) with a flexible value-and-evidence column, separated by thin rules. At the mobile breakpoint, both the controls and fact rows stack; quotations and identifiers continue to wrap. Conditions use consecutive open articles rather than a separate card grid.

## Elevation & Depth

The implementation is flat: it has no box shadows, gradients, or animated elevation. White paper, slate surrounds, gentle state fills, and thin borders distinguish regions. Controls change color immediately on hover; there are no authored transition or animation tokens.

**The Flat Reading Surface Rule.** Organize content through spacing, tonal separation, and borders; preserve the app's flat surface hierarchy.

Keyboard focus is an outline, not a shadow: a blue line (3px, `#2563eb`) with an offset (3px). The programmatically focused draft heading suppresses its outline; interactive controls retain visible focus. The sidecar records the focus treatment because the frontmatter component schema has no outline property.

## Shapes

Controls use modest rounding: status labels are tight, fields and buttons are gently rounded, and feedback containers have a slightly softer silhouette. The exact recurring roles are recorded in the frontmatter. Reading sections and tables remain open, square-edged structures divided by lines rather than repeated cards. Borders are thin (1px). The captured-text pane has a local rounded enclosure; that isolated radius is not promoted into the shared scale.

## Components

### Buttons

Readable text actions with a clear hierarchy.

- **Shape:** the recorded button radius, standard padding, semibold text, and a minimum height (42px).
- **Primary:** Action Blue with White Paper text; its enabled hover deepens the fill. Sign-in and publication use this treatment.
- **Secondary:** white with Reading Ink and a Control Line boundary; hover uses Action Wash and a blue border.
- **Quiet:** transparent at rest with Action Blue text; enabled hover gains Action Wash and a blue border. Compact queue actions use smaller local padding.
- **Focus / disabled:** the shared visible outline; disabled buttons reduce opacity (0.52) and use the unavailable cursor. There is no separate authored pressed-state animation.

### Status Labels

Small, declarative lifecycle information. Use the recorded status colors, compact label typography, tight radius, and compact padding. These labels are not clickable filters or actions.

### Containers and Feedback

Content sections are open reading regions with dividers. Feedback containers carry the recurring card-like enclosure: the recorded feedback radius and padding, a thin semantic border, and the matching error, warning, or success family. Feedback can contain explanatory text, a list, and a recovery action; retain the action's ordinary button treatment. Error and completion messages use the corresponding live-region semantics where implemented.

### Inputs / Fields

White, full-width controls with a visible Control Line border, the field radius, and the recorded padding. Labels appear above controls in semibold text. Textareas resize vertically. All editable controls receive the shared keyboard outline. Placeholder text is secondary to the explicit label; it does not replace it. Disabled fields retain native disabled behavior; the stylesheet does not impose the button opacity treatment on them.

### Navigation

Queue items are full-width, left-aligned buttons. The draft name occupies the first line and smaller muted revision metadata appears below. The current item has Current Selection fill and border and exposes `aria-current="page"`. Other enabled items receive ordinary hover and focus treatment. The mobile queue keeps the same item language while moving above the content.

### Comparison and Evidence

The comparison uses a full-width, fixed-layout semantic table with understated row rules, a wider first column (38%), and Action Wash behind proposed values. Text wraps inside cells. Evidence is presented as prose beside or below the table, with explicit source links and captured-text disclosures. Native `details` / `summary` controls use semibold blue text, underline on hover, and the shared focus outline. Retain their native disclosure marker rather than introducing decorative icons.

### Extraction and Condition Review

Extracted facts extend the existing reading hierarchy. A semantic description list pairs each field label with its emphasized value and immediate source quotations. Quotations use supporting prose typography, preserve whitespace, and wrap long content; muted metadata identifies the source and exact span or explicitly reports a mismatch. Unknown and conflicting values remain visible as words. Extraction status describes evidence checks and the remaining human review, without implying approval.

Conditions remain open, numbered articles with their evidence in view. Each coverage decision uses a labeled native select. Selecting existing-rule coverage reveals a softly rounded fieldset, a descriptive legend, native checkboxes, and a labeled explanation textarea with visible minimum-length help. These controls retain the shared field, checkbox, and focus treatments.

The application area begins after a thin divider and reuses the comparison table to show the current draft against the proposed result. A warning container headed “Before you apply” lists outstanding requirements next to the confirmation and action; accessible descriptions connect that list to the controls. Applying uses a secondary text button and creates a new draft revision. The separate publication area retains the primary button and requires fresh approval.

Recorded review, validation findings, full sources, and provenance use the existing native disclosure treatment. Keep source quotations near the corresponding claim while placing longer supporting records inside disclosures. Structured accounting and payload details retain code typography.

## Do's and Don'ts

### Do:
- **Do** retain the app's light white/slate/blue identity and system sans interface typography.
- **Do** keep explicit labels, semantic headings, readable supporting copy, and visible keyboard focus.
- **Do** pair state colors with words or accessible state attributes.
- **Do** keep prose evidence readable and allow long identifiers and table values to wrap.
- **Do** preserve the responsive stack and scrollable local content regions when material grows.
- **Do** keep claim evidence and condition decisions adjacent, and explain outstanding requirements beside the gated action.

### Don't:
- **Don't** turn lifecycle labels into implied clickable controls.
- **Don't** replace the flat reading hierarchy with ornamental shadows or decorative card grids.
- **Don't** hide the meaning of a state in color alone.
- **Don't** promote the sign-in headline size, local pane measurements, or this screen's exact composition into a new global identity.
- **Don't** add decorative media or external display fonts to the utility interface under this retained-identity scope.
