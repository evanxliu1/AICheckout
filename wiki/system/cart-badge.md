---
type: System Component
title: Cart badge
description: The automatic cart badge (Phase 3b) — content script, sender-based worker routing, per-tab badge sessions, the isolated iframe UI, URL-only order detection and savings records.
status: stable
tags: [system, extension, badge, privacy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T03:05:00Z
verified_commit: 7322dec
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
  - resource: ../../extension/src/state/savings.ts
    title: Savings math
  - resource: ../../extension/vite.config.ts
    title: Manifest generation for the badge
  - resource: ../archive/phase2-goal.md
    title: Phase 3b plan and decisions (archived)
---

# Cart badge

On a supported cart page the extension shows, without a click, the best owned card and its estimated cash back in a small pill bottom-right; clicking expands a panel with every owned card ranked, the applied rule and conditions, a payment-method selector and an editable amount. Built on branch `phase3b-auto-badge` (PR #13) with follow-ups on `phase3b-followups` (PR #14); both merged to `main` on 2026-10-02 (`7322dec`). The content script never receives card or wallet data: it sends the adapter's reading to the worker and learns only `{show: boolean}`; card data reaches only the badge iframe, an extension page in a closed shadow root.

Verified 2026-10-02 against `7322dec` by reading the code and running the extension unit tests (21 files, 378 tests pass, including `auto-reader.test.ts`, `badge-routing.test.ts`, `badge-service.test.ts`). The Stage 2 M6 changes (trimmed catalog in the `ready` view, catalog from the vault snapshot) were verified on branch `s2-m6-extension-state` with the unit tests and `e2e/badge.spec.ts` (passed), and merged with PR #26. Since PR #27 the badge ranks against the bundled 178-card `CATALOG_V3` (only the owned cards' slice reaches the iframe).

Stage 2 M7 (branch `s2-m7-extension-ui`, PR #30; verified 2026-10-03 with the unit tests and `e2e/badge.spec.ts`) words the v3 states in the badge with the popup's code ([`BadgeApp.tsx`](../../extension/src/badge/BadgeApp.tsx) reuses `EstimateRow` from `ComparisonResult.tsx` and the wording in `estimates.ts`; [decision](../decisions/2026-10-03-extension-ui-v3.md)), and `badgeCatalog` is `catalogSlice` for the owned cards and this merchant:

- **Pill:** dollars for cash, store rewards and valued points (a published estimate is marked `est.`), units for a program without a value (texts below).
- **Panel rows:** dollars first, then for points the units and value per unit labelled "Estimate", "Issuer-stated" or "Your value"; an unvalued program in units ("Shown in units because this program has no value set").
- **Conditions:** an unanswered gate or chosen category is shown as a range with the question or option it depends on; a ranking note (`rankingNote`) appears when conditions or missing values could change the first card.
- **Store cards not accepted here** are listed after the ranking, one line each ("works only at …", `notAcceptedLines`).
- **Payment method:** the selector offers Venmo only when the catalog in effect is v3 (see `set-payment` below).

Ocean theme (branch `ui-ocean-theme`, merged with `main` on 2026-10-03; [decision](../decisions/2026-10-02-ocean-theme.md)): the pill is navy (`--ac-color-navy`, hover `--ac-color-navy-strong`) with white text, and the reward part (`pillReward`, including "est.") is sky Bricolage (`.badge-pill__amount`); the accessible name is unchanged. The panel header icon is navy, and the ranked list uses the popup's winner block and "$X less" through `rowEmphasis` ([extension](extension.md#popup-and-onboarding)): only a clear winner (`!tied && !rankingMayChange`) gets the block. Panel `h3` margins are reset so rows match the popup. `badge.spec.ts` checks that the widest amounts on a $99,999.99 purchase stay inside the 360 px panel body.

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Content-script reach | Union of adapters' `matchPatterns` (cart and order pages only), `run_at: document_idle`, top frame only | `badgeManifest` plugin in [`vite.config.ts`](../../extension/vite.config.ts) |
| Iframe page | `src/badge/index.html`, web-accessible only on `https://<adapter host>/*` | same |
| Debounce | 500 ms after DOM mutations | [`auto-reader.ts:DEBOUNCE_MS`](../../extension/src/badge/auto-reader.ts) |
| Read budget | 120 changed readings sent per page load, then observation stops (unchanged readings do not count) | `auto-reader.ts:MAX_SENDS` |
| Observed mutations | In `<body>`: `childList`, `subtree`, `characterData`, attributes `aria-busy`, `class`, `hidden`. On `<html>`: direct `childList` only, so removing the badge host is noticed at once | [`observe.ts:observeCart`](../../extension/src/badge/observe.ts) |
| Per-tab session | `checkoutBadgeTabsV1` in `chrome.storage.session` | [`contracts.ts:BADGE_TABS_KEY`](../../extension/src/badge/contracts.ts) |
| Order window | 3 h from the last recommendation, same tab, same merchant | `ORDER_WINDOW_MS` |
| Host element | `<ai-checkout-badge>`, `position: fixed`, 16 px margin, `z-index: 2147483647`, all styles inline `!important`, appended to `<html>` (outside `<body>`) | [`frame.ts:createBadgeFrame`](../../extension/src/badge/frame.ts) |
| Auto-mode engine inputs | `eligiblePurchase: 'eligible'`, `onlineRetail` from the merchant profile (`unknown` for a v1 catalog), payment path from the tab entry (default `card`) | [`badge-service.ts:autoPurchase`](../../extension/src/background/badge-service.ts) |

## How it works

### Reading

[`auto-reader.ts:startAutoReader`](../../extension/src/badge/auto-reader.ts) is DOM-free for testing; [`content.ts`](../../extension/src/badge/content.ts) supplies the page. On a cart URL it reads via `readCheckoutPage` (the same adapter interpreter as the popup, see [Extension](extension.md#site-adapters)), keys the reading, and sends `cart:reading` only when the key changes. It pauses while the tab is hidden and on `pagehide`; a `pageshow` from the back/forward cache (`persisted: true`) resumes it and re-sends the reading, because the navigation cleared it in the worker. It stops for good and hides the badge if a single-page navigation leaves the cart. An unchanged reading is not re-sent unless the worker wanted the badge shown and the page removed the frame; that re-send gets a new frame. An `unavailable` reading hides the pill unless the panel is expanded (the panel then says "Can't read this cart — enter the amount"). On an order-confirmation URL it sends `order:page` once and never reads the page.

### Message routing

[`routing.ts:routeMessage`](../../extension/src/background/routing.ts) decides from Chrome's `sender`, never from message fields:

| Message type | Accepted from | Route |
| --- | --- | --- |
| `checkout:*`, `settings:*` | `sender.id` = this extension and URL exactly the popup or onboarding page | `page` (full API) |
| `badge:*` (except `badge:changed`) | This extension, URL exactly `src/badge/index.html`, inside a tab, `frameId > 0` | `badge` with `tabId` from sender |
| `cart:reading`, `order:page` | This extension's content script, `https:` URL, `frameId === 0`, inside a tab | `content` with `tabId`, `url` |
| anything else from those senders | | `deny` (`{ok: false}`) or `ignore` |

### Worker side

[`badge-service.ts:createBadgeService`](../../extension/src/background/badge-service.ts) serialises work in one queue.

- `content()` validates with `contentMessageSchema`, re-derives the merchant from the sender URL (a reading for another merchant is refused), updates the tab entry (`reading`, `unreadable`, clears a typed amount when the cart changes) and replies `show` only for a `found` reading on a non-dismissed, non-disabled site.
- `view()` builds a `BadgeView`: `hidden`, `locked`, `damaged`, `no-cards`, `unreadable`, `unavailable`, `ready` (comparison, catalog slice, wallet), `order`, `recorded`. It reads the state and the catalog in effect from the vault's `snapshot()` (`{status, state, catalog}`; both null while locked or damaged). The `ready` view's catalog is [`badgeCatalog`](../../extension/src/background/badge-service.ts): only the owned cards, this merchant, their programs, the brands and gates their rules name and the sources they cite, never the whole catalog (a 20-card slice of a 1 MiB catalog is under 160 KiB, tested in `state-v3.test.ts`). Computing `ready` stores `recommendation {purchase, recommendedCardId, at}` for order detection.
- `badge()` handles `badge:get`, `set-amount`, `set-payment` (Venmo too; the selector offers it only with catalog v3 terms, and `autoPurchase` compares a card payment if an older catalog is in effect), `dismiss` (for the tab's life), `disable-site` (adds to `disabledMerchants` in settings), `answer-order`, `open` (popup via `chrome.action.openPopup`, falling back to a tab; or onboarding).
- `navigated(tabId)` clears the reading and typed amount; dismissal, payment choice and the pending recommendation survive. `removed(tabId)` deletes the entry.
- Popup/onboarding writes trigger `badge:changed`, a runtime broadcast that reaches extension pages (the iframes), never content scripts.

### Iframe and isolation

[`frame.ts`](../../extension/src/badge/frame.ts) creates the host element with a **closed** shadow root holding a cross-origin `chrome-extension://` iframe, so page scripts can see the host but not its contents. The iframe ([`BadgeApp.tsx`](../../extension/src/badge/BadgeApp.tsx), [`client.ts`](../../extension/src/badge/client.ts)) talks to the worker via `chrome.runtime.sendMessage` and posts only `{source: 'ai-checkout-badge', type: 'size', width, height, expanded}` or `{type: 'hide'}` to `location.ancestorOrigins[0]`. The host accepts a message only if `event.source` is its iframe's window, `event.origin` is the extension origin, and the shape has exactly the expected keys with sizes in 0–4000.

Pill texts by view: `Use {card} · {$x} back` for cash back; catalog v3 (Stage 2 M7, `estimates.ts:pillReward`): `· {$x} in store rewards`, `· {$x} in points` (or miles; a published estimate reads `· est. {$x} in points`, spelled "estimated" in the accessible name; an issuer's or the shopper's value is named in the accessible name), and for a program without a value its units, `· {n} miles`; a range reads `$x–$y`, a $0 minimum `up to $y`; `Unlock to see your best card` (or `Unlock to record this order`), `Pick your cards to see your best card` (opens onboarding), `Can't read this cart — enter the amount`, `Did you pay with your recommended card?`.

### Order detection and savings

1. A cart view computes a recommendation and saves it on the tab entry.
2. A document that loaded at an adapter `orderConfirmation` path in the same tab, within 3 h (`ORDER_WINDOW_MS`) for the same merchant, moves the recommendation to `orderPrompt` and the badge shows (not in a dismissed tab). The question expires 3 h after the order page or at the next cart reading; a reload shows the same pending question, never a second one after an answer.
3. The shopper answers Yes / another owned card / Not sure (`badge:answer-order`).
4. [`savings.ts:savingsEntry`](../../extension/src/state/savings.ts) computes the guaranteed minimum (`minRewardCents`) for the used card and for the default card with the same engine; `extraCents = estimated − baseline` (null if either is unknown, may be negative). A card whose program has no value counts as unknown, not $0 (M10 part 2). The amounts are dollar values: cash back at face value, points and miles at the value in effect (estimate, issuer's value or the shopper's own). The worker writes it with internal `checkout:record-savings` (encrypted when the vault is on; refused while locked).
5. The `recorded` view words the amount by what the two cards pay ([`estimates.ts:rewardsWording`](../../extension/src/components/estimates.ts), M10 part 2): "About $0.55 more cash back than Double Cash, your default card (estimated)" when both pay cash back; otherwise "more in rewards" plus what the other rewards were counted at ("Counts Capital One miles at 1¢ each (estimate).", store rewards "at face value") or, for a program with no value, that the order is not added to the total. The order question says the answer adds to the "all-time rewards total".
6. The popup's [`SavingsHistory.tsx`](../../extension/src/components/SavingsHistory.tsx) shows the total as "All-time: $x extra in rewards" (`totalExtraCents`) with how points are counted, the history, JSON export and delete.

## Gotchas

- **Frame nonce.** For each new badge frame the worker issues a 32-char nonce (`NONCE_PATTERN`), passed in the frame URL fragment inside the closed shadow root and stored as `frameNonce` in the tab entry. Every `badge:*` request must carry the current nonce, so page-made copies of the web-accessible badge page get nothing. A removed host is recreated with a new nonce ([`contracts.ts`](../../extension/src/badge/contracts.ts), `badge-service.ts`).
- **Click guard.** Pointer clicks in the frame count only while IntersectionObserver v2 reports it visible (anti-clickjacking). An ignored click shows "Click ignored: the badge was covered or hidden…" for about 4 s in a `role="status"` paragraph that is always in the DOM (visually hidden when empty), so screen readers announce it ([`BadgeApp.tsx`](../../extension/src/badge/BadgeApp.tsx)). The panel's close (X) button is exempt (2026-10-03): it only hides the badge, and the taller v3 panel can sit under a site's floating chat button.
- Locking the vault removes only the session key; badge tab state survives.

- Order-confirmation paths are unverified guesses for all three adapters (`orderConfirmation.verified: false`). A wrong path only means no savings prompt. Open until checked on real orders.
- Recorded cart amounts are the last cart reading (subtotal or estimated total), not the charged total; rewards are guaranteed minimums. Both are labelled estimates in the UI.
- The badge reads only inside the adapter's summary selector; it never reads order pages, item names, addresses or form values.
- Settings default to `{disabledMerchants: []}` when missing or invalid; the badge is on for every supported site by default.
- Content scripts must stay free of Zod and wallet code: [`pages.ts`](../../extension/src/badge/pages.ts) and [`adapters/ids.ts`](../../extension/src/checkout/adapters/ids.ts) exist so the IIFE stays small.
- Adding a merchant adapter automatically widens host permissions and content-script matches; `e2e/package.spec.ts` and [`e2e/hosts.ts`](../../extension/e2e/hosts.ts) pin the expected set.

## Tests

| Layer | Tests |
| --- | --- |
| Unit | `extension/tests/auto-reader.test.ts` (includes back/forward-cache resume and `observeCart` host removal), `badge-routing.test.ts`, `badge-service.test.ts` |
| Browser | `extension/e2e/badge.spec.ts`: a catalog v3 badge (points pill with "est.", estimate label, a store card not accepted, Venmo, no overflow at $99,999.99, no inline styles, axe on pill and panel); onboarding, each supported cart, live updates on quantity change, closed shadow + cross-origin iframe, a removed host coming back without a body change, the covered-click status message, dismiss, per-site off, order savings, axe on badge and panel; no-cards and locked prompts. Fixture pages are served at the real hosts via `context.route`. |

## Related

* [Extension](extension.md)
* [Rewards engine](rewards-engine.md)
* [Testing](testing.md)
* [Decisions](../decisions/index.md)
