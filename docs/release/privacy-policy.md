# AI Checkout privacy policy — draft

**Not published.** This draft describes the current default extension build without a remote catalog endpoint. Resolve [the recorded privacy findings](privacy-review.md), fill the public placeholders, and remove this preparation notice only after the final implementation and policy agree.

Effective date: **[[EFFECTIVE_DATE]]**
Operator: **[[PUBLISHER_NAME]]**
Privacy and support contact: **[[SUPPORT_EMAIL]]**

## What AI Checkout does

AI Checkout compares estimated rewards on supported credit-card products that you select. It uses the purchase amount and eligibility information you confirm. The shopper extension does not require an account, connect to a bank, or process a payment.

## Information handled on your device

After you accept the setup disclosure and choose a local passphrase, the extension encrypts the following in its local Chrome profile storage:

- The card product identifiers you select and your preferred card when rewards tie.
- Optional reward-limit information you report, such as annual online-retail spend, its date/year and applicable activation status.
- Your latest saved purchase inputs: merchant, USD amount, date and eligibility selections.
- Information needed to restore or invalidate a comparison, including catalog version, revision and timestamps. Reward amounts are calculated from these inputs.
- When you read a supported cart: amount, currency, amount type (total, estimated total or subtotal), merchant/reader identifiers, capture time, a random capture identifier, tab/document identifiers and a hash of the page identity.

After you request a cart read, the extension examines bounded visible summary labels and amounts (on Amazon US, only the cart page's order-summary subtotal label and amount). It accesses the current tab URL in memory to check the merchant and whether the page changed. It does not save that raw URL, query string or page HTML. The stored hash is a freshness identifier; it is not a promise of anonymization. A captured cart may be rechecked when you compare or reopen a saved comparison while temporary page access remains available.

The extension does not read card numbers, security codes, bank credentials, addresses, payment-field values or product names for this flow. It does not request your browsing-history list. It saves the current working purchase, not a transaction-history log.

## Purpose and sharing

These inputs are used to calculate and explain estimates, retain your chosen cards and detect stale comparisons. They are not sold, used for advertising, used to determine creditworthiness, or sent to the publisher or an AI provider by this default extension build.

The comparison flow makes no network request. Opening a card-source link takes you to the issuer's website, which operates under its own privacy policy. Your browser and the Chrome Web Store may handle installation/update information under their own terms. Ordinary merchant browsing is also separate from the extension.

AI-assisted catalog maintenance is a separate administrator tool. This extension does not send your wallet or purchase inputs to that tool or to a model. Its calculations use the rules packaged with the extension.

## Retention, changes and deletion

Your working inputs remain in this Chrome profile until replaced, deleted with **Delete all local data**, or removed when the extension is uninstalled. The extension does not use Chrome Sync to synchronize them across devices.

A cart capture becomes unusable after five minutes; manual comparisons become unusable after at most fifteen minutes, and other input/date/catalog changes may invalidate them sooner. These limits are freshness checks, not scheduled deletion of every stored input. Inactive extension storage can remain on disk; your last entered purchase and reported spend may remain after their estimates become stale.

Use **Edit cards** to change selected products and reported limits. Enter a new purchase to replace the working purchase. Expanding **Delete saved data**, confirming permanent deletion, and choosing **Delete all local data** clears extension-managed local state and the unlock key, including obsolete prototype keys/logs if present. Setup returns so that a new passphrase and acceptance are required before saving new inputs. It does not clear a merchant's cart, Chrome history, issuer records, backups made outside the extension, or messages you sent to support.

## Storage protection

Saved inputs are encrypted with a key derived from your local passphrase. The passphrase is not saved by the extension. The usable unlock key is kept in Chrome’s session memory, separately from the persistent encrypted record, until you choose **Lock saved inputs**, restart Chrome, or reload/update the extension. Closing the popup or normal background-worker shutdown does not lock the session. Both storage areas are restricted to trusted extension contexts. Format metadata, including a random identity, salt, revision and encrypted-record length, remains unencrypted.

While unlocked, someone using your Chrome profile can view these inputs. Protection depends on a strong passphrase and does not protect an already compromised device, earlier unencrypted copies, external backups, or an older valid encrypted record restored by someone with profile access. The extension does not promise forensic erasure or protection from operating-system memory capture. Do not enter payment credentials.

If earlier unencrypted inputs exist, setup asks you to protect or delete them before returning to comparisons. Protecting replaces the active saved record with encrypted data; it cannot erase old disk or backup copies. A forgotten passphrase cannot be recovered: use **Delete saved data** and confirm deletion to start again. This removes the saved inputs and session key without needing the passphrase.

## Contact and policy changes

For privacy questions, contact **[[SUPPORT_EMAIL]]**. Do not send card numbers, payment credentials, complete cart pages or unredacted shopping screenshots. Any information you choose to send through a support channel is handled separately from local extension storage; the final support channel's provider, retention and deletion practices must be disclosed before this policy is published.

Changes to data handling will be reflected in this policy and the extension's relevant disclosures. A future release that contacts a catalog service requires an updated policy describing that service and its request metadata before distribution.
