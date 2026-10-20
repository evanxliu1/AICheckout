# Legacy adapter retirement: what changes for Amazon, Best Buy and Newegg (2026-10)

Phase 15.1 of the [Release A plan](../../wiki/product/phase-15-release-a.md) retires the three bundled store adapters (`amazon-us`, `best-buy-us`, `newegg-us`) and leaves the generic detector and reader (`packages/cart-reader`) as the only reader at every https store. This file is the measurement the [decision of 2026-10-19](../../wiki/decisions/2026-10-19-retire-legacy-adapters.md) asks for: what each reader showed on the same pages, before deletion. **It is a record, not a gate**; Evan directed the retirement unconditionally.

Both tables are text-free: a page is named by its fixture or capture id and URL, and a row carries only the readers' outputs (kind, amount, currency, or a reason code). No page text, selectors or product names.

How to read a row. **Adapter** is the legacy reader's output on the adapter's own cart URL (`readCheckoutPage`): an amount of a kind, or an unavailable reason. **Generic** is what the extension shows at that page after retirement, derived from `readCartPage(document, { url })` the way `manual-reader.ts:readAnyCart` maps it: `amount` (the badge and popup show the dollar estimate), `rates view` (the page is a cart or checkout but the amount was not read with certainty: cards compared by rate, never a wrong amount), or `hidden` (not a cart, an empty cart or a non-USD cart: no badge). The detector's verdict and reason, and the reader's reason, are the reason codes.

## Part 1: the committed observed fixtures

- **Readers at commit `3eff32ca`** (`origin/main`, the merge of PR #94), the last commit before any deletion. Generic bundle SHA-256 `73735fa139ce05743ad5c52065ba7962cc331749638fd817eb43049d918f55e2`, legacy bundle SHA-256 `dfe06af7f94e3d06462a74f266a43b15e8e1f8872503006c4b30c6129e31b965` (both built by `evals/reader/bundle.mjs` from the tree at that commit).
- **Pages:** the seven `extension/tests/fixtures/*-observed-*.html` files (cart pages observed logged-out on the three stores between 2026-09-25 and 2026-09-30 and reduced to their order-summary markup for the adapter tests, as each file's header comment records), each loaded once from a temp file with JavaScript off and every other request aborted, as `evals/reader/run.mjs` loads a page, at the URL the adapter tests use for it.
- **Run** 2026-10-20 by the Phase 15.1 implementer (Fable 5.1, `claude-fable-5-1`) on the worktree of branch `phase15-1-retire-adapters` before its first code change; agent-verified, not human-verified.

| Fixture | URL | Adapter | Generic (after retirement) | Detector | Reader reason |
| --- | --- | --- | --- | --- | --- |
| `amazon-observed-subtotal.html` | `www.amazon.com/gp/cart/view.html` | subtotal USD 6.99 | **hidden** (`not-a-cart`) | `none`, `no-structure` | `ambiguous` |
| `amazon-observed-quantity.html` | `www.amazon.com/gp/cart/view.html` | subtotal USD 13.98 | **hidden** (`not-a-cart`) | `none`, `no-structure` | `ambiguous` |
| `amazon-observed-empty.html` | `www.amazon.com/gp/cart/view.html` | unavailable `empty-cart` | hidden (`not-a-cart`) | `none`, `no-structure` | `no-summary` |
| `bestbuy-observed-summary.html` | `www.bestbuy.com/cart` | estimated total USD 27.23 | amount: estimated total USD 27.23 | `cart`, `url-summary` | shown |
| `newegg-observed-subtotal.html` | `secure.newegg.com/shop/cart` | subtotal USD 249.99 | amount: subtotal USD 249.99 | `cart`, `url-summary` | shown |
| `newegg-observed-quantity.html` | `secure.newegg.com/shop/cart` | subtotal USD 499.98 | amount: subtotal USD 499.98 | `cart`, `url-summary` | shown |
| `newegg-observed-empty.html` | `secure.newegg.com/shop/cart` | unavailable `empty-cart` | hidden (`not-a-cart`) | `none`, `no-structure` | `no-summary` |

**Summary (7 fixtures).** Same amount and kind on all 4 fixtures where the adapter showed one at Best Buy and Newegg; both empty carts stay hidden under both readers (the adapter's `empty-cart` becomes the detector's `none`). On the two Amazon fixtures with an amount the generic reader shows **nothing** (the detector finds no cart structure in the reduced fixture, so the badge is hidden rather than in the rates view), where the adapter read the subtotal; no fixture produced a wrong amount. The Amazon fixtures are reduced to the `#sc-buy-box` summary the adapter targeted, so they say little about the live page; part 2 measures the live cart.

## Part 2: fresh captures (15.1m)

_Placeholder: filled by the coordinator (milestone 15.1m) from fresh pane captures of amazon.com, bestbuy.com and secure.newegg.com (`cart-1`, `cart-qty2`, `empty-cart`) taken under `generic-reader-protocol.11` rules (never checkout, never sign-in), with both readers run from the pre-deletion commit `3eff32ca`. A capture blocked by a bot wall is recorded as blocked._

| Capture | URL | Adapter | Generic (after retirement) | Detector | Reader reason |
| --- | --- | --- | --- | --- | --- |
| _pending_ | | | | | |
