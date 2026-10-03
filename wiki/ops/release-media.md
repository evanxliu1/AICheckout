---
type: Runbook
title: Release media
description: Pointer to the npm scripts that regenerate store and portfolio media, with their prerequisites.
status: stable
tags: [ops, release, media]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:05:00Z
sources:
  - resource: ../../package.json
    title: release:media and release:portfolio scripts
  - resource: ../../scripts/build-release-media.mjs
    title: Release media build
  - resource: ../../scripts/build-portfolio-demo.mjs
    title: Portfolio demo build
---

# Release media

Two npm scripts regenerate hash-pinned media under `docs/release/assets/`. Rerun the relevant one whenever a UI change alters what the screenshots or videos show, so the pinned hashes match. What the assets are and how they are used is documented in [`docs/release/assets/README.md`](../../docs/release/assets/README.md), outside the wiki. Prerequisites below are inferred from the scripts; neither was run for this page on 2026-10-02.

| Script | Runs | Prerequisites |
| --- | --- | --- |
| `npm run release:media` | [`scripts/build-release-media.mjs`](../../scripts/build-release-media.mjs): renders brand assets, builds and packages the extension, runs `extension/e2e/release-assets.spec.ts` (`RELEASE_ASSETS=1`), renders and verifies the release assets | `ffmpeg` and `ffprobe` on `PATH`; Playwright Chromium; must be started via `npm run` |
| `npm run release:portfolio` | [`scripts/build-portfolio-demo.mjs`](../../scripts/build-portfolio-demo.mjs): builds API and review app, runs the review `e2e/portfolio-demo.spec.mjs` (`PORTFOLIO_DEMO=1`), then `scripts/render-full-stack-demo.mjs` | `ffmpeg` and `ffprobe`; Playwright Chromium; local Supabase stack already running at `http://127.0.0.1:54321` (`npm run db:start:api`); must be started via `npm run` |

## Gotchas

- `release:portfolio` reuses the running local stack and never resets or migrates a database; start it first ([Local setup](local-setup.md#database-suite-docker)).
- Intermediate caption renders (`docs/release/assets/video-captions/`, `full-stack-captions/`) are gitignored.

## Related

* [Local setup](local-setup.md)
* [Helios design system decision](../decisions/2026-09-28-helios-design-system.md)
* [Ocean theme decision](../decisions/2026-10-02-ocean-theme.md): the committed release media predate it and the catalog v3 UI; after the merge rerun `release:media` (store screenshots, promo, shopper demo, and the site's `/media/*.png`, which `apps/site/vite.config.ts` copies from them) and `release:portfolio` (review app stills and video)
