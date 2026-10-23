---
type: System Component
title: Cart badge
description: The automatic cart badge — content script on every https page, the generic detector and reader on every hinted page, sender-based worker routing, per-tab badge sessions, the isolated iframe UI with the amount and rates views.
status: stable
tags: [system, extension, badge, privacy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
verified_commit: 7a07113
sources:
  - resource: ../../extension/src/badge/content.ts
    title: Badge content script
  - resource: ../../extension/src/badge/observe.ts
    title: Cart and badge-host observer
  - resource: ../../extension/src/badge/auto-reader.ts
    title: Automatic reader
  - resource: ../../extension/src/badge/frame.ts
    title: Shadow-root iframe host
  - resource: ../../extension/src/badge/contracts.ts
    title: Badge messages and stored shapes
  - resource: ../../extension/src/badge/BadgeApp.tsx
    title: Badge iframe UI
  - resource: ../../extension/src/background/routing.ts
    title: Sender-based routing
  - resource: ../../extension/src/background/badge-service.ts
    title: Worker badge service
  - resource: ../../extension/vite.config.ts
    title: Manifest generation for the badge
  - resource: ../../extension/src/checkout/manual-reader.ts
    title: readAnyCart (one reader per URL)
  - resource: ../../extension/src/components/RatesResult.tsx
    title: Rates view
  - resource: ../product/phase-13c-cart-detection.md
    title: Phase 13c plan
  - resource: ../archive/phase2-goal.md
    title: Phase 3b plan and decisions (archived)
  - resource: ../archive/merchant-coverage-design.md
    title: Merchant coverage design (archived)
---

# Cart badge

Runs on every https cart or checkout page ([plan](../product/phase-13c-cart-detection.md)): the extension shows, without a click, the best owned card and its estimated cash back in a small pill bottom-right, or, when the reader is not certain of the amount, the best card and its rate (the **rates view**, never a prompt for an amount); clicking expands a panel with every owned card ranked, the applied rule and conditions, a payment-method selector and an editable amount. The content script never receives card or wallet data: it sends the reading to the worker and learns only `{show: boolean}`; card data reaches only the badge iframe, an extension page in a closed shadow root.

Last rechecked 2026-10-10 against `main` `7a07113` (agent-verified, code reading and a build); later milestones were checked by their own gates and reviews ([log](../log.md)). The badge ranks against the bundled `CATALOG_V3`; only the owned cards' slice reaches the iframe.

The badge words the v3 states in the badge with the popup's code ([`BadgeApp.tsx`](../../extension/src/badge/BadgeApp.tsx) reuses `EstimateRow` from `ComparisonResult.tsx` and the wording in `estimates.ts`; [decision](../decisions/2026-10-03-extension-ui-v3.md)), and `badgeCatalog` is `catalogSlice` for the owned cards and this merchant:

- **Pill:** dollars for cash, store rewards and valued points (a published estimate is marked `est.`), units for a program without a value (texts below).
- **Panel rows:** dollars first, then for points the units and value per unit labelled "Estimate", "Issuer-stated" or "Your value"; an unvalued program in units ("Shown in units because this program has no value set").
- **Conditions:** an unanswered gate or chosen category is shown as a range with the question or option it depends on; a ranking note (`rankingNote`) appears when conditions or missing values could change the first card.
- **Store cards not accepted here** are listed after the ranking, one line each ("works only at …", `notAcceptedLines`).
- **Payment method:** the selector offers Venmo only when the catalog in effect is v3 (see `set-payment` below).

Ocean theme ([decision](../decisions/2026-10-02-ocean-theme.md)): the pill is navy (`--ac-color-navy`, hover `--ac-color-navy-strong`) with white text, and the reward part (`pillReward`, including "est.") is sky Bricolage (`.badge-pill__amount`); the accessible name is unchanged. The panel header icon is navy, and the ranked list uses the popup's winner block and "$X less" through `rowEmphasis` ([extension](extension.md#popup-and-onboarding)): only a clear winner (`!tied && !rankingMayChange`) gets the block. Panel `h3` margins are reset so rows match the popup. `badge.spec.ts` checks that the widest amounts on a $99,999.99 purchase stay inside the 360 px panel body.

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Content-script reach | `https://*/*`, `run_at: document_idle`, top frame only; `host_permissions` `https://*/*` plus the catalog origin | `badgeManifest` plugin in [`vite.config.ts`](../../extension/vite.config.ts) |
| Iframe page | `src/badge/index.html`, web-accessible on `https://*/*`, `use_dynamic_url: false` (kept: the worker routes `badge:*` by this exact URL and the content script cannot obtain a dynamic one; any site can therefore detect the extension by fetching the page; [decision](../decisions/2026-10-10-rates-view-reference-amount-and-spa-navigation.md)) | same |
| Reader per URL | Every https page: `cartUrlHint(url, title)` first (null → no DOM read, no observer), then `readCartPage` (detector and reader in one pass; [generic cart reader](extension.md#generic-cart-reader)) | [`content.ts`](../../extension/src/badge/content.ts), [`manual-reader.ts:readAnyCart`](../../extension/src/checkout/manual-reader.ts) |
| Merchant | `storeForTab(url)` against the merchant release in effect ([Extension](extension.md#store-matching-phase-142)): a matched record's id and name (`amazon-us` "Amazon"), every unmatched site or `disabled` record `generic-us-online`, a `processor` page no badge at all; every reading carries `generic-reader-v1` and names `generic-us-online` | [`badge-service.ts:content`](../../extension/src/background/badge-service.ts) |
| Rates view reference | `RATES_REFERENCE_CENTS` = 10,000 ($100.00): below every catalog cap, so an estimate's cents are its rate in basis points | [`contracts.ts`](../../extension/src/badge/contracts.ts) |
| Single-page navigation | Navigation API `currententrychange` (fallback `popstate`, `hashchange`), then one debounce before the check | `content.ts:onNavigate`, `auto-reader.ts` |
| Built content script | `dist/src/badge/content.js` 40,408 bytes (measured 2026-10-20 after 15.1b; the detector and reader, never the merchant release, which the worker matches); manual reader size on [Extension](extension.md#facts) | `vite.config.ts` content-script plugin |
| Debounce | 500 ms after DOM mutations | [`auto-reader.ts:DEBOUNCE_MS`](../../extension/src/badge/auto-reader.ts) |
| Read budget | 120 changed readings sent per page load, then observation stops (unchanged readings do not count) | `auto-reader.ts:MAX_SENDS` |
| Observed mutations | In `<body>`: `childList`, `subtree`, `characterData`, attributes `aria-busy`, `class`, `hidden`. On `<html>`: direct `childList` only, so removing the badge host is noticed at once | [`observe.ts:observeCart`](../../extension/src/badge/observe.ts) |
| Per-tab session | `checkoutBadgeTabsV1` in `chrome.storage.session`: `{merchantId, host, reading, unreadable, dismissed, amountOverrideCents, paymentPath, frameNonce, page, reportedKey, suggested}` (`page` is `cart` or `checkout`, one word from the sender URL; `reportedKey` the last recommendation reported; the last three have defaults; an entry with other fields fails the strict schema and is dropped) | [`contracts.ts:BADGE_TABS_KEY`](../../extension/src/badge/contracts.ts) |
| Host element | `<ai-checkout-badge>`, `position: fixed`, 16 px margin, `z-index: 2147483647`, all styles inline `!important`, appended to `<html>` (outside `<body>`) | [`frame.ts:createBadgeFrame`](../../extension/src/badge/frame.ts) |
| Auto-mode engine inputs | `eligiblePurchase: 'eligible'`, `onlineRetail` from the merchant profile (`storeProfile`: the release record's, the catalog's or the engine's `GENERIC_MERCHANT_PROFILE`; `unknown` for a v1 catalog), payment path from the tab entry (default `card`); the same profile is passed to `compareRewards` as `{ merchant }` | [`badge-service.ts:autoPurchase`](../../extension/src/background/badge-service.ts) |
| Settings | `checkoutSettingsV1`: `showOnOtherStores` (default `true`; the badge toggle for every store), `disabledSites` (hostnames, ≤ 500; the switch for every store, matched or generic); a stored `disabledMerchants` (the retired adapters' per-store switch) maps to those stores' hosts once on read (`LEGACY_MERCHANT_HOSTS`); stored values from before 13c parse with the defaults | `contracts.ts:settingsSchema` |

## How it works

### Reading

[`auto-reader.ts:startAutoReader`](../../extension/src/badge/auto-reader.ts) is DOM-free for testing; [`content.ts`](../../extension/src/badge/content.ts) supplies the page and the page **mode** per URL: `generic` (a URL whose URL or `document.title` carries a cart or checkout word, `cartUrlHint`; the reading names `generic-us-online` and the worker resolves the store) or `none` (nothing is read and no observer is attached). On a `generic` page it reads through `readAnyCart` (one pass: detection and reading), keys the reading, and sends `cart:reading` only when the key changes. A hinted page the detector calls `none` (a product page with an open drawer, an empty cart, `title-only`) sends nothing and hides the badge while the observer keeps watching the page. Same-document navigation (`onNavigate`) schedules a check one debounce later: entering a cart starts reading and attaches the observer, leaving it hides the badge and disconnects. It pauses while the tab is hidden and on `pagehide`; a `pageshow` from the back/forward cache (`persisted: true`) resumes it and re-sends the reading, because the navigation cleared it in the worker. An unchanged reading is not re-sent unless the worker wanted the badge shown and the page removed the frame; that re-send gets a new frame. An `unavailable` reading with reason `withheld` (`RATES_VIEW_REASONS`: a cart whose amount is uncertain) shows the rates view; `empty-cart`, `unsupported-currency` and `unsupported-page` hide the pill unless the panel is expanded. A thank-you page is read like any hinted page and shows no badge unless the detector finds a cart.

### Message routing

[`routing.ts:routeMessage`](../../extension/src/background/routing.ts) decides from Chrome's `sender`, never from message fields:

| Message type | Accepted from | Route |
| --- | --- | --- |
| `checkout:*`, `settings:*` | `sender.id` = this extension and URL exactly the popup or onboarding page | `page` (full API) |
| `badge:*` (except `badge:changed`) | This extension, URL exactly `src/badge/index.html`, inside a tab, `frameId > 0` | `badge` with `tabId` from sender |
| `cart:reading` | This extension's content script, any `https:` URL, `frameId === 0`, inside a tab | `content` with `tabId`, `url` (any other type, `order:page` included: `ignore`) |
| anything else from those senders | | `deny` (`{ok: false}`) or `ignore` |

### Worker side

[`badge-service.ts:createBadgeService`](../../extension/src/background/badge-service.ts) serialises work in one queue.

- `content()` validates with `contentMessageSchema` (a `cart:reading` naming `generic-us-online` with `generic-reader-v1`; anything else is refused with `{show: false}`), derives the store from the sender URL (`storeForTab` against the merchant release in the worker; a processor page replies `{show: false}` and records nothing), records the matched id and the tab's hostname (`merchantId`, `host`, never the path), updates the tab entry (`reading`, `unreadable`, clears a typed amount when the cart changes) and replies `show` for a `found` reading or a rates-view reason on a visible site: not dismissed, `showOnOtherStores` on and the host not in `disabledSites`.
- `view()` builds a `BadgeView`: `hidden`, `locked`, `damaged`, `no-cards`, `rates` (no amount read or typed: the comparison at `RATES_REFERENCE_CENTS`, catalog slice, wallet), `unavailable`, `checking` (the result is `catalog-expired` while a refresh's catalog step is in flight; [first run and expiry](extension.md#first-run-and-expiry-phase-154)), `ready` (comparison, catalog slice, wallet). It reads the state and the catalog in effect from the vault's `snapshot()` (`{status, state, catalog, checkingTerms}`; both null and the flag false while locked or damaged). The `no-cards` pill expands nothing, so it carries its own per-tab dismiss button beside it. The comparison passes `merchantOption(catalog, merchantId)`: a release record's own profile via `releaseProfileFor`, so a matched store ranks on its category, goods flag and brands. The `ready` view's catalog is [`badgeCatalog`](../../extension/src/background/badge-service.ts): only the owned cards, this merchant, their programs, the brands and gates their rules name and the sources they cite, never the whole catalog (a 20-card slice of a 1 MiB catalog is under 160 KiB, tested in `state-v3.test.ts`).
- `badge()` handles `badge:get`, `set-amount`, `set-payment` (Venmo too; the selector offers it only with catalog v3 terms, and `autoPurchase` compares a card payment if an older catalog is in effect), `dismiss` (for the tab's life), `disable-site` (the tab's host to `disabledSites`, never a store id: the generic id is shared by every unmatched store), `open` (popup via `chrome.action.openPopup`, falling back to a tab; or onboarding), `expanded` (a usage report only) and `suggest-store` ("Store not recognised? Suggest it" at a generic store: `store_suggested` with the registrable domain of the tab's host, refused at a named store or for an address the contract rejects; `suggested` on the entry turns the button into a thank-you). With a telemetry module (hosted builds with `VITE_TELEMETRY`), `view()` reports `recommendation_shown` once per distinct recommendation per tab and the actions report `badge_expanded` and `badge_dismissed` (only from the amount or rates view: the no-cards, locked, checking and unavailable pills report neither), `site_disabled` and `amount_typed`, none with the host; reports are started, never awaited ([Extension](extension.md#usage-reporting-phase-153)); `shownIn(tabId)` tells the popup's problem report what the badge shows there.
- `navigated(tabId)` clears the reading and typed amount; dismissal and the payment choice survive. `removed(tabId)` deletes the entry.
- Popup/onboarding writes trigger `badge:changed`, a runtime broadcast that reaches extension pages (the iframes), never content scripts.

### Iframe and isolation

[`frame.ts`](../../extension/src/badge/frame.ts) creates the host element with a **closed** shadow root holding a cross-origin `chrome-extension://` iframe, so page scripts can see the host but not its contents. The iframe ([`BadgeApp.tsx`](../../extension/src/badge/BadgeApp.tsx), [`client.ts`](../../extension/src/badge/client.ts)) talks to the worker via `chrome.runtime.sendMessage` and posts only `{source: 'ai-checkout-badge', type: 'size', width, height, expanded}` or `{type: 'hide'}` to `location.ancestorOrigins[0]`. The host accepts a message only if `event.source` is its iframe's window, `event.origin` is the extension origin, and the shape has exactly the expected keys with sizes in 0–4000.

Pill texts by view: `Use {card} · {$x} back` for cash back; catalog v3 (Stage 2 M7, `estimates.ts:pillReward`): `· {$x} in store rewards`, `· {$x} in points` (or miles; a published estimate reads `· est. {$x} in points`, spelled "estimated" in the accessible name; an issuer's or the shopper's value is named in the accessible name), and for a program without a value its units, `· {n} miles`; a range reads `$x–$y`, a $0 minimum `up to $y`; `Unlock to see your best card`, `Pick your cards to see your best card` (opens onboarding), the rates view `Use {card} · {rate}` (`estimates.ts:rateWording`: `2% back`, `1%–3% back` where conditions decide, `2 miles per $1 (est. 2%)`, units alone for a program without a value; accessible name "… at this store (AI Checkout). The cart amount was not read"), `Card terms need attention` (an unavailable comparison). The rates panel ([`RatesResult.tsx`](../../extension/src/components/RatesResult.tsx), shared with the popup) says the amount wasn't read and that rates don't depend on it, shows the engine's `rankingNote` when conditions could change the order and a cap note (`ratesCapped`) when an applied rule has a spend cap, lists the cards by rate, and keeps the optional amount field ("Amount (USD, optional)") and the payment selector; nothing asks for an amount. The ready panel's "Based on … at {store}" names the matched store (`merchantName`) and both panels add the store's evidence line (`storeEvidence`, [Extension](extension.md#store-matching-phase-142)) where a bonus category applies; a `default` record shows nothing about categories.

## Gotchas

- **Frame nonce.** For each new badge frame the worker issues a 32-char nonce (`NONCE_PATTERN`), passed in the frame URL fragment inside the closed shadow root and stored as `frameNonce` in the tab entry. Every `badge:*` request must carry the current nonce, so page-made copies of the web-accessible badge page get nothing. A removed host is recreated with a new nonce ([`contracts.ts`](../../extension/src/badge/contracts.ts), `badge-service.ts`).
- **Click guard.** Pointer clicks in the frame count only while IntersectionObserver v2 reports it visible (anti-clickjacking). An ignored click shows "Click ignored: the badge was covered or hidden…" for about 4 s in a `role="status"` paragraph that is always in the DOM (visually hidden when empty), so screen readers announce it ([`BadgeApp.tsx`](../../extension/src/badge/BadgeApp.tsx)). The panel's close (X) button is exempt (2026-10-03): it only hides the badge, and the taller v3 panel can sit under a site's floating chat button.
- Locking the vault removes only the session key; badge tab state survives.

- The generic reader reads visible summary text and currency hints on every hinted page ([rules](extension.md#generic-cart-reader)); it never reads item names, addresses or form values, and only the reading leaves the page. A card-offer panel's hypothetical credit outside the summary does not withhold the summary's amount; any other credit row beside a total still withholds (`credit-unclear`). The reader treats an element with opacity below one half as hidden, its ancestors included, so a page dimmed as a whole reads as no cart and the badge hides (the clickjacking-guard browser test therefore covers the badge with an overlay instead of dimming the page).
- Settings default to `{showOnOtherStores: true, disabledSites: []}` when missing or invalid; the badge is on everywhere by default. `disabledSites` matches the exact lower-cased hostname. A stored `disabledMerchants` (the retired adapters' switch) is mapped to hosts and rewritten once.
- **Payment processors:** the 15 `processor` records of the bundled release (PayPal, Shop Pay, Klarna, Affirm, Bolt, Amazon Pay's hosts, …) make the worker answer `{show: false}` and store no tab entry, so a hinted processor checkout page is never badged; the content script still reads it like any hinted page (it carries no release, so the reading stays on the device and goes nowhere), while the popup refuses it before injecting the reader. A wrong processor host only hides the badge on that host.
- Content scripts must stay free of Zod and wallet code: [`pages.ts`](../../extension/src/badge/pages.ts) and [`checkout/merchants.ts`](../../extension/src/checkout/merchants.ts) exist so the IIFE stays small.
- Host permissions and content-script matches are `https://*/*`; `e2e/package.spec.ts`, `any-store.spec.ts`, `generic-read.spec.ts` and [`e2e/hosts.ts`](../../extension/e2e/hosts.ts) pin that set.
- Privacy at any store: the content script makes no network requests and sends only the reading (`{status, merchantId, amountCents, kind, extractorVersion}` or a reason code); the worker stores per tab the merchant id, the hostname, the reading and the shopper's choices, never a URL path or page text; card data reaches only the badge iframe. `badge-any-store.spec.ts` checks the session storage for the fixture's path and text.

## Tests

| Layer | Tests |
| --- | --- |
| Unit | `extension/tests/auto-reader.test.ts` (includes back/forward-cache resume, `observeCart` host removal, and the generic path: hinted page, withheld, detector `none`, navigation in and out of a cart with no read on unhinted pages, a former order-confirmation URL as an unhinted page), `badge-routing.test.ts` (any https host; `order:page` ignored), `badge-service.test.ts` (generic readings only: a reading that names a store or carries a retired `*-summary-v1` version refused on any URL, `order:page` refused with no tab entry, rates view, `disabledSites`, the toggle covering Best Buy too, older settings, and the mapping of a stored `disabledMerchants` to hosts, rewritten once; on the fixture release: a store known only to the worker's release named and ranked on its record's profile from a `generic-us-online` reading, with its id and host on the tab, a processor page with no badge and no entry, a disabled record as the generic store, "Not on this site" by host at a matched store, the mcc Best Buy record), `rates-view.test.tsx` (`rateWording`, `ratesCapped`, `RatesResult`), `manual-reader.test.ts` (`readAnyCart`), `merchant-tab.test.ts` (`storeForTab`, `storeProfile`, `storeEvidence`) |
| Browser | `extension/e2e/badge-any-store.spec.ts` (synthetic stores at `shop.example.com` and `other.example.com` through `context.route`): the amount view at the generic profile, the rates view and its panel (axe), a typed amount in the panel, no badge on a product page with an open drawer, an empty cart or a euro cart, single-page navigation into and out of a cart, "Not on this site" by host and the Settings switch, the badge toggle hiding Best Buy's cart too, `https://*/*` as the only origin, nothing from the page in session storage; a release store named on a subdomain (`smile.amazon.com/cart` → "at Amazon", `merchantId` `amazon-us` and the host on the tab) and no badge on `pay.amazon.com` or `www.paypal.com` cart-like pages. `extension/e2e/badge.spec.ts`: a catalog v3 badge (points pill with "est.", estimate label, a store card not accepted, Venmo, no overflow at $99,999.99, no inline styles, axe on pill and panel); onboarding, three store carts through the generic reader (the observed Best Buy and Newegg fixtures at their hosts, and a synthetic cart at `www.amazon.com/cart` named "Amazon" by the release), live updates on quantity change, closed shadow + cross-origin iframe, a removed host coming back without a body change, the covered-click status message (an overlay over the badge), dismiss, per-site off by host (`www.bestbuy.com` in Settings), axe on badge and panel; no-cards and locked prompts. Fixture pages are served at the real hosts via `context.route`. |

## Related

* [Extension](extension.md)
* [Rewards engine](rewards-engine.md)
* [Testing](testing.md)
* [Decisions](../decisions/index.md)
