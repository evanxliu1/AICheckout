---
type: System Component
title: Public site
description: apps/site — the static public pages (landing, results, architecture, privacy, support) pre-rendered with React at build time and served by the API at /.
status: stable
tags: [system, site, static]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T02:50:00Z
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

Verified 2026-10-03 on branch `s2-m10-docs-publish` (Stage 2 M10) by reading the code and running `npm test --workspace=@ai-checkout/site` (2 files, 10 tests, passing). Browser specs not run.

## Facts

| Path | Page ID | Content |
| --- | --- | --- |
| `/` | `home` | What the extension does, how it decides (including points valued by published estimates), screenshots, supported cards (178 by issuer, `ISSUERS` in [`pages.tsx`](../../apps/site/src/pages.tsx), checked against `CATALOG_V3` by a test) and checkouts |
| `/results/` | `results` | Evaluation tables and charts from `results.json`, and the 173-card expansion section from `expansion.json`: the gpt-5.5 cross-model row, the luna upper bound and the same configuration's 7-card held-out score, with the not-comparable caveat ([Evaluation](evaluation.md)) |
| `/architecture/` | `architecture` | Two-systems diagram (inline SVG, [`Diagram.tsx`](../../apps/site/src/Diagram.tsx)) and harness summary |
| `/privacy/` | `privacy` | What stays on the device, the only network request, cart reads |
| `/support/` | `support` | Getting started, issues, limitations |

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
3. Styles are Helios tokens only ([`site.css`](../../apps/site/src/site.css)).

## Gotchas

- Pages must not need inline style or script; the CSP blocks them and the browser test fails on any CSP violation.
- The site can never answer `/v1`, `/review` or `/health` (see [API](api.md#gotchas)).
- Updating eval numbers means regenerating `docs/evals/results.json` (`npm run eval:summarize`) and rebuilding the site; nothing is fetched at runtime.
- TODO(M7): the screenshots (`media/1-wallet.png` still shows the seven-card setup) show the pre-M7 UI; retake them in Stage 2 M10 part 2. The support page's getting-started steps describe the M7 card search and questions since the M7 merge (2026-10-03).
- The privacy and support pages describe extension behaviour; when the extension changes (for example the [Cart badge](cart-badge.md)), these pages need a matching edit.

## Tests

- `apps/site/tests/pages.test.tsx`, `tests/results.test.ts`: data and markup checks.
- `apps/site/e2e/a11y.spec.ts`: starts the built API with `SITE_DIST_DIR`, runs axe (WCAG 2.0/2.1 A and AA) on every page at 1280 and 390 px, and fails on horizontal scroll, broken images or CSP violations. Runs in "Application checks" CI.

## Related

* [API](api.md)
* [UI library](ui-library.md)
* [Evaluation](evaluation.md)
* [Architecture](architecture.md)
