# AI Checkout privacy policy — draft

**Not published.** This draft describes both the default extension build (no network request) and builds configured with the hosted catalog (`npm run build:hosted`, the intended store release), which make one catalog request when the user asks. Resolve [the recorded privacy findings](privacy-review.md), fill the public placeholders, and remove this preparation notice only after the final implementation and policy agree.

Effective date: **[[EFFECTIVE_DATE]]**
Operator: **[[PUBLISHER_NAME]]**
Privacy and support contact: **[[SUPPORT_EMAIL]]**

## What AI Checkout does

AI Checkout compares estimated rewards on supported credit-card products that you select. On the supported Amazon US, Best Buy US and Newegg US carts it shows a badge with your best card for the cart automatically; elsewhere you can compare a purchase you enter. The shopper extension does not require an account, connect to a bank, or process a payment.

## Information handled on your device

The extension saves the following in its local Chrome profile storage, which the extension restricts to its own pages and service worker each time it starts, so web pages and its own content scripts cannot read it (confirmed by the browser tests on Chromium 153; the extension supports Chrome 120 and later). By default it is stored unencrypted; if you turn on **Protect with a passphrase** in Settings, it is encrypted with your passphrase (see Storage protection).

- The card product identifiers you select and your default card (used to break ties and as the baseline for savings).
- Card options you choose: the bonus categories you selected, your answers to optional membership, status and account questions (for example a Prime or Sam's Club membership, a bank relationship or balance tier, or when an account was opened), and any point values you set.
- Your badge settings: the sites where the badge is turned off.
- Your savings history: for each order you confirmed in the badge, the date, merchant, last cart amount, recommended card, the card you said you used (or "not sure"), and the estimated rewards for that card and for your default card.
- Optional reward-limit information you report, such as annual online-retail spend, its date/year and applicable activation status.
- Your latest saved purchase inputs: merchant, USD amount, date and eligibility selections.
- Information needed to restore or invalidate a comparison, including catalog version, revision and timestamps. Reward amounts are calculated from these inputs.
- In hosted builds, the most recently downloaded published catalog (public card terms, no personal data).
- When you read a supported cart: amount, currency, amount type (total, estimated total or subtotal), merchant/reader identifiers, capture time, a random capture identifier, tab/document identifiers and a hash of the page identity.

**Automatic cart badge.** On `www.amazon.com`, `bestbuy.com`/`www.bestbuy.com` and `secure.newegg.com` only, a script packaged with the extension runs on the cart, checkout and order-confirmation pages (declared address patterns). On a cart page it reads the visible order-summary amount through a bundled site adapter (on Amazon US, only the cart page's "Subtotal (N items)" label and amount) when the page loads and when the summary changes, and passes only the merchant, amount, amount type and reader version to the extension. The badge's card names and amounts are shown in an isolated frame that the merchant page cannot read. While a tab is open the extension keeps, in Chrome's session memory, that tab's latest cart amount, your typed amount and payment choice, whether you dismissed the badge, and the card it last recommended; this is cleared when the tab closes or Chrome restarts.

**Order recognition.** If an order-confirmation page of the same site opens in that tab within three hours of a recommendation, the extension recognizes it from the page address alone (the page is never read; the page must have loaded at that address, not reached it by an in-page change) and the badge asks once which card you paid with. Reloading the order page shows the same question; it is never asked twice. An unanswered question expires three hours after the order page or as soon as another cart is read in that tab. Your answer is saved to the savings history above; if you dismiss the question nothing is saved.

**Manual reads.** After you request a cart read from the toolbar popup, the extension examines bounded visible summary labels and amounts. It accesses the current tab URL in memory to check the merchant and whether the page changed. It does not save that raw URL, query string or page HTML. The stored hash is a freshness identifier; it is not a promise of anonymization. A captured cart may be rechecked when you compare or reopen a saved comparison.

The extension does not read card numbers, security codes, bank credentials, addresses, payment-field values or product names. It does not run on other websites and does not request your browsing-history list. Apart from the savings history you choose to build, it saves the current working purchase, not a transaction log.

## Purpose and sharing

These inputs are used to calculate and explain estimates, retain your chosen cards and settings, keep your savings history and detect stale comparisons. They are not sold, used for advertising, used to determine creditworthiness, or sent to the publisher or an AI provider. There are no analytics, tracking pixels or accounts.

Reading carts, showing the badge, recognizing orders and comparing make no network request. Opening a card-source link takes you to the issuer's website, which operates under its own privacy policy. Your browser and the Chrome Web Store may handle installation/update information under their own terms. Ordinary merchant browsing is also separate from the extension.

AI-assisted catalog maintenance is a separate administrator tool. This extension does not send your wallet or purchase inputs to that tool or to a model. Its calculations use the rules packaged with the extension.

## Catalog updates (hosted builds only)

The default build makes no network request; it uses the card terms packaged with it. Builds configured with the hosted catalog show **Check for updated terms**. Each time you choose it, and only then, the extension sends one HTTPS GET request for the published catalog to a fixed address on the AI Checkout API (`https://ai-checkout-api.onrender.com/v1/catalog`). It never fetches in the background.

The request carries no cookies, no referrer and none of your cards, amounts, purchase inputs or page addresses. Like any web request it reveals your IP address, your browser's user agent and the time of the request, which the API host records in its access logs. The API is operated by the AI Checkout project (github.com/evanxliu1/AICheckout), hosted on Render, with the catalog stored in Supabase. Access logs are retained according to those hosting providers' log retention; deleting your data in the extension cannot delete them.

## Retention, changes and deletion

Your working inputs, settings and savings history remain in this Chrome profile until replaced, deleted with **Delete all local data** (or **Delete history** for savings alone), or removed when the extension is uninstalled. You can export the savings history as a JSON file from the popup. The extension does not use Chrome Sync to synchronize them across devices.

A cart capture becomes unusable after five minutes; manual comparisons become unusable after at most fifteen minutes, and other input/date/catalog changes may invalidate them sooner. These limits are freshness checks, not scheduled deletion of every stored input. Inactive extension storage can remain on disk; your last entered purchase and reported spend may remain after their estimates become stale.

Use **Edit cards** to change selected products and reported limits. Enter a new purchase to replace the working purchase. Expanding **Delete saved data**, confirming permanent deletion, and choosing **Delete all local data** clears extension-managed local state and the unlock key, including obsolete prototype keys/logs if present. Card setup returns. It does not clear a merchant's cart, Chrome history, issuer records, backups made outside the extension, or messages you sent to support.

## Storage protection

Passphrase protection is optional and off by default. Without it, saved inputs are stored unencrypted in the extension's local storage: other websites and the extension's content scripts cannot read it, but someone with access to your device or Chrome profile files could. Turn on **Protect with a passphrase** in Settings to encrypt it; turning protection off again (with the passphrase) stores the same data unencrypted.

With protection on, saved inputs are encrypted with a key derived from your local passphrase. While locked, the badge only says "Unlock to see your best card". The passphrase is not saved by the extension. The usable unlock key is kept in Chrome’s session memory, separately from the persistent encrypted record, until you choose **Lock saved inputs**, restart Chrome, or reload/update the extension. Closing the popup or normal background-worker shutdown does not lock the session. Both storage areas are restricted to trusted extension contexts. Format metadata, including a random identity, salt, revision and encrypted-record length, remains unencrypted.

While unlocked, someone using your Chrome profile can view these inputs. Protection depends on a strong passphrase and does not protect an already compromised device, earlier unencrypted copies, external backups, or an older valid encrypted record restored by someone with profile access. The extension does not promise forensic erasure or protection from operating-system memory capture. Do not enter payment credentials.

Turning protection on replaces the active saved record with encrypted data; it cannot erase old disk or backup copies. A forgotten passphrase cannot be recovered: use **Delete saved data** and confirm deletion to start again. This removes the saved inputs and session key without needing the passphrase.

## Contact and policy changes

For privacy questions, contact **[[SUPPORT_EMAIL]]**. Do not send card numbers, payment credentials, complete cart pages or unredacted shopping screenshots. Any information you choose to send through a support channel is handled separately from local extension storage; the final support channel's provider, retention and deletion practices must be disclosed before this policy is published.

Changes to data handling will be reflected in this policy and the extension's relevant disclosures. Any additional network request, or a change to the catalog service, its operator or providers, requires an updated policy before distribution.
