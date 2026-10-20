# AI Checkout privacy policy

This is the text published at `https://ai-checkout-api.onrender.com/privacy/` (rendered from `apps/site/src/pages.tsx`; the two must say the same thing). It describes the Chrome Web Store build of AI Checkout, version 2.1.0, which downloads card terms and the store list from the AI Checkout service and offers optional usage reporting. A build made from source without a catalog endpoint makes no network request at all; where that differs it is said below. It is not legal advice; Evan Liu reads and approves it before submission.

Last updated: 2026-10-20
Operator: **Evan Liu** (the AI Checkout project, github.com/evanxliu1/AICheckout)
Privacy and support contact: **SUPPORT_EMAIL_TBD**

## What AI Checkout does

AI Checkout tells you which of the credit cards you already own earns the most on the cart or checkout page you are looking at. You pick your cards once; on a cart or checkout page of any https store, a small badge shows your best card and its estimated reward, or, when the cart amount could not be read with certainty, the cards ranked by rate. The toolbar popup compares any purchase. There is no account, no bank connection, no payment processing and no AI model at checkout: the comparison is arithmetic over published card terms, run on your device.

## Information kept on your device

The extension saves the following in its own Chrome storage, which it restricts to its own pages and service worker each time it starts, so websites and its content scripts cannot read it. It is stored unencrypted by default; **Protect with a passphrase** in Settings encrypts the shopper's data with a key derived from your passphrase (see Optional passphrase protection).

- The cards you picked (as catalog identifiers, never card numbers, security codes or balances) and your default card.
- Card options you chose: bonus categories, answers to optional membership, status and account questions (for example a Prime membership or when an account was opened), spending you report toward a card's cap with its date, activation choices, and point values you set.
- Badge settings: whether the badge is on, and the sites where you turned it off with **Not on this site** (their hostnames).
- Your latest purchase inputs in the popup: store, amount, date and eligibility choices, and what is needed to show or invalidate a saved comparison (catalog version, revision, timestamps).
- After a cart read from the popup: the amount and currency, its kind (total, estimated total or subtotal), the store the extension matched, the reader version, the capture time, a random capture identifier, the tab and document identifiers, and a hash of the page address used to notice that the page changed (a freshness check, not a privacy measure). The address itself is not saved.
- The most recent card catalog and store list downloaded from the AI Checkout service (public data, no personal information).
- Usage reporting state, only in builds with usage reporting: your answer to the one consent question, the random identifier created when you chose Share, reports waiting to be sent (at most 200), and the time sharing started (or, if you never shared, when you first answered or tapped Suggest or Report), from which only a month and an age range are ever sent. This is never encrypted because it holds no wallet data; the identifier and waiting reports are deleted by **Stop sharing**, **Delete my data** and **Delete all local data**.

While a tab is open, the extension also keeps in Chrome's session memory, per tab: the store it matched and the tab's hostname (never the page path), the latest cart reading, an amount you typed in the badge, your payment-method choice, whether you dismissed the badge, whether a cart or checkout page was read, which recommendation was last reported (if you share usage reports) and whether you suggested the store. Session memory is cleared when the tab closes or Chrome restarts. Nothing is synced to other devices.

## The cart badge: what it reads on web pages

The extension asks for access to every https website, because a cart can be at any store. Here is exactly what that access is used for.

- **A packaged script runs on https pages**, in the top frame only, after the page has loaded. It first looks at the page's address and title for a cart or checkout word (cart, basket, bag, checkout and their equivalents in other languages). On a page with neither, it reads nothing from the page and observes none of its content; it only notices when the address changes without a reload (as on single-page stores) and checks the new address the same way.
- **On a cart or checkout page** it reads the visible text of the page's main content to find the order summary (rows such as Subtotal, Shipping, Tax and Total) and cart line items, and, to tell the currency, the page's structured data (for example a `priceCurrency` value), currency meta tags and attributes, the country code of the store's web address and the page language. It keeps watching the page while you are on the cart so the badge follows quantity changes, up to 120 readings per page load.
- **What leaves the page:** only the reading, sent to the extension's own service worker on your device: whether an amount was found, the amount in cents, its kind (total, estimated total or subtotal), the currency and the reader version, or a reason code when no amount is shown (for example an empty cart, another currency, or an amount that could not be read with certainty). Never item names, addresses, form values, card numbers, the page's text or its address. The script makes no network request.
- **Matching the store** happens on your device: the extension downloads the whole published store list and compares the tab's hostname with it locally, so the service never learns which stores you visit. On a payment processor's page (PayPal, Shop Pay, Klarna and others) no badge is shown and nothing is kept.
- **Isolated badge.** Your card names and amounts appear in a frame on an extension page that the store's page cannot read. Clicks on it count only while it is fully visible.
- **The popup** reads the open tab the same way, with the same packaged script, when you open it or choose **Read cart amount** (on an http page only when you choose **Read cart amount**; the badge never runs there); it uses the tab's address in memory to match the store and never saves it.
- **Switch it off** for a site with **Not on this site**, or everywhere with the badge switch in Settings.

Amounts shown in another currency are not compared (U.S. dollars only). The extension does not read card numbers, security codes, bank credentials, addresses, payment fields or product names, and does not request or read your browsing history.

## Network requests

Card terms and the store list are published as data and downloaded by the extension; nothing it downloads is code. In the Chrome Web Store build the extension sends:

- **`GET /v1/catalog` and `GET /v1/merchants`** on `https://ai-checkout-api.onrender.com`: the published card terms and the store list, validated against fixed schemas before use. They are fetched right after installation and again a few minutes later, then weekly (with one retry a few minutes later if a weekly attempt failed), and whenever you choose **Check for updated terms** in the popup. Card terms expire 30 days after they were verified; the weekly check keeps them current. These requests carry no cookies, no referrer and none of your cards, amounts, settings or page addresses.
- **Usage reports**, only after you choose **Share** (next section).

Like any web request, each one reveals your IP address, your browser's user agent and the time of the request to the service's host, which records them in access logs. The service is operated by Evan Liu for the AI Checkout project and hosted on Render; its data is stored in Supabase. Access logs are kept according to those providers' log retention, which AI Checkout does not control; deleting your data in the extension cannot delete them. Opening a card's issuer link takes you to the issuer's website under its own privacy policy. Chrome and the Chrome Web Store handle installation and updates under Google's terms.

A build made from source without a catalog endpoint makes none of these requests and has no usage reporting.

## Usage reports (optional)

After you pick your cards, the extension asks once whether to **Share** usage reports to help improve the reader, the store list and the recommendations, or **Not now**. The extension works the same either way, and you can change your answer any time under Settings in the toolbar popup. Apart from the two things you send on purpose (below), nothing about your use leaves the device before you choose Share.

**What a report contains.** Every report carries a **random identifier** created when you chose Share, so repeated reports from one install can be told apart: no name, email, account or browsing history. Because the identifier persists and some reports carry exact amounts, this data is pseudonymous: it cannot be tied to you by name, but reports from one install can be linked to each other. Each report also carries its own random report identifier, the time it was built, the versions of the extension, card terms, store list and cart reader in use, the versions of the consent text and of the dictionary, and the month you chose Share with how long ago that was (as a range: 0, 1–6, 7–13, 14–29, 30–59 or 60+ days). The events, listed in full in the public dictionary ([`docs/telemetry/events.md`](https://github.com/evanxliu1/AICheckout/blob/main/docs/telemetry/events.md)), are:

- that sharing started, and that setup finished with how many cards you picked;
- the cards you own, as catalog identifiers, when sharing starts and whenever you change them;
- each recommendation shown: whether in the badge or the popup and in which view, the recommended card, how many cards you have, the store's category (for example supermarkets), whether the store is one the list names and what evidence its category rests on, whether it was a cart or checkout page or a popup read, the exact cart amount read in cents and its kind, or that the amount was not read, and whether an unanswered card question could change the ranking;
- the badge expanded or dismissed (with its view), a site switched off (with whether the list names the store), the popup opened (what its read found and whether the list names the store), how far an amount you typed was from the one read (a range, not the amount), and each refresh of card terms or the store list (what started it, whether it worked, and the versions before and after);
- error codes when a request fails and where it happened, without messages, addresses or page content.

**What an automatic report never contains:** a store name, domain or web address, the page's text, item names, card numbers, your name or email, or your browsing history. Reports are built by the extension's service worker from what it already knows; the scripts that run on web pages send nothing anywhere.

**Two things you send on purpose.** "Suggest this store" (in the popup or the badge panel, at a store the list does not name) and "Report a problem" (in the popup, with a fixed reason and no text field) send the store's registrable domain (for example `example.com`) with that one request, together with the page kind (Suggest) or the reason and what the badge showed (Report), and the versions, month and age range described above. They work whether you share or not; when you do not share they carry no identifier, so they cannot be deleted on request and simply expire with the 90-day retention.

**How reports travel.** Reports queue on your device and are sent to `POST /v1/events` on the same service every 15 minutes while any wait, at once when 50 are waiting, when you choose Share, and when you tap Suggest or Report; at most 200 wait on the device. The service accepts at most 500 reports per identifier per day and keeps raw reports for **90 days**: a scheduled job on the service deletes older reports once a day (03:17 UTC), and the service also deletes them each time it receives, deletes or summarises reports, so a report is gone within about a day after it turns 90 days old. Aggregate counts (for example how many installs saw a recommendation in a week, or how often a store was suggested) may be kept longer and contain no identifier. Reports are reviewed as such aggregate counts and as the list of suggested store domains with their counts.

**Your controls, in Settings.** **Stop sharing** (the toggle off) deletes the identifier and anything waiting on the device and sends nothing more; reports already sent can then no longer be deleted from the extension and expire after 90 days. **Delete my data** sends your current identifier to `POST /v1/events/delete`, which deletes every report stored under it, and then stops sharing; use it before stopping sharing if you want earlier reports deleted. Choosing Share again creates a new identifier. If the service is unavailable, the extension tells you nothing was deleted yet so you can retry.

**Purpose and limits.** Reports are used to see whether the reader shows amounts in the wild, which stores shoppers want added and whether recommendations are used, and to fix errors. They are not sold, not used for advertising, not used to decide creditworthiness or lending, and not sent to an AI provider or any third party other than the hosting providers named above. AI Checkout's use and transfer of information received from users adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. If AI Checkout ever wanted to use reports for another purpose, it would ask you first and update this policy.

## Optional passphrase protection

Protection is off by default: saved data is stored unencrypted in the extension's storage, which websites and the extension's content scripts cannot read, but which someone with access to your device or Chrome profile could. Turn on **Protect with a passphrase** in Settings to encrypt the shopper's data with a key derived from a passphrase you choose; the passphrase is not saved. While locked, the badge only asks you to unlock. The unlock key stays in Chrome's session memory until you choose **Lock saved inputs**, restart Chrome, or the extension reloads or updates; closing the popup does not lock. Format metadata (a random identity, salt, revision and the encrypted record's length) stays unencrypted, and so do the downloaded catalog and store list and the usage-reporting state, which hold no wallet data.

While unlocked, someone using your Chrome profile can see your inputs. Encryption does not protect an already compromised device, earlier unencrypted copies, or backups made outside the extension. A forgotten passphrase cannot be recovered: use **Delete saved data** to start again. Never enter payment credentials into the extension.

## Retention and deletion

Your cards, options, settings and purchase inputs stay in this Chrome profile until you change them, delete them or uninstall the extension. A cart read becomes unusable after five minutes and a comparison after fifteen; these are freshness limits, not scheduled deletion.

- **Delete all local data** (expand **Delete saved data** in the popup and confirm) clears everything the extension saved: cards, options, settings, purchase inputs, the downloaded catalog and store list, the unlock key and the usage-reporting state (your answer, the identifier and waiting reports). While you are sharing, it first sends your identifier to `POST /v1/events/delete`, exactly as **Delete my data** does, and clears this device only once the service confirms the deletion; if the service cannot be reached or refuses, nothing is cleared and the extension offers **Try again** or **Clear this device anyway**, which keeps the reports already sent until they expire. Card setup returns, and nothing is shared until you choose Share again. It does not affect a store's cart, your browser history or issuer records.
- **Delete my data** (Settings) deletes the usage reports stored under your identifier on the service, as described above.
- **Uninstalling** removes the extension's storage from your device. Chrome then opens a page on this site with no parameters that repeats these points. Reports already sent are deleted within about a day after they turn 90 days old; to delete them earlier, use **Delete my data** or **Delete all local data** before uninstalling, since the identifier leaves with the extension.

## Children

AI Checkout is not directed at children under 13 and does not knowingly collect information from them. It is offered in the United States only.

## Your rights

Everything the extension holds about you is on your device, where you can see it in the popup and delete it. For usage reports, the only data the service holds under a person, the controls above let you stop and delete without contacting anyone. For any privacy question, write to **SUPPORT_EMAIL_TBD**. Because the identifier is random and the service holds nothing else about you, no one can find your reports from your name or email; **Delete my data** in Settings is the way to delete them, and the dictionary linked above is the full account of what they contain. AI Checkout does not sell personal information and does not share it for cross-context behavioral advertising.

## This website

This site sets no cookies, runs no analytics and loads nothing from other domains. It is served by the same service on Render, whose access logs record IP address, user agent and request time.

## Changes

Changes to what the extension collects or sends are made in this policy and in the extension's own consent and settings text before they take effect, and the date above is updated. Material changes to usage reporting ask for consent again.
