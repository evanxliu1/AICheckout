# AI Checkout support — draft

Public contact: **[[SUPPORT_EMAIL]]**
Privacy policy: **[[PRIVACY_URL]]**

Preparation status: the contact and policy URL must be filled and the final release verified before publishing this page.

## Getting started

1. After installing, a setup tab opens: choose the supported cards you already own and your default card, then **Save cards**. No card number, account or passphrase is needed. (You can change cards later from the AI Checkout toolbar button.)
2. Open your cart on Amazon US, Best Buy US or Newegg US. A badge in the bottom-right corner shows your best card and its estimated cash back. Click it for every card's estimate, the rules behind it, a payment-method choice and an editable amount.
3. After you order, the badge may ask once whether you paid with the recommended card. Your answer adds an estimate to **All-time** extra cash back in the toolbar popup.
4. For any other purchase, open the toolbar popup, choose the merchant, enter the amount, confirm the listed exclusions and choose **Compare my cards**.

The supported card products are Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver, Capital One Savor, Chase Freedom Unlimited, and American Express Blue Cash Everyday and Blue Cash Preferred. Other benefits and card products are outside the current scope. Rewards depend on issuer terms and how the transaction posts; the extension cannot guarantee a category or reward.

## Common issues

| What you see | What to do |
| --- | --- |
| No badge on a cart | The badge appears only on the Amazon US cart, Best Buy US cart/checkout and Newegg US cart, once the order summary has loaded. Check that the site is on under **Settings → Show the cart badge on**, and that you did not dismiss it in this tab (dismissal lasts until the tab closes). |
| “Pick your cards to see your best card” | No cards are saved yet. Click the badge to open setup. |
| “Unlock to see your best card” | Passphrase protection is on and locked. Click the badge or the toolbar button and unlock. |
| “Can’t read this cart” | The order summary is loading or ambiguous. Wait, or type the amount in the badge. |
| The order question did not appear | Order pages are recognized by their address only, within three hours of a recommendation in the same tab; these addresses are not yet verified for every retailer. Nothing is lost; the savings total simply does not include that order. |
| Cart cannot be read | Open the toolbar on the supported cart, wait for its summary, and retry. Unsupported or changed page structures require manual entry. The extension does not reload the merchant page. |
| Unsupported page | Use the Best Buy US cart, `https://secure.newegg.com/shop/cart`, or `https://www.amazon.com/cart`; product listings, other countries, Amazon checkout pages and other Newegg checkout routes are outside the reader scope. |
| Subtotal / total TBD | This is not the final charge. Enter the charge once known, or use the explicitly labeled subtotal estimate. |
| “Compare the conditions” or a range | Eligibility or reward-cap usage is unknown. Review the displayed assumptions and issuer sources. Do not enter zero spend unless it is accurate. |
| Saved cart changed or expired | Read again and confirm the current amount. Navigation, quantity changes and time limits can invalidate a capture. |
| Reported spend became unknown | Spend reported on an earlier date/year is no longer assumed current. Update it in **Edit cards**. The extension cannot see intervening transactions. |
| Terms expired | Choose **Check for updated terms** in the popup (hosted builds), or install a release with reverified terms. Do not alter your computer's date to bypass expiry. |
| Inputs changed in another window | Reopen the popup to load authoritative saved inputs before making another change. |
| Unlock your saved inputs | Only when you turned on passphrase protection: enter your local passphrase after restarting Chrome or reloading/updating the extension. **Lock saved inputs** locks all open extension views. You can turn protection off in **Settings**. |
| Forgot the passphrase | It cannot be recovered. Open **Delete saved data**, confirm deletion, and start again. Existing saved inputs will be lost. |
| Saved data cannot be read | Use **Delete all local data**, then select your card products again. This deletes your extension inputs. |

The extension works offline while the packaged terms remain valid. An unavailable model service cannot affect shopper calculations because this extension flow does not call a model.

## Delete data

Expand **Delete saved data**, confirm that the inputs will be permanently removed, and choose **Delete all local data**. The same confirmation is required whether locked or unlocked. Card setup returns. This clears this extension's local inputs, settings, savings history and session key; to delete only the savings history, use **Delete savings history** in the popup. it does not remove a retailer's cart or Chrome's browser history. Uninstalling the extension also removes its local storage. See the privacy policy for retention details.

## Report a problem

Send the extension version, Chrome version/OS, merchant name and page type, the exact error text, and a short sequence of steps. Use a made-up amount if the amount helps explain the problem. Include whether the issue also occurs with manual entry.

Do not send your local passphrase, card numbers, bank credentials, tokens, your full cart URL/query, product lists, addresses, or complete page HTML. Crop and redact screenshots before sending them. For a security vulnerability, use GitHub private vulnerability reporting (see `SECURITY.md`) rather than posting details publicly. Response times are not guaranteed; no service-level promise is currently made.
