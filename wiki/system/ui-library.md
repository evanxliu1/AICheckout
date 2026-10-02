---
type: System Component
title: UI library
description: packages/ui — React 19 components built to the Helios design-system specs, styled with Helios token names whose values come from the AI Checkout Ocean theme, shared by the extension, review app and public site.
status: stable
tags: [system, ui, helios, theme, accessibility]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:05:00Z
sources:
  - resource: ../../packages/ui/src/index.ts
    title: Component exports
  - resource: ../../packages/ui/src/styles.css
    title: Tokens import and component CSS
  - resource: ../../packages/ui/src/theme.css
    title: Ocean theme layer and fonts
  - resource: ../../packages/ui/scripts/generate-icons.mjs
    title: Icon generator
  - resource: ../../packages/ui/README.md
    title: UI README
  - resource: ../archive/phase2-goal.md
    title: Phase 3a Helios plan (archived)
---

# UI library

`packages/ui` (`@ai-checkout/ui`) is this repo's own React 19 component set, written to the public [Helios](https://helios.hashicorp.design) component specs (HashiCorp's Ember-only library is not used) and styled only with `--token-*` CSS variables from `@hashicorp/design-system-tokens` 5.1.0, whose values the AI Checkout Ocean theme ([`src/theme.css`](../../packages/ui/src/theme.css), [decision](../decisions/2026-10-02-ocean-theme.md)) replaces. Icons are path data from `@hashicorp/flight-icons` 5.2.0 copied into a generated TS file. It is consumed as TypeScript source by the extension popup, onboarding and badge iframe, the review app and the public site. Light theme only. Usage examples and licence notes: [`packages/ui/README.md`](../../packages/ui/README.md).

Verified 2026-10-02 by reading the code and running `npm test --workspace=@ai-checkout/ui` (36 tests plus the icon staleness check, passing) and the gallery browser test (axe at 360 and 1280 px) with the Ocean theme.

## Facts

| Item | Value |
| --- | --- |
| Exports | `AlertInline`, `ApplicationState`, `Badge`, `Button`, `Card`, `Disclosure`, `Checkbox`, `Field`, `Fieldset`, `Radio`, `Select`, `TextInput`, `Toggle`, `Icon`, `Link`, `Modal`, `Table`, `Tabs`, `cx` ([`src/index.ts`](../../packages/ui/src/index.ts)) |
| Styles | `import '@ai-checkout/ui/styles.css'` once per app: Helios tokens, color/elevation/focus-ring/typography helpers, the Ocean theme, component CSS ([`src/styles.css`](../../packages/ui/src/styles.css)) |
| Theme | [`src/theme.css`](../../packages/ui/src/theme.css) overrides Helios semantic, palette, radius, elevation, focus, form-control and badge tokens and adds `--ac-color-navy` `#0c2a4d`, `--ac-color-sky` `#7cc4ff`, `--ac-color-on-navy`, `--ac-color-on-navy-soft` `#a9c6ea`, `--ac-color-navy-strong`, `--ac-color-navy-line`, `--ac-font-display`, `--ac-radius-hero`. Action blue on white is `#1d5fb4` |
| Fonts | Figtree (text) and Bricolage Grotesque (display), `@fontsource-variable/*` 5.3.0 (SIL OFL 1.1), imported by `theme.css` and bundled as same-origin `woff2` files; no CSP change |
| Token exceptions | Listed at the top of `styles.css`: untokenized layout px, overlay opacity, outlined badges using the filled text colour for 4.5:1 contrast. Raw hex only in `theme.css` |
| Icons | Only names in `ICONS` in [`scripts/generate-icons.mjs`](../../packages/ui/scripts/generate-icons.mjs) are bundled into `src/icons.generated.ts`; `npm run icons --workspace=@ai-checkout/ui` regenerates |
| Gallery | `npm run gallery --workspace=@ai-checkout/ui` → `http://localhost:5178` (`gallery/`, not shipped) |
| Licences | Tokens and icon data MPL-2.0; fonts SIL OFL 1.1; components MIT. No HashiCorp branding, no affiliation |

## How it works

- Each component file links its Helios doc page in a comment and follows Helios naming (colours `primary/secondary/tertiary/critical`, sizes `small/medium/large`, etc.).
- `Field` and `Fieldset` wire `id`, `aria-describedby` (helper, error and any extra IDs passed via `describedBy`) and `aria-invalid`; errors sit in a polite live region.
- `Modal` traps focus, closes on Esc, restores focus and locks body scroll; built for one open modal at a time.
- `Tabs` uses roving tabindex with arrow keys; `Table` supports optional sorting.

## Gotchas

- CSP: components use no inline styles or `<style>` tags, but checkbox, radio, toggle and select use Helios token `data:` images, so consumers need `img-src 'self' data:` (the review app and site CSPs allow it; see [API](api.md#security-headers)).
- `npm test` fails if `src/icons.generated.ts` is stale relative to `ICONS`.
- Sky (`--ac-color-sky`) and on-navy text only pass contrast on navy. On white use `--token-color-foreground-action`; the axe checks in every app's browser suite catch misuse (the site's install card inside the navy hero needed its text colour reset).
- The extension release package allows `assets/*.woff2` for the fonts ([`release-package.mjs`](../../extension/scripts/release-package.mjs)); other font formats fail packaging.
- The extension's Tailwind theme maps to `--token-*` variables so remaining utilities are tokens ([`extension/tailwind.config.js`](../../extension/tailwind.config.js)).

## Tests

- [`tests/components.test.tsx`](../../packages/ui/tests/components.test.tsx): roles, labels, keyboard behaviour.
- [`e2e/gallery.spec.ts`](../../packages/ui/e2e/gallery.spec.ts): builds the gallery; axe (WCAG 2.1 A/AA) at 360 and 1280 px, modal focus trap and return, keyboard use of tabs, radios and sortable table. Runs in "Application checks" CI.

## Related

* [Extension](extension.md)
* [Review app](review-app.md)
* [Public site](public-site.md)
* Design notes (design-tool files): [`extension/DESIGN.md`](../../extension/DESIGN.md), [`apps/review/DESIGN.md`](../../apps/review/DESIGN.md)
