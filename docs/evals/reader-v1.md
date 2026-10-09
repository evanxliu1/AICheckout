# Generic cart reader v1: results, 2026-10

Phase 13 of the [merchant coverage plan](../../wiki/product/phase-13-reader.md). `readCart(document, { url })` in `packages/cart-reader` reads a cart or checkout page and returns the cart total it is certain of (kind, amount in minor units, ISO currency) or withholds; the extension shows card rates only when it withholds. It is deterministic, has no model, and has no per-store rules (no domain lists, selectors, class names or brand words; the URL is used only for its country TLD as the storefront currency of last resort). Built on 2026-10-08 and 2026-10-09 by a Fable 5.1 (`claude-fable-5-1`) reader developer in six rounds, reviewed by an independent subagent (agent-verified) after rounds 3, 4, 5 and 6, and measured on the frozen evaluation set ([captures report](reader-captures-2026-10.md)) by the harness in [`evals/reader/`](../../evals/reader/README.md).

**Labels are single agent labels** (one labeller per store, agent-verified). **Held-out A was not sealed** (Evan, 2026-10-08, [decision](../../wiki/decisions/2026-10-08-phase-13-simplified.md)): the developer tuned on development pages, run 1 was the first look at held-out A, and the fixes before run 2 were informed by run 1's failure classes (general rules only, each with a synthetic test). **Run 1 is the unbiased estimate on unseen stores; run 2 is the final reader after held-out-informed fixes** and is optimistic for that reason.

## Results

Real page-states; "shown" means the reader returned an amount. A shown amount is correct only if kind, amount and currency all match the label. Bounds are exact one-sided 95% Clopper–Pearson upper bounds on the wrong rate among shown amounts.

| | Development (final reader) | Held-out A run 1 (reader `63566bc`) | Held-out A run 2 (reader `94b7b9a`, final) |
| --- | ---: | ---: | ---: |
| Stores / page-states | 200 / 722 | 137 / 495 | 137 / 495 |
| Shown correct / wrong / withheld | 384 / 0 / 338 | 237 / 18 / 239 (1 harness load timeout) | 244 / 7 / 244 |
| Precision on shown amounts | 100% | 92.9% | 97.2% |
| Wrong rate, upper bound (page) | ≤ 0.78% | ≤ 10.3% | ≤ 5.2% |
| Wrong rate, upper bound (store / operator clusters) | — | ≤ 14.5% / ≤ 14.9% (9 stores) | ≤ 7.4% / ≤ 7.6% (3 stores) |
| Right amount and currency among shown | 384 / 384 | 246 / 255 (96.5%) | 249 / 251 (99.2%) |
| Coverage on `cart-1` (expected amount shown correctly) | 86.0% (153 / 178) | 76.9% (90 / 117) | 78.6% (92 / 117) |
| Coverage, all states with an expected amount (`cart-other` excluded) | 78.9% | 70.5% | 72.7% |
| p95 read time (max) | 10.0 ms | 28.2 ms (103 ms; 11 pages over 50 ms) | 11.6 ms (26.5 ms; none over) |
| Offline variants: correct / wrong / withheld | 875 / 0 / 213 | 593 / 23 / 115 | 602 / 9 / 120 |

**Against the targets.** The ≥ 99% precision bar is a quality target, not a gate (Evan, 2026-10-08). On stores the rules were not tuned on, the reader was right on 92.9% of the amounts it showed (run 1), and 97.2% after one round of general fixes (run 2); held-out A is too small to show ≥ 99% even with no errors (about 250 shown amounts bound the wrong rate at about 1.2%). Coverage on `cart-1` is 77–79% on held-out stores against the 80% target, 86% on development. Read time is well inside the 50 ms budget.

**By stream (run 2):** U.S. 150 correct / 5 wrong (precision 96.8%, coverage 75.4%); non-U.S. 94 / 2 (97.9%, 68.8%). **By state (run 2):** `cart-1` 92 / 2, `cart-qty2` 75 / 2, `cart-2items` 18 / 2, `minicart-1` 33 / 1, `cart-other` 15 / 0, `empty-cart` 11 / 0. **By currency (run 2, 5 or more stores):** USD 150 / 5, EUR 24 / 0 (coverage 96%), AED 4 / 0, INR 3 / 0.

## What the reader still gets wrong (run 2)

All 7 real wrong answers come from 3 stores:
- **Same amount, different kind (5):** appliancepartspros.com (3) and ilmakiage.com (2) show the right amount and currency as `estimatedTotal` where the label says `subtotal`. A hidden header flyout or a hidden "Grand Total" row repeats the visible subtotal's amount; in the offline rebuild that row's positioning is lost, so the reader can't tell it is hidden.
- **Amount shown where the label says none (2):** hmv.com `cart-1` and `minicart-1`: the page was captured while its basket was still loading, and its closed drawer, laid out by the rebuild without its off-screen position, shows the cart's total.

Both causes are partly measurement artefacts: the rebuilt page keeps computed styles and boxes on text elements but not the live page's layout, so off-screen panels that a shopper never sees can look visible. On a live checkout page the reader sees real geometry. The variant wrong answers (9) are the same three pages under transforms.

**Run 1's 18 wrong answers** (9 stores) fell into six classes, each fixed by a general rule before run 2: hidden rows read as visible (6), totals with tax wording rejected by an over-strict rule (4, one showing a pre-discount subtotal), a card-offer banner's hypothetical price read as an after-credit total (1), a fixed bottom bar competing with the summary (2), a footer currency list that should leave the currency undetermined (2), and a "product total" wording read as the order total (1); plus 11 pages over 50 ms (max 103 ms), fixed by caching and bounding text walks.

## How it was built

- **Rounds 1–3 (development only):** from a placeholder to 383 correct / 0 wrong on development (quick loop), coverage on `cart-1` 85.4%. A quick development loop (`evals/reader/dev.mjs`, one read per page in parallel, never a scored run) made each iteration about 5 minutes instead of 25.
- **Independent review (rounds 4–5):** found five paths to a wrong amount or currency on unseen markup (tax or shipping rows read as totals, a one-digit superscript read as cents, the country TLD overriding a currency shown on the page, missed currency selectors and coded prices, "Total tax included" rows) and coverage gaps (Arabic and Indian number formats, qualified total labels); all fixed with unit tests at little coverage cost.
- **Held-out run 1, then round 6:** the six failure classes above, fixed generically and re-reviewed (two more should-fixes: a loyalty credit dropped as an offer, a zero placeholder outranking a header summary).
- **Final reader:** about 1,400 lines of TypeScript (`index.ts`, `amounts.ts`, `currency.ts`, `words.ts`), 75 unit tests on synthetic pages; visibility rules are covered by the harness, not unit tests (jsdom has no layout).

## Runs

`evals/reader/runs.json` holds every run: the placeholder baseline, official development runs after rounds 3, 4, 5 and 6 (two stopped runs marked `failed` when a review fix superseded them), and held-out A runs 1 (`20261009T023737Z-heldout-a-5156cf`) and 2 (`20261009T052336Z-heldout-a-dc3dc7`). Held-out A's two runs are used; any further held-out measurement needs a fresh, frozen held-out set (protocol).

## Limits

- Held-out A has 137 stores; the bounds above are wide at store level.
- Labels are single agent labels; some "wrong" answers are kind disputes on rows with the same amount.
- Pages are offline rebuilds (JavaScript off, no layout positioning); live pages may behave better (real geometry) or worse (late-loading totals).
- 95 visited stores block automated browsing and are not in the set; how the reader does on them is unknown.
