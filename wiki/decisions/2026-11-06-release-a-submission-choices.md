---
type: Decision
title: "Phase 15.7: submission choices (version stays 2.1.0, no listing video at first submission, deferred publishing, the ZIP's bundled releases checked against the API, EXTENSION_IDS and the proxy-hop count settled by Evan's dashboard step and an outside test, the telemetry-off build as the rejection fallback)"
description: The non-obvious choices in the 15.7 plan of 2026-11-06, planned while the hosted catalog was expired (since 2026-11-04) and the 15.R renewal was being prepared. Each is a recommendation Evan can overrule by a word in chat; a silent go adopts it.
status: accepted
tags: [decision, phase-15, release, web-store, submission]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-11-06T19:30:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan, section 9 (the 15.7 plan)
  - resource: https://developer.chrome.com/docs/webstore/publish
    title: Publish in the Chrome Web Store (deferred publishing, 30-day window; read 2026-11-06)
  - resource: https://developer.chrome.com/docs/webstore/prepare
    title: Prepare your extension (each upload needs a higher version; read 2026-11-06)
  - resource: https://developer.chrome.com/docs/webstore/review-process
    title: Review process (timing, rejection, appeal; read 2026-11-06)
  - resource: https://developers.cloudflare.com/fundamentals/reference/http-headers/
    title: Cloudflare HTTP headers (X-Forwarded-For appends, CF-Connecting-IP; read 2026-11-06)
  - resource: ../../extension/scripts/check-release-bundles.mjs
    title: The bundled-release check added by this plan
---

# Phase 15.7: submission choices (2026-11-06)

## Context

Milestone 15.7 puts the first Release A ZIP on the Chrome Web Store. On 2026-11-06 the hosted catalog had expired (`/v1/catalog` answers 503 since 2026-11-04T00:00Z), the 15.R renewal was being prepared in the main checkout, the five screenshots were bound to a ZIP two merges old, the motion demo's end card said "Coming soon to the Chrome Web Store", and a docs rewrite (`docs-official-tone`) was in flight. Evan's inputs are final (publisher Evan Liu, support `evanliu7788@gmail.com`, non-trader). The plan in [section 9 of the Phase 15 page](../product/phase-15-release-a.md#9-157-plan-submission-build-and-release-record-planned-2026-11-06) needed these calls.

## Options considered

| Question | Options | Chosen |
| --- | --- | --- |
| Extension version of the first upload | Stay `2.1.0` (nothing has been uploaded, so Chrome's "larger than the previous upload" rule has nothing to compare against); bump to `2.2.0` or `3.0.0` for the first public build | **Stay `2.1.0`.** Bump to `2.1.1` only if the draft package has to be replaced before submission or a rejection needs a new package, since the dashboard refuses a package whose version is not above the item's current one |
| Listing video and the demo's end card | (a) Submit without a YouTube video; after approval re-render the end card and add the video in a listing-only update; (b) re-render with the listing URL once the draft upload assigns the id, upload to YouTube, submit with the video; (c) render "Available on the Chrome Web Store" now | **(a).** Nothing false is committed or shown at any moment (the README links the repository's MP4), nothing is re-rendered during review, and the first review has one less field. The end card's "after" wording is **"Now on the Chrome Web Store"**: the 32-letter listing URL does not fit the 600 px end-card box at 28 px and is unreadable in motion, so the URL goes into the YouTube description, the site and the README |
| Publish on approval or defer | Automatic publication on approval; deferred publishing (manual Publish within 30 days of approval) | **Defer.** The site's install card, the READMEs and the end card still say the listing does not exist; Evan publishes once their update is merged and deployed, so the store link, the site and the demo go live together. Approval email arrives either way; the 30-day window is ample |
| Proving the ZIP bundles the renewed catalog | Trust the checkout (`CATALOG_V3` at the commit); read the version from the capture manifest (source-derived, as 15.6 did); read it from the archive itself | **Read it from the archive** (`extension/scripts/check-release-bundles.mjs`): the minified worker chunk keeps the object literals' key order, so the catalog and store-list headers are found in `assets/*.js` and compared with the repository constants and, with `--hosted`, with `/v1/catalog` and `/v1/merchants`. The release record cites its `--json` output |
| Who sets `EXTENSION_IDS` on Render | Coordinator through the Render dashboard or CLI; Evan in the dashboard | **Evan**, in the dashboard, with "Save and deploy". Nobody but Evan signs in to hosted services (directive 2026-09-28; the 2026-10-05 CLI-publish exception covers catalog releases only, and a Render API key would be a secret the agent must not hold). The coordinator verifies from outside: a wrong `Origin` gets 403 `origin_not_allowed`, the right one 400 on an empty batch |
| Confirming `TELEMETRY_PROXY_HOPS=1` | Read Render's documentation; read `CF-Connecting-IP` in the API instead (code change); test from outside | **Test from outside** (two networks, see the plan): Cloudflare fronts the service (`server: cloudflare` and `cf-ray` on every response, observed 2026-11-06) and appends the connecting address to `X-Forwarded-For`, and whether Render's own proxy appends a second entry is not documented. If the test shows a shared bucket, Evan sets the value to `2` and the test is repeated; moving the API to `CF-Connecting-IP` is a follow-up, not a 15.7 change. The failure mode is a shared bucket, never a bypass, as long as the count is not too high, which the forged-header half of the test rules out |
| Rejection fallback for the "strictly necessary" rule | Argue on appeal; drop telemetry from Release A | **Both, in order:** appeal once with the single-purpose text (every event measures or improves the answer); if the appeal fails, resubmit `2.1.1` from the build without `VITE_TELEMETRY` (no consent screen, no `/v1/events`), with the policy, listing and privacy tab reduced to the on-device handling and screenshot 5 dropped ([telemetry design decision](2026-10-19-release-a-telemetry-design.md)) |
| A guaranteed cart page for reviewers | Rely on "any cart page of a U.S. store"; serve the sample cart fixture on the site at a `/sample-cart/` path | **Recommended, Evan's call:** serve the fixture on the site so a reviewer who has no cart to hand can see the badge in one click; it is a static page under `apps/site` (the docs agent's area), outside the ZIP, so it changes no hash. Not a gate |

## Decision

The choices in the table, as the 15.7 plan's steps 3, 7, 12–14, 16 and 17 and its risk checklist state them. The 15.R renewal is published and merged before the ZIP is built, because `build:hosted` has no catalog switch: the ZIP bundles whatever `packages/rewards-core/src/catalog-v3.ts` holds at the commit (`pipeline run build --version <new>` rewrites it through `npm run catalog:v3`). The hosted ZIP hash is independent of `docs/`, `README.md` and `apps/site`, so the media, docs and site commits that follow the build do not change it; the release record cites the final `main` revision and the rebuild at that revision must reproduce the hash.

## Consequences

- One new script and its tests (`extension/scripts/release-bundles.mjs`, `check-release-bundles.mjs`, `release-bundles.test.mjs`; `npm run release:bundles:check`), run in the extension's `npm test`. No end-card swap script (two lines in `composition.html` and `script.md`, then `npm run release:motion`) and no release-record generator (the check's `--json` output holds the derivable facts).
- `docs/release/store-listing.md`'s "Pricing: Free" row names a field the dashboard no longer has (Chrome Web Store payments were retired; the Distribution tab holds visibility and regions only). The docs agent rewords it; not a wiki change.
- The first submission has no video, so `store-listing.md`'s "no YouTube video" stays true until the post-approval listing update.
- If Evan prefers the video on the first submission, option (b) applies: the end card is rendered after the draft upload and before Submit, and the YouTube upload is his.

## Status

Accepted 2026-11-06 (recommendations; a silent go from Evan adopts them). Supersedes nothing; the 15.6b decision's "replace the end card with the listing URL at 15.7" is narrowed to the wording above.
