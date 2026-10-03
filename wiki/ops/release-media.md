---
type: Runbook
title: Release media
description: Pointer to the npm scripts that regenerate store and portfolio media, with their prerequisites.
status: stable
tags: [ops, release, media]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T04:10:00Z
sources:
  - resource: ../../package.json
    title: release:media and release:portfolio scripts
  - resource: ../../scripts/build-release-media.mjs
    title: Release media build
  - resource: ../../scripts/build-portfolio-demo.mjs
    title: Portfolio demo build
  - resource: ../../extension/scripts/render-release-assets.mjs
    title: Store screenshot and shopper video composition
---

# Release media

Two npm scripts regenerate hash-pinned media under `docs/release/assets/`. Rerun the relevant one whenever a UI change alters what the screenshots or videos show, so the pinned hashes match. What the assets are and how they are used is documented in [`docs/release/assets/README.md`](../../docs/release/assets/README.md), outside the wiki. Both were last run on 2026-10-03 (branch `release-media-ocean`, from `ca0d10e`) for the Ocean theme and the 178-card catalog; both passed first time and needed no spec change.

| Script | Runs | Prerequisites |
| --- | --- | --- |
| `npm run release:media` | [`scripts/build-release-media.mjs`](../../scripts/build-release-media.mjs): renders brand assets, builds and packages the extension, runs `extension/e2e/release-assets.spec.ts` (`RELEASE_ASSETS=1`), renders and verifies the release assets | `ffmpeg` and `ffprobe` on `PATH`; Playwright Chromium; must be started via `npm run` |
| `npm run release:portfolio` | [`scripts/build-portfolio-demo.mjs`](../../scripts/build-portfolio-demo.mjs): builds API and review app, runs the review `e2e/portfolio-demo.spec.mjs` (`PORTFOLIO_DEMO=1`), then `scripts/render-full-stack-demo.mjs` | `ffmpeg` and `ffprobe`; Playwright Chromium; local Supabase stack already running at `http://127.0.0.1:54321` (`npm run db:start:api`); must be started via `npm run` |

## Current media (2026-10-03)

- Store screenshots 1–6 (640×400) show the Ocean popup and badge with card search; the presentation panel and video caption panel are Ocean navy (`#0c2a4d`, soft text `#a9c6ea`) in Bricolage Grotesque and Figtree, embedded from `@fontsource-variable` by `render-release-assets.mjs`. Bound to ZIP SHA-256 `0fbf73fc…af2f7`, catalog `2026-10-02.expansion.1`.
- Shopper demo: 37.1 s, 960×720 H.264, about 1 MB, 9 caption cues. Full-stack demo: 59.6 s, 1280×960, about 2.8 MB, 11 chapters, plus 12 stills (`full-stack-confirmation.png` is new: the publish dialog, added to the spec with the Helios review app). The Web Store takes videos only as a YouTube link, so no upload limit applies.
- Not changed: the promo (440×280) and the toolbar icons still use the Helios action blue of `extension/assets/cart-mark.svg` (`#2563eb`); `render-brand.mjs` renders them from that file and the Ocean decision did not restyle the icon. Changing them is a brand choice for Evan.
- The full-stack stills show whatever other drafts the shared local database holds (for example a local `2026-10-02.expansion.1` draft) and its release sequence; they are local state, not hosted.

## Gotchas

- `release:portfolio` reuses the running local stack and never resets or migrates a database; start it first ([Local setup](local-setup.md#database-suite-docker)).
- Intermediate caption renders (`docs/release/assets/video-captions/`, `full-stack-captions/`) are gitignored.

## Related

* [Local setup](local-setup.md)
* [Helios design system decision](../decisions/2026-09-28-helios-design-system.md)
* [Ocean theme decision](../decisions/2026-10-02-ocean-theme.md): media regenerated in the Ocean look on 2026-10-03; the site's `/media/*.png` are copied from screenshots 1–4 by `apps/site/vite.config.ts`
