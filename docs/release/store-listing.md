# Store listing and dashboard declarations

Everything Evan types into the Chrome Web Store developer dashboard for AI Checkout **2.1.0** comes from this file. The text describes the hosted build (`npm run build:hosted`: card terms and the store list downloaded from `https://ai-checkout-api.onrender.com`, usage reporting on). The 15.7 reviewer pass checks each section against the exact upload ZIP and its manifest before submission; the release record in [README.md](README.md) records what was submitted. Two items below are **Evan's alone** and are marked so.

## Basic fields

| Field | Value |
| --- | --- |
| Name | AI Checkout |
| Summary (≤ 132 characters; must equal the manifest `description`, which `release-package.mjs` checks for length) | Compare estimated rewards on cards you own, with clear rates and conditions. |
| Category | Shopping |
| Language | English (United States) |
| Regions | United States only |
| Pricing | Free |
| Publisher name shown | Evan Liu (**Evan to confirm**; the dashboard shows the account's publisher name) |
| Support email | `SUPPORT_EMAIL_TBD` (**Evan to supply**; `node scripts/check-release-docs.mjs --release` refuses a release while the placeholder remains) |
| Homepage | `https://ai-checkout-api.onrender.com/` |
| Support URL | `https://ai-checkout-api.onrender.com/support/` |
| Privacy policy URL | `https://ai-checkout-api.onrender.com/privacy/` |
| Mature content | No |
| Directed at children | No |
| Trader declaration (EU consumer-protection field) | **Non-trader**, recommended: a free, non-commercial portfolio project with no sales, no ads and no paid features. **Evan to confirm**; it is a legal statement about him |

## Detailed description (public copy)

See which card you already own earns the most, right on your cart.

Pick your cards once. On the cart or checkout page of any U.S. online store, AI Checkout shows a small badge with your best card and its estimated reward for that cart, for example "Use Blue Cash Everyday · $3.00 back". Click it to see every card you own, ranked, with the issuer's rule behind each estimate, its conditions and a payment-method choice. When the cart amount can't be read with certainty, the badge ranks your cards by rate instead of guessing an amount.

What it covers:

- 178 U.S. personal credit cards from the ten largest issuers (American Express, Bank of America, Barclays, Capital One, Chase, Citi, Discover, Synchrony, U.S. Bank, Wells Fargo), cash back and points. Add yours by searching for the card or bank name; no card numbers or bank login.
- More than 600 named U.S. stores with their bonus category (supermarkets, drugstores, home improvement and so on), plus a general profile for every other store, so category bonuses are applied where they count.
- Card terms are published from the issuers' own terms, checked by independent reviewers, approved by a person before each release, and refreshed by the extension weekly. Points and miles are compared in cash at a published estimate unless the issuer states a value or you set your own.

How it works:

- The badge reads the cart's order-summary amount and nothing else on the page: never item names, addresses or payment fields. It shows an amount only when it is sure of it.
- Every estimate quotes the issuer's terms. Unknown spend toward a cap, an unactivated bonus or an uncertain payment method show as a range, never a guess.
- The comparison runs on your device. No account, no model at checkout, and your cards never leave your browser unless you choose to share usage reports.
- Dismiss the badge for a tab, turn it off for a site, or switch it off everywhere in Settings. Optional passphrase protection encrypts your saved cards.
- Optional usage reports (you are asked once, after picking your cards) help improve the reader and the store list. They carry a random identifier, no name, email or browsing history, and never a store's address unless you tap "Suggest this store" or "Report a problem". Stop sharing or delete your reports any time from Settings.

Scope and limitations:

AI Checkout is a rewards comparison tool, not a card-benefits catalog or a payment service. It does not apply for cards, link a bank, process a payment or place an order. U.S. stores and U.S. dollars only. Issuer eligibility and how a purchase posts affect actual rewards; offers, fees, financing and other benefits are not modeled. Dollar amounts are estimates and may differ from your statement. Card terms expire 30 days after they were verified; the extension refreshes them weekly and when you ask, and tells you when they need a refresh. AI Checkout is an independent project and is not affiliated with any card issuer or retailer.

Store categories in the extension's store list are derived in part from public purchase-card transaction data published by the State of Oklahoma (Office of Management and Enterprise Services) under CC BY 4.0, by the Government of the District of Columbia and by the U.S. General Services Administration (CC0), pooled and aggregated to per-store category counts; the State of Oklahoma does not endorse this product. Full credits: https://ai-checkout-api.onrender.com/credits/

## Single purpose (dashboard copy)

Shows which of the credit cards you already own earns the most on the cart or checkout page you are viewing, from the visible cart amount and the reward rules published by the issuers. Every feature serves it: the badge and popup (the answer), the catalog and store-list downloads (the rules and store categories the answer needs), and optional usage reporting (measuring and improving the answer).

## Permission justifications (dashboard copy)

The built manifest (`extension/dist/manifest.json`, generated by `vite.config.ts` and checked by `scripts/release-package.mjs`) declares exactly these; nothing else may appear.

| Manifest entry | Justification |
| --- | --- |
| Host permission `https://*/*` | The badge must recognise a cart or checkout page at any store, so a packaged content script runs on https pages (top frame only, after load). On a page whose address and title carry no cart or checkout word it reads nothing from the page and observes none of its content (it only re-checks the address after a same-document navigation). On a cart or checkout page it reads the visible order-summary amount and its currency and sends only the amount, its kind, the currency and a reader version to the extension's own service worker; never item names, addresses, form values, card numbers or page text, and nothing to any server. The store is matched on the device against the downloaded store list, so no server learns which sites are visited. The same access lets the service worker read the tab's address in memory to match the store and, only when the shopper taps Suggest this store or Report a problem, derive the registrable domain that tap sends. |
| Host permission `https://ai-checkout-api.onrender.com/*` | Download the published card terms (`/v1/catalog`) and the store list (`/v1/merchants`): schema-validated JSON data, never code, fetched at install, weekly and on "Check for updated terms". After the shopper opts in, send usage reports to `/v1/events` and deletion requests to `/v1/events/delete` on the same origin. Requests carry no cookies, referrer or credentials. |
| `storage` | Keep the shopper's chosen cards and options, settings, purchase inputs, the downloaded card terms and store list, and the usage-report consent and queue in `chrome.storage.local`, and per-tab badge state in `chrome.storage.session`, on the device. |
| `activeTab` | When the shopper opens the popup or chooses "Read cart amount", read the current tab's cart total once with the same packaged reader, and match the tab's store. The `https://*/*` host permission covers https tabs; `activeTab` is what lets the shopper read an http:// cart with "Read cart amount" (a click in the popup), where the badge never runs and no host permission is requested. Nothing is read from a tab the shopper has not opened the popup on. |
| `scripting` | Inject the packaged cart reader (`src/checkout/content.js`) into the active tab for that one read (`chrome.scripting.executeScript` with a packaged file; no remote or generated code). |
| `alarms` | The weekly refresh of card terms and the store list (with one retry when it fails) and the 15-minute batching of usage reports while any wait. No install warning. |
| Content script `src/badge/content.js` on `https://*/*` (`document_idle`, top frame only) | The automatic badge described under the `https://*/*` host permission. |
| Web-accessible resource `src/badge/index.html` on `https://*/*` | The badge is an extension page shown in an isolated frame inside a closed shadow root, so the store's page cannot read card names or amounts. It is the only web-accessible file. |

## Remote code

**No.** All code (the rewards engine, the cart reader, the badge and popup) is packaged in the extension. The card catalog and the store list are JSON data validated against fixed schemas before use; no script, stylesheet or WebAssembly is fetched or evaluated. `grep -rn "eval(\|new Function" extension/src` returns nothing, and neither does a grep of the built `extension/dist` bundles for `eval(`, `new Function(`, `importScripts` or `WebAssembly` (15.5 review, 2026-10-19); the 15.7 reviewer confirms this on the upload ZIP.

## Privacy practices tab

**Does the extension collect or use user data?** Yes.

| Dashboard category | Answer | What to disclose |
| --- | --- | --- |
| Personally identifiable information | No | No name, address, email, age or identification number. A random identifier is created only when the shopper chooses Share and is explained in the policy. |
| Health information | No | |
| Financial and payment information | **Yes** | After opt-in: cart amounts read on cart and checkout pages (exact, in cents, never with a store or domain) and the card products the shopper owns, as catalog identifiers. Never card numbers, security codes, bank accounts or balances. |
| Authentication information | No | |
| Personal communications | No | |
| Location | No | No GPS, IP-derived or address data is collected by the extension (the service's host logs IP addresses as any web host does; the policy says so). |
| Web history | No | No list of visited pages is read or built. A page's address is checked in memory for a cart word and never stored or sent; a store's domain is sent only when the shopper taps Suggest this store or Report a problem. |
| User activity | **Yes** | After opt-in: the badge shown, expanded or dismissed, the popup opened, a site switched off, an amount typed (as a range), refresh outcomes and error codes. No keystrokes, mouse positions or scrolling. |
| Website content | **Yes** | The cart total and its currency read on a cart or checkout page (shown to the shopper; sent only after opt-in and only as the amount), and a store's domain when the shopper taps Suggest this store or Report a problem. |

**Certifications (all three ticked):** I do not sell or transfer user data to third parties, outside of the approved use cases. I do not use or transfer user data for purposes that are unrelated to my item's single purpose. I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://ai-checkout-api.onrender.com/privacy/`. The policy contains the Limited Use statement ("AI Checkout's use and transfer of information received from users adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements").

Consistency rule for the reviewer pass: the consent screen (`extension/src/state/telemetry-contracts.ts:CONSENT_COPY`), the Settings copy, the policy, this tab and the generated dictionary (`docs/telemetry/events.md`, `npm run telemetry:check`) must describe the same data. A build without `VITE_TELEMETRY` has no consent screen and sends nothing; if Chrome review objects to usage reporting, Release A is resubmitted from that build with "User activity" and the financial-data answer reduced to the on-device handling and the policy amended ([decision](../../wiki/decisions/2026-10-19-release-a-telemetry-design.md)).

## Test instructions (dashboard field)

Paste the short version from [reviewer-instructions.md](reviewer-instructions.md#short-version-for-the-dashboard). No login, payment or account is needed.

## Assets

Store icon 128×128 (the cart mark, 96 px artwork with 16 px padding), screenshots at 1280×800 and the 440×280 promo tile are regenerated against the 2.1.0 ZIP in milestone 15.6 and recorded in [assets/README.md](assets/README.md). The assets committed today were made for 2.0.0 and show the retired three-store flow; they must not be uploaded.

References checked 2026-10-20: [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use), [images](https://developer.chrome.com/docs/webstore/images). Recheck the dashboard's wording at submission.
