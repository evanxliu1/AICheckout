# Store listing draft

Internal preparation only. Copy the public description after the gates in [release preparation](README.md) pass. Match the final ZIP; the text below assumes the hosted-catalog build with the automatic cart badge (Phase 3b): seven card products and three US merchant readers (Amazon, Best Buy, Newegg).

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

See which card you already own earns the most cash back, right on your cart.

On Amazon US, Best Buy US and Newegg US carts, AI Checkout shows a small badge with your best card and its estimated cash back for that cart: "Use Blue Cash Everyday · $3.00 back". Click it to see every card you own, ranked, with the issuer's rule behind each estimate, its conditions, and a payment-method choice. It currently models seven cash-back cards: Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver and Savor, Chase Freedom Unlimited, and American Express Blue Cash Everyday and Blue Cash Preferred.

Features:

- Automatic, on the three supported carts only: the badge reads the cart's order-summary amount (for example "Subtotal (N items)" on Amazon) and nothing else on the page. Dismiss it for a tab or turn it off for a site.
- Every estimate quotes the issuer's terms; unknown spend toward a cap or uncertain payment methods show as a range, never a guess.
- Correct the amount in the badge, or compare any purchase manually from the toolbar popup.
- All-time savings: after an order on a supported site, the badge asks once whether you paid with the recommended card and keeps an estimated total of the extra cash back versus your default card. The order page is recognized by its address only and is never read.
- No account and no AI at checkout. Your cards, settings and savings stay in this Chrome profile; optional passphrase protection encrypts them.
- Delete everything with **Delete all local data**; export your savings history as JSON.

The extension does not collect card numbers, security codes, bank logins, product names or addresses, and does not send shopping data to us or to an AI provider. The only request it makes is for the published card terms, when you choose **Check for updated terms**. See the privacy policy for the complete data-handling details.

Scope and limitations:

This is a small rewards comparison tool, not a full card-benefits catalog or payment service. It does not apply for cards, link a bank, process a payment, or place an order. Issuer eligibility and merchant coding affect actual rewards. Offers, fees, financing, rewards-covered amounts and unsupported categories are excluded. Card terms expire under a maintenance policy; expired terms block comparisons until updated terms are available. Dollar amounts are estimates and may differ from statement rewards; savings totals are estimates based on the last cart amount, before tax and shipping.

Automatic reading is limited to Best Buy's observed US cart and checkout summary, `secure.newegg.com/shop/cart`, and the Amazon US cart page (`www.amazon.com/gp/cart/view.html` or `/cart`). Authenticated checkout, international sites and mobile layouts are not verified. AI Checkout is an independent project and is not affiliated with the named issuers or retailers.

## Single purpose — dashboard copy

Show a shopper which of the supported cards they already own earns the most cash back on their cart at a supported US retailer, from the visible cart amount and packaged reward rules.

## Permission justifications — dashboard copy

| Permission | Reason |
| --- | --- |
| `storage` | Save the user's selected card products, optional reward-limit inputs, badge settings, purchase inputs and savings history locally, so the badge, popup and service worker share them. The user can export the savings history and delete all data from the popup. |
| Host permissions: `https://www.amazon.com/*`, `https://www.bestbuy.com/*`, `https://bestbuy.com/*`, `https://secure.newegg.com/*` | The automatic cart badge. A packaged content script runs only on these sites' cart, checkout and order-confirmation pages (declared match patterns). On cart pages it reads the visible order-summary amount through a bundled, declarative site adapter; on order-confirmation pages it uses the page address only, to ask whether the recommended card paid. Nothing else on these pages is read, and no other site is accessed. Each host comes from a bundled site adapter; adding a retailer requires an extension update. |
| Host permission: the catalog origin (`https://ai-checkout-api.onrender.com/*`, hosted builds) | Fetch the published card catalog (reward rules, a JSON document validated against a fixed schema) when the user chooses **Check for updated terms**. The request carries no cookies, referrer, cards or purchase data. |
| `activeTab` | Obtain temporary access to the current tab when the user opens the extension, so a manual cart read can identify a supported merchant and its summary amount. |
| `scripting` | Run the packaged, bounded summary reader for a manual read requested from the popup, and recheck the same captured document before using its amount. |
| Web-accessible resource | The badge itself (`src/badge/index.html`), accessible only on the four hosts above, is shown in an isolated frame so the merchant page cannot read card names. |

Remote code declaration for the inspected build: **No**. Reward calculations, site adapters, extraction and UI code are packaged in the extension. The catalog supplies schema-validated values, not executable scripts. Reinspect the actual upload artifact before certifying this.

## Data-use declarations — maintainer worksheet

Do not select “no user data” simply because processing is local. The following is a conservative mapping to check against the dashboard's current definitions, not a claim that a dashboard was submitted:

| Data category | Current behavior to disclose |
| --- | --- |
| Financial/payment information | Selected card products, optional reported annual spend, purchase and cart amounts, reward estimates/conditions and the local savings history (which card the user says paid); no card numbers, bank accounts or payment credentials. |
| Website content | Automatic reading of the visible order-summary amount on the supported carts (and user-requested reads); no product names, addresses or payment fields. |
| Web history/browsing activity | On the supported sites, page addresses are matched against cart and order-confirmation patterns in memory; for a manual read a page-identity hash and tab/document identifiers are saved. No browsing history list is requested or built. |
| Personally identifying/authentication data | No shopper sign-in, email, name, address or token is requested by the extension. Contact sent separately to support and administrator login are distinct services. |
| Health, communications, location, activity tracking | No corresponding feature or collection. The catalog request reaches the API host, whose access logs record IP address, user agent and time (see the privacy policy). |

Certify restricted data use only after the final artifact and service practices match: no sale, no unrelated use/transfer and no creditworthiness/lending use. The extension has no ads, analytics events, tracking pixels or affiliate-link feature. Do not generalize that fact into a promise about an unconfigured website or hosting provider.

Chrome requires a narrow purpose, permission explanations and consistent privacy declarations. [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy). Local handling still requires disclosure. [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

## Prepared assets

The [local gallery](assets/index.html) and [asset record](assets/README.md) contain five 640×400 screenshots covering wallet selection, a confirmed comparison, unknown cap usage, a controlled Newegg subtotal and locked inputs. Each pairs explanatory copy with an actual native-popup detail at its original scale. Sample inputs and the crop are labeled; these are not earned rewards or live-retailer evidence.

The 440×280 promotional PNG and shared cart icon are also prepared. The 128×128 icon contains 96×96 artwork with 16px transparent padding; the 16px, 48px and 128px exports were inspected on light and dark backgrounds. Image formats, dimensions, source hashes and the current ZIP association pass local checks. The media visual review returned **ship**, with no material fixes.

Dimensions and required assets were checked against [Chrome's image guidance](https://developer.chrome.com/docs/webstore/images). These assets have not been submitted or approved by Google. Regenerate and recheck them if the upload artifact, terms or product scope changes; no optional marquee was produced.
