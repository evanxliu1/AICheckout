# AI Checkout support

This is the text published at `https://ai-checkout-api.onrender.com/support/` (rendered from `apps/site/src/pages.tsx`; keep the two in step). Extension version 2.1.0.

Contact: **evanliu7788@gmail.com** · Privacy policy: `https://ai-checkout-api.onrender.com/privacy/` · Issues: `https://github.com/evanxliu1/AICheckout/issues`

## Getting started

1. After installing, a setup tab opens. Under **Add a card**, type part of a card or bank name and pick each card you own, choose your default card, then **Save cards**. For some cards it also asks which bonus categories you chose or about a membership, status or account the bonus depends on ("Not sure" shows a range), and what a point is worth to you. No card number, login or passphrase is needed. You can change cards later from the AI Checkout toolbar button under **Edit cards**.
2. It then asks once whether to **Share** usage reports or **Not now**. The extension works the same either way; change your answer any time under **Settings → Usage reports**.
3. Open your cart at any U.S. online store. A badge in the bottom-right corner shows your best card and its estimated reward for the cart, or your cards ranked by rate when the amount couldn't be read with certainty. Click it for every card's estimate, the issuer's rule behind it, a payment-method choice and an optional amount field.
4. For any other purchase, open the toolbar popup, type the amount, confirm the eligibility assumption and choose **Compare my cards**. Opened on a cart, the popup reads it for you.

The catalog covers 178 U.S. personal credit cards from the ten largest issuers. Points and miles are compared in cash at a published estimate unless the issuer states a value or you set your own under **Point values** in **Edit cards**; a program with no published value shows points or miles and is listed last. The store list names more than 600 U.S. stores with their bonus category; any other store is compared as a general online store. Rewards depend on the issuer's terms and how the purchase posts; the extension cannot guarantee a category or a reward.

## Common issues

| What you see | What to do |
| --- | --- |
| No badge on a cart | The badge appears on cart and checkout pages whose address or title names the cart or checkout, once the order summary has loaded, at https stores only. Check **Settings → Cart badge** (the badge switch, and the sites you turned off), and whether you dismissed it in this tab (dismissal lasts until the tab closes). Payment pages such as PayPal never show it. If a real cart gets no badge, use **Report a problem** in the popup (reason: no badge). |
| "Pick your cards to see your best card" | No cards are saved yet. Click the badge to open setup, or dismiss it for this tab with the button beside it. |
| "Unlock to see your best card" | Passphrase protection is on and locked. Click the badge or the toolbar button and unlock. |
| The badge shows rates instead of an amount ("The cart amount was not read") | The order summary wasn't found or an amount wasn't certain (for example a credit or coupon that may or may not apply). The ranking by rate is still right for this store; type the amount in the panel to see dollar estimates. |
| "This page doesn't look like a cart or checkout page" (popup) | The popup's read runs on cart and checkout pages only. Type the amount instead. |
| "This comparison supports USD only", or no badge on a cart in another currency | AI Checkout compares U.S.-dollar purchases only. |
| "… is a payment page, not the store's" | PayPal, Shop Pay and similar checkout pages belong to the payment provider, so the store can't be told. Compare from the store's own cart page. |
| It says subtotal or estimated total | Tax and shipping aren't included yet, or the store's total is still an estimate. The estimates compare what was read; enter the final charge once you know it. |
| A range instead of one amount, or "Compare the conditions" | A condition is unknown: spend toward a cap, an activation, or how PayPal or buy-now-pay-later will post. Confirm it in **Edit cards** or the payment selector to narrow the range. |
| The store is recognised as another store, or its category looks wrong | The store list matched the site's address. Use **Report a problem** in the popup (reason: recognised as another store, or wrong card). The report carries the store's domain and the reason, nothing else. |
| "Another U.S. online store" for a store you'd expect to be named | The list doesn't name it yet. Tap **Suggest this store** in the popup or **Store not recognised? Suggest it** in the badge panel; the store's domain is sent so it can be added. |
| "Checking for updated terms…" | A new install, or terms that expired while you were away. The extension is fetching the current card terms; this takes a few seconds, longer if the service is waking up. |
| "Card terms expired" or "Card terms need attention" | Terms are valid for 30 days after they were verified and are refreshed weekly in the background. Choose **Check for updated terms** in the popup. If it still fails you're offline or the service is down; comparisons resume when a refresh succeeds. Don't change your computer's date. |
| Offline | Cart reads and comparisons work offline while the saved terms are valid; only refreshes and usage reports need a connection. |
| Saved cart changed or expired | Read again and confirm the current amount. Navigation, quantity changes and time limits invalidate a read. |
| Reported spend became unknown | Spend reported on an earlier day is no longer assumed current. Update it in **Edit cards**; the extension cannot see your transactions. |
| Inputs changed in another window | Reopen the popup to load the saved inputs before changing them again. |
| Forgot the passphrase | It cannot be recovered. Open **Delete saved data**, confirm, and set up your cards again. |
| Saved data cannot be read | Use **Delete all local data**, then pick your cards again. |

## Usage reports

Under **Settings → Usage reports** in the popup: the **Sharing usage data** toggle turns sharing on (a new random identifier is created) or off (**Stop sharing**: the identifier and anything waiting are deleted and nothing more is sent). **Delete my data** asks the service to delete every report stored under your current identifier, then stops sharing; use it before stopping sharing if you want earlier reports gone. Reports are deleted by the service within about a day after they turn 90 days old in any case. What a report contains is listed in the [privacy policy](privacy-policy.md) and the public dictionary ([`docs/telemetry/events.md`](https://github.com/evanxliu1/AICheckout/blob/main/docs/telemetry/events.md)).

## Delete your data

Expand **Delete saved data** in the popup, confirm, and choose **Delete all local data**. While you share usage reports, it first asks the service to delete the reports stored under your identifier (as **Delete my data** does) and clears this device only once that succeeded; if the service cannot be reached, nothing is cleared and you can **Try again** or **Clear this device anyway** (the reports already sent then stay until they expire after 90 days). It clears your cards, options, settings, purchase inputs, the downloaded terms and store list, the unlock key and the usage-reporting identifier and answer; card setup returns. It does not affect a store's cart or your browser history. Uninstalling the extension removes its storage from your device; a page then explains that reports already sent are deleted within about a day after 90 days and that **Delete my data** or **Delete all local data** must be used before uninstalling to delete them earlier.

## Report a problem

In the extension: open the popup on the store's page and use **Report a problem** with one of the fixed reasons (wrong amount, no badge, recognised as another store, recommended card looks wrong, something else). The report carries the store's domain, the reason and whether the badge showed an amount, plus your random identifier only if you share usage reports. There is no text field.

On GitHub: open an issue with the extension and Chrome versions, the store and page type (cart or checkout), the exact message and the steps. Use a made-up amount if it helps. Never include your passphrase, card numbers, bank credentials, full cart addresses, product lists, your home address or unredacted screenshots; issues are public.

For a security vulnerability, don't open a public issue: use GitHub private vulnerability reporting (`https://github.com/evanxliu1/AICheckout/security/advisories/new`, see `SECURITY.md`). Responses are best effort; there is no service-level promise.
