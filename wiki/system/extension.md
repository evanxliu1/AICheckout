---
type: System Component
title: Extension
description: The MV3 extension's popup, onboarding, service worker, local state and optional vault, site adapters and catalog refresh.
status: stable
tags: [system, extension, chrome, mv3]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
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
    title: State v1 to v2 migration
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

Verified 2026-10-02 by reading the code and running `npm test --workspace=ai-checkout-extension` (21 vitest files, 378 tests, plus 6 `node --test` package tests, all passing; re-run at `7322dec`). Browser (Playwright) specs were not run for this page.

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Extension pages | `src/popup/index.html` (toolbar popup), `src/onboarding/index.html` (opened on install), `src/badge/index.html` (badge iframe) | [`vite.config.ts`](../../extension/vite.config.ts) `rollupOptions.input` |
| Permissions | `storage`, `activeTab`, `scripting`; `minimum_chrome_version` 120 | [`manifest.json`](../../extension/manifest.json) |
| Host permissions | Generated: `https://<host>/*` for each adapter host, plus the catalog origin when `VITE_CATALOG_API_URL` is set | [`vite.config.ts:BADGE_HOSTS`](../../extension/vite.config.ts) |
| State key | `checkoutStateV1` in `chrome.storage.local` (name kept; content is schema 2) | [`state/service.ts:STATE_KEY`](../../extension/src/state/service.ts) |
| Vault session key | `checkoutVaultSessionV1` in `chrome.storage.session` | [`state/vault-contracts.ts`](../../extension/src/state/vault-contracts.ts) |
| Settings | `checkoutSettingsV1` in local: `{schemaVersion: 1, disabledMerchants[]}` | [`badge/contracts.ts`](../../extension/src/badge/contracts.ts) |
| Vault crypto | PBKDF2-SHA256, 600,000 iterations; AES-GCM-256 with header as AAD; passphrase 15–256 chars; envelope ≤ 512 KiB | [`state/vault-crypto.ts`](../../extension/src/state/vault-crypto.ts) |
| Comparison freshness | Saved comparison invalid after 15 min, a new local day, a revision or catalog change | `RESULT_MAX_AGE_MS` in [`state/service.ts`](../../extension/src/state/service.ts) |
| Manual cart snapshot | Valid 5 min; read times out after 8 s | `CART_MAX_AGE_MS`, `CART_READ_TIMEOUT_MS` |
| Savings history | ≤ 500 entries, newest first | `MAX_SAVINGS_ENTRIES` in [`state/contracts.ts`](../../extension/src/state/contracts.ts) |
| Wallet | ≤ 20 cards, ≤ 10 usage rows per card, unique IDs, default card must be owned | `walletSchema` |
| Catalog fetch | 8 s timeout, body ≤ `MAX_CATALOG_BYTES` + 2048, HTTPS only, `redirect: 'error'`, no credentials/referrer, `no-store` | [`catalog-client/src/index.ts`](../../packages/catalog-client/src/index.ts) |

## How it works

### Worker and messages

[`src/background/index.ts`](../../extension/src/background/index.ts) restricts both storage areas to `TRUSTED_CONTEXTS` (on worker start, `onInstalled` and `onStartup`), builds the vault service and the badge service, and routes every `chrome.runtime` message through [`routing.ts:routeMessage`](../../extension/src/background/routing.ts) (sender-based; details on [Cart badge](cart-badge.md#message-routing)). `checkout:*` and `settings:*` are accepted only from the popup and onboarding page URLs. After any page request the worker broadcasts `badge:changed` so open badges re-read their view. Tab updates and removals invalidate saved carts. `onInstalled` with reason `install` opens onboarding.

Requests (`requestSchema` in [`state/contracts.ts`](../../extension/src/state/contracts.ts)): `checkout:get-state`, `refresh-catalog`, `save-wallet`, `read-cart`, `compare`, `clear`, `delete-savings`, internal `record-savings`; vault: `checkout:vault-status|create|unlock|lock|delete|remove`. Mutating requests other than `clear` and `record-savings` carry `expectedRevision` and fail if the state moved (another window).

### State and migration

`appStateSchema` (schema 2): `revision`, `wallet`, `purchase`, `catalog` cache (`release`, `lastCheckedAt`), manual `cart` snapshot, `savings[]`, `pendingNotice`, `comparison` metadata. [`state/service.ts:createStateService`](../../extension/src/state/service.ts) serialises operations in one promise queue and treats storage as authoritative so popup closure or worker shutdown loses nothing. Schema 1 (pilot-era) state is migrated once on load by [`migrate.ts:migrateState`](../../extension/src/state/migrate.ts): card IDs carry over, usage rows for rule IDs the current catalog lacks are dropped, and a one-time notice is kept in `pendingNotice` until shown.

### Optional vault

[`state/vault-service.ts:createVaultService`](../../extension/src/state/vault-service.ts) wraps the state service with a storage adapter. Statuses: `unprotected` (plain record or nothing yet; the default), `locked`, `unlocked`, `damaged`. `vault-create` encrypts the existing plain state; `vault-remove` (needs the passphrase) decrypts back to plain storage and drops the session key; `vault-delete` clears everything. The derived key lives only in `chrome.storage.session`. Legacy MVP keys (`openaiKey`, `cachedCards`, …) are removed on status checks.

### Catalog refresh

The engine uses `state.catalog.release?.catalog ?? CATALOG_V2` ([`state/catalog.ts:currentCatalog`](../../extension/src/state/catalog.ts)). `checkout:refresh-catalog` is user-triggered from the popup and exists only in builds with `VITE_CATALOG_API_URL` ([`catalog-config.ts`](../../extension/src/catalog-config.ts)); the URL must be a fixed HTTPS `/v1/catalog` endpoint or the build fails. [`prepareCatalogUpdate`](../../extension/src/state/catalog.ts) rejects: invalid schema, a null release after one was cached, expired or future releases, a lower sequence, same sequence with different content, a reused version. On acceptance it drops usage rows whose rule changed and clears the saved comparison.

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

[`popup/Popup.tsx`](../../extension/src/popup/Popup.tsx) holds the wallet editor, purchase form (merchant, amount, payment path, online-retail eligibility, eligibility confirmation), comparison result, catalog refresh, savings history, per-site badge switches ([`BadgeSettings.tsx`](../../extension/src/components/BadgeSettings.tsx)) and protection settings. [`onboarding/Onboarding.tsx`](../../extension/src/onboarding/Onboarding.tsx) picks cards and a default card with `checkout:save-wallet`.

## Gotchas

- Inspect `dist/manifest.json`; the source manifest omits host permissions, content scripts and badge resources (see [Architecture](architecture.md#gotchas)).
- `src/checkout/content.js` (the manual reader) has no web-accessible entry since `1fd1e31`; `executeScript` injects it without one.
- Both content scripts are built by a custom esbuild IIFE plugin so the packaged hash does not depend on the checkout path.
- `VITE_E2E_CATALOG_DATE` re-dates the bundled catalog for browser tests; the build refuses it unless the output dir is not `dist` (it uses `dist-e2e`).
- `checkout:record-savings` is worker-internal: `routeMessage` denies it from every sender, pages included (since `1fd1e31`, covered by `tests/badge-routing.test.ts`).
- `orderConfirmation.verified` is `false` for all three adapters: the paths are guesses until checked on a real order.

## Tests

| Area | Tests |
| --- | --- |
| State, migration, vault | `state-service.test.ts`, `cart-state.test.ts`, `background.test.ts`, `state-migration.test.ts`, `vault.test.ts`, `vault-gate.test.tsx` |
| Adapters and readers | `adapter-interpreter.test.ts`, `site-adapters.test.ts`, `checkout-reader.test.ts`, `amazon-reader.test.ts`, `newegg-reader.test.ts`, `checkout-browser.test.ts` (fixtures in `tests/fixtures/`) |
| Catalog | `catalog-refresh.test.ts`, `catalog-schema.test.ts` |
| Popup | `popup.test.tsx`, `comparison-result.test.tsx` |
| Browser | `e2e/extension.spec.ts`, `checkout.spec.ts`, `newegg.spec.ts`, `lifecycle.spec.ts`, `vault.spec.ts`, `catalog.spec.ts`, `package.spec.ts`, `popup-a11y.spec.ts`, `release-assets.spec.ts` |

Commands are on [Testing](testing.md).

## Related

* [Cart badge](cart-badge.md)
* [Rewards engine](rewards-engine.md)
* [Architecture](architecture.md)
* Design notes (design-tool file): [`extension/DESIGN.md`](../../extension/DESIGN.md)
* [Glossary](../domain/glossary.md)
