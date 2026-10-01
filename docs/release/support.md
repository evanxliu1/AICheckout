# AI Checkout support — draft

Public contact: **[[SUPPORT_EMAIL]]**
Privacy policy: **[[PRIVACY_URL]]**

Preparation status: the contact and policy URL must be filled and the final release verified before publishing this page.

## Getting started

1. Open AI Checkout from Chrome's toolbar. Read the setup disclosure, choose and confirm a local passphrase of at least 15 characters, accept the disclosure, and choose **Protect saved inputs**. Then choose the supported card products you already own and save them. No card number or account login is needed.
2. Open a supported Best Buy US cart or the Newegg US secure cart and choose **Read cart amount**. For manual entry, choose **Merchant** and enter a USD amount.
3. Confirm or correct the amount. If it is a subtotal, tax and shipping are excluded; enter the final charge when available or knowingly compare the subtotal only.
4. Choose the online-retail eligibility assumption, confirm the listed exclusions, and choose **Compare my cards**.

The supported card products are Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver, Capital One Savor, Chase Freedom Unlimited, and American Express Blue Cash Everyday and Blue Cash Preferred. Other benefits and card products are outside the current scope. Rewards depend on issuer terms and how the transaction posts; the extension cannot guarantee a category or reward.

## Common issues

| What you see | What to do |
| --- | --- |
| Cart cannot be read | Open the toolbar on the supported cart, wait for its summary, and retry. Unsupported or changed page structures require manual entry. The extension does not reload the merchant page. |
| Unsupported page | Use the Best Buy US cart or `https://secure.newegg.com/shop/cart`; product listings, other countries and other Newegg checkout routes are outside the reader scope. |
| Subtotal / total TBD | This is not the final charge. Enter the charge once known, or use the explicitly labeled subtotal estimate. |
| “Compare the conditions” or a range | Eligibility or reward-cap usage is unknown. Review the displayed assumptions and issuer sources. Do not enter zero spend unless it is accurate. |
| Saved cart changed or expired | Read again and confirm the current amount. Navigation, quantity changes and time limits can invalidate a capture. |
| Reported spend became unknown | Spend reported on an earlier date/year is no longer assumed current. Update it in **Edit cards**. The extension cannot see intervening transactions. |
| Terms expired | Install an extension release containing reverified terms. The current default build has no online terms-update button. Do not alter your computer's date to bypass expiry. |
| Inputs changed in another window | Reopen the popup to load authoritative saved inputs before making another change. |
| Unlock your saved inputs | Enter your local passphrase after restarting Chrome or reloading/updating the extension. Closing the popup does not lock it. **Lock saved inputs** locks all open extension views. |
| Forgot the passphrase | It cannot be recovered. Open **Delete saved data**, confirm deletion, and start again. Existing saved inputs will be lost. |
| Earlier inputs are not encrypted | Choose a passphrase and accept setup to protect the active saved record, or explicitly delete it. This cannot erase historical disk/backup copies. |
| Saved data cannot be read | Use **Delete all local data**, then select your card products again. This deletes your extension inputs. |

The extension works offline while the packaged terms remain valid. An unavailable model service cannot affect shopper calculations because this extension flow does not call a model.

## Delete data

Expand **Delete saved data**, confirm that the inputs will be permanently removed, and choose **Delete all local data**. The same confirmation is required whether locked or unlocked. The protection setup screen returns. This clears this extension's local inputs and session key; it does not remove a retailer's cart or Chrome's browser history. Uninstalling the extension also removes its local storage. See the privacy policy for retention details.

## Report a problem

Send the extension version, Chrome version/OS, merchant name and page type, the exact error text, and a short sequence of steps. Use a made-up amount if the amount helps explain the problem. Include whether the issue also occurs with manual entry.

Do not send your local passphrase, card numbers, bank credentials, tokens, your full cart URL/query, product lists, addresses, or complete page HTML. Crop and redact screenshots before sending them. For a security concern, use the private support contact rather than posting sensitive details publicly. Response times are not guaranteed; no service-level promise is currently made.
