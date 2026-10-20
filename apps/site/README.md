# Public site

The public pages for AI Checkout, served by the API at `/` (`SITE_DIST_DIR`):

| Path | Content |
| --- | --- |
| `/` | What the extension does at any https store, how it decides, release screenshots, the cards and stores covered, install placeholder until the Chrome Web Store listing exists |
| `/results/` | The extraction evaluation from `docs/evals/results.json`: dev and held-out tables, both charts, caveats and limitations, link to the full `results.md` |
| `/architecture/` | The two-systems diagram (inline SVG, wide and phone layouts) and the harness summary |
| `/privacy/` | The privacy policy (`docs/release/privacy-policy.md` says the same): what stays on the device, what the badge reads on web pages, the catalog and store-list requests, optional usage reports (random identifier, 90 days, Stop sharing, Delete my data), the optional vault, deletion |
| `/support/` | Getting started, common issues, usage reports, deleting data, reporting a problem (`docs/release/support.md`) |
| `/credits/` | Data sources and licences: the Oklahoma CC BY 4.0 notice, DC and GSA CC0, the Visa manual reference, NerdWallet valuations, Helios and the fonts; linked from the footer, not the navigation |
| `/uninstalled/` | The page Chrome opens after an uninstall (`chrome.runtime.setUninstallURL`, no parameters): what was removed on the device, that server rows expire within 90 days, that Delete my data had to be used before uninstalling |

It is a Vite multi-page build with no client router. Each page is rendered to static HTML at build time with React and `@ai-checkout/ui` (`src/render.tsx`, loaded by the plugin in `vite.config.ts`), so the only script is `src/enhance.ts`, which makes wide tables scrollable by keyboard. The build copies `docs/evals/results.json`, both result SVGs and four release screenshots into `dist/`, so the numbers always match the committed data. Styles use Helios tokens only; nothing needs an inline style or script, so the site runs under `style-src 'self'; script-src 'self'`.

```sh
npm run dev --workspace=@ai-checkout/site          # http://127.0.0.1:5180
npm run build --workspace=@ai-checkout/api --workspace=@ai-checkout/site
npm run test --workspace=@ai-checkout/site         # data and markup checks
npm run test:browser --workspace=@ai-checkout/site # axe on every page at 1280 and 390 px
```

The browser test starts the built API with `SITE_DIST_DIR`, so the pages load under their production headers, and fails on any axe violation (WCAG 2.0/2.1 A and AA), horizontal scroll, broken image or CSP violation.
