---
type: Decision
title: "Phase 15.6b: the shopper demo is a motion graphic (HTML/CSS composition, every frame a function of t, rendered with the repository's Playwright and ffmpeg), not a screen recording; the recording pipeline for the demo retired"
description: Evan asked on 2026-10-22 for the store and README demo to be a motion graphic rather than a screen recording. The demo is now a 55-second (38 s before the independent review's pacing fix), 1920×1080 master and 1280×720 web copy rendered from one self-contained HTML composition with no new dependency; it illustrates the product with recreated, simplified UI and is not bound to the extension ZIP, while the five screenshots stay real captures bound to it.
status: accepted
tags: [decision, phase-15, release, media, video]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T03:00:00Z
sources:
  - resource: ../../docs/release/assets/motion/script.md
    title: Motion demo script (scenes, timings, verbatim text)
  - resource: ../../extension/scripts/render-motion-demo.mjs
    title: Motion demo renderer
  - resource: 2026-10-20-store-assets-choices.md
    title: Phase 15.6 store assets choices (fictional stores only)
  - resource: ../../docs/release/privacy-policy.md
    title: Privacy policy (what the demo may claim)
---

# Phase 15.6b: the shopper demo as a motion graphic (2026-10-22)

## Context
The 15.6 shopper demo was a 38.4 s Playwright recording of one 880×660 tab placed beside caption panels in a 1280×720 frame. It was honest but small and slow to read: the UI ran at its real size in two thirds of the frame, the story lived in a caption column, and first run and consent took a third of the time. Evan wants the README and store demo to be a motion graphic. The [fictional-stores amendment](2026-10-20-store-assets-choices.md#amended-after-the-independent-review-2026-10-20) still applies: no real retailer, logo or layout. Claims must stay within the [privacy policy](../../docs/release/privacy-policy.md) and the store listing.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| **HTML/CSS composition driven by `renderFrame(t)`, screenshotted per frame by the repository's Playwright Chromium and encoded by the local ffmpeg** | Chosen | No new dependency; the Ocean tokens, Bricolage Grotesque and Figtree and the cart mark are used straight from the repository; deterministic by construction once each frame starts from a fresh copy of the authored DOM; the same tools already render the store images |
| Remotion | Rejected | Adds React rendering, its bundler and Remotion's own licence terms to a repository that needs one 38-second piece; the frame-function model it offers is a few dozen lines here |
| Keep the recording, re-cut with zooms and larger captions | Rejected | Still a real-size UI in a fraction of the frame; zooming a recording blurs text; every change needs a full recapture |
| After Effects or another desktop tool | Rejected | Not reproducible from the repository; binary project files; fonts and colours drift from the tokens |
| CSS animations or Web Animations with Playwright's video recorder | Rejected | Real-time capture drops and duplicates frames and is not repeatable; the frame-by-frame screenshot is |

## Decision
- **Script first** ([`motion/script.md`](../../docs/release/assets/motion/script.md)): 1920×1080 at 30 fps, 38.0 s (1,140 frames), six scenes (hook 0–5.5 s, the badge 5.5–12, why 12–19, amounts only when certain 19–25.5, trust 25.5–33, end card 33–38) with verbatim on-screen text, the facts allowed, and what must not be invented (savings history, order tracking, "anonymous", "nothing is sent", "cards never leave your device", a store URL).
- **Composition** [`docs/release/assets/motion/composition.html`](../../docs/release/assets/motion/composition.html): the badge pill, amount view and rates view recreated from screenshots 2 and 3 at about 1.6× and simplified (no amount field, payment method, disclosures or footer); the sample wallet and the engine's numbers for it (Freedom Unlimited $3.00 at Sample Kitchen; Double Cash $2.00, Quicksilver $1.50, Blue Cash Everyday $1.00; at `shop.example.com` with a −$25.00 gift card, Blue Cash Everyday 3%, Double Cash 2%, Quicksilver 1.5%, Freedom Unlimited 1.5%). Amounts count up; rates are revealed, never counted, so a paused frame never shows a rate a card does not have. A label in scenes 1–4 and the end card's fine print say it is an illustration with sample cards and a fictional store.
- **Determinism:** every frame is `renderFrame(t)` on a fresh clone of the authored DOM. Without the clone, Chromium's layer and raster state carried over between frames (text anti-aliasing differed between a frame reached directly and the same frame reached in sequence, even with `will-change` removed); with it, direct, sequential and evaluate-only renders are byte-identical, and two full renders gave identical MP4, poster and caption bytes. The manifest records a digest of all frame hashes and six key-frame hashes; `--check` re-renders the key frames and compares.
- **Outputs:** `shopper-demo.mp4` (1280×720, the README and gallery copy, filename kept so links keep working), `motion/shopper-demo-1920x1080.mp4` (master), `shopper-demo-poster.png` (17.0 s), `shopper-demo.vtt` (one scene description per scene, for the gallery's player and screen readers; the frames read without it), `motion/motion-manifest.json`. `npm run release:motion` renders them; `release:media` does not (the demo is independent of the ZIP) but `render-release-assets.mjs` refuses to build the gallery if the demo's files differ from its manifest, and `verify-release-assets.mjs` checks their hashes, the poster, playback and the cue count.
- **Retired:** the demo recording in `release-assets.spec.ts` and its `RELEASE_ASSETS_ONLY=screenshots` reuse path, the caption composition in `render-release-assets.mjs`, `shopper-demo.webm` and `demo-chapters.json` (in git history). The five screenshots' pipeline is unchanged and re-rendered byte-identically.

## Consequences
- The demo no longer proves anything about the built extension; the README, gallery, assets README and portfolio doc say so. The screenshots remain the evidence.
- When the UI or the sample numbers change, the composition must be edited by hand; the script lists what to check. The end card's "Coming soon to the Chrome Web Store" is a placeholder to replace with the listing URL at 15.7 (then rerun `npm run release:motion`).
- The Web Store takes a video only as a YouTube link; uploading the master is Evan's step. GitHub plays a README video inline only from a `user-attachments` upload, also Evan's.
- `verify-release-assets.mjs` still fails at its first check on `main` since 15.5b changed the extension after the 15.6 captures (the hosted ZIP is no longer `f5a27208…e501`); this is unchanged by 15.6b and resolves when `npm run release:media` runs on the submitted ZIP (15.7). 15.6b ran the verifier's remaining checks with the ZIP binding skipped.

## Amended after the independent review (2026-10-22)
An independent Opus reviewer (agent-verified, not the implementer) rendered stills every 0.3–0.6 s around each scene change and checked every on-screen claim against the extension source, screenshots 2 and 3, the privacy policy and the store listing. Kept as they were: "Works at any U.S. online store." (the listing's own wording; the badge runs on https pages, which is every online checkout), "178 cards; checks for updates weekly", "No model at checkout…", "Your cards are saved in your browser. No card numbers, no bank login.", every rate and amount (the sample wallet's engine numbers as screenshots 2 and 3 show them), the fictional stores on reserved domains, the end card's placeholder. Fixed on the branch:
- **Determinism:** `--check` failed about one run in three on the trust key frame: GPU rasterization changed one pixel of a static frame between renders. The renderer now launches Chromium with `--disable-gpu-rasterization`; five consecutive `--check` runs and two full renders were byte-identical.
- **Pacing:** the trust scene showed about 39 new words in its last 3.5 s (about 10 words a second) and the three facts left after 3.2 s. The demo is now 55.0 s (1,650 frames): the rates view holds 1.5 s longer (scene 4 19–27 s), the trust scene (27–48 s) has two beats (the pipeline 27–36 s, then the three facts one every 3.6 s, 36–48 s, at 44 px), the end card 48–55 s. Seven key frames (4.5, 10.5, 17.0, 25.0, 34.0, 46.0, 53.0 s).
- **Truth:** the rates view ended its intro with "unless a condition below applies" but showed no condition; it now shows the spend-cap note the real view shows (screenshot 3). "Usage reports only if you choose Share." was literally true in the policy's terms but read as "nothing leaves without Share", while Suggest and Report send the store's domain either way; the line now adds "Tapping Suggest or Report sends the store’s domain." The other cards' "$… less" appears only after their amount has counted to its value, so a paused frame never pairs a difference with an intermediate amount.
- **Legibility:** interface text under the script's 20 px floor (item quantities 18 px, cart meta, "less" and rate lines 19 px) raised to 20 px. The renderer's contact sheet tiles 6×5 so it covers the whole demo.
- Outputs: `shopper-demo.mp4` 1,580,198 bytes `beffcfeb…90b2`, master 2,960,709 bytes `4e11e034…219a`, poster `04f0ec80…b7fc`, VTT `abae23f3…d190`, frame digest `954f39f2…a69b`. The gallery, `assets-manifest.json` and `verification.json` (ZIP binding still skipped, as stated in its note) were regenerated.

## Status
Accepted 2026-10-22 by the implementer on Evan's request; independently reviewed and amended the same day (agent-verified, Opus reviewer; see the amendment above, which supersedes the timings, key-frame count and trust-scene text in Decision).
