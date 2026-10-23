---
type: System Component
title: Public site
description: apps/site — the static public pages (landing, results, architecture, privacy policy, support, credits, the uninstall page) pre-rendered with React at build time and served by the API at /.
status: stable
tags: [system, site, static]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
sources:
  - resource: ../../apps/site/vite.config.ts
    title: Site build and copied files
  - resource: ../../apps/site/src/render.tsx
    title: Static renderer
  - resource: ../../apps/site/src/pages.tsx
    title: Page content
  - resource: ../../apps/site/src/enhance.ts
    title: Only client script
  - resource: ../../apps/site/README.md
    title: Site README
  - resource: ../../apps/api/src/public-site.ts
    title: Serving context
---

# Public site

`apps/site` (`@ai-checkout/site`) is a Vite multi-page build with no client router. A build plugin loads [`src/render.tsx`](../../apps/site/src/render.tsx) through a Vite SSR server and renders each page to static HTML with React and `@ai-checkout/ui`; the only shipped script is [`src/enhance.ts`](../../apps/site/src/enhance.ts) (keyboard-scrollable wide tables). The build copies the committed evaluation results and four release screenshots into `dist/`, so the results page always matches `docs/evals/`. The API serves `dist/` at `/` when `SITE_DIST_DIR` is set ([API](api.md)).

Verified 2026-10-03 on branch `s2-m10-docs-publish` (Stage 2 M10) by reading the code and running `npm test --workspace=@ai-checkout/site` (2 files, 10 tests, passing). Browser specs not run. Re-verified 2026-10-03 on `ui-ocean-theme` after merging `main` (`f383964`): site unit tests (10) and the site browser spec (6 passed, axe incl. the navy hero).

## Facts

| Path | Page ID | Content |
| --- | --- | --- |
| `/` | `home` | What the extension does at any https store, how it decides (the store list matched on the device, points valued by published estimates), screenshots (the 2.1.0 store screenshots), the cards covered (178 by issuer, `ISSUERS` in [`pages.tsx`](../../apps/site/src/pages.tsx), checked against `CATALOG_V3` by a test) and the stores (any https store; more than 600 named); the install card stays "Coming soon" until the listing exists |
| `/results/` | `results` | Evaluation tables and charts from `results.json`, and the 173-card expansion section from `expansion.json`: the gpt-5.5 cross-model row, the luna upper bound and the same configuration's 7-card held-out score, with the not-comparable caveat ([Evaluation](evaluation.md)) |
| `/architecture/` | `architecture` | Two-systems diagram (inline SVG, [`Diagram.tsx`](../../apps/site/src/Diagram.tsx)) and harness summary |
| `/privacy/` | `privacy` | **The published privacy policy** ([`docs/release/privacy-policy.md`](../../docs/release/privacy-policy.md) is its markdown copy): what stays on the device, what the badge reads on web pages, the catalog and merchant requests, usage reports (random identifier, the dictionary's events, 90 days ([retention](database.md#telemetry-phase-152)), Stop sharing, Delete my data, the Limited Use statement), the vault, retention and deletion, children and rights, this site. Operator Evan Liu; contact `SUPPORT_EMAIL_TBD` until Evan supplies one |
| `/support/` | `support` | Getting started (consent step included), common issues (rates view, checking, expired, payment pages, Suggest and Report), usage reports, deleting data, limitations, reporting a problem ([`docs/release/support.md`](../../docs/release/support.md)) |
| `/credits/` | `credits` | Data sources and licences: the Oklahoma CC BY 4.0 notice verbatim from [`NOTICE.md`](../../evals/merchants/db/mcc/NOTICE.md) with DC and GSA (CC0) and the Visa manual reference, NerdWallet valuations, Helios and the fonts. Linked from the footer of every page (`OTHER_PAGES` in [`Layout.tsx`](../../apps/site/src/Layout.tsx)), not from the navigation |
| `/uninstalled/` | `uninstalled` | The page Chrome opens after an uninstall (`chrome.runtime.setUninstallURL`, hosted builds, no parameters): what Chrome removed from the device, that reports already sent expire within 90 days, that Delete my data had to be used before uninstalling. Not in the navigation |

| Copied at build (`COPIED` in [`vite.config.ts`](../../apps/site/vite.config.ts)) | From |
| --- | --- |
| `results/results.json`, `results/results.svg`, `results/results-heldout.svg`, `results/expansion.json` | `docs/evals/` |
| `media/1-wallet.png` … `media/4-subtotal.png` | release screenshot assets |

| Item | Value |
| --- | --- |
| Dev server | `npm run dev --workspace=@ai-checkout/site` → `http://127.0.0.1:5180` |
| CSP | `SITE_CSP` in [`public-site.ts`](../../apps/api/src/public-site.ts): `script-src 'self'; style-src 'self'; connect-src 'self'` — no inline styles or scripts allowed |
| Caching | `/assets/*` immutable for a year; HTML and copied data `no-cache` |

## How it works

1. `vite build` enumerates `PAGES` and calls `renderPage(id)` for each, producing `{head, body}` injected into the HTML shell ([`Layout.tsx`](../../apps/site/src/Layout.tsx)).
2. [`results.ts`](../../apps/site/src/results.ts) reads the copied `results.json` and [`Chart.tsx`](../../apps/site/src/Chart.tsx) renders tables; the SVG charts are the committed files.
3. Styles use theme tokens only ([`site.css`](../../apps/site/src/site.css)); the home intro is a navy hero block with the install card beside it.

## Gotchas

- Pages must not need inline style or script; the CSP blocks them and the browser test fails on any CSP violation.
- The site can never answer `/v1`, `/review` or `/health` (see [API](api.md#gotchas)).
- Updating eval numbers means regenerating `docs/evals/results.json` (`npm run eval:summarize`) and rebuilding the site; nothing is fetched at runtime.
- The home page's "What you see" screenshots are copied at build time from the Web Store screenshots 1–4 (`COPIED` in `vite.config.ts`: wallet, badge, rates, comparison, 1280×800), so regenerating the [release media](../ops/release-media.md) updates them; their alt text and captions live in `SCREENSHOTS` in `pages.tsx` and must describe the images as cropped. Last regenerated 2026-10-20 for the 2.1.0 hosted build. The support page's getting-started steps describe the card search and questions.
- The privacy and support pages describe extension behaviour; when the extension changes (for example the [Cart badge](cart-badge.md) or [usage reporting](extension.md#usage-reporting-phase-153)), these pages, their markdown copies in `docs/release/` and the store listing need a matching edit, and the 15.7 reviewer pass checks they agree with the consent copy and the dictionary. `scripts/lib/release-docs.test.mjs` (in `npm test`) refuses the retired three-store wording and any form of "anonymous" in `apps/site/src` and the release docs, and `node scripts/check-release-docs.mjs --release` also refuses `SUPPORT_EMAIL_TBD` and "Evan to confirm" ([decision](../decisions/2026-10-20-release-docs-choices.md)).

## Tests

- `apps/site/tests/pages.test.tsx` (every page in `ALL_PAGES` has one h1 and the footer credits link, only navigation pages mark `aria-current`; no page names the three-store flow, savings or order confirmation; the privacy page names the badge's reads, both requests, usage reports under "A random identifier, no name, email or browsing history", 90 days, Stop sharing, Delete my data and the Limited Use statement, and no page uses "anonymous"; the credits page carries the Oklahoma publisher line, "Creative Commons Attribution 4.0 (CC BY 4.0)", the non-endorsement, DC, GSA, CC0, Visa, NerdWallet and the font licence; the uninstalled page names the 90-day expiry and Delete my data), `tests/results.test.ts`: data and markup checks.
- `apps/site/e2e/a11y.spec.ts`: starts the built API with `SITE_DIST_DIR`, runs axe (WCAG 2.0/2.1 A and AA) on every page of `ALL_PAGES` (the credits and uninstalled pages included) at 1280 and 390 px, and fails on horizontal scroll, broken images or CSP violations. Runs in "Application checks" CI.

## Related

* [API](api.md)
* [UI library](ui-library.md)
* [Evaluation](evaluation.md)
* [Architecture](architecture.md)
