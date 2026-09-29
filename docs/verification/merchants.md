# Merchant verification evidence

This records observed behavior, not broad merchant compatibility or issuer reward-category guarantees. The pilot implements Best Buy US and Newegg US. Best Buy has live reader observations and separate native fixture tests. Newegg also has a passing combined native-toolbar/live-cart comparison at two quantities. Final normal-Chrome and release-build checks remain open.

## Best Buy US — September 25, 2026

Method: isolated Chromium 153 profile, no account sign-in, one temporary physical cable added through the public Add to cart control. No checkout submission or purchase. The packaged `dist/src/checkout/content.js` reader was evaluated against the rendered live cart DOM. This proves the reader's behavior on those pages; Chrome toolbar permission/message/UI tests are separate evidence.

| Observed state | Displayed summary | Reader result |
| --- | --- | --- |
| Empty cart | Total $0.00 | Empty-cart structure recorded; matching sanitized fixture rejects a zero purchase |
| One item, quantity 1 | Subtotal $19.99; shipping $5.49; estimated tax $1.75; total $27.23 | USD 2,723 cents, kind `total` |
| Same item, quantity 2 | Subtotal $39.98; shipping FREE; estimated tax $3.50; total $43.48 | USD 4,348 cents, kind `total` |

The quantity change also changed shipping eligibility. Reading the retailer's summary avoided doubling shipping/tax or confusing a unit price with a line total. The temporary item was removed and the empty-cart heading verified afterward. These are observed test amounts, not current product offers or savings claims.

Separately, the packaged Chromium test invokes Chrome's real extension action through the documented DevTools `Extensions.triggerAction` command. It verifies page access is denied before the action, then exercises the native toolbar popup → worker → isolated-world script → captured amount → confirmed comparison path against the observed summary fixture. A changed DOM total is rejected before another comparison; manual correction remains usable. Host permissions remain empty. This is native extension-flow evidence on a fixture, not an additional live retailer test.

Observed selector contract: `table[data-testid="order-summary__price-summary-table"]`, also labeled `aria-label="Order Summary"`, with row labels in `th[scope="row"]` and amounts in `td`. Only visible, bounded summary cells are read. Conflicting totals, invalid currency/amounts, loading state, and missing summaries fail closed. No product names, address/payment fields, raw page HTML, or network interception are needed by the shipped reader.

The public source page is [Best Buy's cart](https://www.bestbuy.com/cart). The retained fixture [bestbuy-observed-summary.html](../../extension/tests/fixtures/bestbuy-observed-summary.html) contains only the sanitized numeric summary. The empty fixture is observed; the large-price fixture is explicitly synthetic. Raw browser profiles/screenshots stay outside the repository.

Limits: one anonymous desktop cart and one product type; no authenticated checkout, gift card, split payment, promotion, financing, marketplace item, mobile layout, or completed transaction was verified. Issuer category eligibility is still a user-confirmed assumption. Checkout paths may fall back to manual entry if they do not use the observed table contract. Automated fixtures must not be reported as additional live merchants.

Combined live-toolbar attempts are not counted as a populated-cart pass. Retailer search controls intermittently timed out. One test setup also navigated before Add to cart finished; the real native popup correctly reported that the resulting $0.00 cart had no amount to compare. That setup was corrected to await a populated cart, but the subsequent search controls still timed out. The successful native fixture check and successful live reader observations above remain separate evidence.

A subsequent read-only check confirmed the isolated browser profile's extension storage was empty and the retailer displayed “Your cart is empty.” No further cart mutation was needed.

On September 26, another isolated profile reached the public cart shell, but two public Best Buy product URLs failed with `ERR_HTTP2_PROTOCOL_ERROR` before the product rendered. No item was added in this attempt, and it does not satisfy the combined live-toolbar gate. The newly verified [extracted-ZIP flow](release-package.md) also uses a fixture and remains separate evidence.

## Newegg US — implemented and live-tested, September 26, 2026

Status: **supported pilot cart path with narrowly scoped live evidence**. An isolated Chromium 153 profile visited the public storefront, followed its cart link to [secure.newegg.com/shop/cart](https://secure.newegg.com/shop/cart), and used the public Add to cart control for one physical SSD sold/shipped by Newegg. The retailer also included a free gift. No address, account sign-in, checkout submission or purchase was used.

| Observed state | Visible summary | Interpretation for implementation |
| --- | --- | --- |
| Empty cart | “Your cart is currently empty.”; no `.summary-side` | No amount to compare |
| Physical item quantity 1, included gift quantity 1 | 2 selected; Selected Subtotal $249.99; delivery TBD; tax calculated at checkout; Est. Total TBD | A known subtotal, not a known charge total |
| Physical item quantity 2, included gift quantity 2 | 4 selected; Selected Subtotal $499.98; delivery TBD; tax calculated at checkout; Est. Total TBD | Quantity update observed; subtotal doubled, total still unknown |
| After removal | Empty-cart heading; zero Remove buttons; zero `.summary-side` elements | Temporary cart contents removed; cleanup verified at 08:17:08 UTC |

The add operation succeeded even though the initial harness waited for the wrong confirmation text: the page announced a cart-count update and showed a warranty offer. The subsequent cart read confirmed the actual items. The removal check waited for the empty-cart state; a click alone was not counted as cleanup.

Observed structure: `.summary-side` contains a `h1.row-title` and `.summary-wrap`; summary rows are `.summary-content > ul > li`, with labels and a sibling amount span/strong. `li.summary-content-total` is labeled `Est. Total`. The selected count includes gifts, so it cannot be used to infer physical quantities or money. The implemented `newegg-summary-v1` reader inspects only bounded visible `Selected Subtotal` and `Est. Total` rows. Only the exact observed `TBD` value allows subtotal fallback. Arbitrary malformed totals, conflicting or duplicate amount rows, loading indicators, and foreign currency fail closed. The URL contract accepts HTTPS `secure.newegg.com/shop/cart` with an optional trailing slash; other Newegg hosts and checkout routes are not supported.

Sanitized fixtures preserve the observed summary containers, labels and amount markup: [quantity 1](../../extension/tests/fixtures/newegg-observed-subtotal.html), [quantity 2](../../extension/tests/fixtures/newegg-observed-quantity.html), and [empty](../../extension/tests/fixtures/newegg-observed-empty.html). The four retained summary rows were compared against both raw live captures before implementation and matched. Promotion/payment controls and unrelated content are omitted. Raw profiles and screenshots remain outside the repository.

### Combined native-toolbar/live-cart check

The production build passed this flow in a fresh Chromium 153.0.8010.12 profile, without routing or replacing merchant responses. Chrome's actual extension action opened the native popup, which selected both owned cards and recorded zero previous annual online-retail spend. Reading the live cart selected Newegg automatically. With eligible online goods and purchase exclusions explicitly confirmed, the popup showed:

| Live cart | Captured basis | Blue Cash Everyday estimate | Quicksilver estimate |
| --- | --- | --- | --- |
| Physical quantity 1 | $249.99 subtotal; total TBD | $7.49 | $3.74 |
| Physical quantity 2 | $499.98 subtotal; total TBD | $14.99 | $7.49 |

Both results visibly identified **Newegg US subtotal** and excluded tax/shipping. After the real quantity change, reopening did not display the previous saved estimate; a fresh read and confirmation produced the new result. Expected cents were independently computed in the harness. These estimates are conditional arithmetic checks, not earned rewards or verified issuer coding. Permissions contained no persistent origins. Deleting data left extension storage empty. Removing the temporary physical item also removed the gift; the empty-cart heading, zero Remove controls, and empty extension storage were confirmed at **08:40:01 UTC on September 26**. A compact [verification record](newegg-live-2026-09-26.json) retains amounts, build hashes, conditions and cleanup without page content or personal data.

The first attempt reused an unpacked-extension profile from before the implementation. Its popup loaded new assets while the background still returned the old Best Buy-only error. That attempt failed and its cart was cleaned up. A fresh profile loaded the current build and passed; the failed attempt is not counted as verification. Reload unpacked extensions after a rebuild. This does not prove a store-installed upgrade or ordinary installed-Chrome behavior.

The separate native fixture test covers popup close/reopen with confirmation reset, changed amount rejection before comparison, a fresh quantity read, manual merchant switching, and clearing stale inputs/results. Unit/component tests also reject merchant/version mismatches and preserve an older downloaded catalog's original merchant scope. The bundled pilot and unapproved seed are version `.2`; source dates and expiry are unchanged.

Limits: one anonymous desktop cart and physical product type with an included gift. Numeric estimated totals have synthetic regression coverage only. Selected-item changes, final charged totals, authenticated checkout, promotions, alternate sellers, international/mobile layouts, payment methods, completed transactions, and issuer coding remain unverified. When the final charge becomes known, the shopper must enter it or deliberately compare only the displayed subtotal.

## Remaining release checks

- Complete the combined Best Buy native-toolbar/live-cart check; its existing live reader and native fixture evidence remain separate.
- Repeat both declared merchant paths in the final release build. Newegg's current combined flow is passing evidence for this development build.
- Repeat the [verified packaged lifecycle cases](extension-lifecycle.md) in the final normal Chrome smoke pass. Local fixture checks now cover same-tab reload, popup closure during capture, cross-origin permission revocation, and actual idle-worker shutdown/recovery.
- Ask a small tester group to reproduce the supported flow before submission; record failures honestly.
