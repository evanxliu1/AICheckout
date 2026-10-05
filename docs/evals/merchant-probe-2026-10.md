# Merchant feasibility probe, 2026-10

Phase 10 of the [merchant coverage plan](../../wiki/product/phase-10-merchant-expansion.md), run on 2026-10-05 per the [probe plan](../../wiki/product/phase-10-feasibility-probe.md). No product code. Committed evidence: `evals/merchants/probe/sites.json` (sites and outcomes), `labels.json` (displayed totals), `reader-results.json` (prototype reader runs), and the prototype tools in `evals/merchants/probe/tools/`. Snapshots, screenshots, the Tranco file and the probe profile are gitignored under `evals/merchants/probe/data/` and `profile/`.

**Labels are agent labels.** Labeler 1 is the builder of this probe (claude-code/claude-opus-5-5). The second, independent labeler has not run yet. All label-based figures below are provisional until that check, and they are agreement with one agent, not human-checked accuracy.

## Verdict

- **Go.** 16 of 25 sites (64%) put an item in a logged-out cart and showed a cart summary. That is above the stop rule's threshold of half. Of those 16, 14 also showed an order summary on the first checkout page without sign-in.
- **The caveat is the top band.** Only 3 of the 8 top-1k sites reached a cart. Five were stopped by bot defences before or at add-to-cart. In the 1k–10k band 5 of 8 reached a cart, and in the 10k–100k band 8 of 9 did. The shopper's own browser does not face these walls, so this mainly limits **capture for evaluation** (Phase 12), not the product.
- **Proposed Y = 80%** found-correct on the one-item cart-page state, on the held-out split (reasoning in [Y](#proposed-y)).

## Site list (Q1)

The source is Tranco list [647LX](https://tranco-list.eu/list/647LX/1000000), the daily list generated 2026-10-04 from CrUX, Farsight, Majestic, Radar and Umbrella over 2026-09-05 to 2026-10-04 (Le Pochat et al., NDSS 2019). It was checked against the [NRF 2026 Top 100](https://nrf.com/research-insights/top-retailers/top-100-retailers/top-100-retailers-2026-list), read 2026-10-05. CrUX was not needed. "Cart" means a logged-out cart or mini-cart summary was shown. "Checkout" is the first checkout page.

| Domain | Tranco rank | Band | Platform | Cart | After add-to-cart | Checkout (logged out) |
| --- | ---: | --- | --- | --- | --- | --- |
| apple.com | 10 | top 1k | custom | yes | goes straight to the bag page | sign-in interstitial; "Continue as Guest" led to a 404 (not retried) |
| samsung.com | 109 | top 1k | custom cart on `shop.samsung.com` (SAP Commerce marker on the home page) | yes | goes straight to the cart page | guest gate that needs an email; it shows the order summary |
| walmart.com | 476 | top 1k | custom (Next.js) | **blocked** | — | bot wall ("Robot or human?") on the first product page |
| target.com | 611 | top 1k | custom | **blocked** | — | press-and-hold verification after choosing shipping |
| ikea.com | 637 | top 1k | custom | yes | drawer, price only | reached after a "Continue as guest" choice |
| nike.com | 651 | top 1k | custom (Next.js) | **blocked** | — | add-to-cart refused by a modal that asks to disable extensions |
| homedepot.com | 768 | top 1k | custom | **blocked** | — | HTTP 403 on category and product pages |
| lowes.com | 965 | top 1k | custom | **blocked** | — | "Access Denied" (403) on the product page |
| costco.com | 1,004 | 1k–10k | custom | **no** | — | no add-to-cart button: delivery "Unavailable" for the ZIP the site chose |
| logitech.com | 2,088 | 1k–10k | custom storefront; Global-e checkout | yes | popover with subtotal | reached; the summary is inside a Global-e iframe |
| barnesandnoble.com | 2,188 | 1k–10k | custom storefront; Shopify checkout | yes | drawer with subtotal | reached on `shop.barnesandnoble.com` |
| wayfair.com | 2,580 | 1k–10k | custom | **blocked** | — | press-and-hold (429) on the first category page |
| sonos.com | 2,939 | 1k–10k | Salesforce Commerce Cloud (headless) | yes | popover, price only | reached |
| gap.com | 3,331 | 1k–10k | custom (Next.js) | yes | modal, price only | reached (email step with summary) |
| ulta.com | 4,862 | 1k–10k | custom (25–29 open shadow roots) | yes | drawer, price only | reached through a "Checkout as guest" link |
| skechers.com | 5,622 | 1k–10k | Salesforce Commerce Cloud | **blocked** | — | add-to-cart error twice, then HTTP 429 on `/cart` |
| corsair.com | 10,382 | 10k–100k | custom storefront (Next.js); Shopify checkout | yes | drawer with total | reached on `checkout.corsair.com` |
| bose.com | 11,276 | 10k–100k | Salesforce Commerce Cloud | yes | drawer with subtotal | reached |
| fashionnova.com | 11,949 | 10k–100k | Shopify | yes | dropdown with subtotal | reached |
| hottopic.com | 14,270 | 10k–100k | Salesforce Commerce Cloud | yes | dropdown with subtotal | **blocked**: DataDome CAPTCHA on `/checkout` |
| gymshark.com | 23,863 | 10k–100k | Shopify (headless storefront) | yes | drawer (summary below the drawer's fold) | reached on `us.checkout.gymshark.com` |
| yeti.com | 26,857 | 10k–100k | Salesforce Commerce Cloud | **blocked** | — | press-and-hold (403) on the first category page |
| glossier.com | 47,749 | 10k–100k | Shopify | yes | drawer with subtotal and estimated total | reached |
| zumiez.com | 53,839 | 10k–100k | Adobe Commerce (Magento) | yes | dropdown with order total | reached |
| allbirds.com | 68,312 | 10k–100k | Shopify | yes | drawer (`/cart` redirects to it) | reached |

**Strata.** The sample is 8 / 8 / 9 sites across the three bands. Platforms: Shopify storefront 4; custom storefront with Shopify checkout 2; Salesforce Commerce Cloud 5; Adobe Commerce 1; SAP Commerce marker 1; custom or none detected 12. That is at least four platforms.

- **Shadow DOM.** No storefront kept its cart summary in a shadow root. Ulta has 25–29 open shadow roots on its cart pages, but its summary rows are in the light DOM. Closed roots appear on 8 sites, typically in payment buttons and widgets. None of them held a summary.
- **Third-party checkouts.** Logitech uses a Global-e iframe. Shopify checkout runs on a separate host for Barnes & Noble, Corsair and Gymshark.

**Platform detection.** Platforms were read from markers in the page HTML (`cdn.shopify.com`, `demandware`, `Magento_`, `/_ui/`, `__NEXT_DATA__`) and from the checkout host. The prototype's `magento` marker gave false positives (`mage/` matches `image/`), so it was not used.

## Exclusions

Sites were excluded from the U.S. online retail of physical goods as follows:

- **Plan rule.** amazon.com, bestbuy.com and newegg.com.
- **Cross-border marketplaces with foreign sellers.** temu.com, shein.com and aliexpress.com.
- **Marketplaces.** ebay.com and etsy.com. They are in retail scope as `marketplace` hosts, but first-party retailers were preferred for 25 slots.
- **Non-U.S. retailers.** hm.com and zara.com.
- **Not retailers.** rakuten.com (cashback service).
- **Mostly digital goods.** playstation.com, xbox.com and nintendo.com.
- **Pharmacies, a sensitive health category.** cvs.com and walgreens.com.
- **Adult and illegal sites.** Every adult site in the top 1,000 was dropped, as the plan requires.
- **Other candidates.** hp.com, dell.com and lenovo.com were considered and not picked; their band was filled by NRF Top 100 retailers. kohls.com, macys.com, lego.com, adidas.com, dickssportinggoods.com, chewy.com and lululemon.com were deprioritised because their home pages returned 403 or 429 to a plain fetch during selection. See [deviations](#deviations-and-limits).

## Q2: what stops automation

| Stop | Sites |
| --- | --- |
| HUMAN/PerimeterX press-and-hold or "Robot or human?" | walmart, target, wayfair, yeti |
| Edge 403 "Access Denied" or error page | homedepot, lowes |
| Add-to-cart refused quietly or with a message | nike (asks to disable browser extensions), skechers (site error, then 429) |
| No add-to-cart for the site-chosen location | costco |
| CAPTCHA at checkout | hottopic (DataDome) |

Nothing was solved, bypassed or retried more than once. Non-blocking prompts were:

- **Cookie banners on at least 10 sites.** Each was declined or closed where possible, otherwise left alone.
- **Email sign-up modals.** On Bose the modal intercepted add-to-cart until it was closed. Fashion Nova, Gap, Allbirds and Skechers also showed them.
- **Site-chosen locations.** A ZIP from IP geolocation was set on Samsung, IKEA, Target, Walmart, Costco and Hot Topic. It could not be changed without typing. Samsung's default ZIP made the first item unavailable, so a second item was used.
- **Invisible reCAPTCHA frames.** Present on Fashion Nova, Zumiez, Target, Lowe's and Ulta. None showed a challenge.

## Q3: how summaries are built

- **After add-to-cart.** 14 of the 16 cart sites opened an in-page cart: a drawer, dropdown, popover or modal. Apple and Samsung went straight to a cart page. Of the 14 mini-carts, 10 show a subtotal or total row and 4 show only the item price. Gymshark's total row sits below the fold of a scrollable drawer.
- **Cart pages.** Every cart site has a cart page except Allbirds, where `/cart` reopens the drawer. Each summary has a subtotal row. Most also have an estimated-total row, which sometimes includes shipping (Gymshark, Bose, Ulta).
- **Shadow DOM and iframes.** No summary was in a shadow root, closed or open. One was in an iframe: the Logitech checkout, inside the Global-e iframe, which a top-frame reader cannot see and must answer `none`.
- **Distractors seen.**
  - Strikethrough list prices (Fashion Nova, Corsair, Barnes & Noble).
  - A pre-discount subtotal above a negative discount row (Corsair).
  - Per-line "Total" labels (a Hot Topic line item; Logitech's checkout table header).
  - "Pay in 4" installment lines on most sites.
  - Free-shipping progress bars on most sites.
  - "Bought together" subtotals on an Ulta product page.
  - A headline sentence that repeats the total (Apple).
  - Cents in a separate superscript element (IKEA).
  - An opt-out add-on placed in the order (Allbirds returns coverage).

## Q4: can the badge frame show

The test extension (`tools/frame-ext/`) mounts a `chrome-extension://` iframe the way the cart badge does: a host on `<html>`, a closed shadow root and a web-accessible page. It records whether the frame loads. The frame **loaded on all 44 captured pages** across the 16 cart sites, including the 4 whose cart pages send an enforcing CSP that restricts frames:

- Gymshark: `frame-src` and `child-src`.
- Barnes & Noble: `frame-src` and `default-src`.
- IKEA: `frame-src` and `default-src`.
- Zumiez: `frame-src`, `child-src` and `default-src`.

None of these policies lists `chrome-extension:`, so in the test browser (Chrome for Testing 153) an extension-scheme frame is not subject to the page's frame directives. The probe did not test a closed-shadow summary, because none was found. The design's open point about `web_accessible_resources` exposure (`use_dynamic_url`) is unchanged.

## Q5: does a prototype reader find the total

`tools/prototype-reader.mjs` implements design steps 1–3 and a simple decide:

1. **Summary region.** Found from summary headings and from `summary`/`total` attribute markers.
2. **Total rows.** A label paired with exactly one amount, smallest element.
3. **Distractors.** Text such as savings, installments and shipping progress; recommendation, carousel and line-item containers; strikethrough amounts; negative amounts.
4. **Decide.** One amount of the most preferred kind inside a region gives `found`; otherwise `ask` or `none`.

It runs over the 44 `dom.json` snapshots. In 38 of them a top-frame total is displayed. Labeler 1 wrote the labels from the screenshots before the reader first ran. Two labeler errors were corrected after run 2, against the capture-time screenshot and DOM, not the reader output (recorded in `labels.json`):

- Gymshark mini-cart: the summary sits below the drawer's fold.
- Hot Topic mini-cart: the dropdown had closed before capture.

| Run | Found-correct | Found-wrong | Ask (right amount among candidates) | Ask (without it) | None, total missed | None, correct |
| --- | --- | --- | --- | --- | --- | --- |
| 1, as first written | **25 / 38** (66%) | 1 | 1 | 1 | 11 | 5 |
| 2, one visibility fix | **31 / 38** (82%) | 1 | 5 | 1 | 1 | 5 |

| State (run 1 → run 2) | Snapshots with a total | Found-correct |
| --- | --- | --- |
| Cart page (one item) | 16 | 12 → **14** (Wilson 95%: 50–90% → 64–96%) |
| First checkout page | 13 | 11 → 12 |
| Mini-cart | 9 | 2 → 5 |

**Run 2 is not a held-out figure.** Its one change was made after seeing run 1, on the same snapshots. Run 1 had treated a zero-size ancestor (floats, `display: contents`) as hiding its children.

**The false found, both runs, is IKEA's checkout.** The cents of the estimated total are a superscript without a decimal point, so the row failed to parse. The reader then returned the "Products" subtotal as `found`. The design's zero-false-found criterion would fail on this page. Reader v1 needs split-amount parsing, and a rule that a summary with an unparsed total-labelled row is never `found` on a lower kind.

**Other failure classes.** These are reported, not tuned:

- Corsair's mini-cart labels its total with a cart count instead of a total word (`none`).
- Five `ask` results (Allbirds, Fashion Nova, Logitech mini-cart) came from pages where no summary region was recognised: the prototype caps those at `ask` even with one candidate amount.

**Timing.**

- **Reader logic:** p50 2.1 ms, p95 8.5 ms, max 12 ms per snapshot (run 2) over the JSON tree (Node 24, owner's Mac, parse excluded).
- **Capture-time in-page walk:** p50 276 ms, p95 691 ms. This walk calls `getComputedStyle` on every node. The budget risk is style access in the live DOM, not the algorithm. Reader v1 should read styles lazily, only inside candidate regions, to stay under the 50 ms p95 budget. The probe did not measure that.

## Q6: does a 2 MiB merchant database fit `chrome.storage.local`

Measured rather than only desk-checked, in the test extension's service worker on Chrome for Testing 153. A 2,100,590-character JSON value (12,200 merchant rows) was stored as one string:

- `getBytesInUse` reported 2,369,004 bytes against `QUOTA_BYTES` 10,485,760. That leaves about 4.4× headroom before the catalog cache is counted.
- `set` took 164 ms, `get` 9 ms and `JSON.parse` 4 ms.

It fits without `unlimitedStorage`. The 2 MiB cap in the design leaves room for the catalog and the session data.

## Proposed Y

**Y = 80%** found-correct on the held-out split's one-item cart-page state, alongside the unchanged 0 false-found requirement. Reasons:

- The untuned prototype found 12 of 16 cart pages. After one bug fix it found 14 of 16. Reader v1 will be tuned on a development split three times larger, with split-amount parsing, lazy styles and kind rules.
- An 80% target sits below the fixed prototype's point estimate (88%) and inside both runs' 95% intervals. That allows for held-out pages that look less like the development pages.
- A higher target (90% or more) would invite `found` on ambiguous pages. That trades against the zero-false-found rule, which matters more because a wrong prefilled amount silently misranks cards. Pages with no readable total, such as iframe checkouts, are not counted against found-correct only when they answer `none`.

Evan sets Y in the Phase 12 protocol. This is the recommendation.

## Deviations and limits

- **Site classification used a candidate list.** About 300 known U.S. retail domains were looked up in Tranco and the top 1,000 was read in full. The top 100,000 was not classified exhaustively.
- **Selection bias.** For platform markers, 93 candidate home pages were each fetched once with `curl` before the visits. Domains that answered 403 or 429 were mostly passed over. That biases the sample toward reachable sites, so the 64% cart rate is optimistic for top retailers. Home Depot was chosen despite a 403 and was blocked.
- **Browser setup.** The browser was Playwright's Chrome for Testing 153 in a fresh probe profile, not branded Chrome. The test extension was loaded throughout, and Nike's refusal cites extensions.
- **Clicks beyond size, colour and add-to-cart.** None typed anything or submitted a form other than add-to-cart.
  - Declining or closing cookie banners and popups. One popup close was a coordinate click inside a third-party iframe.
  - "Continue as Guest" buttons (`type=button`, no enclosing form) on Apple and IKEA, and Ulta's guest link.
  - Checkout buttons that were links or non-form buttons.
- **Checkout pages reached by URL.** For Shopify and Magento, `/checkout` was opened by URL instead of clicking a form-submit checkout button.
- **One possible stray page load.** During a driver restart, a mistyped command may have loaded the stanley1913.com home page once. That domain is not in the sample, and nothing else was done there.
- **Snapshot format.** `dom.json` is a custom computed-style tree with open shadow roots inlined, saved beside `page.html`, MHTML and a full-page screenshot. It is not a Playwright trace.
- **Pending checks.** The second labeler and the independent review of this report have not run.

## Related

* [Probe plan](../../wiki/product/phase-10-feasibility-probe.md)
* [Merchant coverage design](../../wiki/system/merchant-coverage-design.md)
* [Decision: probe method choices](../../wiki/decisions/2026-10-05-merchant-probe-method.md)
