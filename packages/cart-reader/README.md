# @ai-checkout/cart-reader

The generic cart reader (Phase 13, [plan](../../wiki/product/phase-13-reader.md)). `readCart(document, { url })` reads a checkout or cart page and returns the cart total it is **certain** of, or withholds:

```ts
{ shown: true, kind: 'afterCredit' | 'estimatedTotal' | 'subtotal', amountMinor: number, currency: 'USD' | 'EUR' | ... }
{ shown: false, reason: 'no-summary' | 'ambiguous' | 'currency-undetermined' | ... } // reason: [a-z0-9-]{1,64}
```

The extension shows the amount only when the reader shows one; otherwise it shows card rates only. A wrong shown amount is the costly error; a withhold only costs coverage.

## Cart page detector (Phase 13c)

`detectCartPage(document, { url })` says whether the page is the shopper's cart (`cart`), a checkout step (`checkout`) or neither (`none`), with a short machine `reason`; `cartUrlHint(url, title)` is the cheap first signal a content script can run before touching the DOM (null means stop); `readCartPage(document, { url })` returns the detection and the reader's reading from one pass. The same rules bind it (deterministic, synchronous, generic, no `data-pane-*`). A positive needs a URL or main-heading cart word and a structure signal in the main content (a summary row the reader finds, or cart line items). Plan and signals: [Phase 13c](../../wiki/product/phase-13c-cart-detection.md#the-detector); harness: `evals/reader/detect.mjs`.

## Rules the reader must keep (binding)

- **Deterministic and local.** It reads only the `document` given (open shadow roots included) and `options.url`. No model, network, storage, clock, randomness, timers or global state between calls. Synchronous.
- **Generic.** No per-store rules: no domain or hostname lists, no per-site selectors or class names. Words, number formats, currency symbols and generic structure (landmarks, ARIA, headings, rows, visibility) only. The harness's bundle tripwire refuses any split domain and more than 3 frame domains in the bundle.
- **Never reads `data-pane-*` attributes** (labelling aids the harness strips anyway).
- **Shows one amount of the most preferred kind** — `afterCredit` (total after a gift card, store credit or points) > `estimatedTotal` (an order total, with or without tax or shipping; a sale-discounted total; a total excluding tax) > `subtotal` (items total) — read from the cart summary and visible to the shopper. It withholds when the summary isn't found, the preferred kind has two different amounts, the amount can't be parsed, the currency isn't certain, or anything else is in doubt.
- **Currency** follows the protocol's [currency evidence](../../docs/evals/generic-reader-protocol.md#currency-evidence) order: an ISO code or country-named dollar in the summary; structured data (`priceCurrency`, currency meta tags, cart currency attributes) if consistent; an unambiguous symbol (€, £, ₹, ₩, zł, ...); otherwise the storefront's currency from the page URL (for example the TLD) only when the symbol is ambiguous ($, ¥, kr, R) and nothing on the page points elsewhere. `lang` alone never decides. `amountMinor` uses the currency's ISO 4217 minor unit (`evals/merchants/currency-minor-units.json`: cents for USD, units for JPY and KRW).
- **Budget:** p95 ≤ 50 ms per read on the harness machine; read computed styles lazily, only inside candidate regions.

## How it is measured

`evals/reader/` ([README](../../evals/reader/README.md)) loads each frozen page rebuilt offline (JavaScript off, network blocked), reads it six times and scores shown-correct, shown-wrong and withheld against the frozen labels (`reader-labels.2`), with exact bounds; coverage is on `cart-1` and excludes `cart-other`. Offline variants test robustness (class renames, fake subtotals outside the summary, promo rows, injected instructions, credit applied, format swaps, zero-decimal currencies, mixed currencies) and are reported apart.

```sh
npm run test --workspace=@ai-checkout/cart-reader          # unit tests (synthetic pages; jsdom has no layout, so box and visibility rules are covered by the harness, not here)
node evals/reader/dev.mjs                                    # quick loop: development, one read per page, ~5 min
node evals/reader/run.mjs --split development               # official run (six reads per page, ~25 min)
node evals/reader/score.mjs --run <runId> --failures         # per-page failures, development only
```

**Tune on development.** The reader is developed from development pages and their failures; held-out A is read for the score (`run.mjs --split heldout-a --confirm-heldout-run <n>`, at most twice), so it measures how the rules carry over to stores they were not tuned on ([plan](../../wiki/product/phase-13-reader.md)).
