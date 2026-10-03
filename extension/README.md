# AI Checkout extension

React/TypeScript, Manifest V3, Vite/CRXJS, Tailwind, and Zod. The popup compares owned-card rewards locally. Comparisons require no API key, account, or network request; an optional configured HTTPS endpoint supplies reviewed catalog updates.

**Status:** local pilot covering Quicksilver and Blue Cash Everyday at Best Buy US and Newegg US. See the [roadmap](../docs/design.md#roadmap).

## Setup and use

Use Node 24 and npm. From the repository root:

```sh
npm ci
npm run build --workspace=ai-checkout-extension
```

Open `chrome://extensions`, enable Developer mode, and load `extension/dist/` as an unpacked extension. After rebuilding, reload the extension there before retesting; an existing unpacked profile can retain the earlier background worker. On install a setup tab opens: select the card products you own and your default card, optionally report today's annual online retail spend for Blue Cash Everyday, and save.
<!-- TODO(M7): describe wallet search over the 178 cards, per-card options (chosen categories, memberships and tiers) and the Point values section once Stage 2 M7 merges. --> No passphrase is needed; **Settings → Protect with a passphrase** in the popup encrypts saved data optionally.

**Automatic cart badge.** On the Amazon US cart, Best Buy US cart and checkout, and the Newegg US cart, a badge appears bottom-right with your best card and its cash back for the cart. Clicking it expands every card's estimate with its rule and conditions, a payment-method selector, an editable amount, **Dismiss for this tab** and **Not on this site** (per-site switches are also in the popup's Settings). After an order-confirmation page in the same tab (recognized by URL only, at the document's initial URL; patterns unverified), the badge asks once which card paid. Your answer records an estimate in the popup's **All-time** savings (history, JSON export, delete); an unanswered question expires three hours after the order page or at the next cart reading in that tab.

How it is isolated: a content script declared only for the adapters' cart, checkout and order-confirmation match patterns reads the summary through the bundled adapter (on load and on debounced, bounded DOM changes) and sends the worker only `{merchantId, amountCents, kind, extractorVersion}`; it learns only whether to show the badge. The badge is an extension page (`src/badge/index.html`) in an iframe inside a closed shadow root, so page scripts cannot read card names. The worker routes messages by Chrome-provided sender: the popup and onboarding pages get the wallet API, the badge iframe only `badge:*` for its own tab and only with the nonce its content script was given for that frame (page-made copies of the web-accessible badge page are refused), the content script only readings and order pages (`src/background/routing.ts`). In the frame, pointer clicks count only while IntersectionObserver v2 reports it fully visible (a clickjacking guard).

The popup still compares any purchase manually: open it on a supported cart and choose **Read cart amount**, or choose the merchant and enter the amount, confirm the eligibility assumption and exclusions, and compare.

The readers use bounded visible order-summary rows. They distinguish total, estimated total, and subtotal. Newegg's exact **Est. Total: TBD** state permits its known selected subtotal; both the input and result explain that tax/shipping are excluded and the final charge is unknown. Other malformed totals fail closed. Switching merchants clears the amount, capture, eligibility, confirmation and result. Loading, ambiguous amounts, empty carts, other currencies, unsupported hosts, or missing permission keep manual entry available. The extension never reloads the shopping page. [Recorded merchant verification](../docs/verification/merchants.md) describes the live cases and limits.

The comparison shows either an estimate or a range. Unknown bonus eligibility or annual-cap usage can change which card is best. The app does not track transactions: update reported spend before each purchase. Reported usage becomes unknown on the next day. Only the named card products and merchant scope are modeled; card-specific offers, financing, fees, and other benefits are excluded.

The bundled catalog is `2026-10-02.expansion.1` (178 cards of the ten largest U.S. issuers; Amazon US, Best Buy US and Newegg US). Its issuer terms were captured October 2, 2026 and expire November 1, 2026 (00:00 UTC) under our refresh policy. Points and miles are compared in cash terms with a published estimate or the issuer's stated value where one exists; a program without one is ranked in points after the valued cards. Expired terms block new comparisons until a currently valid reviewed release is available. An older downloaded catalog keeps its original merchant scope until replaced by a reviewed update.

## Optional catalog updates

Set `VITE_CATALOG_API_URL=https://your-api.example/v1/catalog` in `extension/.env.local` before building. Use the deployed [Node catalog API](../apps/api/README.md), with valid HTTPS. The build adds only that API origin to host permissions. The hosted API is at `https://ai-checkout-api.onrender.com`; `npm run build:hosted --workspace=ai-checkout-extension` builds against it. The default build stays offline.

**Check for updated terms** downloads published rule data only, with no wallet, purchase, page URL, cookies, or authentication token. It does not run automatically. The worker validates the bounded response, release sequence, version, dates, and source/rule references before one atomic storage update. It rejects rollbacks, altered releases, malformed data, and expired terms. A failed request preserves the current snapshot. Already cached valid terms work offline; an expired remote release never silently falls back to the bundle.

New releases invalidate comparisons. Changed rules clear affected reported usage so it becomes unknown. Removed owned cards remain visible as unavailable until explicitly removed; they do not disappear from the wallet silently. Deleting all local data also removes downloaded terms and returns to the original bundle and its original expiry.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser --workspace=ai-checkout-extension
npm run test:catalog:browser
npm run test:package:browser --workspace=ai-checkout-extension
```

Run these commands from the repository root. Type checking includes the production code and the packaged-browser test harness. Unit/component tests cover money parsing, partial caps, stale/unknown usage, eligibility, ties, expiration, runtime messages, storage failures, popup recovery, deletion, catalog schema/refresh, bounded summary parsing, and tab/document freshness. Earlier prototype boundary tests remain as regression checks for retained modules. Packaged Chromium tests exercise offline operation, persistence, changed inputs, expired estimates, two-window deletion, the native Chrome action/permission/amount-comparison flow, popup closure during a paused read, navigation/access revocation, and recovery after observed natural worker shutdown on a sanitized fixture. The latter uses Chrome's documented debugging protocol in an isolated profile; the shipped extension does not request any debugging permission. A separate local HTTPS fixture checks catalog refresh, changed rules, rollback rejection, bounded permissions, and offline browser restart. Its synthetic terms are not issuer or deployment evidence. Live cart evidence is separate; authenticated checkout remains unverified.

See [lifecycle evidence and exact limits](../docs/verification/extension-lifecycle.md). The idle test disconnects Playwright during observation so its debugger cannot keep the worker alive; it requires a browser-reported stopped state and a new execution time origin on wake.

The package command creates `extension/artifacts/ai-checkout-2.0.0.zip` and a SHA-256 file inventory from `extension/dist`. It validates the manifest, permissions, entry files, icon dimensions and allowed runtime files, then verifies the actual compressed contents. `test:package:browser` packages and installs the extracted ZIP in a fresh Chromium profile to check a native two-card comparison and deletion. Build first after source changes. The default browser suite skips this separately invoked ZIP flow. See [package evidence and limits](../docs/verification/release-package.md).

`npm run release:media` at the repository root rebuilds and packages the extension, captures actual popup screenshots, records the labeled offline shopper demo and verifies the store-media packet. It additionally requires Playwright Chromium and `ffmpeg`/`ffprobe`; it makes no live retailer or model call and does not publish. See [media, provenance and reproduction](../docs/release/assets/README.md).

This remains a development artifact. CI can build the current flow without secrets or Supabase configuration; it tests the extracted ZIP before artifact upload. Remote execution is still unverified. Catalog browser fixtures build into a separate directory and cannot become the packaged ZIP accidentally.

## Data and permissions

- Permissions: `storage`, `activeTab` and `scripting`, plus host permissions for exactly the adapters' hosts (`www.amazon.com`, `bestbuy.com`, `www.bestbuy.com`, `secure.newegg.com`) and, in hosted builds, the one catalog API origin. The build derives `host_permissions`, `content_scripts` and the badge's `web_accessible_resources` from the bundled adapters; `scripts/release-package.mjs` refuses any other host.
- Stored data: selected card product IDs and default card, optional reported annual spend, badge settings, savings history, confirmed purchase amount/eligibility/date, comparison freshness, and optional captured amount metadata (kind/currency, tab/document IDs, hashed page identity). Per-tab badge state (latest cart amount, typed amount, payment choice, dismissal, last recommendation) lives in session storage and is cleared when the tab closes. Raw URLs/query strings, product names, addresses, payment fields, and page HTML are not retained.
- The worker restricts local and session storage to trusted extension contexts every time it starts (and on install and browser startup), so content scripts and pages cannot read them; `e2e/checkout.spec.ts` confirms it for a content script (tested on Chromium 153; the manifest supports Chrome 120+). Locking removes only the session key, not the badge's per-tab state.
- The worker reloads authoritative inputs from storage. Manual comparisons last at most 15 minutes. Cart captures expire after five minutes, are revalidated before use, and are invalidated by navigation/removal; date/catalog/wallet changes also invalidate results. Reads time out after eight seconds; late reads cannot restore deleted state.
- Saved state is plain local storage by default. Optional passphrase protection uses passphrase-derived AES-GCM encryption with the usable key kept only in trusted Chrome session memory; restart/reload requires unlocking and the badge then asks to unlock. Protection can be turned off again with the passphrase. [Protection design and limits](../docs/verification/local-protection.md).
- Delete all local data clears cards, settings, savings, the session key and saved state; all UI deletion paths require explicit confirmation.

The active summary reader is in `src/checkout/`. `.env.example` documents the optional public catalog endpoint. Never place service-role or model provider secrets in `VITE_` variables.

Remaining work is tracked in the [roadmap](../docs/design.md#roadmap).
