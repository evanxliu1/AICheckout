---
type: System Component
title: Extension
description: The MV3 extension's popup, onboarding, service worker, local state and optional vault, site adapters and catalog refresh.
status: stable
tags: [system, extension, chrome, mv3]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T02:50:00Z
sources:
  - resource: ../../extension/vite.config.ts
    title: Build plugins and generated manifest
  - resource: ../../extension/src/background/index.ts
    title: Service worker
  - resource: ../../extension/src/state/contracts.ts
    title: App state schema and requests
  - resource: ../../extension/src/state/service.ts
    title: State service
  - resource: ../../extension/src/state/vault-service.ts
    title: Optional vault
  - resource: ../../extension/src/state/vault-crypto.ts
    title: Vault crypto
  - resource: ../../extension/src/state/migrate.ts
    title: State migration to schema 3 and reconciliation
  - resource: ../../extension/src/state/wallet.ts
    title: Wallet pruning and validation
  - resource: ../../extension/src/state/keys.ts
    title: Storage keys and limits shared with pages
  - resource: ../../extension/src/state/catalog.ts
    title: Catalog cache and update rules
  - resource: ../../extension/src/checkout/adapters/schema.ts
    title: Site adapter schema
  - resource: ../../extension/src/checkout/page-reader.ts
    title: Adapter interpreter
  - resource: ../../extension/src/checkout/browser.ts
    title: Manual cart read
  - resource: ../../packages/catalog-client/src/index.ts
    title: Catalog fetcher
  - resource: ../archive/phase2-goal.md
    title: Phase 3 and 3b plan (archived)
---

# Extension

A Manifest V3 extension (`extension/`, Vite + `@crxjs/vite-plugin`, React 19, `@ai-checkout/ui`). The service worker owns all state in `chrome.storage`; the popup and onboarding pages are thin clients that send typed messages. State is plain local storage by default; a passphrase vault is optional. Carts are read by one generic interpreter driven by bundled, declarative site adapters. The automatic cart badge has its own page: [Cart badge](cart-badge.md).

Verified 2026-10-03 on branch `s2-m7-extension-ui` (Stage 2 M7, merged with `main` after M5 and again after M10 part 1 and Tailwind 4) by running `npm test --workspace=ai-checkout-extension` (28 vitest files, 688 tests, plus 6 `node --test` package tests) and the Playwright specs (`npm run test:browser`: 14 passed, 3 skipped by design; `npm run test:catalog:browser` and `test:package:browser` passed). Earlier: verified 2026-10-02 on branch `s2-m6-extension-state` (Stage 2 M6, merged with PR #26; M5 merged with PR #27 made `CATALOG_V3` the bundled catalog) by reading the code and running `npm test --workspace=ai-checkout-extension` (23 vitest files, 608 tests including the rewards engine suites, plus 6 `node --test` package tests) and the Playwright specs (`npm run test:browser`: 10 passed, 3 skipped by design; `npm run test:catalog:browser` and `test:package:browser` passed).

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Extension pages | `src/popup/index.html` (toolbar popup), `src/onboarding/index.html` (opened on install), `src/badge/index.html` (badge iframe) | [`vite.config.ts`](../../extension/vite.config.ts) `rollupOptions.input` |
| Permissions | `storage`, `activeTab`, `scripting`; `minimum_chrome_version` 120 | [`manifest.json`](../../extension/manifest.json) |
| Host permissions | Generated: `https://<host>/*` for each adapter host, plus the catalog origin when `VITE_CATALOG_API_URL` is set | [`vite.config.ts:BADGE_HOSTS`](../../extension/vite.config.ts) |
| State key | `checkoutStateV1` in `chrome.storage.local` (name kept; content is schema 3); encrypted when the vault is on | [`state/keys.ts:STATE_KEY`](../../extension/src/state/keys.ts) |
| Catalog key | `checkoutCatalogV1` in `chrome.storage.local`: `{release, lastCheckedAt}`, never encrypted (public data, up to 1 MiB), readable while locked | [`state/keys.ts:CATALOG_KEY`](../../extension/src/state/keys.ts), `catalogCacheSchema` |
| Vault session key | `checkoutVaultSessionV1` in `chrome.storage.session` | [`state/vault-contracts.ts`](../../extension/src/state/vault-contracts.ts) |
| Settings | `checkoutSettingsV1` in local: `{schemaVersion: 1, disabledMerchants[]}` | [`badge/contracts.ts`](../../extension/src/badge/contracts.ts) |
| Vault crypto | PBKDF2-SHA256, 600,000 iterations; AES-GCM-256 with header as AAD; passphrase 15–256 chars; envelope ≤ 512 KiB | [`state/vault-crypto.ts`](../../extension/src/state/vault-crypto.ts) |
| Comparison freshness | Saved comparison invalid after 15 min, a new local day, a revision or catalog change | `RESULT_MAX_AGE_MS` in [`state/service.ts`](../../extension/src/state/service.ts) |
| Manual cart snapshot | Valid 5 min; read times out after 8 s | `CART_MAX_AGE_MS`, `CART_READ_TIMEOUT_MS` |
| Savings history | ≤ 500 entries, newest first | `MAX_SAVINGS_ENTRIES` in [`state/contracts.ts`](../../extension/src/state/contracts.ts) |
| Wallet | ≤ 20 cards, ≤ 30 usage rows per card, catalog v3 `choices` (≤ 5 per card, 1–5 options each), wallet `gates` and `valueOverrides` (≤ 100 each, 1–10,000 hundredths of a cent); unique IDs, default card must be owned | `walletSchema` |
| Catalog fetch | 8 s timeout, body ≤ `CATALOG_V3_LIMITS.bytes` + 2048 (`MAX_RESPONSE_BYTES`), HTTPS only, `redirect: 'error'`, no credentials/referrer, `no-store` | [`catalog-client/src/index.ts`](../../packages/catalog-client/src/index.ts) |

## How it works

### Worker and messages

[`src/background/index.ts`](../../extension/src/background/index.ts) restricts both storage areas to `TRUSTED_CONTEXTS` (on worker start, `onInstalled` and `onStartup`), builds the vault service and the badge service, and routes every `chrome.runtime` message through [`routing.ts:routeMessage`](../../extension/src/background/routing.ts) (sender-based; details on [Cart badge](cart-badge.md#message-routing)). `checkout:*` and `settings:*` are accepted only from the popup and onboarding page URLs. After any page request the worker broadcasts `badge:changed` so open badges re-read their view. Tab updates and removals invalidate saved carts. `onInstalled` with reason `install` opens onboarding.

Requests (`requestSchema` in [`state/contracts.ts`](../../extension/src/state/contracts.ts)): `checkout:get-state`, read-only `catalog-cards` (up to 20 card IDs whose terms the wallet editor needs), `refresh-catalog`, `save-wallet`, `read-cart`, `compare`, `clear`, `delete-savings`, internal `record-savings`; vault: `checkout:vault-status|create|unlock|lock|delete|remove`. Mutating requests other than `clear` and `record-savings` carry `expectedRevision` and fail if the state moved (another window). Every successful response carries `state`, the comparison, a notice, `catalog` and `cardIndex` ([`service.ts:pageResponse`](../../extension/src/state/service.ts)): `catalog` is the catalog in effect cut by [`catalog-slice.ts:catalogSlice`](../../extension/src/state/catalog-slice.ts) to the owned cards (plus the cards a `catalog-cards` request names), every merchant and what those cards refer to (programs, brands, gates, sources), and `cardIndex` lists every card's id, name, short name and issuer for search; with two owned cards a response is under 80 KB against about 800 KB for the whole bundled catalog ([decision](../decisions/2026-10-03-extension-ui-v3.md)). `responseSchema` checks the slice only for shape, since it may hold no cards. Pages use it and never load the bundled catalog (they import keys and limits from [`state/keys.ts`](../../extension/src/state/keys.ts), not the worker's `service.ts`). `responseSchema` accepts the v3 rule statuses, uncertainty codes, `no-accepted-card`, `notAccepted` and the estimate fields `programId`, `minRewardUnits`, `maxRewardUnits`, `unitValue`.

### State and migration

`appStateSchema` (schema 3): `revision`, `wallet`, `purchase`, manual `cart` snapshot, `savings[]`, `pendingNotice`, `comparison` metadata and `walletCatalogVersion` (the catalog the wallet was last checked against). The catalog cache is not in the state; it lives under `CATALOG_KEY` and is written in the same `storage.set` as the state it belongs with. [`state/service.ts:createStateService`](../../extension/src/state/service.ts) serialises operations in one promise queue and treats storage as authoritative so popup closure or worker shutdown loses nothing.

Migration, once on load ([`migrate.ts:migrateState`](../../extension/src/state/migrate.ts)), in one write of both keys: schema 1 (pilot) drops usage rows for rule IDs its catalog lacks; schema 2 moves its embedded cache to `CATALOG_KEY` (a cache already under that key wins unless its release has a lower sequence), stamps `walletCatalogVersion`, bumps the revision and clears the saved comparison. A one-time notice is kept in `pendingNotice` until shown. With the vault on, migration happens on the first unlocked read and re-encrypts the smaller schema 3 state. An unreadable catalog cache is ignored (bundled terms).

Reconciliation ([`migrate.ts:reconcileState`](../../extension/src/state/migrate.ts), [`wallet.ts:reconcileWallet`](../../extension/src/state/wallet.ts)): when `walletCatalogVersion` differs from the catalog in effect (an extension update changed the bundled catalog, the catalog in effect switched between cached and bundled as one expired or the other is newer, or the cache was dropped), load drops usage rows, choices, gate answers and point values whose IDs the catalog lacks (the engine throws on them), and usage rows whose rule changed when the old catalog is still at hand (`catalogByVersion`: the cached release or the bundled catalog; rules are compared in v3 form, `ruleTerms`, so a v2 rule carried unchanged into v3 keeps its rows: [decision](../decisions/2026-10-03-bundled-catalog-v3.md)), with the migration notice and a revision bump; if nothing is dropped only the stamp changes. Owned cards the catalog lacks stay and block comparisons (`unknown-owned-card`). `save-wallet` refuses a wallet with anything the catalog in effect lacks (`validateWallet`).

### Optional vault

[`state/vault-service.ts:createVaultService`](../../extension/src/state/vault-service.ts) wraps the state service with a storage adapter. Statuses: `unprotected` (plain record or nothing yet; the default), `locked`, `unlocked`, `damaged`. `vault-create` encrypts the existing plain state; `vault-remove` (needs the passphrase) decrypts back to plain storage and drops the session key; `vault-delete` clears everything. The derived key lives only in `chrome.storage.session`. Legacy MVP keys (`openaiKey`, `cachedCards`, …) are removed on status checks.

### Catalog refresh

The catalog in effect ([`state/catalog.ts:currentCatalog(cache, now)`](../../extension/src/state/catalog.ts)) is, of the cached release's catalog (v1, v2 or v3) and the bundled `BUNDLED_CATALOG` (`CATALOG_V3`, `2026-10-02.expansion.1`, since Stage 2 M5; `CATALOG_V2` before), the one valid now; when both are valid, the one with the later `verifiedAt` (the cached release on a tie); when both have expired, again the one verified later; when neither is valid otherwise (one not yet valid), the cached release, so comparisons report its state ([decision](../decisions/2026-10-03-newest-valid-catalog-wins.md), [both expired](../decisions/2026-10-03-expired-catalogs-keep-answers.md)). An expired catalog in effect never prunes choices, gate answers or point values (`reconcileWallet(…, { keepOptions })`, also in `validateWallet`); comparisons get an in-memory copy without unknown IDs (`wallet.ts:engineWallet`). Only the worker imports this module. `checkout:refresh-catalog` is user-triggered from the popup and exists only in builds with `VITE_CATALOG_API_URL` ([`catalog-config.ts`](../../extension/src/catalog-config.ts)); the URL must be a fixed HTTPS `/v1/catalog` endpoint or the build fails. [`prepareCatalogUpdate`](../../extension/src/state/catalog.ts) accepts every catalog schema and rejects: invalid schema, a null release after one was cached, expired or future releases, a lower sequence, same sequence with different content, a reused version. On acceptance it drops usage rows whose rule changed or disappeared, and choices, gate answers and point values whose IDs the new catalog lacks, stamps `walletCatalogVersion`, clears the saved comparison and writes cache and state together; a check that finds nothing new writes only `lastCheckedAt` to the cache. A release older than the bundled catalog in effect is cached (the reference for the next sequence check) without touching the state ([decision](../decisions/2026-10-02-extension-state-v3.md)).

### Site adapters

Each merchant is a JSON spec in [`src/checkout/adapters/`](../../extension/src/checkout/adapters) validated by [`schema.ts:siteAdapterSchema`](../../extension/src/checkout/adapters/schema.ts) at build time (in `vite.config.ts`) and in tests, never at runtime, so Zod stays out of content scripts. A spec declares hosts and anchored path regexes, `matchPatterns` (content-script reach), `orderConfirmation` paths, summary/row/label/amount selectors, label→kind map, loading and empty-cart markers, `requiredKinds`, duplicate and combine policy.

| Adapter | `extractorVersion` | Hosts | Cart paths | Order paths verified |
| --- | --- | --- | --- | --- |
| `best-buy-us` | `bestbuy-summary-v1` | `bestbuy.com`, `www.bestbuy.com` | `^/cart/?$`, `^/checkout(?:/.*)?$` | No |
| `newegg-us` | `newegg-summary-v1` | `secure.newegg.com` | `^/shop/cart/?$` | No |
| `amazon-us` | `amazon-summary-v1` | `www.amazon.com` | `^/gp/cart/view\.html$`, `^/cart/?$` | No |

[`page-reader.ts:readCheckoutPage`](../../extension/src/checkout/page-reader.ts) is the one interpreter: visible text only, no form values or item names, bounded rows and text, USD only, any ambiguity returns `{status: 'unavailable', reason}` (`unsupported-page`, `empty-cart`, `summary-missing`, `ambiguous-amount`, `unsupported-currency`, `page-loading`). [`merchants.ts:merchantForCheckout`](../../extension/src/checkout/merchants.ts) requires HTTPS, no credentials or port, an exact host and path length ≤ 200.

### Manual cart read (popup)

[`checkout/browser.ts:readActiveCheckout`](../../extension/src/checkout/browser.ts) injects `src/checkout/content.js` into the active tab's top frame (isolated world) via `activeTab` + `scripting`, calls `window.__AI_CHECKOUT_readSummary`, and stores a snapshot bound to tab ID, document ID and a SHA-256 of the URL. `validateActiveCheckout` re-reads the same document before a cart-based comparison is shown again.

### Popup and onboarding

[`popup/Popup.tsx`](../../extension/src/popup/Popup.tsx) holds the wallet editor, purchase form (merchant, amount, payment path incl. Venmo when the catalog in effect is v3, online-retail eligibility, eligibility confirmation), comparison result, catalog refresh, savings history (card names from `cardIndex`), per-site badge switches ([`BadgeSettings.tsx`](../../extension/src/components/BadgeSettings.tsx)) and protection settings; "Your cards" names any owned points program without a value. [`onboarding/Onboarding.tsx`](../../extension/src/onboarding/Onboarding.tsx) shows the same editor and saves with `checkout:save-wallet`.

[`WalletEditor.tsx`](../../extension/src/components/WalletEditor.tsx) (Stage 2 M7, [decision](../decisions/2026-10-03-extension-ui-v3.md)): **Add a card** is a `Combobox` over `cardIndex` grouped by issuer (every typed word must appear in the name, issuer or short name); an added card's terms are fetched with `checkout:catalog-cards` before its questions show, and saving waits for them; owned cards are listed with **Remove**; up to 20 cards (`MAX_WALLET_CARDS`). Then, only for cards that have them ([`wallet-options.ts`](../../extension/src/components/wallet-options.ts), only rules that can apply at a catalog merchant): **Card options** (each `chosen` choice: radios with "Not sure", or up to `picks` checkboxes; `defaultOptionIds` prefilled when the card is added, labelled as the card's default), **About you** (each gate once per wallet, naming the cards it affects, with "Not sure"), **Bonus limits** (spend and activation from `usageInputs`, without rules of categories the shopper did not choose; an `enroll-once` rule of a chosen category asks nothing, choosing is its enrollment), **Point values** (each owned points program: published estimate with publisher and date, issuer-stated value of the program or card, or "No published value"; an optional value in cents each, 0.01–100, stored as hundredths of a cent, replacing the default for every card of the program; the default shown is the card's stated value first, as the engine uses it; **Reset to default**). Spend fields name the limit's period ("this quarter", "in 2026"). Saving keeps choices, gate answers and point values the form does not ask. A card whose terms fail to load is removed again with an alert. Results ([`ComparisonResult.tsx`](../../extension/src/components/ComparisonResult.tsx), wording in [`estimates.ts`](../../extension/src/components/estimates.ts)): dollars first, then for points the units and value per unit with an "Estimate", "Issuer-stated" or "Your value" label; unvalued programs in units with a prompt to set a value; store rewards in dollars "paid as" the program; points rates as "N points per $1" (a cash card paid in points the issuer values at 1¢, Citi Double Cash, reads "2%" and "paid as" its points: `cashLikePoints`); "Up to $x" with "Nothing is guaranteed" when a card's minimum is $0; v3 statuses, uncertainties (naming the chosen option or the gate question), cards not accepted ("works only at …") and `no-accepted-card` in plain words; a ranking note when conditions or missing values could change the first card.

## Gotchas

- Inspect `dist/manifest.json`; the source manifest omits host permissions, content scripts and badge resources (see [Architecture](architecture.md#gotchas)).
- `src/checkout/content.js` (the manual reader) has no web-accessible entry since `1fd1e31`; `executeScript` injects it without one.
- Both content scripts are built by a custom esbuild IIFE plugin so the packaged hash does not depend on the checkout path.
- Only the worker chunk carries the bundled catalog: with `CATALOG_V3` it is 587,077 bytes (52,727 gzip; 42,737 with `CATALOG_V2`), the upload ZIP 208,313 bytes (166,831). Popup, onboarding and content-script chunks import no catalog; check with `grep -l 2026-10-02.expansion.1 -r extension/dist` after a build.
- The wallet editor lists all 178 bundled cards by issuer and refuses to save more than `MAX_WALLET_CARDS` (20, `state/keys.ts`, also the schema limit); native-popup browser specs pick cards by name (`checkCards`, `REAL_CARD_NAMES` in `e2e/native-popup.ts`), never by position. Unit tests that fix the clock use dates from 2026-10-02 (the bundle's `verifiedAt`); `popup.test.tsx` mocks only `Date.now`, so its date must not be later than the real date.
- Styling is Tailwind 4 through `@tailwindcss/postcss` ([`postcss.config.js`](../../extension/postcss.config.js), with autoprefixer); the theme is CSS-first in [`src/styles/globals.css`](../../extension/src/styles/globals.css) (`@theme inline` on `--token-*`, no preflight, unlayered utilities, sources limited to `src/`). `space-y-*` keeps Tailwind 3's selector (top margin on each shown child after the first, at class specificity) and a small PostCSS step drops Tailwind 4's own `space-y` rules. Other utilities added later follow Tailwind 4 semantics (`border` sets a solid style, `ring` is 1 px, `hover:` only on hover-capable devices, `space-x`/`divide-*` use the zero-specificity form). The root `package.json` pins `lightningcss` only so npm 11 keeps its platform binaries in the lockfile ([decision](../decisions/2026-10-03-tailwind-4.md)).
- `VITE_E2E_CATALOG_DATE` re-dates the bundled catalog for browser tests; the build refuses it unless the output dir is not `dist` (it uses `dist-e2e`).
- `checkout:record-savings` is worker-internal: `routeMessage` denies it from every sender, pages included (since `1fd1e31`, covered by `tests/badge-routing.test.ts`).
- `orderConfirmation.verified` is `false` for all three adapters: the paths are guesses until checked on a real order.

## Tests

| Area | Tests |
| --- | --- |
| State, migration, vault | `state-service.test.ts`, `cart-state.test.ts`, `background.test.ts`, `state-migration.test.ts`, `vault.test.ts`, `vault-gate.test.tsx`, `state-v3.test.ts` (schema 2 → 3 with and without the vault, vault size with a 1 MiB catalog, largest valid state, v3 refresh rules, pruning, badge payload bound) |
| Adapters and readers | `adapter-interpreter.test.ts`, `site-adapters.test.ts`, `checkout-reader.test.ts`, `amazon-reader.test.ts`, `newegg-reader.test.ts`, `checkout-browser.test.ts` (fixtures in `tests/fixtures/`) |
| Catalog | `catalog-refresh.test.ts`, `catalog-schema.test.ts` |
| Popup | `popup.test.tsx`, `comparison-result.test.tsx`, `wallet-editor.test.tsx` (search, 180-card fixture, 20-card limit, options, gates, point values), `v3-results.test.tsx` (v3 wording), `catalog-slice.test.tsx` (response slice, index, `catalog-cards`, editor loading) |
| Browser | `e2e/extension.spec.ts` (incl. ranking changes when a chosen category, a point value or a gate answer changes, on the fixture and on the bundled catalog), `checkout.spec.ts`, `newegg.spec.ts`, `lifecycle.spec.ts`, `vault.spec.ts`, `catalog.spec.ts`, `package.spec.ts`, `popup-a11y.spec.ts` (axe and no inline styles at 360 and 480 px, v2 and v3 states incl. onboarding), `release-assets.spec.ts` |

Commands are on [Testing](testing.md).

## Related

* [Cart badge](cart-badge.md)
* [Rewards engine](rewards-engine.md)
* [Architecture](architecture.md)
* Design notes (design-tool file): [`extension/DESIGN.md`](../../extension/DESIGN.md)
* [Glossary](../domain/glossary.md)
