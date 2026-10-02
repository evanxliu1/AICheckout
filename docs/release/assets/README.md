# Release media

Regenerated October 1, 2026 for extension 2.0.0 with the automatic cart badge (Phase 3b; passphrase protection optional) and catalog `2026-09-29.real.1`. Open [the gallery](index.html) to review the screenshots, promotion, icon inspection, recording and transcript together. This packet is not a submitted listing or evidence of live retailer/model behavior.

## Deliverables

| File | Use |
| --- | --- |
| [1-wallet-640x400.png](1-wallet-640x400.png) | The seven card products grouped by issuer, all selected as a sample |
| [2-comparison-640x400.png](2-comparison-640x400.png) | A synthetic $100 eligible Best Buy purchase: Blue Cash Everyday $3.00 with its rule in the issuer's words and conditions |
| [3-uncertainty-640x400.png](3-uncertainty-640x400.png) | Unknown annual spend toward the cap produces a $1.00–$3.00 range, so Double Cash leads at $2.00 |
| [4-subtotal-640x400.png](4-subtotal-640x400.png) | Controlled Newegg fixture explicitly excludes tax/shipping from its subtotal |
| [5-locked-640x400.png](5-locked-640x400.png) | Passphrase unlock after locking saved inputs (optional protection, turned on in Settings) |
| [6-badge-640x400.png](6-badge-640x400.png) | The automatic cart badge ("Use Blue Cash Everyday · $3.00 back") on a neutral sample cart with a $100.00 total; no retailer branding |
| [promo-440x280.png](promo-440x280.png) | Required small promotional brand image |
| [icon-inspection.png](icon-inspection.png) | Existing cart identity simplified for 16/48/128px exports; light/dark inspection |
| [shopper-demo.mp4](shopper-demo.mp4) | Actual offline extension-page walkthrough, with persistent sample-data labeling and timed explanations |
| [shopper-demo.vtt](shopper-demo.vtt) | Nine English caption cues; the gallery also has a text transcript |
| [full-stack-demo.mp4](full-stack-demo.mp4) | Actual local React/API/Auth/PostgreSQL review and publication flow with simulated model responses |
| [Full-stack transcript and evidence](full-stack-demo.md) | Eleven chapters, verified cleanup, source/build hashes and reproduction |

The screenshots are opaque 24-bit RGB PNGs at 640×400. The promotion is the same format at 440×280. The icon source is [cart-mark.svg](../../../extension/assets/cart-mark.svg); its 128px export uses 96px artwork with 16px transparent padding on each side. The prior gradient/text bitmap is replaced by a crisp cart mark in the existing action blue; no new product functionality is implied by that artwork.

Screenshots 1–5 combine a presentation caption with the top 400 CSS pixels of an actual 360px native-popup capture at its original pixel density. Screenshot 6 shows the actual packaged badge on a neutral sample cart page ([mock-cart.html](../../../extension/tests/fixtures/mock-cart.html), served in memory at a supported cart URL so the content script runs) at 360×400 CSS pixels. The interface text and geometry are not recreated or retouched. The full original captures are under `captures/`; the crop and source hash are recorded in [assets-manifest.json](assets-manifest.json). A full-height inspection view is not represented as a native popup. The left presentation panel and “sample inputs” label are outside the application UI.

The roughly 40-second MP4 is 960×720 H.264. It contains an actual 360×600 extension-page interaction recording at its original size alongside captions. The underlying [WebM](shopper-demo.webm) is retained for provenance; it has no presentation captions and is not the stand-alone public demonstration. This recording is not a native-toolbar video, a live merchant test, a full-stack review recording or live LLM evaluation. The shopper calculation remains offline, and both local/session stores were empty after confirmed deletion.

## Provenance and validity

The store images and shopper recording are bound to ZIP SHA-256 **`5f6a903cd03a6abbee10118723a2bcdab2b75a5a9235ef8eb6bf9fdedaf74879`**. [capture-manifest.json](capture-manifest.json) records the actual native target viewport, browser version, staged input descriptions, source hashes and artifact identity. [demo-chapters.json](demo-chapters.json) records timed explanations and the matching artifact; [verification.json](verification.json) records file-format/hash checks, desktop/mobile gallery checks, actual video playback and caption loading.

The full-stack recording has separate [source/build and cleanup evidence](full-stack-capture.json) and [media hashes/playback checks](full-stack-media.json); the extension ZIP does not identify the server or review app. It is 1280×960 H.264 and preserves the unscaled 1280×800 application with an explanatory footer. It uses local disposable accounts, invented terms and intercepted responses; it does not make a live model call or establish model quality. Its reproduction command is `npm run release:portfolio`, with the existing disposable local Supabase stack available. See [the complete procedure](full-stack-demo.md).

The Newegg image uses an intercepted in-memory fixture; all other HTTP traffic during native capture is blocked. No purchase, live retailer request, model call, deployment or store submission is performed by this workflow. Conditional estimates are not observed customer savings. Reverify terms and recapture if the intended artifact or catalog changes. The current terms expire October 25, 2026 UTC; do not edit dates to keep a demonstration running.

## Reproduce

Requires Node 24, the root workspace dependencies, Playwright Chromium, and local `ffmpeg`/`ffprobe` with H.264 encoding. From the repository root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/aicheckout-playwright npm run release:media
```

Use the browser path installed on your machine. This local command renders the vector icons/promotion, rebuilds and packages the extension, captures actual native UI, records the staged offline flow, composes the store images/video, and verifies the packet. It overwrites only the generated media, icon exports and normal build/package outputs. It does not publish. Reproducibility means a documented process with artifact provenance; byte parity across operating systems, font rasterizers and video encoders is not claimed.

The explicit media test is skipped by the normal browser suite. For a screenshot-only recapture of an unchanged ZIP, `RELEASE_ASSETS_ONLY=screenshots` may be used with the gated media test; it refuses to reuse a recording from a different artifact. Rendering alone never recaptures the underlying application. The verifier compares current ZIP, inventory, build, source captures and composed-file hashes before checking browser playback.

To preview captions over HTTP, serve this public-only asset directory locally rather than exposing the repository or credentials:

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory docs/release/assets
```

Open the local address printed by the server. Stop it when finished. File-based viewing can block caption loading; the included transcript remains readable. The verifier starts and closes its own temporary loopback server and writes inspection screenshots under `/tmp/aicheckout-release-media-inspection`.

Chrome's [image requirements](https://developer.chrome.com/docs/webstore/images) permit 640×400 or 1280×800 screenshots and require the small promotional image. The original-density 640px format was chosen because Chromium's enlarged native-target capture produced repeated tiles; those drafts were discarded. These assets still need the final [release gates](../README.md), accurate dashboard declarations and Google's review. No optional marquee or YouTube upload is claimed.

## Reproducing the pinned artifact

Generate release media only from a clean checkout of the commit being released, with a fresh install:

```sh
git worktree add --detach /path/to/clean-checkout HEAD   # or a fresh clone
cd /path/to/clean-checkout && npm ci && npm run release:media
```

A working copy with local edits, untracked files, or a non-`npm ci` install can produce a different ZIP and therefore a different pinned hash. The build does not depend on the checkout's location: the content script is bundled at a fixed path (see `extension/vite.config.ts`). The hash above was produced this way and reproduced by `npm ci && npm run build --workspace=ai-checkout-extension && npm run package --workspace=ai-checkout-extension` in a second fresh worktree at a different path.
