# Shopper demo: motion graphic script

The script for [`../shopper-demo.mp4`](../shopper-demo.mp4), written before the composition (2026-10-22, milestone 15.6b). The composition is [`composition.html`](composition.html); [`render-motion-demo.mjs`](../../../../extension/scripts/render-motion-demo.mjs) renders it (`npm run release:motion`). Timings and on-screen text here are the contract; if the composition changes, change this file in the same commit.

## Format

| Item | Value |
| --- | --- |
| Master | 1920×1080, 30 fps, H.264 `yuv420p`, `motion/shopper-demo-1920x1080.mp4` |
| Web copy | 1280×720, 30 fps, H.264 `yuv420p`, `+faststart`, `shopper-demo.mp4` (README, gallery, store listing via YouTube) |
| Length | 55.0 s (1,650 frames) |
| Audio | None (no audio track). Every frame reads without sound; `shopper-demo.vtt` carries one descriptive cue per scene for the gallery's player |
| Poster | `shopper-demo-poster.png`, 1280×720, the frame at 17.0 s (the ranked panel) |

## Rules

- **Illustration, not a capture.** The interface is recreated in HTML/CSS from the 2.1.0 screenshots, simplified for motion (the badge panel drops its amount field, payment method, disclosures and footer). The [store screenshots](../README.md) are the real extension. A persistent label in scenes 1–4 and the end card's fine print say so.
- **Fictional store only.** Sample Kitchen on `sample-kitchen.example` and a sample store on `shop.example.com` (reserved domains). No real retailer, logo, layout, issuer logo or card art; card product names are plain text.
- **Product facts only**, all from the screenshots and the release docs: the sample wallet (Double Cash, Quicksilver, Freedom Unlimited, Blue Cash Everyday), $100.00 at Sample Kitchen → Freedom Unlimited $3.00 (3%), Double Cash $2.00, Quicksilver $1.50, Blue Cash Everyday $1.00; at the sample store with a −$25.00 gift card the amount is not read and the cards rank Blue Cash Everyday 3%, Double Cash 2%, Quicksilver 1.5%, Freedom Unlimited 1.5%; 178 cards; weekly refresh; one consent question. Quotes are the issuer's words exactly as the extension shows them.
- **Must not be invented:** savings history, order tracking, "anonymous", "nothing is sent", "cards never leave your device" (with Share, reports carry the cards' catalog names), a store-listing URL, ratings or user counts.
- **Look:** Ocean tokens (navy `#0c2a4d`, navy-strong `#081f3a`, navy-line `#1d4573`, sky `#7cc4ff` on navy only, on-navy-soft `#a9c6ea`, action blue `#1d5fb4` on white, page tint `#eef4fb`), Bricolage Grotesque for display, Figtree for text, both from `@fontsource-variable` in the repository; the cart mark from `extension/assets/cart-mark.svg`. No stock footage, remote fonts, CDNs or external assets.
- **Motion:** one idea per scene; cubic ease-out entrances, ease-in-out moves, a lightly damped spring (about 6% overshoot) for the badge; staggered reveals of 0.1–0.4 s; counters for amounts. Nothing loops or flashes.
- **Legibility:** safe area 120 px left and right, 56 px top and bottom at 1080p. Headlines 76–92 px, supporting copy 32 px, interface text at least 20 px, fine print 20 px at 1080p (13 px in the 720p copy).
- **Pacing:** every line stays on screen for at least about one second per three words of new text in its beat; the three trust facts get a beat of their own, one at a time (amended after the 2026-10-22 review, which found the trust scene at about 10 words a second).
- **Determinism:** every frame is a pure function of `t` (seconds): `window.renderFrame(t)` sets every animated property from `t` alone; no clock, `requestAnimationFrame`, CSS transition or randomness is used when rendering. The renderer rasterizes in software (`--disable-gpu-rasterization`): GPU rasterization left an occasional one-pixel difference between renders of the same frame.

## Scenes

Text in quotation marks is verbatim on screen.

| # | Scene | Time (s) | On screen |
| --- | --- | --- | --- |
| 1 | Hook | 0.0–5.5 | Headline "Which card should I use?" word by word. A browser window rises: address "sample-kitchen.example/cart", "Your cart", "Sample cart · 2 items", "Sample item" "Qty 1", "Another sample item" "Qty 2", "Order summary": "Subtotal" $92.59, "Estimated tax" $7.41, "Total" counting to $100.00. Below the headline, "Your cards" and four chips, staggered: "Double Cash", "Quicksilver", "Freedom Unlimited", "Blue Cash Everyday" |
| 2 | The badge | 5.5–12.0 | Headline "Your best card, right on your cart." Supporting "The badge names the card you already own that earns the most here." The pill springs in at the window's corner: "Use Freedom Unlimited · $3.00 back"; it is pressed and opens into the panel: "Best card for this cart", "Based on $100.00 cart estimated total at Sample Kitchen. Treated as a restaurant (its own pages; fits Chase’s restaurant definition)." The navy winner block: "Freedom Unlimited", the amount counting to "$3.00", "3%", 3% on “dining at restaurants, including takeout and eligible delivery services”; otherwise 1.5% on “all other purchases”. |
| 3 | Why | 12.0–19.0 | Headline "The rule, in the issuer’s words." Supporting "Sample Kitchen is treated as a restaurant, so Freedom Unlimited’s dining rule applies." The evidence sentence and the quote are highlighted in turn; the other cards slide in with amounts counting up: "Double Cash" "2%" "$1.00 less" "$2.00", "Quicksilver" "1.5%" "$1.50 less" "$1.50", "Blue Cash Everyday" "1%" "$2.00 less" "$1.00" |
| 4 | Amount only when certain | 19.0–27.0 | Headline "Amounts only when certain." Supporting "A gift card is applied here, so the cart amount isn’t read. The badge ranks your cards by rate instead." The panel folds back; the address changes to "shop.example.com/cart"; a "Gift card" row "−$25.00" slides into the summary and the total becomes $75.00. Pill "Use Blue Cash Everyday · 3% back" opens the rates view: "The cart amount wasn’t read on this page. Each card’s rate doesn’t depend on it, so the best card is the same at any amount, unless a condition below applies." and the condition it refers to, as in screenshot 3: "A spend cap on one of these cards could change the order at your cart’s amount." Rows "Blue Cash Everyday" "3% back", "Double Cash" "2% back", "Quicksilver" "1.5% back", "Freedom Unlimited" "1.5% back" |
| 5 | Trust | 27.0–48.0 | The window leaves. Beat 1 (27.0–36.0): headline "Card terms kept current by an LLM. Every change approved by a person." A pipeline draws left to right: "Issuer terms" / "Published reward pages" → "An LLM drafts" / "Proposed changes, with quotes" → "A person approves" / "Every change, before release" → "Your extension" / "178 cards; checks for updates weekly". Beat 2 (36.0–48.0): three lines, one every 3.6 s: "No model at checkout: the comparison is arithmetic on your device." "Your cards are saved in your browser. No card numbers, no bank login." "Usage reports only if you choose Share. Tapping Suggest or Report sends the store’s domain." (The policy's two on-purpose sends work without Share; the line says so rather than implying nothing leaves without it.) |
| 6 | End card | 48.0–55.0 | The cart mark, "AI Checkout", "The best card you already own, shown right on your cart.", "Works at any U.S. online store.", an outlined placeholder "Coming soon to the Chrome Web Store" (replace with the listing URL at submission, 15.7), fine print "Illustration with sample cards and a fictional store. Estimates are conditional, not earned rewards." |

Persistent in scenes 1–5: the wordmark (cart mark and "AI Checkout") top left. In scenes 1–4: "Illustration · sample cards · Sample Kitchen is a fictional store" bottom left.

## Stills checked

Key moments (the manifest's key frames, re-rendered by `--check`): 4.5 s (hook settled), 10.5 s (badge open), 17.0 s (ranked panel, the poster), 25.0 s (rates view), 34.0 s (pipeline), 46.0 s (the three facts), 53.0 s (end card). The 2026-10-22 review also read stills every 0.3–0.6 s around each scene change.

Counters: amounts count up (cart totals, the winner's $3.00, the other cards' amounts); a paused frame can show an intermediate amount such as $1.38, never a different winner or a rate a card does not have. Rates and the "less" differences are revealed, not counted; each "less" appears only after its amount has landed.
