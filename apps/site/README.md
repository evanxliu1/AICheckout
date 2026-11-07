# Public site

The public website for AI Checkout. The API serves it at `/` when `SITE_DIST_DIR` is set.

| Path | Content |
| --- | --- |
| `/` | What the extension does at any https store, how it decides, release screenshots, the cards and stores covered, install placeholder until the Chrome Web Store listing exists |
| `/results/` | The extraction evaluation from `docs/evals/results.json`: dev and held-out tables, both charts, caveats and limitations, link to the full `results.md` |
| `/architecture/` | The two-systems diagram (inline SVG, wide and phone layouts), the release flow, the engine and the harness summary |
| `/privacy/` | The privacy policy (`docs/release/privacy-policy.md` says the same): a summary, what stays on the device, what the badge reads on web pages, the catalog and store-list requests, optional usage reports (random identifier, 90 days, Stop sharing, Delete my data), the optional vault, deletion |
| `/support/` | Getting started, troubleshooting, usage reports, deleting data, reporting a problem (`docs/release/support.md` says the same) |
| `/credits/` | Data sources and licences: the Oklahoma CC BY 4.0 notice, DC and GSA CC0, the Visa manual reference, NerdWallet valuations, Helios and the fonts; linked from the footer, not the navigation |
| `/uninstalled/` | The page Chrome opens after an uninstall (`chrome.runtime.setUninstallURL`, no parameters): what was removed from the device, that shared reports expire after 90 days (deleted by a daily job), and that Delete my data had to be used before uninstalling |
| `/sample-cart/` | A sample cart for testing AI Checkout, linked from the Chrome Web Store test instructions: the fictional cart of the release screenshots (two sample items; Subtotal $92.59, Estimated tax $7.41, Total $100.00) with read-only quantities and disabled **Remove** buttons. The title and heading say "Your cart" because the cart reader needs a cart word there (the path segment `sample-cart` is not one); `noindex`, not in the navigation. `tests/sample-cart.test.ts` runs the cart reader on the rendered page and `extension/e2e/sample-cart.spec.ts` checks the badge on the built page |

It is a Vite multi-page build with no client router. Each page is rendered to static HTML at build time with React and `@ai-checkout/ui` (`src/render.tsx`, loaded by the plugin in `vite.config.ts`), so the only script is `src/enhance.ts`, which makes wide tables scrollable by keyboard. The build copies `docs/evals/results.json`, both result SVGs and four release screenshots into `dist/`, so the numbers always match the committed data. Styles use the Helios token names with the Ocean theme values from `packages/ui` only; nothing needs an inline style or script, so the site runs under `style-src 'self'; script-src 'self'`.

```sh
npm run dev --workspace=@ai-checkout/site          # http://127.0.0.1:5180
npm run build --workspace=@ai-checkout/api --workspace=@ai-checkout/site
npm run test --workspace=@ai-checkout/site         # data and markup checks
npm run test:browser --workspace=@ai-checkout/site # axe on every page at 1280 and 390 px
```

The browser test starts the built API with `SITE_DIST_DIR`, so the pages load under their production headers, and fails on any axe violation (WCAG 2.0/2.1 A and AA), horizontal scroll, broken image or CSP violation.

Page copy follows the project's [house style for public docs](../../docs/release/style-guide.md). The privacy policy and support pages mirror `docs/release/privacy-policy.md` and `docs/release/support.md`; change both in the same commit.
