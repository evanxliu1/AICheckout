# AI Checkout help

<!-- Source text for https://ai-checkout-api.onrender.com/support/, which apps/site/src/pages.tsx renders; keep the two the same in substance. Describes extension version 2.1.0. -->

Set up the extension, fix common issues and report a problem. For anything else, email evanliu7788@gmail.com.

Privacy policy: <https://ai-checkout-api.onrender.com/privacy/> · Issues: <https://github.com/evanxliu1/AICheckout/issues>

## Get started

1. After you install the extension, a setup tab opens. Under **Add a card**, type part of a card or bank name and pick each card you own. Choose your default card, and then choose **Save cards**. For some cards, setup also asks which bonus categories you chose, about a membership, status or account that a bonus depends on ("Not sure" shows a range), and what a point is worth to you. You don't need a card number, a login or a passphrase.
2. Setup then asks once whether to **Share** usage reports or choose **Not now**. The extension works the same either way. To change your answer later, go to **Settings → Usage reports** in the toolbar popup.
3. Open your cart at any U.S. online store. A badge in the bottom-right corner shows your best card and its estimated reward, or your cards ranked by rate when the amount can't be read with certainty. Click the badge to see every card's estimate, the issuer's rule, a payment-method choice and an optional amount field.
4. To compare any other purchase, open the toolbar popup, type the amount, confirm the eligibility assumption and choose **Compare my cards**. If you open the popup on a cart, it reads the amount for you.

To change your cards later, open the toolbar popup and choose **Edit cards**. Points and miles are compared in cash at a published estimate unless the issuer states a value or you set your own under **Point values**.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| No badge on a cart | The badge appears at https stores, on cart and checkout pages whose address or title names the cart or checkout, after the order summary loads. In the popup, check **Settings → Cart badge** (the badge switch and the sites you turned off), and check whether you dismissed the badge in this tab (dismissal lasts until the tab closes). Payment pages such as PayPal never show it. If a real cart gets no badge, use **Report a problem** in the popup. |
| "Pick your cards to see your best card" | No cards are saved yet. Click the badge to open setup, or use the button beside it to dismiss it for this tab. |
| "Unlock to see your best card" | Passphrase protection is on and your data is locked. Click the badge or the toolbar button, and then unlock. |
| Rates instead of an amount ("The cart amount was not read") | The order summary wasn't found or the amount wasn't certain, for example because of a credit that may or may not apply. The ranking by rate is still correct for this store. To see dollar estimates, type the amount in the panel. |
| "This page doesn't look like a cart or checkout page" | The popup reads cart and checkout pages only. Type the amount instead. |
| "This comparison supports USD only", or no badge on a cart in another currency | AI Checkout compares U.S.-dollar purchases only. |
| "… is a payment page, not the store's" | PayPal, Shop Pay and similar checkout pages belong to the payment provider, so the store can't be identified. Compare from the store's own cart page. |
| The amount is labeled subtotal or estimated total | Tax and shipping aren't included yet, or the store's total is still an estimate. When you know the final charge, enter it. |
| A range instead of one amount, or "Compare the conditions" | A condition is unknown: your spend toward a cap, an activation, or how PayPal or buy-now-pay-later will post. To narrow the range, confirm the condition in **Edit cards** or the payment selector. |
| The wrong store is matched, or its category looks wrong | The store list matched the site's address. In the popup, use **Report a problem** and choose "The store was recognized as another store" or "The recommended card looks wrong". The report carries the store's domain, the reason and what the badge showed. |
| "Another U.S. online store" for a store you expected to be named | The store list doesn't name it yet. Choose **Suggest this store** in the popup, or **Store not recognized? Suggest it** in the badge panel. The store's domain is sent so the store can be added. |
| "Checking for updated terms…" | The extension is downloading the current card terms, after a new install or because the saved terms expired. This takes a few seconds, or longer if the service is starting up. |
| "These card terms have expired" or "Card terms need attention" | Card terms are valid for 30 days after they were verified and are refreshed weekly in the background. In the popup, choose **Check for updated terms**. If that fails, you're offline or the service is unavailable; comparisons resume after a refresh succeeds. Don't change your computer's date. |
| Offline | Cart reads and comparisons work offline while the saved terms are valid. Only refreshes and usage reports need a connection. |
| A saved cart amount changed or expired | Read the cart again and confirm the current amount. Navigating, changing quantities and time limits invalidate a read. |
| Reported spend became unknown | Spend you reported on an earlier day is no longer assumed current. Update it in **Edit cards**; the extension can't see your transactions. |
| "Your saved inputs changed in another window" | Reopen the popup to load the saved inputs before you change them again. |
| Forgot the passphrase | It can't be recovered. Open **Delete saved data**, confirm, and set up your cards again. |
| "Saved data could not be read" | Use **Delete all local data**, and then pick your cards again. |

## Manage usage reports

In the popup, go to **Settings → Usage reports**. The **Sharing usage data** toggle turns sharing on, which creates a new random identifier, or off. Turning it off (**Stop sharing**) deletes the identifier and any waiting reports and sends nothing more. **Delete my data** asks the service to delete every report stored under your current identifier, and then stops sharing. To delete earlier reports, use it before you stop sharing. In any case, the service deletes each report within about a day after it turns 90 days old. For what a report contains, see the [privacy policy](privacy-policy.md) and the public event dictionary ([`docs/telemetry/events.md`](https://github.com/evanxliu1/AICheckout/blob/main/docs/telemetry/events.md)).

## Delete your data

In the popup, expand **Delete saved data**, confirm, and choose **Delete all local data**. If you share usage reports, the extension first asks the service to delete the reports stored under your identifier (as **Delete my data** does) and clears this device only after that succeeds. If the service can't be reached, nothing is cleared, and you can choose **Try again** or **Clear this device anyway**. With Clear this device anyway, reports already sent stay on the service until they expire after 90 days.

Deleting clears your cards, options, settings, purchase inputs, the downloaded terms and store list, the unlock key, and the usage-reporting identifier and answer. Card setup then starts again. It doesn't affect a store's cart or your browser history. Uninstalling the extension also removes its storage from your device, but reports already sent stay until they expire, so use **Delete my data** or **Delete all local data** first if you want them deleted sooner.

## Known limitations

- 178 cards from ten U.S. issuers, and U.S. stores and U.S. dollars only. Other cards, benefits and countries aren't covered.
- Estimates follow the issuers' terms. How a purchase actually posts (its merchant category, or payment through PayPal or buy-now-pay-later) can change the reward, so the extension can't guarantee one.
- The cart reader shows an amount only when it's certain of it. On some carts, that means you see the rates view and type the amount.
- The Chrome Web Store listing isn't published yet.

## Report a problem

In the extension, open the popup on the store's page, choose **Report a problem** and pick one of the fixed reasons ("The amount shown is wrong", "No badge appeared on a cart or checkout page", "The store was recognized as another store", "The recommended card looks wrong" or "Something else"). The report carries the store's domain, the reason and whether the badge showed an amount. It includes your random identifier only if you share usage reports. There's no text field.

On GitHub, open an issue with the extension and Chrome versions, the store and page type (cart or checkout), the exact message and the steps to reproduce it. Use a made-up amount if that helps. GitHub issues are public: never include your passphrase, card numbers, bank credentials, full cart addresses, product lists, your home address or unredacted screenshots.

To report a security vulnerability, don't open a public issue. Report it privately through GitHub private vulnerability reporting (<https://github.com/evanxliu1/AICheckout/security/advisories/new>); see the [security policy](../../SECURITY.md).

Support is provided on a best-effort basis, with no guaranteed response time.
