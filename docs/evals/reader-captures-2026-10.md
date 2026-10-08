# Reader evaluation set, 2026-10: captures, labels, variants and freeze

Phase 12 of the [generic cart reader evaluation](../../wiki/product/phase-12-reader-eval.md), closed on 2026-10-08 under [`generic-reader-protocol.12`](generic-reader-protocol.md) and Evan's two status notes of 2026-10-08 (capture paused at about 300 stores, the ≥ 99% bar a quality target; one labeller per store). This is the frozen set reader v1 (Phase 13) is built and judged on. No reader code ran before the freeze.

**Labels are agent labels (agent-verified, never human-verified).** Each store was labelled once, by one Claude Code subagent (claude-opus-5-5) per five stores; there was no second labeller and no adjudication (Evan, 2026-10-08, [decision](../../wiki/decisions/2026-10-08-single-labeller.md)), so label errors are not caught by agreement and every score is on single labels.

## The set

| | Development | Held-out A | All |
| --- | ---: | ---: | ---: |
| Stores | 200 | 137 | 337 |
| U.S. / non-U.S. | 114 / 86 | 77 / 60 | 191 / 146 |
| Labelled page-states | 722 | 495 | 1,217 |
| Page-states with an expected amount | 488 | 331 | 819 |
| `cart-1` page-states | 188 | 130 | 318 |
| `cart-1` with an expected amount | 178 | 117 | 295 |
| Low-confidence labels | 53 | 39 | 92 |
| Currencies among expected amounts | 20 | 17 | 20 |
| Offline variants | 1,088 | 731 | 1,819 |

Of the 337 stores, 332 were captured by agent-driven pane sessions in the Claude desktop app's browser pane (2026-10-07 and 2026-10-08) and 5 are standing robot captures of 2026-10-06 (apple.com, cardkingdom.com, conforama.es, disneystore.com, lego.com). The split is the committed seeded split (`seeded-selection.mjs split --weights-protocol-10`, 3 : 2, by band × region group × platform group with the operator lock), computed and committed (`evals/merchants/splits.json`, commit `7a490f6`) before any label; two stores later left it (below). Operators with more than one store: 19 in development, 5 in held-out A; no operator spans both splits.

Expected `cart-1` amounts by region group: development U.S. 103, Europe 29, Asia-Pacific 15, Canada and Latin America 15, Middle East and Africa 16; held-out A U.S. 67, Europe 19, Asia-Pacific 10, Canada and Latin America 9, Middle East and Africa 12.

By state (labelled / with an expected amount): development `empty-cart` 189 / 28, `minicart-1` 119 / 67, `cart-1` 188 / 178, `cart-qty2` 149 / 144, `cart-2items` 40 / 37, `cart-other` 37 / 34; held-out A `empty-cart` 133 / 19, `minicart-1` 84 / 55, `cart-1` 130 / 117, `cart-qty2` 102 / 97, `cart-2items` 29 / 27, `cart-other` 17 / 16. A null expected is `no-total-displayed` (379), `ambiguous-preferred-kind` (11), `currency-undetermined` (7) or `not-readable` (1). Currency was undetermined on 1 of 188 development and 2 of 130 held-out A real `cart-1` pages, under the 10% stop rule.

## Capture

The pane capture visited 532 stores of the frozen candidate order (U.S. 296, non-U.S. 236) and was paused on 2026-10-08 by Evan at 334 captured. Outcomes of the visited stores:

| Outcome | U.S. | Non-U.S. |
| --- | ---: | ---: |
| Captured | 187 | 147 |
| Bot wall (`blocked-bot-wall`) | 44 | 31 |
| CAPTCHA (`captcha`) | 16 | 4 |
| Add-to-cart refused | 17 | 5 |
| Sign-in required | 11 | 11 |
| Needs input (ZIP, size by typing, etc.) | 3 | 11 |
| Would need a forbidden action (cart under `/checkout`) | 6 | 6 |
| Not a store, no eligible item, defunct, maintenance | 3 | 10 |
| Redirected off domain, geo-blocked, HTTP 403 | 3 | 6 |
| Tool error after the second session, or incomplete | 6 | 5 |

**The blocked-store gap.** 95 visited stores (18%) block automated browsing with a bot wall or a CAPTCHA, and no agent ever solves or bypasses one, so they are not in the set. They skew to the largest U.S. retailers. The reader is therefore measured on stores that let an agent reach the cart; how it does on the blocked ones is unknown. 12 stores keep their cart under a `/checkout` path (VTEX, AbeBooks), which the capture rules never open.

**Integrity sweep (2026-10-08).** 1,329 exports were checked for bot-check markup, truncation and missing amounts. Two `empty-cart` exports carried a visible PerimeterX challenge (`px-captcha-modal`); both stores (target.com, ashleyfurniture.com) were already excluded as `captcha`, so neither page is in the set. One export (rallyhouse.com `minicart-1`) hit the export's node cap (`truncated`); it was labelled as is. Two first-session exports that a second session didn't replace (tillys.com `cart-2items`, backmarket.com `cart-qty2`) were set aside, not labelled. Four operator records disagreed with the coordinator's standing status and were aligned with it, the operator's outcome kept beside it (merrell.com and replacements.com excluded as `tool-error` after an undecodable export in their second session; kohls.com and gsuplementos.com.br captured with `minicart-1` only).

**Independent capture review (2026-10-08, agent-verified).** Before the final freeze an independent subagent reviewed the capture: all 532 transcripts re-audited (no forbidden tool, no typing, no stray write), no signed-in store, every exclusion's evidence on disk, records, `sites.json`, exports and labels in agreement, every item price in its band, no bot-check markup in any split page. On its findings, with Evan's go:
- **72 page-states dropped** (kept on disk and in the records as `droppedStates`): electrodepot.fr `cart-1` and `cart-qty2`, whose cart redirected to a `/checkout/` path; and 70 `minicart-1` exports that showed no in-page cart at export (only a header badge, a toast or an inline stepper, or a drawer closed, off-canvas or mid-animation), classified by subagents against the protocol's definition (200 of 270 kept).
- **Two stores left the set:** gsuplementos.com.br (development) and sporting.com.ar (held-out A) had no other cart state; both keep their cart under `/checkout`, so they are excluded as `would-need-forbidden-action`. No other store moved and no platform changed.
- **Deviations (reported, not fixed):** six stores whose exports hold the operator's item would count as captured under protocol `.9` but stay out, because adding stores after labelling would re-run the frozen split: motorola.com.mx, big5sportinggoods.com, abebooks.com, auchan.fr, harley-davidson.com, derimod.com.tr. Some exclusions are likely miscoded (nike.com, newbalance.com, jdsports.com, gap.com and converse.com as `add-to-cart-refused` where the add failed silently in a hidden pane, which would have allowed a second session as `tool-error`); a few safety slips happened on stores outside the set (a header cart link landing on a checkout page, closed at once; evidence exported on `/checkout`; a persistent store choice at saveonfoods.com) and one in it (menards.com: an accidental "Buy Now" click opened a sign-in panel; nothing was submitted). About 16 `cart-1` pages were exported mid fade-in and are labelled with no displayed total; six stores served a currency other than the frame's (USD at amazon.co.jp, amazon.de, laverne.com, mavi.com and sportsbikeshop.co.uk; NOK at outnorth.com).

## Labelling

Every page-state was rendered offline (`render-pane.mjs`: the export rebuilt, JavaScript off, network blocked; viewport and full-page screenshots, the full page also cut into 1280 × 1600 tiles) and given a deterministic digest of its visible amounts (`digest-pane.mjs`, reviewed by an independent subagent over three rounds). Labellers got the screenshots, the digest and the export, never any reader output. 69 labeller sessions of five stores each (a pilot of two, then 67; six stalled sessions re-ran) wrote the labels in `reader-labels.2`; the coordinator added split, origin and the snapshot hashes (`assemble-labels.mjs`), and `agreement.mjs --single` made the final labels. All validate; after the capture review's drops, 1,217 remain. One label was corrected before the freeze: the variant sample check found that held-out A `finishline.com/cart-1` missed its "Items (1)" subtotal row (the expected amount was unchanged); the label's note records it.

## Offline variants

The nine transforms of the protocol were applied to every real `cart-1` with a usable expected row (`variants/generate.mjs`). Generated per transform, development / held-out A: `class-rename` 186 / 128, `promo-row` 124 / 78, `fake-subtotal` 128 / 87, `injected-instruction` 128 / 87, `credit-applied` 124 / 78, `format-swap` 88 / 65, `format-space-after` 93 / 65, `zero-decimal` 93 / 65, `mixed-currency` 124 / 78. Variants are skipped, never guessed, when the expected row isn't found or isn't unique (the main reasons: 242 / 192 and 141 / 80 skips) or the page's amount format isn't unique; robot captures have no pane export to transform.

The labeller's check of a seeded 10% sample found three mismatches in 182 on its first run: two generator defects (`zero-decimal` left a "(USD)" code in a total's label; the row finder took a line item's Polish "Suma" for the total because "do zapłaty" wasn't a total word) and the finishline.com label omission above. The row-dependent transforms moved to version `.2`, every variant was regenerated, and the re-drawn sample matched 183 of 183. After the capture review's drops the variants were regenerated once more; the seeded draws picked the same 183 entries with unchanged exports and derived labels, so their checks stand.

## Freeze

`evals/merchants/freeze.json` (`reader-freeze.1`, made at commit `2de2fec` on 2026-10-08T20:42Z, after the capture review; the first freeze at `2a850bc` was replaced before any reader run) holds the SHA-256 of both splits' final labels and reports, variant manifests and variant labels, the snapshot manifest (`snapshot-manifest.json`, 1,217 page-states with their export and render hashes), `currency-minor-units.json`, `item-price-bands.json`, `retail-frame-3.json` and `splits.json`. `freeze.mjs --check --data` passes. The reader harness checks it before every score and refuses on a mismatch. A frozen label is never edited; later corrections go in dated errata, with scores reported on frozen and corrected labels side by side.

## What held-out A can show

Held-out A has 137 stores and 331 page-states with an expected amount (117 `cart-1`). If reader v1 shows amounts on, say, 80% of them with none wrong, the one-sided 95% upper bound on the wrong-amount rate is about 1.1% at page level; per store, with about 110 stores showing an amount, it is about 2.7%. Results are reported with those bounds and the store counts, by U.S. and non-U.S., state and currency, and on variants apart from real pages; nothing passes or fails a bar.

## Files

Committed: `evals/merchants/splits.json`, `captured.json`, `captured-methods.json`, `freeze.json`, `snapshot-manifest.json`; `evals/merchants/labels/final/` (labeller files, final labels, reports); `evals/merchants/variants/<split>-{manifest,variant-labels,variant-check}.json`; the text-free records in `evals/merchants/capture/records/`; the tools and the labelling workflows (`evals/merchants/labels/workflows/`). Gitignored: the exports, renders, tiles, digests and variant exports under `evals/merchants/capture/data/`.
