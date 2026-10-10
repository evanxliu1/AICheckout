---
type: Product
title: Phase 13c plan (cart page detection and the badge at any store)
description: Recognise cart and checkout pages at any store with a generic, deterministic detector, show the automatic badge there with the best card and a dollar estimate when the reader is certain, or the best card and its rate otherwise, never ask for a typed amount, measure detection on the frozen set and a live sweep of home pages, then one reader round on coverage.
status: stable
tags: [product, plan, phase-13, merchants, reader, badge]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-10T01:10:00Z
sources:
  - resource: phase-13-reader.md
    title: Phase 13 plan (reader v1 and 13b)
  - resource: ../system/cart-badge.md
    title: Cart badge
  - resource: ../system/extension.md
    title: Extension
  - resource: ../../docs/evals/reader-v1.md
    title: Generic cart reader v1 results
  - resource: ../decisions/2026-10-09-badge-on-all-sites.md
    title: Decision, badge on all sites at install
  - resource: ../decisions/2026-10-09-never-ask-for-an-amount.md
    title: Decision, never ask for a typed amount
---

# Phase 13c plan: cart page detection and the badge at any store

Planned 2026-10-09. Evan, in chat that day, after trying the 13b build: "the popup does not show on any of the carts i check that are outside the three we hard support, do we have cart/basket/checkout page recognition? for any general website? we need this too", then "plan phase 13c THOROUGHLY, and then use fable agent to implement and review". Branch `phase13c-cart-detection`, one PR. Implementer and reviewer: separate Fable 5.1 (`claude-fable-5-1`) subagents; the coordinator runs the held-out and live measurements.

Evan's three calls (2026-10-09, [badge on all sites](../decisions/2026-10-09-badge-on-all-sites.md), [never ask for an amount](../decisions/2026-10-09-never-ask-for-an-amount.md)):

1. **All sites at install.** The extension asks for access to all `https` sites at install, and the badge runs at any store from the start. This moves the "automatic badge on all sites" out of Phase 17 (telemetry stays there) and widens what Phase 15's privacy policy and store listing must say.
2. **No typing.** The shopper is never asked to type an amount. When the reader is certain, the badge shows the best card and a dollar estimate. When it is not, the badge shows the best card and its rate. An optional amount edit stays in the expanded panel for a shopper who wants it, but nothing prompts for it.
3. **Now, before Phase 14.** The store's category still comes from the merchant profile. A store not in the catalog uses the generic "Another U.S. online store" profile (general and online-retail rates) until the Phase 14 merchant database gives stores their categories. The page's products never decide the category: rewards follow how the store's payments are coded, not what is in the cart.

## What the extension must do

### The detector

`detectCartPage(document, { url })` in `packages/cart-reader` (beside `readCart`, the same rules: deterministic, synchronous, generic, no domain lists or per-site selectors, no `data-pane-*`) returns `{ page: 'cart' | 'checkout' | 'none', reason }`, where `reason` is a short machine string with no page text.

- **`cart`:** the page's main content is the shopper's cart (a cart or basket page, a bag page), with at least one item.
- **`checkout`:** a checkout step page (shipping, payment, review) with an order summary.
- **`none`:** everything else, including:
  - a product page with an open mini-cart drawer (the drawer is not the cart page);
  - an empty cart ("your cart is empty" in any language, or a zero total from `readCart`);
  - home, search, category, account and content pages;
  - non-store sites.
- **Signals, cheapest first:**
  1. URL path, host and fragment words for cart, basket, bag, trolley and checkout in many languages (cart, basket, bag, trolley, checkout, panier, warenkorb, carrello, carrito, cesta, carrinho, sacola, winkelwagen, kurv, varukorg, ostoskori, koszyk, košík, kosár, sepet, корзина, カート, 购物车, 장바구니, …), on word boundaries, so `cartier`, `/cartography` and `add-to-cart` endpoints don't count.
  2. The document title and main headings (`h1`, `role=heading` level 1–2, `aria-label` of `main`).
  3. Page structure: an order-summary region (the rows `readCart` already finds) and cart line items (quantity controls, remove controls) in the main content, not in a hidden or off-canvas drawer.
- **Decision.** A positive needs a URL or heading signal and a summary or line-item signal in the visible main content. URL alone is never enough, so a `/cart` link checker or a blog post about carts stays `none`.
- **Budget.**
  - On a page whose URL and title carry no hint, the detector reads only `location` and `document.title`, under 1 ms.
  - On a hinted page, detection plus `readCart` takes ≤ 50 ms at p95, the same budget as the reader.

### The badge at any store

- **Reach.** The badge content script is declared for `https://*/*`, top frame only, `document_idle`. `host_permissions` become `https://*/*` (plus the catalog endpoint as today). The badge iframe page is web-accessible on `https://*/*`.
  - The implementer evaluates `use_dynamic_url: true`, which makes the extension harder for sites to fingerprint, against the worker's sender check by URL. They record the outcome in the [cart badge](../system/cart-badge.md) page and the decision.
  - `http:` pages stay out, as today, because routing accepts readings from `https` only.
- **One reader per URL** (unchanged from 13b, [decision](../decisions/2026-10-09-generic-read-on-legacy-site-pages.md)):
  - a legacy adapter's URL patterns use the adapter exactly as today, order-confirmation pages and savings included;
  - every other `https` page uses the detector, then `readCart`.
- **Merchant.** `merchantForTab(url)`, the same rule as 13b: a legacy store's other pages name that store, and every other site gets `generic-us-online`. Readings carry `generic-reader-v1`.
- **What shows:**

  | Detector | `readCart` | Currency | Badge |
  | --- | --- | --- | --- |
  | `cart` or `checkout` | shown, amount > 0 | USD | Best card and its dollar estimate, as today (`est.` where valued) |
  | `cart` or `checkout` | withheld | — | Best card and its rate, no amount and no input prompt ("rates view") |
  | `cart` or `checkout` | shown, any amount | not USD | Hidden (the engine is U.S.-only) |
  | `cart` or `checkout` | shown, zero | any | Hidden (empty cart) |
  | `none` | not run | — | Hidden |

  The legacy stores' "Can't read this cart — enter the amount" state becomes the rates view too.
- **Rates view.**
  - The worker ranks the owned cards with no cart amount and shows each card's rate as the engine words it: percent back, points per dollar with the valued percent, or a range where conditions decide.
  - If ranking at a reference amount is needed, the implementer chooses one, documents it, and shows the existing ranking note when caps, minimum spend or a threshold could change the order at the real amount.
  - The panel says the amount wasn't read and that rates don't depend on it.
  - The panel's optional amount edit remains; nothing asks for it.
- **Single-page sites.** Moving into a cart without a reload (history push, hash change) starts detection, and leaving it hides the badge. The implementer chooses the mechanism and tests both directions:
  - the worker's `tabs.onUpdated` URL changes, sent to the tab;
  - the Navigation API in the content script;
  - a cheap URL check on the existing debounce.
  - Pages without a URL or title hint attach no `MutationObserver`; the observer runs only on hinted pages.
- **Turning it off.**
  - A settings toggle "Show the badge at other stores" (on by default) covers every non-legacy site.
  - "Don't show on this store" for a generic store records the site's host (`disabledSites`), not the shared `generic-us-online` id, which would hide the badge everywhere.
  - Both are stored state with Zod contracts and defaults for existing installs.
- **Privacy.**
  - The content script still never makes network requests, sends only the reading (`{ page, shown, kind, amountMinor, currency }` or a withheld reason) and learns only `{ show }`.
  - Card data reaches only the badge iframe.
  - No page text, URL path or product data is stored or sent.
  - The worker keeps per-tab state as today; `disabledSites` holds hostnames the shopper chose.
- **Order confirmation.** URL-only order detection and the savings prompt stay with the three legacy stores. Generic thank-you pages are out of scope, a reported gap.

### The popup

- **Opening the popup on an `https` tab reads the page automatically.** Clicking the toolbar icon grants `activeTab`, and the all-sites permission covers the rest. There's no "Read cart amount" click first.
- The popup uses the same detector and the same outcomes as the badge:
  - a certain USD amount fills in and compares;
  - otherwise it compares in the rates view;
  - on a non-USD store it shows the USD-only message, as today.
- The amount field stays available and optional. The popup never shows an error asking for an amount when the read withholds.
- The "Read cart amount" button stays as a re-read.

## Measurement

The detector is new, so the frozen set's held-out A is unseen data for it; its two reader runs are used, so **the reader's own held-out numbers stay those of v1 run 2**.

| Set | Pages | Expected | What is reported |
| --- | --- | --- | --- |
| Frozen set, development | real `cart-1`, `cart-qty2`, `cart-2items`, `cart-other` (cart positives); `minicart-1` (product pages with an open drawer); `empty-cart` (cart page or product page, empty) | positives → `cart`/`checkout`; `minicart-1` and `empty-cart` → badge hidden | tuning only; counts per state |
| Frozen set, held-out A | the same states | the same | **one** detector run at the end (`--confirm-heldout-run 1`), with exact Clopper–Pearson bounds at page and store level |
| Live home pages | the home page of every store in `sites.json` plus about 50 popular non-store sites (news, reference, docs, video, government), one load each, logged out, `robots.txt` respected, bot walls never bypassed | `none` | false shows with bounds; loaded vs blocked counts |
| Synthetic fixtures | unit tests and e2e pages: a blog about carts, a `/cart` link page, a product page with an open drawer, empty carts in several languages, a checkout step, single-page navigation | as written | pass/fail |

- **Metrics.**
  - **Badge recall:** the share of cart positives where the badge shows, either view.
  - **False shows:**
    - `minicart-1`, `empty-cart`, live home pages and synthetic negatives where the badge shows;
    - by state and stream (U.S. vs non-U.S.).
  - **Badge content on shown cart pages:**
    - the amount view, which equals the reader's coverage, and the rates view;
    - wrong amounts, which equal the reader's precision.
  - **Time:** the detector's p95 and maximum time on unhinted and hinted pages.
- **Reporting targets, not gates:**
  - badge recall ≥ 95% on held-out cart positives;
  - false shows ≤ 1% on `minicart-1` and live home pages, by the upper bound where n allows;
  - no false show on a synthetic non-store page.
  - Everything is reported as measured.
- **Known limits, written into the report:**
  - checkout step pages were never captured (Phase 12 forbade entering checkout), so `checkout` detection is measured only on synthetic fixtures;
  - the frozen pages' URLs have no query string, so query-routed carts (`?route=checkout/cart`) are measured synthetically;
  - offline rebuilds have no live layout;
  - 95 bot-walled stores aren't in the set;
  - since the 13c.3 review fixes, `inMain` excludes `position: fixed` boxes (open drawers), so a checkout step whose only order summary is a fixed bottom bar is `no-structure` (coverage, not safety);
  - a "My Basket" saved-items or wishlist page whose rows carry a quantity control and a Remove control is indistinguishable from a cart and shows the badge (the reader then usually withholds, so the rates view).
- **Harness.**
  - `evals/reader/detect.mjs`, the quick loop and the scored run, reuses `run.mjs`'s page loading (`locate`, `readOnce`), logs scored runs to `evals/reader/runs.json` as `detector` runs, and enforces the held-out confirmation.
  - `evals/reader/live-home.mjs` runs the live sweep (built 2026-10-10): the home page of every store in `evals/merchants/splits.json` (both splits) plus the 55 non-store sites in `evals/reader/live-nonstore.json`, one load each in headless Chromium with a fresh context (logged out, no clicks, typing or forms), `robots.txt` checked first for a generic agent (`robots-disallowed`, never loaded), a 4xx/5xx or a challenge or block title → `blocked` (never bypassed), then `load` plus a 1.5 s settle and one `detectCartPage` from the same bundle and tripwire as `detect.mjs`. It saves no page content, only `{ domain, set, url, status: loaded | blocked | robots-disallowed | error, page, reason, hinted, ms }` in a gitignored run directory (`evals/reader/runs/live-home-<utc>/`, covered by the existing `/evals/reader/runs/` ignore). The summary (counts per status and set, false shows with Clopper–Pearson upper bounds, shown domains with reason codes only, detector times) goes to `evals/reader/live-home-summary.json`, committed by the coordinator after the run. Usage: `node evals/reader/live-home.mjs [--concurrency 4] [--timeout 30000] [--settle 1500] [--only <substring>] [--summary <file>]`.
  - The bundle tripwire applies to the detector, which ships in the same bundle.

## Milestones

| Milestone | Who | What | Done when |
| --- | --- | --- | --- |
| 13c.0 Plan | Coordinator | This page, the two decisions, roadmap, `now`, `user-directives`, `log` | Committed on `phase13c-cart-detection` |
| 13c.1 Detector | Fable implementer | `detectCartPage` and unit tests (synthetic, multilingual); `detect.mjs`; tuned on development (recall, false shows on `minicart-1` and `empty-cart`, time) | Quick loop numbers in the commit message; typecheck, lint and package tests green |
| 13c.2 Badge everywhere | Fable implementer | Manifest reach, content-script split (legacy adapter vs detector), worker generic merchant, rates view in the badge and the popup, the popup's read on open, single-page navigation, `disabledSites` and the settings toggle, contracts, unit and e2e tests (`e2e/badge-any-store.spec.ts`: amount, rates, drawer, empty, single-page in and out, non-USD, toggle and per-site off, legacy unchanged, axe) | `npm run lint && npm run format:check && npm run typecheck`, `npm test`, `npm run build`, the extension's Playwright suite green; content-script sizes recorded |
| 13c.3 Review | Fable reviewer (independent) | Reviews 13c.1–13c.2: genericity (no store rules), privacy (what leaves the page, what is stored), permission and fingerprinting, false-show risks, single-page handling, rates-view correctness against the engine, tests; must-fix and should-fix list | The implementer has fixed every must-fix and answered every should-fix; the reviewer re-checks |
| 13c.4 Measure | Coordinator | Held-out A detector run (once), the live home sweep, then `docs/evals/cart-detection-v1.md` | Report committed with bounds, counts and limits |
| 13c.5 Reader coverage | Fable implementer | One round on development's withheld cart pages (largest classes first), with no new shown-wrong on development real pages or variants; reported on development only, since held-out A's reader runs are used | Development quick loop and official development run in `runs.json`; the report's coverage section updated |
| 13c.6 Close | Coordinator | Wiki ([cart badge](../system/cart-badge.md), [extension](../system/extension.md), [architecture](../system/architecture.md), this page, `now`, `log`), Phase 15 doc list, PR, merge after CI | PR merged after every check passes |

Sessions are short (about 45 minutes) with frequent commits, as in Phase 13; subagents never push or merge.

## Phase 15 consequences

Not edited here (release docs are edited only when the task is about them); added to the Phase 15 list in [now](../now.md):

- `docs/release/privacy-policy.md`, `store-listing.md` (permission justification for `https://*/*`, the content script on every page, the single-purpose statement);
- `support.md` and `reviewer-instructions.md` (the badge at any store, the toggle, the rates view);
- `extension/README.md`.

## Progress

- **2026-10-09: planned** (13c.0).
- **2026-10-10: 13c.1 detector built** (Fable 5.1 implementer, commits `f85de6f`, `92ecd1d` and the docs commit after). `packages/cart-reader/src/detect.ts`: `cartUrlHint(url, title)` (URL path, query, fragment and host tokens, title words; `cartier`, `/cartography`, `/cart/add`, `add-to-cart`, product slugs and `minicart` excluded), `detectCartPage(document, { url })` and `readCartPage(document, { url })` (detection and the reader's reading from one pass). Signals: URL word, else a visible h1/h2/role=heading (level 1–2) or `main` aria-label outside headers, footers, navigation and dialogs; then a structure signal in that main content: a summary row the reader found (labelled, beside shipping, tax or a checkout control, non-zero, visible, whether or not its amount was readable) or line items (a visible quantity control and a visible remove control, or either within seven levels of a product image; open shadow roots searched). The `main` landmark is not relied on (stores wrap only part of the cart in it) and asides count as main content (checkout order summaries). `none` reasons: `no-hint`, `title-only`, `zero-total`, `no-structure`. Harness `evals/reader/detect.mjs` (quick loop and `--scored`; `runs.json` rows carry `kind: detector`, held-out allowance one run, `legacyBundleSha256` optional). Development quick loop: badge recall 385/414 = 93.0% (cart-1 176/188, cart-qty2 137/149, cart-2items 40/40, cart-other 32/37), false shows 0/119 `minicart-1`, 0/189 `empty-cart`, 323 amount view / 62 rates view, detector time unhinted p95 0.2 ms max 0.4 ms, hinted p95 10.9 ms max 34.8 ms. Remaining miss classes: 14 pages where the store's cart is a drawer opened at a product or home URL (by design, no URL or title hint; a known limit), 10 pages whose quantity and remove controls are `visibility: hidden` or boxless in the offline rebuild, 5 `OrderItemDisplayView`-style pages with a cart title but no main heading found (and in three of them the summary lives in an iframe). Held-out A not run.
- **2026-10-10: 13c.2 badge everywhere built** (Fable 5.1 implementer, commits `16baba3`, `da1c6b8` and the fixes commit after; [choices](../decisions/2026-10-10-rates-view-reference-amount-and-spa-navigation.md)). Manifest: content script, `host_permissions` and the badge page's web-accessible entry on `https://*/*`; `use_dynamic_url` evaluated and kept `false` (the worker routes `badge:*` by the static URL and the content script cannot obtain a dynamic one; the nonce guards page-made copies; sites can detect the extension by fetching the page). One reader per URL in `extension/src/checkout/manual-reader.ts:readAnyCart` (legacy adapter URLs unchanged, order pages and savings included; elsewhere `cartUrlHint` then `readCartPage`), shared by the badge content script and the popup. Worker: `merchantForTab` for generic readings (`generic-reader-v1` required; adapter versions on adapter URLs), tab entries carry the hostname, settings gain `showOnOtherStores` (default on) and `disabledSites` (hosts), "Not on this site" at a generic store records the host. The show table is as planned: USD amount → amount view; `withheld`, `summary-missing` or `ambiguous-amount` → rates view (ranked at `RATES_REFERENCE_CENTS` = $100, below every cap, so cents are basis points; `rateWording`: "2% back", "1%–3% back", "2 miles per $1 (est. 2%)"; the engine's ranking note and a spend-cap note; optional amount field, nothing asks); non-USD, zero or `none` → hidden. The legacy "Can't read this cart — enter the amount" state is gone. Single-page navigation: Navigation API `currententrychange` (fallback `popstate`/`hashchange`), one debounce, no observer on unhinted pages. Popup: reads on open on an https tab with cards (a saved cart or a comparison for the tab's store is kept instead), fills a certain amount, shows the rates view (`checkout:rates`, read-only) when withheld, the USD-only message on a non-USD cart, never an error asking for an amount; "Read cart amount" re-reads. Built sizes: `dist/src/badge/content.js` 44,268 bytes, `dist/src/checkout/content.js` 40,064 bytes (34,458 in 13b). Tests: 31 vitest files, 749 tests (new `rates-view.test.tsx`; generic paths in `auto-reader`, `badge-service`, `badge-routing`, `manual-reader`, `popup`); `e2e/badge-any-store.spec.ts` (amount, rates and its panel with axe, typed amount, drawer, empty, euro, single-page in and out, per-site by host and Settings, toggle with Best Buy unchanged, origins, nothing from the page in storage); `generic-read.spec.ts` and `lifecycle.spec.ts` updated for the rates view, the read on open (a comparison that fails its re-read is dropped and the current amount is read, unconfirmed) and all-https access (the activeTab check uses an http page, since https pages are now readable through the host permission). Browser suite: 21 passed, 3 skipped by design. Noted for 13c.3/13c.5: a product page whose title and heading contain a cart word as a standalone token ("Leather bag") with an open drawer is detected as a cart (title hint + heading + the drawer's summary rows); the e2e drawer fixture uses "Leather wallet". Not done: `docs/release/` (Phase 15).
- **2026-10-10: 13c.3 review fixes applied** (Fable 5.1 implementer, after the independent review of `1c684a5`; commit after this entry). Detector (`detect.ts`): a title segment (split on `| - – — : · » « > /`) or heading counts only when it is the cart or checkout word plus filler (your/my/shopping/review/items, their equivalents in the supported languages, counts), so "Gift Basket", "Tote Bag", "Sleeping Bag", "Leather bag" and "Cart abandonment" no longer hint; line items need a visible quantity control **and** a visible remove control in the main content (the "either within seven levels of an image" rule is gone, so product steppers and quick-add tiles do not count); a path segment under a product, collection, category, brand, tag or search parent (`/products/bag`, `/collections/basket`, `/c/basket`) and a search query value (`?q=basket`, `?s=cart`) are slugs, not hints (generic URL conventions, no store rules); counts and ids beside the word (`/cart--4362`) are filler; `commande` and `pedido` dropped from the checkout words (order pages); a host label (`checkout.example.com`) alone never makes a checkout, it can still name the cart; `inMain` excludes `position: fixed` ancestors for headings, summary rows and line items (an open aside drawer on a hinted URL). Development quick loop after the fixes: badge recall **375/414 = 90.6%** (Wilson 87.4–93.0%; was 385/414 = 93.0%): cart-1 171/188 (91.0%), cart-qty2 133/149, cart-2items 40/40, cart-other 31/37; false shows **0/119 `minicart-1`, 0/189 `empty-cart`** (Clopper–Pearson upper 2.5% and 1.6%); 321 amount view / 54 rates view on shown positives; detector time unhinted p95 0.2 ms max 0.3 ms, hinted p95 10.9 ms max 30.6 ms. Misses 39: 16 `no-hint` (drawer carts at product or home URLs; was 14, the stricter title rule costs 2 title-hinted pages), 20 `no-structure` (was 10: ten more stores whose remove control is hidden, boxless or absent in the offline rebuild now that both controls are required), 3 `title-only` (OrderItemDisplayView pages with no main heading). Extension: the detector's `none` is a distinct reason `not-a-cart` (`manual-reader.ts`, `probeSchema`, `read-copy.ts`), which the popup's read on open ignores (a mail or news tab shows nothing, as before 13c) and the button names; the read-on-open skip rule keys a saved cart by its tab id and a saved comparison by a legacy store id only (a saved generic comparison never suppresses the read at another site); the `void adapters` nit removed. Wiki: `cart-badge.md` contradiction and pre-13c gotcha fixed, `verified_commit` updated. Built sizes after the fixes: badge `content.js` 46,386 bytes, manual reader 42,182. Gate green (lint, format, typecheck, `npm test`, build, browser suite 21 passed / 3 skipped). Tests: 95 cart-reader tests (title phrases, slugs, search terms, host checkout, product and listing pages with cart words, a fixed aside drawer), 750 extension tests (`not-a-cart` on open and on the button, the skip rule).
- **2026-10-10: 13c.3 re-check fixes and the live sweep tool** (Fable 5.1 implementer; reviewer: approve with fixes). Detector: a quantity control and a remove control count as line items only when they meet within six levels (one line block), and filter, compare, review, account, address, payment, coupon and "remove all" controls never count as a line's remove (`NOT_LINE_REMOVE_RE`); `PHRASE_FILLER` gains compra(s), achats, acquisti, aankopen, einkauf and similar; `styleOf` comment. Development quick loop: badge recall **375/414 = 90.6%** unchanged (cart-1 171/188, cart-qty2 133/149, cart-2items 40/40, cart-other 31/37), false shows 0/119 `minicart-1`, 0/189 `empty-cart`, 321 amount / 54 rates, hinted p95 10.4 ms max 36.9 ms; misses 16 `no-hint`, 20 `no-structure`, 3 `title-only`. Known limits added above (fixed bottom-bar summaries, saved-items pages). `evals/reader/live-home.mjs` built with `evals/reader/live-nonstore.json` (55 sites), tests `tests/live-home.test.mjs` (robots parsing and matching, challenge detection, inputs, summary and bounds) and `tests/browser/live-home.test.mjs` (fixture server: robots honoured before any load, 403 and a challenge title → blocked, a home page → none, a cart page → false show, text-free rows). The sweep itself is not run by the implementer. Built sizes: badge `content.js` 46,961 bytes, manual reader 42,757. Gate green (lint, format, typecheck, `npm test`, build, browser suite 21 passed / 3 skipped).
- **2026-10-10: 13c.5 reader coverage round** (Fable 5.1 implementer, development only; held-out A untouched). Reader rules, each generic: `blockText` leaves out scripts, styles, templates and option lists (an inline stylesheet beside a summary row no longer hides its checkout control); table structure (`tr`, `tbody`, `tfoot`, `table`) does not count toward the nearest-summary climb (the subtotal-alone scope stays tight); a sum rule: two labelled rows of one kind where the larger equals the smaller plus one shipping row of its summary make the larger the order total (tax rows do not count, since a total before and after tax is the protocol's ambiguous pair); a trailing "you save(d) [amount]" note is dropped from a total row; a total inside a short card-offer block (`OFFER_RE`, no shipping or tax words, within three levels) is dropped; a shipping threshold row ("$29.00 more", "qualify", "unlock") explains its amount; a wrapper row around another chosen subtotal row is not checked for company; a body that clips its overflow bounds the page at the viewport's width (not the body's own box, which is narrower on right-to-left pages); a void element (an input) is measured by its own box, not an empty range; `ج م` reads as EGP. Detector: a `position: fixed` box counts as main content unless it is a drawer: at least 60% of the viewport's height, or carrying its own cart heading or close control (a summary made sticky by script counts, a mini-cart popover or bottom sheet does not). Independent review (approve with fixes, applied) and re-check (three detector should-fixes, applied): a fixed box with any cart word in a visible heading or its aria-label, or a visible close control outside a form, is a drawer whatever its height (every close control is checked, not only the first); line items inside a fixed box never count, so a bottom bar holding a line is no cart; two items totals are promoted by the sum rule only when no order total is labelled, every pair judged on the rows as labelled (two sellers' sub-carts stay ambiguous); an offer block must also name a card, a credit or a new total and hold no checkout control. Development quick loop after the fixes: reader **405 correct / 0 wrong / 317 withheld** (was 384 / 0 / 338), `cart-1` coverage **89.9%** (was 86%), variants 0 shown-wrong in every transform (898 correct / 190 withheld), read p95 14.2 ms, max 39.4 ms; detector badge recall **388/414 = 93.7%** (was 375; cart-1 177/188, cart-qty2 138/149, cart-2items 40/40, cart-other 33/37), false shows **0/119 `minicart-1`, 0/189 `empty-cart`**, 343 amount view / 45 rates view, hinted p95 11.3 ms max 35.3 ms (unchanged recall and false shows after the re-check fixes). Remaining reader misses on cart positives: 21 `no-summary` (offline rebuilds with `opacity: 0` or `visibility: hidden` on the cart, drawer carts at product URLs, prices not in text), 8 `currency-undetermined` (`$` on Spanish `.com` stores, SAR written as `$`), 6 `subtotal-not-alone` (payment-plan and checkout-button amounts, unlabelled totals), 6 `amount-unreadable` (bare integers, dual-currency rows). Remaining detector misses: 16 `no-hint`, 7 `no-structure` (two stores whose main or body has `opacity: 0` in the rebuild, one with prices not in text, one with no visible controls), 3 `title-only`. Tests: 105 cart-reader tests. The official development run is the coordinator's.
- **2026-10-10: 13c.4 measured, re-check fixes, final numbers** (coordinator). Held-out A detector run 1 `20261010T083549Z-heldout-a-7ea020` (detector `9da996e`): recall 232/278 (83.5%), 0/84 `minicart-1`, 0/133 `empty-cart`; the only held-out detector run. Official development reader run `20261010T095154Z-development-eaa36b` (reader `ebf240a`): 405 / 0 / 317, `cart-1` 89.9%, variants 898 / 0 / 190. Final re-check fixes (`isDrawer`, fixed bottom bars; detector only) at `59dff8c`; scored development detector run `20261010T102625Z-development-b27cbb`: 388/414, 0/119, 0/189. Live home sweeps at `9da996e`, `ebf240a` and `59dff8c`: 0 of 244 loaded sites each. Report: [cart-detection-v1](../../docs/evals/cart-detection-v1.md).
