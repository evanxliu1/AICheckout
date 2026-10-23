---
type: Runbook
title: Release media
description: Pointer to the npm scripts that regenerate store and portfolio media, with their prerequisites.
status: stable
tags: [ops, release, media]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
sources:
  - resource: ../../package.json
    title: release:media and release:portfolio scripts
  - resource: ../../scripts/build-release-media.mjs
    title: Release media build
  - resource: ../../scripts/build-portfolio-demo.mjs
    title: Portfolio demo build
  - resource: ../../extension/scripts/render-release-assets.mjs
    title: Store screenshot and gallery composition
  - resource: ../../extension/scripts/render-motion-demo.mjs
    title: Shopper demo motion graphic renderer
  - resource: ../../docs/release/assets/motion/script.md
    title: Shopper demo script
  - resource: ../../extension/e2e/release-assets.spec.ts
    title: Release media capture and recording
---

# Release media

Three npm scripts regenerate media under `docs/release/assets/`. Rerun the relevant one whenever a UI change alters what the screenshots or videos show, so the pinned hashes match. What the assets are and how they are used is documented in [`docs/release/assets/README.md`](../../docs/release/assets/README.md), outside the wiki. `release:media` was last run on 2026-10-20 (Phase 15.6, branch `phase15-6-store-assets`) for extension 2.1.0; `release:motion` on 2026-10-22 (Phase 15.6b, branch `phase15-6b-motion-demo`); `release:portfolio` on 2026-10-03 (branch `release-media-ocean`), and the curation side it records is unchanged since.

| Script | Runs | Prerequisites |
| --- | --- | --- |
| `npm run release:media` | [`scripts/build-release-media.mjs`](../../scripts/build-release-media.mjs): renders brand assets, builds the **hosted** extension (`build:hosted`, since 15.6: the consent screen exists only with usage reporting) and packages it, runs `extension/e2e/release-assets.spec.ts` (`RELEASE_ASSETS=1`, the five captures only), renders the screenshots, gallery and `assets-manifest.json`, and verifies the packet (the motion demo's hashes and playback included, not re-rendered) | `ffmpeg` and `ffprobe` on `PATH`; Playwright Chromium; must be started via `npm run` |
| `npm run release:motion` | [`extension/scripts/render-motion-demo.mjs`](../../extension/scripts/render-motion-demo.mjs): renders the shopper demo motion graphic from `docs/release/assets/motion/composition.html`, 1,650 frames at 1920×1080 (software rasterization), one ffmpeg pass to the master and the 1280×720 `shopper-demo.mp4`, the poster, the VTT and `motion/motion-manifest.json` (about 3 minutes). `-- --stills` or `-- --at 3,9.5` writes PNG stills to `/tmp/aicheckout-motion-stills`; `-- --check` re-renders the seven key frames and compares them with the manifest | `ffmpeg` and `ffprobe`; Playwright Chromium; root dependencies installed (the fonts come from `node_modules/@fontsource-variable`). Not bound to the extension ZIP; after it, run `node extension/scripts/render-release-assets.mjs` so the gallery and asset manifest pick up the new hashes |
| `npm run release:portfolio` | [`scripts/build-portfolio-demo.mjs`](../../scripts/build-portfolio-demo.mjs): builds API and review app, runs the review `e2e/portfolio-demo.spec.mjs` (`PORTFOLIO_DEMO=1`), then `scripts/render-full-stack-demo.mjs` | `ffmpeg` and `ffprobe`; Playwright Chromium; local Supabase stack already running at `http://127.0.0.1:54321` (`npm run db:start:api`); must be started via `npm run` |

## Current media

- Five store screenshots at 1280×800 ([decision](../decisions/2026-10-20-store-assets-choices.md)): `1-wallet` (the popup's card editor with a "Savor" search), `2-badge` (the amount view expanded at the fictional restaurant Sample Kitchen with the evidence line; Freedom Unlimited's dining rule wins), `3-rates` (the rates view where a gift card is applied, visible on the page), `4-comparison` (the popup comparison at the generic store), `5-consent` (the onboarding consent screen). Every image is one pixel per CSS pixel: a 400 px Ocean presentation column (`#0c2a4d`, soft text `#a9c6ea`, Bricolage Grotesque and Figtree embedded from `@fontsource-variable`) beside the untouched capture: the extension in an 880×800 window (badge scenes, consent) or the popup page in a tab at 360×600, placed whole. Bound to the hosted-build ZIP SHA-256 `f5a27208…e501` (catalog `2026-10-05.renewal.1`, store list `2026-10-11.mcc.3`).
- Captures: `release-assets.spec.ts` needs `dist` to be the hosted build matching `artifacts/ai-checkout-2.1.0.inventory.json` (it asserts `catalogOrigin`), resolves that origin to 127.0.0.1 with `--host-resolver-rules` (worker fetches bypass `context.route`) and blocks all other page traffic except the two fixtures `extension/tests/fixtures/sample-cart.html` (served at `https://www.sample-kitchen.example/cart`; each capture profile caches a test copy of the bundled store list with one fictional `definition`-basis dining record for that host, selling no physical goods, so the panel shows "Treated as a restaurant …" and the winning rule is the dining rule it explains; no real store is named, [amendment](../decisions/2026-10-20-store-assets-choices.md#amended-after-the-independent-review-2026-10-20)) and `sample-cart-gift-card.html` (at `https://shop.example.com/cart`; the credit row makes the reader withhold). Sample wallet: Double Cash, Quicksilver, Freedom Unlimited, Blue Cash Everyday with $0 online-retail spend (Blue Cash Preferred shows a range at a release supermarket because its cap has no spend input). The popup scenes keep the `fitCrop` rule: the popup is scrolled (never the pixels) by the smallest amount that leaves no text line, row, chip or control cut at its 600 px edge or the top; the comparison first anchors the result card. The badge's amount panel is clamped by the 800 px window and scrolls, so its rows after Double Cash are below the fold; the alt text says so.
- Shopper demo ([decision](../decisions/2026-10-22-motion-graphic-shopper-demo.md)): a **motion graphic illustrating the product**, not a recording. Script: [`docs/release/assets/motion/script.md`](../../docs/release/assets/motion/script.md) (six scenes with timings and verbatim text, facts allowed, what must not be invented). 55.0 s at 30 fps; `shopper-demo.mp4` 1280×720 (about 1.6 MB), master `motion/shopper-demo-1920x1080.mp4` (about 3.0 MB), `shopper-demo-poster.png` (17.0 s), `shopper-demo.vtt` (six scene descriptions). The badge and its views are recreated in HTML/CSS from screenshots 2 and 3 with the sample wallet's engine numbers; both stores are fictional. Each frame is `renderFrame(t)` on a fresh clone of the authored DOM (without the clone, Chromium's layer state leaked between frames and changed anti-aliasing), rasterized in software (GPU rasterization changed one pixel in a static frame about one run in three); two full renders were byte-identical. Full-stack demo (2026-10-03): 59.5 s, 1280×960, about 2.5 MB, 11 chapters, 12 stills (`render-full-stack-demo.mjs`); its stills show the shared local database's state of that day, labelled local. The Web Store takes videos only as a YouTube link, so no upload limit applies.
- Not changed: the promo (440×280) and the toolbar icons use the Helios action blue of `extension/assets/cart-mark.svg` (`#2563eb`); `render-brand.mjs` re-rendered them on 2026-10-20 with identical bytes ([decision](../decisions/2026-10-03-keep-helios-blue-cart-mark.md)). No marquee image.

## README demo video

The README header links `docs/release/assets/shopper-demo.mp4` (link text "Shopper demo (motion graphic)"); the earlier inline upload showed retired features ([2026-10-05 decision](../decisions/2026-10-05-readme-demo-video-and-diagrams.md)). GitHub plays videos inline only from `user-attachments` URLs, so an inline player returns only when Evan uploads the new MP4 in the GitHub web UI and the README embeds that URL.

## Gotchas

- `release:portfolio` reuses the running local stack and never resets or migrates a database; start it first ([Local setup](local-setup.md#database-suite-docker)).
- Intermediate caption renders (`docs/release/assets/video-captions/`, `full-stack-captions/`) are gitignored.
- The motion demo is not bound to the ZIP, but its scenes state the sample wallet's amounts (Freedom Unlimited $3.00 at a restaurant, the rates at the gift-card store) and the end card has a "Coming soon to the Chrome Web Store" placeholder: if the engine's answers for that wallet change or the listing goes live (15.7), edit `motion/composition.html` and `script.md` together, rerun `npm run release:motion` and `render-release-assets.mjs`.
- `verify-release-assets.mjs` fails its first check on `main`: the media are bound to `f5a27208…e501`, a fresh hosted ZIP is `d1b513a8…1bbd` (15.5b changed the extension after the captures); 15.7's `release:media` on the submitted ZIP fixes it.
- The release media is bound to the bundled catalog, the bundled store list and the packaged ZIP: after the 15.R renewal or any extension change, rerun `npm run release:media` on the ZIP to be submitted and update the hash in `docs/release/assets/README.md` (last run 2026-10-20 for 2.1.0 with `2026-10-05.renewal.1`). `verify-release-assets.mjs` passes only while `extension/dist` is that hosted build; a plain `npm run build` or `test:package:browser` overwrites `dist` and the ZIP, so rebuild with `build:hosted` and `package` before verifying again.

## Related

* [Local setup](local-setup.md)
* [Helios design system decision](../decisions/2026-09-28-helios-design-system.md)
* [Ocean theme decision](../decisions/2026-10-02-ocean-theme.md): media regenerated in the Ocean look on 2026-10-03; the site's `/media/*.png` are copied from screenshots 1–4 by `apps/site/vite.config.ts`
* [Phase 15.6 store assets decision](../decisions/2026-10-20-store-assets-choices.md)
