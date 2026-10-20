---
type: Decision
title: Phase 15.6 implementer choices: 1280×800 captures at one pixel per CSS pixel from the hosted build, the popup as a page in a tab, a fictional named store (Lidl replaced in review), the badge panel shown as an 800-pixel window shows it, the shopper demo re-recorded in one tab, the README embed retired, no marquee
description: How the 2.1.0 store media were captured and composed, which store they name (a fictional one, after the review), why the popup is captured as a page rather than from the toolbar, why the badge panel is shown with its lower rows below the fold, and what happened to the README demo video.
status: accepted
tags: [decision, release, media, web-store, phase-15]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-20T23:40:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan, row 15.6 and section 6
  - resource: ../../extension/e2e/release-assets.spec.ts
    title: Release media capture and recording
  - resource: ../../extension/scripts/render-release-assets.mjs
    title: Store image and video composition
  - resource: ../../docs/release/assets/README.md
    title: Release media packet
  - resource: https://developer.chrome.com/docs/webstore/images
    title: Chrome Web Store image requirements (checked 2026-10-20)
---

# Phase 15.6 implementer choices (2026-10-20)

## Context
Milestone 15.6 regenerates the Web Store media for 2.1.0: five 1280×800 screenshots (card search, the badge's amount view at a store the release names with its evidence line, the rates view, the popup comparison with the rule in the issuer's words, the consent screen), the promo tile re-bound to the 2.1.0 ZIP, the asset manifest and README, the site's copied screenshots with matching alt text, and the shopper demo re-recorded or retired. Constraints: fixture pages must not imitate a retailer; alt text must describe the crop (the 2026-10-03 review's rule); the consent screen exists only in builds with usage reporting; the 2.0.0 media were 640×400 crops of the native toolbar popup. Chrome's image page (checked 2026-10-20) prefers 1280×800 full-bleed screenshots, requires the 440×280 tile, and calls the 1400×560 marquee optional, asking for an image without text.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| **Capture everything at one image pixel per CSS pixel: window captures at 880×800 (badge, consent), the popup page at 360×600, a 400 px presentation column on the left** | Chosen | The expanded badge panel with four cards is about 1,300 CSS px tall and the consent card about 730, so no 2× composition can show them whole in 800 image pixels; at 1× the rates view and consent screen fit entirely and the popup is shown whole at Chrome's popup size, with no crop to justify. Text is smaller in the listing's carousel than a 2× crop would be |
| Popup scenes at 2× (360×400 CSS crops) and badge scenes at 1× | Rejected | Two densities in one set reads as two sizes of the same 360 px UI; the 1× set is uniform and needs no scroll trick for the popup beyond the existing edge check |
| Native toolbar popup via CDP (as in 2.0.0) | Rejected | Capturing at 1× it is pixel-identical to the popup page in a tab, which Playwright drives with role selectors; the 2.0.0 README recorded that enlarged native-target captures tiled. The packet says the popup is the popup page in a tab, not a toolbar capture |
| Lidl (`lidl-us`, `definition` basis, supermarket) as the store the release names, served the fictional sample cart at `https://www.lidl.com/cart` | Chosen by the implementer; **superseded in review** (below) | The evidence line needs a release record with a category and a non-default basis; a `definition` record reads "Treated as a supermarket (its own pages; fits … supermarket definition)". Only the name the extension renders appears; the page is the neutral two-column sample cart with no logo, colours or layout of any retailer |
| **A test release naming a fictional store** | Rejected by the implementer; **chosen in review** (below) | More machinery (a cached fixture release) to avoid a name that the shipped release already renders at that host; the plan allows the name |
| **Sample wallet of four cards (Double Cash, Quicksilver, Freedom Unlimited, Blue Cash Everyday)** | Chosen | Blue Cash Everyday wins cleanly at both stores. Blue Cash Preferred was dropped: its supermarket cap has no spend input in the editor (the catalog's own merchant list covers no supermarket, so `usageInputs` omits it), so at Lidl it shows a $1.00–$6.00 range and the ranking note instead of a winner |
| **The amount-view panel as an 800 px window clamps it, lower rows below its fold** | Chosen | The panel's natural height exceeds any window of this size; the clamp and scroll are the shipped behaviour, and the alt text and README say the rows after Double Cash are below the fold. The composition never cuts a line itself |
| **Rates view triggered by a gift-card row** | Chosen | A credit row beside the total makes the reader withhold (`credit-unclear`), a realistic reason; two differing totals (the e2e trick) would look like a broken store page |
| **The hosted build (`build:hosted`) is the media's artifact; the catalog origin resolved to 127.0.0.1 with `--host-resolver-rules`; Not now on the consent screen** | Chosen | The consent screen exists only with `VITE_TELEMETRY`; the submitted ZIP is the hosted build. Worker fetches bypass `context.route`, so the install-time refresh is made to fail locally and no report can leave; Not now records a declined consent with no identifier and an empty queue (asserted) |
| **Shopper demo re-recorded as one tab at 880×660 (first run and consent, badge at Lidl, rates view, popup comparison), 35.6 s, composed at 1280×720** | Chosen | Playwright's recording exists; one page keeps one video file; the old 41 s recording showed the three-store flow, locking and deletion |
| **README: the `user-attachments` embed and `docs/readme/demo.mp4` retired; the header links the regenerated `shopper-demo.mp4`** | Chosen | The embed showed the three-store flow and savings history and can only be replaced by an upload Evan makes in the GitHub web UI; the 9.5 MB source copy was not reproducible from the repository. Evan can upload the new MP4 and restore an inline player later |
| Marquee 1400×560 | Skipped | Optional, only for featuring, and Chrome asks for an image without text; the brand tile is text and mark |

## Decision
As chosen above. `release-assets.spec.ts` captures five frames (`consent`, `badge`, `rates`, `wallet`, `comparison`) from the hosted `dist` whose files match the inventory, requires `catalogOrigin` in the inventory, checks the Lidl record's category and basis, asserts the session store holds only the store id and host (no path or page text) and that Not now left no identifier, then records the demo. `render-release-assets.mjs` composes `N-name-1280x800.png` with a 400 px Ocean panel and the untouched capture, the 1280×720 MP4 with captions, the VTT, the gallery and `assets-manifest.json`. `verify-release-assets.mjs` expects five 1280×800 frames and the composed video's own size. `scripts/build-release-media.mjs` builds `build:hosted`. The fixtures are `extension/tests/fixtures/sample-cart.html` and `sample-cart-gift-card.html` (`mock-cart.html` removed). The site copies screenshots 1–4 (wallet, badge, rates, comparison) with alt text written from the crops.

## Consequences
- The media are bound to ZIP `f5a27208…e501` (hosted build of `main` plus this branch); the 15.R renewal changes the bundled catalog, so `npm run release:media` must run again before 15.7 and the hash in `assets/README.md` updated. The verifier passes only while `extension/dist` is that hosted build (a plain `npm run build` overwrites it).
- The badge panel's clamp at 800 px is visible in screenshot 2; a reviewer who wants every row visible needs a shorter panel or a taller window, not a different crop.
- Found, not fixed (not this milestone): a card whose capped bonus category is covered only by the merchant release (not the catalog's own merchant list), such as Blue Cash Preferred's supermarket cap, gets no spend input in the editor, so at a release supermarket it always shows a range. Worth a Phase 17 look.
- The README has no inline player until Evan uploads the new MP4 through the GitHub web UI; the decision of 2026-10-05 on the README video is superseded for the video (the SVG diagrams stand).

## Status
Accepted 2026-10-20 by the implementer (agent-verified by the gates), amended 2026-10-20 by the independent Opus reviewer (agent-verified).

## Amended after the independent review (2026-10-20)
- **No real retailer in listing media.** Screenshot 2 and the demo named Lidl and served the fake cart at `www.lidl.com/cart`. Promotional media that name a real retailer can read as an endorsement claim or trademark use (Chrome Web Store impersonation and intellectual-property policy: do not represent a product as "endorsed by" another company), and the plan's rule is that fixtures must not look like a real retailer. The capture now caches a **test copy of the bundled store list** in each capture profile (`checkoutMerchantsV1`, sequence 1, version `2026-10-11.media-sample.1`, verified with the bundled release so the cache is in effect on a tie, parsed with `publishedMerchantReleaseSchema`): the bundled 640 records plus one fictional record, **Sample Grocery** (`sample-grocery-us`, host `sample-grocery.example`, a reserved domain; supermarket, `definition` basis citing a fictional store page and the four issuer definitions Lidl's record cites), so the evidence line reads exactly as a real one does. The spec asserts that no shipped record matches the host. The panel says "Based on $100.00 cart estimated total at Sample Grocery", the left column of screenshot 2 says the store is fictional, and the README, manifests and demo caption say the record exists only in the test copy. Card product names stay (the extension is about them; no issuer logos appear).
- **The sample cart is one 440 px column**, so the order summary is visible beside the badge panel: screenshot 2 shows the $100.00 total the badge read, and screenshot 3 shows the −$25.00 gift-card row that makes the reader withhold, which the 2-column page hid behind the panel.
- **Alt text** in `assets-manifest.json`, the gallery and the site's `SCREENSHOTS` now describes the whole 1280×800 image (the presentation column's heading and copy, then the capture); the inner capture's alt is unchanged in kind.
- **Demo caption** "Not now: nothing about your use is sent" became "Not now: no usage reports are sent" (the two taps still send a domain when tapped). The demo is now 39.2 s.
- Kept: the badge panel's clamp at 800 px (the shipped scroll behaviour; no window size of a 1280×800 image at 1× avoids it, and scrolling the panel would hide the evidence line); the 440×280 tile's brand name (Chrome's page says to avoid text in the tile; the name and mark are the brand, decided 2026-10-03).
