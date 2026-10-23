# Release media

Regenerated 2026-10-20 (milestone 15.6) for extension **2.1.0**, the hosted build, in the Ocean theme: the badge at any https store through the generic cart reader, the store list matched on the device, card terms `2026-10-05.renewal.1` (178 cards) and store list `2026-10-11.mcc.3`, and usage reporting behind the one consent question. The shopper demo was replaced on 2026-10-22 (milestone 15.6b) by a motion graphic. Open [the gallery](index.html) to review the screenshots, promotion, icon inspection, demo and its scene descriptions together. This packet is not a submitted listing or evidence of live store or model behaviour.

## Deliverables

| File | Use |
| --- | --- |
| [1-wallet-1280x800.png](1-wallet-1280x800.png) | The popup's card editor: a search for "Savor" with its three matches above the four sample cards |
| [2-badge-1280x800.png](2-badge-1280x800.png) | The badge's amount view, expanded, beside a neutral sample cart (total $100.00) at a fictional restaurant, Sample Kitchen: "Based on $100.00 cart estimated total at Sample Kitchen", the evidence line for its restaurant category, and Freedom Unlimited $3.00 with its dining rule in the issuer's words, above Double Cash $2.00 |
| [3-rates-1280x800.png](3-rates-1280x800.png) | The rates view, expanded, at a store the release does not name: a gift card row (−$25.00) is applied on the visible order summary, so the reader withholds the amount and the cards are ranked by rate |
| [4-comparison-1280x800.png](4-comparison-1280x800.png) | The popup comparison of a $100 eligible purchase at "Another U.S. online store": Blue Cash Everyday $3.00 with the rule in the issuer's words, its conditions, and Double Cash below it |
| [5-consent-1280x800.png](5-consent-1280x800.png) | The consent screen of the first run, "Help improve AI Checkout", with what is sent and the equal Share and Not now buttons |
| [promo-440x280.png](promo-440x280.png) | Required small promotional brand image (unchanged artwork, re-rendered and re-bound) |
| [icon-inspection.png](icon-inspection.png) | The cart mark at 16/48/128 px on light and dark backgrounds |
| [shopper-demo.mp4](shopper-demo.mp4) | The shopper demo: a 55.0 s **motion graphic illustrating the product** (1280×720, 30 fps, H.264, silent); the screenshots are the real extension |
| [shopper-demo-poster.png](shopper-demo-poster.png) | The demo's poster frame (17.0 s, the ranked panel), 1280×720 |
| [shopper-demo.vtt](shopper-demo.vtt) | Six English cues, one scene description each; the gallery also lists them as a transcript |
| [motion/](motion/) | The demo's [script](motion/script.md) (scenes, timings, verbatim text), [composition](motion/composition.html), the 1920×1080 master and [render provenance](motion/motion-manifest.json) |
| [full-stack-demo.mp4](full-stack-demo.mp4) | The 2026-10-03 local review/API/Auth/PostgreSQL recording with simulated model responses (the curation side is unchanged by 2.1.0) |
| [Full-stack transcript and evidence](full-stack-demo.md) | Eleven chapters, verified cleanup, source/build hashes and reproduction |

The screenshots are opaque 24-bit RGB PNGs at 1280×800 (Chrome's preferred size); no marquee image is made (optional, and Chrome's guidance asks for an image without text). The promotion is the same format at 440×280. The icon source is [cart-mark.svg](../../../extension/assets/cart-mark.svg); its 128px export uses 96px artwork with 16px transparent padding on each side.

Every screenshot is one image pixel per CSS pixel. The left 400 px are a presentation panel (Ocean navy, Bricolage Grotesque and Figtree) outside the application UI; the right 880×800 are the untouched capture:

- Screenshots 2, 3 and 5 are the extension in an 880×800 window: the badge over the sample cart page, and the onboarding tab. The badge panel is as tall as such a window allows and scrolls inside, so in screenshot 2 the rows after Double Cash are below its fold (the alt text says so).
- Screenshots 1 and 4 are the popup page opened in a tab at the toolbar popup's own 360×600 size, placed whole and centred. Before each capture the test scrolls the popup (never the pixels) by the smallest amount that leaves no line of text, row, chip or control cut at the popup's edges; the scroll position is in the capture manifest. In a tab the popup has no store tab, so its Merchant is the generic store ("Another U.S. online store"), as at any store the release does not name.

The interface text and geometry are not recreated or retouched. The full original captures are under `captures/`; each image's source hash and composition are recorded in [assets-manifest.json](assets-manifest.json), and the alt text describes each image as cropped.

**Fixtures.** The store pages are [sample-cart.html](../../../extension/tests/fixtures/sample-cart.html) and [sample-cart-gift-card.html](../../../extension/tests/fixtures/sample-cart-gift-card.html): a fictional store with no retailer branding, logo or layout, served in memory at `https://www.sample-kitchen.example/cart` and at `https://shop.example.com/cart`, both reserved example domains. No real store is shown or named. So that the panel shows a store's evidence line, the capture profile caches a test copy of the bundled store list (`2026-10-11.mcc.3` plus one fictional record, "Sample Kitchen" on `sample-kitchen.example`, a restaurant selling no physical goods, like every bundled dining record, on the `definition` basis citing Chase's category page), validated with the extension's own schema; the shipped store list has no such record. Everything else the panel shows comes from the shipped catalog and engine. The sample wallet is Citi Double Cash, Capital One Quicksilver, Chase Freedom Unlimited and American Express Blue Cash Everyday, with Blue Cash Everyday's online-retail spend reported as $0.

**Shopper demo: a motion graphic illustrating the product; the screenshots are the real extension.** [shopper-demo.mp4](shopper-demo.mp4) (55.0 s, 1280×720, 30 fps, H.264 `yuv420p`, `+faststart`, no audio track) and its 1920×1080 master in [motion/](motion/) are rendered from [motion/composition.html](motion/composition.html): the badge, its amount view and its rates view recreated in HTML/CSS from the 2.1.0 screenshots, simplified for motion (no amount field, payment method, disclosures or footer), in the Ocean palette with the bundled Bricolage Grotesque and Figtree and the cart mark from `extension/assets/cart-mark.svg`. Six scenes, written first in [motion/script.md](motion/script.md): the question at a $100.00 cart at Sample Kitchen; the badge "Use Freedom Unlimited · $3.00 back" opening its panel; the store's category and the rule in the issuer's words with Double Cash $2.00, Quicksilver $1.50 and Blue Cash Everyday $1.00; the rates view at `shop.example.com` where a −$25.00 gift card makes the amount uncertain, with the spend-cap note the real view shows; terms kept current by an LLM with every change approved by a person; then, one at a time, no model at checkout, cards saved in the browser, and usage reports only with Share (with Suggest and Report sending the store's domain); the end card ("Works at any U.S. online store." and a "Coming soon to the Chrome Web Store" placeholder to replace with the listing URL at 15.7). The amounts and rates are the engine's for the sample wallet, as in screenshots 2 and 3. Both stores are fictional (reserved domains); no real retailer, issuer logo or card art appears. A label in the frame says it is an illustration. It replaces the 2026-10-20 one-tab screen recording ([decision](../../../wiki/decisions/2026-10-22-motion-graphic-shopper-demo.md)); the recording and its chapters file are in git history.

## Provenance and validity

The store images are bound to ZIP SHA-256 **`f5a272081c747c4392a1146240f3e446d1ecb70fe6b98a62a6a2535b1e91e501`** (`npm run build:hosted` then `npm run package`, catalog origin `https://ai-checkout-api.onrender.com`). [capture-manifest.json](capture-manifest.json) records the window and popup sizes, browser version, sample cards, the named store, the network rule and the source hashes; [verification.json](verification.json) records file-format/hash checks, desktop/mobile gallery checks, actual video playback and caption loading. The motion demo is **not bound to the ZIP** (it is illustrative): [motion/motion-manifest.json](motion/motion-manifest.json) records the composition, font and cart-mark hashes, the browser and ffmpeg versions, a digest of all 1,650 frame hashes, seven key-frame hashes and each output's hash, size, duration and format.

During capture all page traffic is blocked except the two in-memory fixtures (Playwright fulfils them before any DNS lookup), and the catalog origin is resolved to the loopback address (`--host-resolver-rules`), so the install-time refresh fails locally and no usage report can be sent; the consent screen was answered Not now, which records no identifier and queues nothing. No purchase, live store request, model call, deployment or store submission is performed by this workflow. Conditional estimates are not observed customer savings. Reverify terms and recapture if the intended artifact, catalog or store list changes. The bundled card terms expire 2026-11-04T00:00Z; the Release A ZIP bundles the renewal (milestone 15.R), after which `npm run release:media` must run again and this file's hash must be updated. Do not edit dates to keep a demonstration running.

The full-stack recording has separate [source/build and cleanup evidence](full-stack-capture.json) and [media hashes/playback checks](full-stack-media.json); it dates from 2026-10-03 and the extension ZIP does not identify the server or review app. Its reproduction command is `npm run release:portfolio`, with the disposable local Supabase stack available. See [the complete procedure](full-stack-demo.md).

## Reproduce

Requires Node 24, the root workspace dependencies, Playwright Chromium, and local `ffmpeg`/`ffprobe` with H.264 encoding. From the repository root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/aicheckout-playwright npm run release:media
```

Use the browser path installed on your machine. This local command renders the vector icons/promotion, builds the hosted extension (`build:hosted`) and packages it, captures the actual UI, composes the store images and gallery, and verifies the packet (the demo's hashes and playback included; it does not re-render the demo). It overwrites only the generated media, icon exports and normal build/package outputs. It does not publish. Reproducibility means a documented process with artifact provenance; byte parity across operating systems, font rasterizers and video encoders is not claimed.

The explicit media test is skipped by the normal browser suite. Rendering alone never recaptures the underlying application. The verifier compares current ZIP, inventory, build, source captures and composed-file hashes before checking browser playback, so it passes only while `extension/dist` is the hosted build the ZIP was made from.

The motion demo has its own command, independent of the ZIP:

```sh
npm run release:motion                 # all 1,650 frames → master, web MP4, poster, captions, manifest (about 3 minutes)
npm run release:motion -- --stills     # the seven key moments as 1920×1080 PNGs in /tmp/aicheckout-motion-stills
npm run release:motion -- --at 9.5,21  # stills at chosen seconds
npm run release:motion -- --check      # re-render the key frames and compare them with the manifest
```

Each frame is a pure function of time: the renderer calls the page's `renderFrame(t)` for `t = frame / 30`, which starts from a fresh copy of the authored page and sets every animated property from `t` alone (no clock, `requestAnimationFrame`, CSS transition or randomness), then screenshots it at 1920×1080 with software rasterization (GPU rasterization occasionally changed one pixel between renders of the same frame) and pipes the PNG to one `ffmpeg` run that writes both MP4s (`libx264`, `-preset slow -tune animation`, CRF 18 and 20, BT.709). Two full renders on the same machine gave identical frames and identical MP4, poster and caption bytes. After changing the composition, rerun `npm run release:motion` and then `node extension/scripts/render-release-assets.mjs` so the gallery and `assets-manifest.json` pick up the new hashes. To preview, render stills with `--stills` or `--at`.

To preview the gallery's player and captions over HTTP, serve this public-only asset directory locally rather than exposing the repository or credentials:

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory docs/release/assets
```

Open the local address printed by the server. Stop it when finished. File-based viewing can block caption loading; the included transcript remains readable. The verifier starts and closes its own temporary loopback server and writes inspection screenshots under `/tmp/aicheckout-release-media-inspection`.

Chrome's [image requirements](https://developer.chrome.com/docs/webstore/images) (checked 2026-10-20): one to five screenshots at 1280×800 (preferred) or 640×400, full bleed with square corners; the small promotional image 440×280 is required; the marquee 1400×560 is optional; the icon 128×128 PNG with 96 px artwork. These assets still need the final [release gates](../README.md), accurate dashboard declarations and Google's review. No marquee or YouTube upload is claimed.

## Reproducing the pinned artifact

Generate release media only from a clean checkout of the commit being released, with a fresh install:

```sh
git worktree add --detach /path/to/clean-checkout HEAD   # or a fresh clone
cd /path/to/clean-checkout && npm ci && npm run release:media
```

A working copy with local edits, untracked files, or a non-`npm ci` install can produce a different ZIP and therefore a different pinned hash. The build does not depend on the checkout's location: the content script is bundled at a fixed path (see `extension/vite.config.ts`). The hash above was produced in a fresh `npm ci` worktree on 2026-10-20.
