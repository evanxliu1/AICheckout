# Public site

The public pages for AI Checkout, served by the API at `/` (`SITE_DIST_DIR`):

| Path | Content |
| --- | --- |
| `/` | What the extension does, how it decides, release screenshots, supported cards and checkouts, install placeholder until the Chrome Web Store listing exists |
| `/results/` | The extraction evaluation from `docs/evals/results.json`: dev and held-out tables, both charts, caveats and limitations, link to the full `results.md` |
| `/architecture/` | The two-systems diagram (inline SVG, wide and phone layouts) and the harness summary |
| `/privacy/` | What stays on the device, the only request (the catalog GET), cart reads, the encrypted vault, deletion |
| `/support/` | Getting started, common issues, known limitations, reporting a problem |

It is a Vite multi-page build with no client router. Each page is rendered to static HTML at build time with React and `@ai-checkout/ui` (`src/render.tsx`, loaded by the plugin in `vite.config.ts`), so the only script is `src/enhance.ts`, which makes wide tables scrollable by keyboard. The build copies `docs/evals/results.json`, both result SVGs and four release screenshots into `dist/`, so the numbers always match the committed data. Styles use Helios tokens only; nothing needs an inline style or script, so the site runs under `style-src 'self'; script-src 'self'`.

```sh
npm run dev --workspace=@ai-checkout/site          # http://127.0.0.1:5180
npm run build --workspace=@ai-checkout/api --workspace=@ai-checkout/site
npm run test --workspace=@ai-checkout/site         # data and markup checks
npm run test:browser --workspace=@ai-checkout/site # axe on every page at 1280 and 390 px
```

The browser test starts the built API with `SITE_DIST_DIR`, so the pages load under their production headers, and fails on any axe violation (WCAG 2.0/2.1 A and AA), horizontal scroll, broken image or CSP violation.
