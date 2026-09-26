# AI Checkout extension

React/TypeScript, Manifest V3, Vite/CRXJS, Tailwind, and Zod. The popup compares owned-card rewards locally. Comparisons require no API key, account, or network request; an optional configured HTTPS endpoint supplies reviewed catalog updates.

**Status:** local pilot, not ready for store submission. See [the release plan](../RELEASE_PLAN.md) and [build checkpoint](../BUILD_STATUS.md).

## Setup and use

Use Node 24 and npm. From the repository root:

```sh
npm ci
npm run build --workspace=ai-checkout-extension
```

Open `chrome://extensions`, enable Developer mode, and load `extension/dist/` as an unpacked extension. After rebuilding, reload the extension there before retesting; an existing unpacked profile can retain the earlier background worker. On first use, choose and confirm a local passphrase of at least 15 characters and accept the setup disclosure. Keep the passphrase: restarting Chrome or reloading/updating the extension requires unlocking, and a forgotten phrase cannot be recovered. Select the card products you own, optionally report today's annual online retail spend for Blue Cash Everyday, and save. Open the extension using Chrome's toolbar on a Best Buy US cart or `https://secure.newegg.com/shop/cart`. Choose **Read cart amount**, which selects the merchant automatically, or choose the merchant and enter the amount manually. Confirm/correct the USD amount, choose the online eligibility assumption, confirm the exclusions, and compare.

The readers use bounded visible order-summary rows. They distinguish total, estimated total, and subtotal. Newegg's exact **Est. Total: TBD** state permits its known selected subtotal; both the input and result explain that tax/shipping are excluded and the final charge is unknown. Other malformed totals fail closed. Switching merchants clears the amount, capture, eligibility, confirmation and result. Loading, ambiguous amounts, empty carts, other currencies, unsupported hosts, or missing permission keep manual entry available. The extension never reloads the shopping page. [Recorded merchant verification](../docs/verification/merchants.md) describes the live cases and limits.

The comparison shows either an estimate or a range. Unknown bonus eligibility or annual-cap usage can change which card is best. The app does not track transactions: update reported spend before each purchase. Reported usage becomes unknown on the next day. Only the named card products and merchant scope are modeled; card-specific offers, financing, fees, and other benefits are excluded.

The bundled `2026-09-25.pilot.2` snapshot covers both merchants. Its issuer terms were checked September 25, 2026 and still expire October 25, 2026 under our refresh policy; adding a merchant does not refresh source dates. Expired terms block new comparisons until a currently valid reviewed release is available. An older downloaded catalog keeps its original merchant scope until replaced by a reviewed update.

## Optional catalog updates

Set `VITE_CATALOG_API_URL=https://your-api.example/v1/catalog` in `extension/.env.local` before building. Use the deployed [Node catalog API](../apps/api/README.md), with valid HTTPS. The build adds only that API origin to host permissions. No deployed endpoint is supplied yet; the default build remains an offline pilot.

**Check for updated terms** downloads published rule data only, with no wallet, purchase, page URL, cookies, or authentication token. It does not run automatically. The worker validates the bounded response, release sequence, version, dates, and source/rule references before one atomic storage update. It rejects rollbacks, altered releases, malformed data, and expired terms. A failed request preserves the current snapshot. Already cached valid terms work offline; an expired remote release never silently falls back to the bundle.

New releases invalidate comparisons. Changed rules clear affected reported usage so it becomes unknown. Removed owned cards remain visible as unavailable until explicitly removed; they do not disappear from the wallet silently. Deleting all local data also removes downloaded terms and returns to the original bundle and its original expiry.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser --workspace=ai-checkout-extension
npm run test:catalog:browser
npm run test:package:browser --workspace=ai-checkout-extension
```

Run these commands from the repository root. Type checking includes the production code and the packaged-browser test harness. Unit/component tests cover money parsing, partial caps, stale/unknown usage, eligibility, ties, expiration, runtime messages, storage failures, popup recovery, deletion, catalog schema/refresh, bounded summary parsing, and tab/document freshness. Earlier prototype boundary tests remain as regression checks for retained modules. Packaged Chromium tests exercise offline operation, persistence, changed inputs, expired estimates, two-window deletion, the native Chrome action/permission/amount-comparison flow, popup closure during a paused read, navigation/access revocation, and recovery after observed natural worker shutdown on a sanitized fixture. The latter uses Chrome's documented debugging protocol in an isolated profile; the shipped extension does not request any debugging permission. A separate local HTTPS fixture checks catalog refresh, changed rules, rollback rejection, bounded permissions, and offline browser restart. Its synthetic terms are not issuer or deployment evidence. Live cart evidence is separate; authenticated checkout remains unverified.

See [lifecycle evidence and exact limits](../docs/verification/extension-lifecycle.md). The idle test disconnects Playwright during observation so its debugger cannot keep the worker alive; it requires a browser-reported stopped state and a new execution time origin on wake.

The package command creates `extension/artifacts/ai-checkout-2.0.0.zip` and a SHA-256 file inventory from `extension/dist`. It validates the manifest, permissions, entry files, icon dimensions and allowed runtime files, then verifies the actual compressed contents. `test:package:browser` packages and installs the extracted ZIP in a fresh Chromium profile to check a native two-card comparison and deletion. Build first after source changes. The default browser suite skips this separately invoked ZIP flow. See [package evidence and limits](../docs/verification/release-package.md).

`npm run release:media` at the repository root rebuilds and packages the extension, captures actual popup screenshots, records the labeled offline shopper demo and verifies the store-media packet. It additionally requires Playwright Chromium and `ffmpeg`/`ffprobe`; it makes no live retailer or model call and does not publish. See [media, provenance and reproduction](../docs/release/assets/README.md).

This remains a development artifact. CI can build the current flow without secrets or Supabase configuration; it tests the extracted ZIP before artifact upload. Remote execution is still unverified. Catalog browser fixtures build into a separate directory and cannot become the packaged ZIP accidentally.

## Data and permissions

- The default manifest requests storage plus temporary `activeTab`/`scripting` access after toolbar activation. A configured catalog build also requests only its HTTPS API origin. There are no automatic site scripts or third-party API calls in the comparison flow.
- Stored data: selected card product IDs, optional reported annual spend, confirmed purchase amount/eligibility/date, comparison freshness, and optional captured amount metadata (kind/currency, tab/document IDs, hashed page identity). Raw URLs/query strings, product names, addresses, payment fields, and page HTML are not retained.
- Storage is restricted to trusted extension contexts. Wallet messages are accepted only from the packaged popup, validated, and serialized by the worker.
- The worker reloads authoritative inputs from storage. Manual comparisons last at most 15 minutes. Cart captures expire after five minutes, are revalidated before use, and are invalidated by navigation/removal; date/catalog/wallet changes also invalidate results. Reads time out after eight seconds; late reads cannot restore deleted state.
- Editing purchase inputs hides the previous result. Results describe the saved manual purchase; they do not claim to reflect the active tab.
- Saved state uses passphrase-derived AES-GCM encryption; the usable key is kept only in trusted Chrome session memory. Setup requires disclosure acceptance; browser restart/reload requires unlocking. Manual lock hides private inputs across views. [Protection design and limits](../docs/verification/local-protection.md).
- Delete all local data clears the session key and saved state and returns to setup; all UI deletion paths require explicit confirmation. Old prototype API keys and shopping logs are removed on the first status/state read.

Legacy item extractors and OpenAI/Supabase clients remain in source but are not connected to the packaged pilot. The active summary reader is in `src/checkout/`. `.env.example` documents the optional public catalog endpoint and the separate legacy catalog inspection variables. Never place service-role or model provider secrets in `VITE_` variables.

Still required: the combined Best Buy native/live smoke test and final normal Chrome installation checks, hosted catalog/backend deployment, representative live model evaluation, privacy/support/store materials, and release checks. The Newegg native/live subtotal flow now passes on one anonymous desktop cart with two quantities. The source-to-reviewed-draft workflow is implemented and verified locally with synthetic model responses; it does not establish live model quality.
