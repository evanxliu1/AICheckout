# UI

React 19 components built to the [Helios](https://helios.hashicorp.design) component specs, styled only with Helios design tokens (light theme). Each component file links its Helios doc page. Consumed as TypeScript source like the other workspace packages.

```tsx
import '@ai-checkout/ui/styles.css'; // once per app: tokens, helpers, component CSS
import { Button, Field, TextInput } from '@ai-checkout/ui';

<Field label="Monthly spend" helperText="In dollars." error={error} isRequired>
  {(control) => <TextInput {...control} inputMode="decimal" />}
</Field>;
```

Components: `Button`, `TextInput`, `Select`, `Checkbox`, `Radio`, `Toggle`, `Field`, `Fieldset`, `Badge`, `AlertInline`, `Card`, `Table`, `Tabs`, `Modal`, `ApplicationState`, `Link`, `Disclosure`, `Icon`.

- CSP: no inline styles or `<style>` tags; icons are inline SVG. Checkbox, radio, toggle, and select use the Helios token `data:` images, so `img-src` must allow `data:` (the review app's CSP does).
- Icons: only the Flight icons listed in `scripts/generate-icons.mjs` are bundled. Add a name there and run `npm run icons --workspace=@ai-checkout/ui`; `npm test` fails if `src/icons.generated.ts` is stale.
- `Modal` is built for one open modal at a time. Nested modals work (only the top one handles Esc/Tab; the body scroll lock holds until the last closes) but aren't a supported pattern.
- Pass extra `aria-describedby` ids through `Field`'s `describedBy` prop (or `aria-describedby` on `Fieldset`/`Checkbox`/`Radio`/`Toggle`); they are merged with the helper and error ids. `Field` and `Fieldset` errors sit in a polite live region.
- Token exceptions are listed at the top of `src/styles.css` (outlined badges use the filled text color for contrast).

## Checks

```sh
npm test --workspace=@ai-checkout/ui          # vitest: roles, labels, keyboard behavior
npm run gallery --workspace=@ai-checkout/ui   # dev server for gallery/ at http://localhost:5178
npm run test:browser --workspace=@ai-checkout/ui  # builds the gallery, runs axe (WCAG 2.1 A/AA) at 360 and 1280 px, modal focus and keyboard checks
```

Run `npx playwright install chromium` once before the browser test.

## Licenses

Design tokens come from [`@hashicorp/design-system-tokens`](https://www.npmjs.com/package/@hashicorp/design-system-tokens) and icon path data (copied into `src/icons.generated.ts`) from [`@hashicorp/flight-icons`](https://github.com/hashicorp/design-system/tree/main/packages/flight-icons), both under the Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). The components are this repository's own code (MIT) written to the public Helios specs; no HashiCorp branding is used and there is no affiliation.
