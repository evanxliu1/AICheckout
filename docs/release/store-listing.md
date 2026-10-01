# Store listing draft

Internal preparation only. Copy the public description after the gates in [release preparation](README.md) pass. Match the final ZIP; the text below assumes the default offline build, two current card products, and the two declared US merchant readers.

## Basic fields

| Field | Draft |
| --- | --- |
| Name | AI Checkout |
| Short description | Compare estimated rewards on cards you own, with clear rates and conditions. |
| Language | English |
| Intended audience/region | US shoppers; USD only |
| Publisher | `[[PUBLISHER_NAME]]` |
| Privacy policy | `[[PRIVACY_URL]]` |
| Support | `[[SUPPORT_URL]]` |

The short description matches the current manifest. Choose the current dashboard's appropriate shopping category and US distribution setting; do not claim other locales or verified-publisher status before they are configured. The name does not mean a live LLM chooses the shopper's card.

## Detailed description — public copy

Compare estimated rewards on the cards you already own before paying for an eligible purchase.

AI Checkout currently models seven cash-back cards (Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver and Savor, Chase Freedom Unlimited, and American Express Blue Cash Everyday and Blue Cash Preferred) for Best Buy, Newegg and Amazon US purchases. Choose your cards, confirm the purchase amount and eligibility, and see each card's estimated reward with the rates, conditions and sources behind it.

Features:

- Read the visible cart summary on Best Buy US or the Newegg US secure cart after opening the extension from Chrome's toolbar.
- Choose the merchant and enter or correct a USD amount manually.
- See when a captured amount is only a subtotal. Tax and shipping are excluded from subtotal comparisons until you enter the final charge.
- Report annual online-retail spending for Blue Cash Everyday, or leave it unknown and see the resulting uncertainty.
- Compare locally without an account or an AI API key. Valid bundled terms work offline.
- Protect saved inputs with a local passphrase, unlock once per browser session, and lock them when needed. A forgotten passphrase cannot be recovered.
- Delete saved cards and purchase inputs using **Delete all local data**.

Your selected card products, optional reported spend, purchase inputs and comparison metadata stay in this Chrome profile. Cart reading uses temporary access to the page you choose and reads bounded summary amounts. The extension does not collect card numbers, security codes, bank logins or transaction history, and does not send shopping data to an LLM. See the privacy policy for the complete data-handling details.

Scope and limitations:

This is a small rewards comparison tool, not a full card-benefits catalog or payment service. It does not apply for cards, link a bank, process a payment, or place an order. Issuer eligibility and merchant coding affect actual rewards. Unknown eligibility or annual-cap usage may change which card is best. Offers, fees, financing, rewards-covered amounts and unsupported categories are excluded. Card terms expire under a maintenance policy; expired terms block comparisons until an updated extension is available. Dollar amounts are estimates and may differ from statement rewards.

Supported reading is limited to Best Buy's observed US cart-summary structure and `secure.newegg.com/shop/cart`. Other pages may require manual entry. Authenticated checkout, international sites and mobile layouts are not verified. AI Checkout is an independent project and is not affiliated with the named issuers or retailers.

## Single purpose — dashboard copy

Help a shopper compare estimated rewards on the supported cards they already own for a confirmed eligible US retail purchase, using a visible cart amount or manual input and packaged reward rules.

## Permission justifications — dashboard copy

| Permission | Reason |
| --- | --- |
| `storage` | Save the user's selected card products, optional reward-limit inputs, confirmed purchase and comparison metadata locally so the popup and service worker can recover state. The user can delete this data from the popup. |
| `activeTab` | Obtain temporary access to the current tab after the user opens the extension, so an explicitly requested read can identify a supported merchant and its displayed summary amount. The full URL is used in memory for freshness checks, not retained as a browsing log. |
| `scripting` | Run the packaged, bounded summary reader in the supported tab after the user requests it, and recheck the same captured document before using its amount. No automatically installed shopping-page scripts or remote executable code are used. |
| Host permissions | None in the current default ZIP. A future configured catalog build needs a justification naming its one exact HTTPS origin and an updated privacy policy. |

Remote code declaration for the inspected build: **No**. Reward calculations, extraction and UI code are packaged in the extension. A configured catalog supplies schema-validated values, not executable scripts. Reinspect the actual upload artifact before certifying this.

## Data-use declarations — maintainer worksheet

Do not select “no user data” simply because processing is local. The following is a conservative mapping to check against the dashboard's current definitions, not a claim that a dashboard was submitted:

| Data category | Current behavior to disclose |
| --- | --- |
| Financial/payment information | Selected card products, optional reported annual spend, purchase amount and reward estimates/conditions; no card numbers, bank accounts or payment credentials. |
| Website content | User-requested reading of visible summary labels and amounts on the supported page. |
| Web history/browsing activity | Current tab URL is accessed in memory to identify and revalidate the chosen cart; a page-identity hash and tab/document identifiers are saved. No browsing history list is requested or built. |
| Personally identifying/authentication data | No shopper sign-in, email, name, address or token is requested by this extension build. Contact sent separately to support and administrator login are distinct services. |
| Health, communications, location, activity tracking | No corresponding feature or collection in the inspected extension. Browser/hosting metadata must be reevaluated if remote services are enabled. |

Certify restricted data use only after the final artifact and service practices match: no sale, no unrelated use/transfer and no creditworthiness/lending use. The extension has no ads, analytics events, tracking pixels or affiliate-link feature. Do not generalize that fact into a promise about an unconfigured website or hosting provider.

Chrome requires a narrow purpose, permission explanations and consistent privacy declarations. [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy). Local handling still requires disclosure. [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

## Prepared assets

The [local gallery](assets/index.html) and [asset record](assets/README.md) contain five 640×400 screenshots covering wallet selection, a confirmed comparison, unknown cap usage, a controlled Newegg subtotal and locked inputs. Each pairs explanatory copy with an actual native-popup detail at its original scale. Sample inputs and the crop are labeled; these are not earned rewards or live-retailer evidence.

The 440×280 promotional PNG and shared cart icon are also prepared. The 128×128 icon contains 96×96 artwork with 16px transparent padding; the 16px, 48px and 128px exports were inspected on light and dark backgrounds. Image formats, dimensions, source hashes and the current ZIP association pass local checks. The media visual review returned **ship**, with no material fixes.

Dimensions and required assets were checked against [Chrome's image guidance](https://developer.chrome.com/docs/webstore/images). These assets have not been submitted or approved by Google. Regenerate and recheck them if the upload artifact, terms or product scope changes; no optional marquee was produced.
