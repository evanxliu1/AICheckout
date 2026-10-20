# Reviewer and tester instructions

For Chrome Web Store reviewers and for the pre-submission tester pass of AI Checkout **2.1.0** (the hosted build). Shopper features need no login, payment, bank connection, API key or administrator access; never give anyone production reviewer credentials to review the shopper extension. The short version goes into the dashboard's test-instructions field; the rest is the manual script.

## Short version (for the dashboard)

No account or login is needed. 1) Install; a setup tab opens. Under "Add a card", type "Quicksilver" and pick Capital One Quicksilver, then "Blue Cash Everyday" and pick American Express Blue Cash Everyday; enter 0 in Blue Cash Everyday's online retail spend field; Save cards. 2) The next screen asks whether to share usage reports: choose Share or Not now (both work; nothing is sent before Share). 3) Open the cart page of any U.S. online store (add one item without buying) or any https page whose address contains "cart" and shows an order summary. A badge appears bottom-right: "Use Blue Cash Everyday · $X back" when the total was read, or the cards ranked by rate when it wasn't. Click it for every card's estimate, the issuer rule and conditions, "Dismiss for this tab" and "Not on this site". 4) Click the toolbar icon on that page: the popup shows the same comparison; "Report a problem" and "Suggest this store" send only the store's domain and a fixed reason, on your tap. 5) Settings in the popup: "Sharing usage data" toggle and "Delete my data"; "Delete saved data → Delete all local data" clears everything. The extension makes requests only to https://ai-checkout-api.onrender.com (card terms, store list, and usage reports after Share). Privacy policy: https://ai-checkout-api.onrender.com/privacy/

## Preconditions

- Record the extension version, the ZIP's SHA-256 (from `docs/verification/release-package.md`), the catalog and store-list versions, Chrome version, OS and date. Use the exact upload artifact in normal Chrome for release evidence; a fresh profile, or **Delete all local data** first.
- The ZIP bundles a catalog that expires 30 days after its verification date. On first run the extension fetches the current terms at once; expect "Checking for updated terms…" for a few seconds (longer if the service is cold), then a result. A failed first fetch shows the expired copy with **Check for updated terms**. Do not change the computer's date.
- Use a real store's cart only without signing in, paying or placing an order; remove the temporary item afterwards. Any https page whose address or title names the cart and shows an order summary (Subtotal, Shipping, Tax, Total rows) works as a synthetic cart.
- The dollar figures below hold under the catalog in effect when this was written (`2026-10-05.renewal.1`); the popup shows each card's rule in the issuer's words, which is the figure to check against.

## 1. Setup and consent

1. Install. A setup tab opens with **Add a card**. Pick **Capital One Quicksilver** and **American Express Blue Cash Everyday**, enter `0` in Blue Cash Everyday's online retail spend field, keep Quicksilver as the default, **Save cards**.
2. The consent screen "Help improve AI Checkout" lists what a report contains ("a random identifier, so repeated reports can be told apart: no name, email or browsing history"), that no store name or address is sent with reports, and the 90-day retention, with a link to the privacy policy. **Share** and **Not now** are equal buttons.
3. Run the rest once with **Not now** and once with **Share** (a second profile, or **Delete all local data** then Settings). With Not now, no request to `/v1/events` is ever made (check the service worker's network panel); with Share, batches go to `POST https://ai-checkout-api.onrender.com/v1/events` with `Origin: chrome-extension://<id>` and no cookies.
4. The done screen says to open a cart at any U.S. online store.

## 2. The badge at a cart

1. Open a cart page with one item. A badge appears bottom-right: **Use Blue Cash Everyday · $X back** (3% of the amount, when the store counts as online retail and the amount was read), or **Use Blue Cash Everyday · 3% back** (the rates view) when the amount was not read. Click it: the panel lists both cards with the rule in the issuer's words and conditions, a payment-method selector, an amount field, **Dismiss for this tab** and **Not on this site**. At a store the list does not name, the panel also offers **Store not recognised? Suggest it**; the header says "at Another U.S. online store" or the matched store's name.
2. Change the quantity. The amount updates without a reload.
3. In the rates view, type an amount in the panel; dollar estimates appear. Nothing asks for an amount.
4. **Dismiss for this tab**: the badge hides until the tab closes (reload: still hidden). **Not on this site**: the host appears under Settings → Cart badge in the popup, where it can be switched back on; the badge switch turns it off everywhere.
5. Open a product page, an empty cart and a non-https page: no badge. On a PayPal or Shop Pay checkout page: no badge.
6. With no cards saved (a fresh profile, skip setup), a cart shows **Pick your cards to see your best card** with a dismiss button beside it; clicking the pill opens setup.

## 3. The popup

1. On the cart tab, click the toolbar icon. The popup reads the tab: the amount is filled and the store named (or "Another U.S. online store"), or the rates view is shown. Confirm eligibility and **Compare my cards**: Blue Cash Everyday first with its rule and conditions, Quicksilver second with "$X less".
2. On any other page, type `100` with "Another U.S. online store", confirm, compare. Expect **Use Blue Cash Everyday**, **$3.00** against **$1.50**. Open **Card terms and sources**.
3. **Edit cards**: clear Blue Cash Everyday's reported spend and save; compare again. Expect a **$1.00–$3.00** range and "Compare the conditions". Unknown spend is not treated as zero.
4. Close and reopen the popup: the saved result returns; a new comparison needs a fresh confirmation. Disconnect the network and compare again: it works while the saved terms are valid.
5. At a store the list does not name, **Suggest this store** appears under the Merchant select: tap it and expect "Thanks. This store's domain was sent". **Report a problem** in the footer offers five fixed reasons and no text field; **Send report** reports the domain, the reason and what the badge showed.
6. On a payment provider's page the popup says it is a payment page and reads nothing.

## 4. Settings, data and deletion

- **Settings → Usage reports**: the toggle reflects the consent answer. Off (Stop sharing) says nothing more will be sent. **Delete my data** with sharing on: "Your reports were deleted and sharing stopped" (a `POST /v1/events/delete`); with sharing off it says there is no identifier to delete. On again: a new identifier and a new `consent_granted`.
- **Settings → Protect with a passphrase**: a disposable passphrase of at least 15 characters. **Lock saved inputs** hides inputs in every open view; the badge says **Unlock to see your best card**; a wrong passphrase fails; restart Chrome and unlocking is required again. Protection can be turned off with the passphrase.
- **Data and protection details** (popup footer) is readable during setup, locked and unlocked.
- **Delete saved data → Delete all local data**: with sharing on, a request to `/v1/events/delete` with the identifier goes first and the device is cleared only after a 2xx (offline, the popup says the reports could not be deleted and offers **Try again** and **Clear this device anyway**); then setup returns with no cards and Settings → Usage reports shows sharing off (the identifier and answer are cleared with everything else); the badge shows the no-cards pill again. Both locked and unlocked deletion require the confirmation checkbox, neither the passphrase. Remove the extension when testing ends; Chrome opens `https://ai-checkout-api.onrender.com/uninstalled/`.

## 5. Accessibility and recovery

- Tab and Shift+Tab through setup, the popup (wallet, purchase, result, settings, deletion) and the badge panel; visible focus, readable errors, no overflow in the 360 px popup.
- Close the popup during a read, then reopen: a finished read may be restored; eligibility confirmation is never invented.
- Navigate away from a read cart: the result is not shown as current for the new page.
- Wait fifteen minutes on a saved comparison: it needs reconfirmation.

## Test record

Record pass or fail per step, exact messages, cropped screenshots, expected and actual amounts, and cleanup of any temporary cart item. Name the environment (normal Chrome, the Playwright fixture or a live store). Record failures even if a retry passes. The release record in [README.md](README.md) links the tester pass; until one is recorded, these instructions are not evidence that it happened.
