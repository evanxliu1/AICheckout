# AI Checkout privacy policy

<!-- Source text for https://ai-checkout-api.onrender.com/privacy/, which apps/site/src/pages.tsx renders; keep the two the same in substance. It describes the Chrome Web Store build, version 2.1.0. A build made from source without a catalog endpoint makes no network requests; the policy says so where it matters. This is not legal advice; Evan Liu reviews and approves it before submission. -->

Last updated: 2026-11-06
Operator: Evan Liu (the AI Checkout project, github.com/evanxliu1/AICheckout)
Contact: evanliu7788@gmail.com

AI Checkout is a Chrome extension published by Evan Liu ("we", "us"). This policy covers the Chrome Web Store build of the extension, version 2.1.0, and the AI Checkout service it connects to.

## Summary

- Your cards, settings and purchase inputs stay in your Chrome profile. There's no account, and no AI model runs at checkout.
- On a cart or checkout page, the extension reads the order-summary amount and its currency. It doesn't collect item names, addresses or payment fields, and it doesn't save the page's web address.
- The extension downloads published card terms and a store list. These requests carry none of your cards, amounts, settings or page addresses.
- Usage reports are optional and off until you choose **Share**. They carry a random identifier: no name, email or browsing history. You can stop sharing at any time, and delete reports sent under your identifier while you still share. Two buttons, Suggest this store and Report a problem, send a store's domain when you tap them, even without Share.
- We don't sell your information or use it for advertising.

## What AI Checkout does

AI Checkout tells you which of the credit cards you already own earns the most on the cart or checkout page you're viewing. You pick your cards once. On the cart or checkout page of any https store, a small badge shows your best card and its estimated reward. When the cart amount can't be read with certainty, the badge ranks your cards by rate instead. The toolbar popup compares any purchase. The comparison is arithmetic over published card terms and runs on your device. There's no bank connection and no payment processing.

## Information stored on your device

The extension saves the following in its own Chrome storage. Each time it starts, it restricts that storage to its own pages and service worker, so websites and the extension's content scripts can't read it. Your cards and inputs are unencrypted unless you turn on passphrase protection (see [Optional passphrase protection](#optional-passphrase-protection)).

- The cards you picked (as catalog identifiers, never card numbers, security codes or balances) and your default card.
- Card options: bonus categories you chose, answers to optional membership, status and account questions (for example a Prime membership or when an account was opened), spending you report toward a card's cap with its date, activation choices and point values you set.
- Badge settings: whether the badge is on, and the sites you turned it off for with **Not on this site** (their hostnames).
- Your latest purchase inputs in the popup (store, amount, date and eligibility choices) and what's needed to show or invalidate a saved comparison (catalog version, revision and timestamps).
- After a cart read from the popup: the amount and currency, its kind (total, estimated total or subtotal), the matched store, the reader version, the capture time, a random capture identifier, the tab and document identifiers, and a hash of the page address used to notice that the page changed (a freshness check, not a privacy measure). The address itself isn't saved.
- The most recent card catalog and store list downloaded (public data).
- In builds with usage reporting: your answer to the consent question, the random identifier created when you chose Share, reports waiting to be sent (at most 200), and the time sharing started (or, if you never shared, when you first answered or tapped Suggest or Report), from which only a month and an age range are ever sent. This state is never encrypted because it holds no wallet data. **Stop sharing**, **Delete my data** and **Delete all local data** delete the identifier and waiting reports.

While a tab is open, the extension also keeps the following in Chrome's session memory for that tab: the matched store and the tab's hostname (never the page path), the latest cart reading, an amount you typed in the badge, your payment-method choice, whether you dismissed the badge, whether a cart or checkout page was read, which recommendation was last reported (if you share) and whether you suggested the store. Session memory is cleared when the tab closes or Chrome restarts. Nothing is synced to other devices.

## Information read on web pages

The extension asks for access to every https website because a cart can be at any store. It uses that access only as described here.

- **On every https page.** A packaged script runs in the top frame after the page loads. It checks the page's address and title for a cart or checkout word (such as cart, basket, bag or checkout, or an equivalent in another language). On a page with neither, it reads nothing from the page and observes none of its content. It only notices when the address changes without a reload, as on single-page stores, and checks the new address the same way.
- **On a cart or checkout page.** The script reads the visible text of the main content to find the order summary (Subtotal, Shipping, Tax, Total) and cart line items. To determine the currency, it also reads the page's structured data (for example a `priceCurrency` value), currency meta tags and attributes, the country code of the store's web address and the page language. It keeps watching the page while you're on the cart so the badge follows quantity changes, up to 120 readings per page load.
- **What leaves the page.** Only the reading goes to the extension's own service worker on your device: whether an amount was found, the amount in cents, its kind, the currency and the reader version, or a reason code when no amount is shown (for example an empty cart, another currency or an amount that couldn't be read with certainty). It never includes item names, addresses, form values, card numbers, the page's text or its address. The script makes no network request.
- **The store is matched on your device.** The extension downloads the whole published store list and compares the tab's hostname with it locally, so the service never learns which stores you visit. On a payment processor's page (PayPal, Shop Pay, Klarna and others), no badge is shown and nothing is kept.
- **Isolated badge.** Your card names and amounts appear in a frame on an extension page that the store's page can't read. Clicks on it count only while it's fully visible.
- **The popup.** When you open the popup or choose **Read cart amount**, it reads the open tab the same way, with the same packaged script. On an http page, it reads only when you choose **Read cart amount**; the badge never runs there. The popup uses the tab's address in memory to match the store and never saves it.
- **Turning it off.** To turn the badge off for a site, choose **Not on this site**. To turn it off everywhere, use the badge switch in Settings.

Amounts in another currency aren't compared (U.S. dollars only). The extension doesn't read card numbers, security codes, bank credentials, addresses, payment fields or product names, and it doesn't request or read your browsing history.

## Information sent to the AI Checkout service

Card terms and the store list are published as data, and nothing the extension downloads is code. The Chrome Web Store build makes these requests to `https://ai-checkout-api.onrender.com`:

- **`GET /v1/catalog` and `GET /v1/merchants`** download the published card terms and the store list, which the extension validates against fixed schemas before use. They run right after installation and again a few minutes later, then weekly (with one retry a few minutes later if a weekly attempt fails), and whenever you choose **Check for updated terms**. Card terms expire 30 days after they were verified; the weekly check keeps them current. These requests carry no cookies, no referrer and none of your cards, amounts, settings or page addresses.
- **Usage reports** are sent only after you choose Share, except for the two things you send on purpose. Both are described in the next section.

Like any web request, each request reveals your IP address, your browser's user agent and the time of the request to the service's host, which records them in access logs. Evan Liu operates the service for the AI Checkout project. It's hosted on Render, with its data stored in Supabase. Access logs are kept according to those providers' log retention, which AI Checkout doesn't control, and deleting your data in the extension can't delete them. If you open a card's issuer link, the issuer's website and its own privacy policy apply. Chrome and the Chrome Web Store handle installation and updates under Google's terms. A build made from source without a catalog endpoint makes none of these requests and has no usage reporting.

## Usage reports (optional)

After you pick your cards, the extension asks once whether to **Share** usage reports or choose **Not now**. Reports help improve the cart reader, the store list and the recommendations. The extension works the same either way, and you can change your answer at any time in Settings in the toolbar popup. Apart from the two things you send on purpose (described below), nothing about your use leaves the device before you choose Share.

- **A random identifier, no name, email or browsing history.** Every report carries an identifier that's created when you choose Share, so repeated reports from one install can be told apart. Because the identifier persists and some reports carry exact amounts, this data is pseudonymous: it can't be tied to you by name, but reports from one install can be linked to each other. Each report also carries its own random report identifier, the time it was built, the versions of the extension, card terms, store list and cart reader in use, the versions of the consent text and of the dictionary, and the month you chose Share with how long ago that was (as a range: 0, 1–6, 7–13, 14–29, 30–59 or 60+ days).
- **What reports contain.** The public event dictionary ([`docs/telemetry/events.md`](https://github.com/evanxliu1/AICheckout/blob/main/docs/telemetry/events.md)) lists every field. Reports say that sharing started and that setup finished, with how many cards you picked; the cards you own, as catalog identifiers, when sharing starts and whenever you change them; each recommendation shown (in the badge or the popup and in which view, the recommended card, how many cards you have, the store's category, whether the store is one the list names and the evidence for its category, whether it was a cart or checkout page or a popup read, the exact cart amount read in cents and its kind, or that it wasn't read, and whether an unanswered card question could change the ranking); the badge expanded or dismissed (with its view), a site switched off and the popup opened (with what its read found), each with whether the list names the store; how far an amount you typed was from the one read (as a range); each refresh of card terms or the store list (what started it, whether it worked, and the versions before and after); and error codes when a request fails, with where it happened, without messages, addresses or page content.
- **What an automatic report never contains:** a store name, domain or web address, the page's text, item names, card numbers, your name or email, or your browsing history. The extension's service worker builds reports from what it already knows. The scripts that run on web pages send nothing anywhere.
- **Two things you send on purpose.** "Suggest this store" (in the popup or the badge panel, at a store the list doesn't name) and "Report a problem" (in the popup, with a fixed reason and no text field) send the store's registrable domain (for example `example.com`) with that one request. They also send the page kind (Suggest) or the reason and what the badge showed (Report), plus the versions, month and age range described above. They work whether you share or not. When you don't share, they carry no identifier, so they cannot be deleted on request and expire with the 90-day retention.
- **How reports are sent and kept.** Reports wait on your device (at most 200) and go to `POST /v1/events` on the same service every 15 minutes while any are waiting, at once when 50 are waiting, when you choose Share, and when you tap Suggest or Report. The service accepts at most 500 reports per identifier per day and keeps raw reports for **90 days**. A scheduled job on the service deletes older reports once a day (03:17 UTC), and the service also deletes them each time it receives, deletes or summarizes reports, so a report is gone within about a day after it turns 90 days old. Aggregate counts with no identifier (for example how often a store was suggested) may be kept longer. Reports are reviewed as these aggregate counts and as the list of suggested store domains with their counts.
- **Your controls in Settings.** **Stop sharing** (turning the toggle off) deletes the identifier and any waiting reports on the device and sends nothing more. Reports already sent can then no longer be deleted from the extension and expire after 90 days. **Delete my data** sends your current identifier to `POST /v1/events/delete`, which deletes every report stored under it, and then stops sharing. To delete earlier reports, use it before you stop sharing. Choosing Share again creates a new identifier. If the service is unavailable, the extension tells you that nothing was deleted yet so you can try again.

## How we use and share information

Reports are used to see whether the cart reader shows amounts on real stores, which stores shoppers want added and whether recommendations are used, and to fix errors. Reports are not sold, not used for advertising, not used to decide creditworthiness or lending, and not sent to an AI provider or any third party other than the hosting providers named above. AI Checkout's use and transfer of information received from users adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. If we ever want to use reports for another purpose, we'll ask you first and update this policy.

## Optional passphrase protection

Protection is off by default. Saved data is stored unencrypted in the extension's storage, which websites and the extension's content scripts can't read but someone with access to your device or Chrome profile could. To encrypt it, turn on **Protect with a passphrase** in Settings. The extension then encrypts your saved data with a key derived from a passphrase you choose; the passphrase isn't saved. While the data is locked, the badge only asks you to unlock. The unlock key stays in Chrome's session memory until you choose **Lock saved inputs**, restart Chrome, or the extension reloads or updates. Closing the popup doesn't lock. Format metadata (a random identity, salt, revision and the encrypted record's length) stays unencrypted, and so do the downloaded catalog and store list and the usage-reporting state, which hold no wallet data.

While the data is unlocked, someone using your Chrome profile can see your inputs. Encryption doesn't protect a device that's already compromised, earlier unencrypted copies or backups made outside the extension. A forgotten passphrase can't be recovered; use **Delete saved data** to start again. Never enter payment credentials in the extension.

## Data retention and deletion

- Your cards, options, settings and purchase inputs stay in this Chrome profile until you change them, delete them or uninstall the extension. A cart read becomes unusable after five minutes and a comparison after fifteen. These are freshness limits, not scheduled deletion.
- **Delete all local data** (expand **Delete saved data** in the popup and confirm) clears everything the extension saved, including the downloaded catalog and store list, the unlock key and the usage-reporting state (your answer, the identifier and waiting reports). While you're sharing, it first sends your identifier to `POST /v1/events/delete`, exactly as **Delete my data** does, and clears this device only after the service confirms the deletion. If the service can't be reached or refuses, nothing is cleared and the extension offers **Try again** or **Clear this device anyway**, which keeps the reports already sent until they expire. Card setup then starts again, and nothing is shared until you choose Share again. Deleting doesn't affect a store's cart, your browser history or issuer records.
- **Delete my data** (in Settings) deletes the usage reports stored under your identifier on the service, as described above.
- **Uninstalling** removes the extension's storage from your device. Chrome then opens a page on this site, with no parameters, that repeats these points. Reports already sent are deleted within about a day after they turn 90 days old. To delete them sooner, use **Delete my data** or **Delete all local data** before you uninstall, because the identifier is removed with the extension.

## Your choices and rights

Everything the extension holds about you is on your device, where you can see it in the popup and delete it. For usage reports, the only data the service holds under an identifier, the controls above let you stop sharing and delete reports without contacting anyone. Because the identifier is random and the service holds nothing else about you, no one can find your reports from your name or email; **Delete my data** is the way to delete them. AI Checkout doesn't sell personal information and doesn't share it for cross-context behavioral advertising.

## Children

AI Checkout is not directed at children under 13 and doesn't knowingly collect information from them. It's offered in the United States only.

## This website

This site sets no cookies, runs no analytics and loads nothing from other domains. It's served by the same service on Render, whose access logs record IP address, user agent and request time.

## Changes to this policy

Before a change to what the extension collects or sends takes effect, we update this policy and the extension's consent and settings text, and change the date at the top of this page. Material changes to usage reporting ask for your consent again.

## Contact us

For questions about this policy or your data, email evanliu7788@gmail.com. To report a security vulnerability, see [Support](https://ai-checkout-api.onrender.com/support/).
