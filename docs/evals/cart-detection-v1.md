# Cart page detection v1 and reader coverage round: results, 2026-10

Phase 13c of the [merchant coverage plan](../../wiki/product/phase-13c-cart-detection.md).
- `detectCartPage(document, { url })` in `packages/cart-reader` decides whether a page is a cart or checkout page, so the automatic badge can run at any https store.
- `readCartPage` does detection and `readCart` in one pass.
- The badge shows:
  - the best owned card and a dollar estimate when `readCart` is certain of a USD total;
  - otherwise the best card and its rate, with no typed amount ([decision](../../wiki/decisions/2026-10-09-never-ask-for-an-amount.md));
  - nothing on non-cart pages, empty carts and non-USD stores.
- **Built** 2026-10-09 and 2026-10-10 by Fable 5.1 (`claude-fable-5-1`) implementers.
- **Reviewed** by an independent Fable 5.1 reviewer after each milestone, with must-fix and should-fix items applied and re-checked (agent-verified).
- **Measured** by `evals/reader/detect.mjs` and `evals/reader/live-home.mjs` on the frozen evaluation set ([captures report](reader-captures-2026-10.md)) and on live home pages.

**Read the held-out numbers with their commit.**
- The detector's one held-out A run measured the detector at `9da996e`.
- After that run:
  - the reader coverage round (13c.5) and review fixes changed the detector (`ebf240a`, then `59dff8c`);
  - those changes are measured on development only.
- The held-out run is the unbiased estimate for the detector design. Later detector numbers are development numbers, optimistic for that reason.
- The reader's own held-out estimate stays that of [reader v1](reader-v1.md) run 2, because held-out A's two reader runs are used.

## Detection: does the badge show on cart pages, and only there?

"Badge shows" means the detector says `cart` or `checkout` and `readCart` didn't read a zero total. Non-USD stores are counted as shown here, although the extension hides the badge there; this measures detection.

| | Held-out A (detector `9da996e`, run `20261010T083549Z-heldout-a-7ea020`) | Development (final detector `59dff8c`, scored run `20261010T102625Z-development-b27cbb`) |
| --- | ---: | ---: |
| Badge recall on cart pages (`cart-1`, `cart-qty2`, `cart-2items`, `cart-other`) | **232 / 278 = 83.5%** (Wilson 78.6–87.4%) | 388 / 414 = 93.7% (90.9–95.7%) |
| By state | `cart-1` 106/130, `cart-qty2` 87/102, `cart-2items` 25/29, `cart-other` 14/17 | 177/188, 138/149, 40/40, 33/37 |
| Stores with every cart page shown | 105 of 133 | 180 of 195 |
| False shows, product page with an open mini-cart (`minicart-1`) | **0 / 84** (≤ 3.5%) | 0 / 119 (≤ 2.5%) |
| False shows, empty carts (`empty-cart`) | **0 / 133** (≤ 2.2%) | 0 / 189 (≤ 1.6%) |
| Shown cart pages with a dollar figure / with the rate only | 192 / 40 | 343 / 45 |
| Detection time, pages with no URL or title hint (p95, max) | 0.3 ms, 0.3 ms | 0.2 ms, 0.4 ms |
| Detection plus reading, hinted pages (p95, max) | 14.2 ms, 47.2 ms | 10.1 ms, 34.4 ms |

Bounds are exact one-sided 95% Clopper–Pearson upper bounds.

**Against the targets** (reporting targets, not gates):
- **Recall:** 83.5% on held-out stores, against a target of ≥ 95%. Development is 93.7% after the coverage round.
- **False shows:** none on product pages with an open drawer or on empty carts, against a target of ≤ 1%. With 84 and 133 held-out pages, the bounds can't reach 1%.
- **Time:** within budget. Pages with no cart hint are checked from the URL and title only, and nothing else on them is read.

**Held-out misses (46):**
- **31 `no-structure`, on 19 stores:** the URL says cart, but no visible summary row or quantity-and-remove pair was found. Causes:
  - the offline rebuild loses controls or opacity;
  - the stricter review rules: both controls are required, and they must share one line block;
  - summaries in iframes.
- **14 `no-hint`, on 8 stores:** carts that open as a drawer at product or home URLs, missed by design (the badge never shows on a product page).
- **1 `title-only`.**

The coverage round fixed part of the development equivalent of the first class (development `no-structure` 20 → 7).

## Live home pages

**Method.** `live-home.mjs` loaded the home page of every store in the frozen set plus 55 popular non-store sites:
- once each, headless Chromium, logged out;
- no clicks or typing, `robots.txt` respected, bot walls never bypassed;
- with no page content saved.

| Final detector `59dff8c`, 2026-10-10T10:27Z (bundle `73735fa1…`) | Stores | Non-store sites | All |
| --- | ---: | ---: | ---: |
| Sites | 337 | 55 | 392 |
| Loaded / blocked / `robots.txt` disallows / error | 205 / 97 / 4 / 31 | 39 / 12 / 3 / 1 | 244 / 109 / 7 / 32 |
| Badge shows | **0 / 205** (≤ 1.5%) | **0 / 39** (≤ 7.4%) | **0 / 244** (≤ 1.2%) |
| Pages with a cart hint | 0 | 0 | 0 |
| Detection time (p95, max) | 1.7 ms, 2.6 ms | 1.2 ms, 1.5 ms | 1.6 ms, 2.6 ms |

- **Same result on earlier detectors:** the sweeps at `9da996e` (2026-10-10T08:37Z) and `ebf240a` (10:13Z) also gave 0 of 244.
- **Hints:** no loaded home page carried a cart hint in its URL or title, so the detector read nothing on them beyond the URL and the title.
- **Timing:** live timing includes the test browser's evaluation overhead and is above the plan's 1 ms aim for unhinted pages; it stays small.
- **Blocked and failed loads:** most are bot walls and timeouts in headless Chromium.

## Reader coverage round (13c.5, development only)

`readCart` gained generic rules (each with a synthetic unit test):
- script and style text is ignored inside summary blocks;
- table structure doesn't count in the summary climb;
- a subtotal-plus-one-shipping-row sum marks the larger row `estimatedTotal`, only when no `estimatedTotal` row is labelled;
- "you saved" notes and free-shipping-threshold rows are ignored;
- a total inside a short card-offer block is dropped, only with offer and credit words and no shipping, tax or checkout control;
- the page is clipped to the viewport width when the body clips overflow;
- inputs are measured by their own box;
- `ج م` marks EGP.

The independent review found no wrong-amount risk and two coverage regressions, both fixed.

| Development (official runs) | Reader v1 (`94b7b9a`) | After 13c.5 (run `20261010T095154Z-development-eaa36b`) |
| --- | ---: | ---: |
| Shown correct / wrong / withheld | 384 / 0 / 338 | **405 / 0 / 317** |
| Wrong rate, upper bound (page / store / operator) | ≤ 0.78% / — / — | ≤ 0.74% / ≤ 1.7% / ≤ 2.0% |
| Coverage on `cart-1` | 86.0% (153 / 178) | **89.9%** (160 / 178) |
| Coverage, all states with an expected amount (`cart-other` excluded) | 78.9% | 82.8% (376 / 454) |
| Offline variants: correct / wrong / withheld | 875 / 0 / 213 | 898 / 0 / 190 |
| p95 read time | 10.0 ms | 10 ms |

- **No held-out run measures this.** The development gain is the honest number available, and it's optimistic.
- **Remaining development withholds on cart pages:**
  - `no-summary` (21): hidden in the rebuild, drawer carts, or prices not in text;
  - `currency-undetermined` (8): `$` on Spanish-language `.com` stores, SAR written as `$`;
  - `subtotal-not-alone` (6);
  - `amount-unreadable` (6).

## Limits

- **Checkout step pages were never captured**, because Phase 12 forbade entering checkout. `checkout` detection is tested only on synthetic pages.
- **Frozen URLs have no query string.** Query-routed carts (`?route=checkout/cart`) are tested only on synthetic pages.
- **Offline rebuilds have no live layout or JavaScript.** Live carts may show more (real controls and geometry) or less (late-loading totals).
- **Known false-show shapes, documented in the plan:**
  - a saved-items page with quantity and remove controls on every row is indistinguishable from a cart;
  - a checkout whose only summary is a fixed bottom bar is missed.
- **The live sweep covers home pages only** (no product, search or account pages). Its non-store sample (39 loaded) is small.
- **The 95 bot-walled stores aren't in the frozen set,** so how the detector does there is unknown.
- **Order confirmation and savings** stay with the three legacy stores.
