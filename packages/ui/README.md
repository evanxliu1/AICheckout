# UI

React 19 components built to the [Helios](https://helios.hashicorp.design) component specs, styled with Helios token names (light theme) whose values come from the AI Checkout Ocean theme in `src/theme.css` (navy, pale sky, sky accent; Figtree text and Bricolage Grotesque headings, self-hosted). Each component file links its Helios doc page. Consumed as TypeScript source like the other workspace packages.

```tsx
import '@ai-checkout/ui/styles.css'; // once per app: tokens, helpers, Ocean theme, fonts, component CSS
import { Button, Field, TextInput } from '@ai-checkout/ui';

<Field label="Monthly spend" helperText="In dollars." error={error} isRequired>
  {(control) => <TextInput {...control} inputMode="decimal" />}
</Field>;
```

Components: `Button`, `TextInput`, `Select`, `Checkbox`, `Radio`, `Toggle`, `Field`, `Fieldset`, `Badge`, `AlertInline`, `Card`, `Combobox` (with `matchesSearch`, `normalizeSearch`), `Table`, `Tabs`, `Modal`, `ApplicationState`, `Link`, `Disclosure`, `Icon`.

- CSP: no inline styles or `<style>` tags; icons are inline SVG. Checkbox, radio, toggle, and select use the Helios token `data:` images, so `img-src` must allow `data:` (the review app's CSP does).
- Icons: only the Flight icons listed in `scripts/generate-icons.mjs` are bundled. Add a name there and run `npm run icons --workspace=@ai-checkout/ui`; `npm test` fails if `src/icons.generated.ts` is stale.
- `Modal` is built for one open modal at a time. Nested modals work (only the top one handles Esc/Tab; the body scroll lock holds until the last closes) but aren't a supported pattern.
- Pass extra `aria-describedby` ids through `Field`'s `describedBy` prop (or `aria-describedby` on `Fieldset`/`Checkbox`/`Radio`/`Toggle`); they are merged with the helper and error ids. `Field` and `Fieldset` errors sit in a polite live region.
- Token exceptions are listed at the top of `src/styles.css` (outlined badges use the filled text color for contrast). Raw colors live only in `src/theme.css`; its `--ac-*` brand tokens (sky, soft on-navy text) pass contrast on navy only.
- Fonts are bundled from `@fontsource-variable` as same-origin `woff2` files, so `style-src 'self'` and `font-src`/`default-src 'self'` CSPs need no change. The extension release package allows `assets/*.woff2`.

## Checks

```sh
npm test --workspace=@ai-checkout/ui          # vitest: roles, labels, keyboard behavior
npm run gallery --workspace=@ai-checkout/ui   # dev server for gallery/ at http://localhost:5178
npm run test:browser --workspace=@ai-checkout/ui  # builds the gallery, runs axe (WCAG 2.1 A/AA) at 360 and 1280 px, modal focus and keyboard checks
```

Run `npx playwright install chromium` once before the browser test.

## Licenses

Design tokens come from [`@hashicorp/design-system-tokens`](https://www.npmjs.com/package/@hashicorp/design-system-tokens) and icon path data (copied into `src/icons.generated.ts`) from [`@hashicorp/flight-icons`](https://github.com/hashicorp/design-system/tree/main/packages/flight-icons), both under the Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). Figtree and Bricolage Grotesque (`@fontsource-variable/figtree`, `@fontsource-variable/bricolage-grotesque`) are under the SIL Open Font License 1.1. The components are this repository's own code (MIT) written to the public Helios specs; no HashiCorp branding is used and there is no affiliation.
