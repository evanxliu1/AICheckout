# Reviewer and tester instructions

Draft for the final release. Shopper features need no login, payment, bank connection, API key or administrator access. Never provide production administrator credentials to review the shopper extension. Chrome's optional [test-instructions field](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions) can hold the applicable steps; this full document is also a manual tester script.

## Preconditions

- Record extension version, ZIP SHA-256, catalog version/expiry, Chrome version, OS and test date. Use the exact intended artifact in normal Chrome for release evidence.
- The bundled catalog `2026-10-02.expansion.1` (178 cards) expires November 1, 2026 at 00:00 UTC (the UI shows local time). After expiry, obtain genuinely reverified terms before testing successful comparisons. Do not edit dates or bypass expiry.
- Use a fresh disposable Chrome profile or deliberately clear extension data first. Avoid real card/account details and redact any evidence.
- The figures below are demonstration arithmetic under the current catalog rules, not a promise about a purchase or a future catalog.

## Manual two-card demonstration

1. Open the extension. Under **Add a card**, type part of the name and pick **Capital One Quicksilver**, then **American Express Blue Cash Everyday**, from the list (the catalog has 178 cards). For this synthetic demonstration only, enter `0` in the Blue Cash Everyday online retail spend field and save. For the lock and restart checks below, open **Settings** and choose **Protect with a passphrase** with a disposable test passphrase of at least 15 characters; keep it, and do not send it to the publisher.
2. Choose **Best Buy US** as Merchant. Enter `100` as the USD purchase amount.
3. Choose **Eligible goods, paid directly online**, confirm the exclusion checkbox, and compare.
4. Expect **Use Blue Cash Everyday**, with **$3.00** for Blue Cash Everyday and **$1.50** for Quicksilver. Confirm the saved-estimate sentence names the merchant and amount. Open **Card terms and sources**.
5. Close and reopen promptly. The valid saved result should return, with fresh confirmation required for another comparison. Disconnect network access and repeat the manual comparison while the catalog remains valid.
6. In **Edit cards**, clear the reported annual spend and save. Confirm and compare again. Expect a **$1.00–$3.00** Blue Cash Everyday range and **Compare the conditions**. Unknown usage must not be treated as zero.
7. Change Merchant to **Newegg US**. The amount and confirmation should clear and the old estimate disappear. Enter a new amount and reconfirm before comparing.

## Supported-page reading

Use a temporary anonymous cart; do not submit an order, enter payment details, or sign in just to run this test.

1. Add one ordinary physical item through the retailer's public interface and wait for its cart to finish updating. The recorded historical products/prices are not required and may change.
2. On Best Buy's US cart, `https://secure.newegg.com/shop/cart`, or `https://www.amazon.com/cart`, open the actual toolbar popup and choose **Read cart amount**. Confirm the amount against the visible summary and confirm automatic merchant selection.
3. For Newegg with **Est. Total: TBD**, and always for Amazon (whose cart shows a subtotal only), expect a **subtotal before tax and shipping** message. The result must also say **Newegg US subtotal** (or **Amazon US subtotal**) and exclude tax/shipping. No numeric final-total live claim follows from this test.
4. Only if the item/channel assumptions fit the stated conditions, confirm them and compare. Otherwise leave eligibility unknown and check the uncertainty instead. Historical $249.99/$499.98 subtotals are examples, not fixed expected live prices.
5. Change quantity on the merchant page. The former capture must not produce an unchanged trusted estimate. Read again, verify the new amount, and reconfirm.
6. Remove all temporary items and wait for the empty-cart state. Record cleanup. A click on Remove alone is not evidence of cleanup.

For Best Buy, the live reader and native fixture observations already exist, but their combined populated-live-toolbar check is still outstanding. For Newegg, the combined check passed on September 26; final normal-Chrome verification is still needed. [Recorded scope](../verification/merchants.md).

## Recovery, access and deletion

- Open on an unsupported page: reading should fail with usable manual entry.
- Read an empty supported cart: no positive purchase amount should be invented.
- Close the popup during a read, then reopen: a finished capture may be restored, but consent must not be invented. Use the controlled packaged lifecycle test to exercise the exact timing reproducibly.
- Navigate away from a captured cart: the capture/result must not remain valid for the new page. Reopen from the supported page's toolbar to restore temporary access.
- Wait beyond five minutes for a captured comparison or fifteen minutes for a manual one: the estimate must need reconfirmation. This checks freshness, not physical deletion of all stored inputs.
- Use Tab/Shift+Tab and native select/checkbox keys through wallet, purchase, result sources and deletion. Check visible focus, readable errors and scrolling in the native 360px popup.
- Choose **Lock saved inputs**. All open extension views should hide private inputs. A wrong phrase must fail; the correct phrase restores them. Restart Chrome and confirm that unlocking is required again. Closing only the popup should keep the session unlocked.
- Expand **Data and protection details** during setup, unlock and normal use. Check that retention, memory-key lifetime and deletion limits are readable.
- Expand **Delete saved data**, confirm permanent deletion, choose **Delete all local data**, and reopen. Card setup should return with no saved cards. Both locked and unlocked deletion require the explicit reset checkbox; neither requires the passphrase. Remove the extension when testing ends.

## Test record

Record pass/fail per step, exact errors, cropped screenshots, expected/actual amounts and cleanup. Name the environment: normal Chrome, packaged Chromium fixture or live merchant. Record failures even if a retry passes. A small tester pass has not yet been performed; these instructions are not evidence that it has.
