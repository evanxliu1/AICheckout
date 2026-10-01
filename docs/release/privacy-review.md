# Data handling and unresolved release decisions

Internal review, September 26, 2026. This is an implementation audit, not legal advice, a security certification or a completed dashboard declaration. The public [privacy draft](privacy-policy.md) describes the current default build; it cannot be published as final while the findings below remain open.

## Observed data paths

| Path | Evidence in current source | Implication |
| --- | --- | --- |
| Popup → worker | `extension/src/background/index.ts`, `state/contracts.ts` | Only the packaged popup sender is accepted; requests and responses use runtime schemas. |
| Worker → protected storage | `state/vault-service.ts`, `state/vault-crypto.ts`, `background/index.ts` | AppState is encrypted with AES-GCM and a passphrase-derived key before `chrome.storage.local` writes. Only the derived unlock key is in `chrome.storage.session`; both areas are `TRUSTED_CONTEXTS`. Plaintext migration requires setup consent. See the [protection design](../verification/local-protection.md). |
| Active tab → reader | `checkout/browser.ts`, `checkout/page-reader.ts` | User-triggered packaged code reads bounded visible amount rows. Full URL is used transiently; a SHA-256 page identity is saved. The hash is a correlation/freshness mechanism, not anonymization. |
| Saved state → result | `state/service.ts` | Five-/fifteen-minute limits invalidate use. They are not a background erasure schedule. Purchase/spend inputs may remain after a result expires. |
| Delete → storage clear | `state/vault-service.ts`; packaged deletion checks | Clears the session key first, then local state including cached catalog. Failed disk deletion reports failure and leaves a locked, recoverable record. Does not delete external carts/history/backups/support communications. |
| Default comparison → network | `catalog-config.ts`, default manifest | No catalog endpoint or model request. Source links open issuer sites at the user's request. |
| Optional update → API | `packages/catalog-client/src/index.ts` | Fixed HTTPS GET, omitted credentials/referrer, no wallet/amount/page payload, redirects rejected. Network operators can still observe IP/request metadata; this is not “no data transfer.” |
| API → operational logs | `apps/api/src/app.ts` | Logs request ID, route template, method, status and duration; generic error events. Does not intentionally log bodies/tokens/amounts/IP. Proxy/provider logs need separate verification. |
| Administrator → Auth/database/model | `apps/review/README.md`, `supabase/CURATION.md` | Separate restricted service with sign-in, immutable source/draft/run/review records and, if authorized, provider requests. It is not a shopper feature or a destination for wallet data. |

## Open release findings

**R1 — Protection implemented; final release artifact must carry the verified design.** The old JSON path is replaced by a versioned encrypted record, a passphrase-derived key kept only in Chrome’s session memory, a setup/migration gate, and explicit lock/reset controls. The [design, threat limits and test record](../verification/local-protection.md) cover authentication of the record, failed migration, wrong phrases, tampering, deletion, browser restart and worker recovery. Do not interpret this as an independent security audit, forensic erasure, protection of an unlocked/compromised device, or Google’s approval. Chrome’s [User Data FAQ, question 9](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) and [handling policy](https://developer.chrome.com/docs/webstore/program-policies/data-handling) remain the release review references.

**R2 — Pre-use disclosure implemented; public links remain open.** Setup names saved card/limit/purchase/cart data, local handling and recovery limits, and requires explicit acceptance before creating or migrating the protected record. Expandable **Data and protection details** are available during setup, unlock and normal use, including transient URL access, freshness versus deletion, memory-key lifetime and external deletion limits. Final public privacy/support URLs still require the owner’s identity, contact and hosting decisions; add the real links and reconcile the final listing/policy before release. The purchase-exclusion checkbox is separate from data-handling acceptance. [Disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements).

**R3 — Configure actual support and hosting practices.** Publisher/contact/domain and support provider are unknown. Do not invent a retention period or claim logs are automatically deleted. Choose and implement retention/deletion/access settings for support mail, hosting/proxy logs, private reviewer data and backups; then update the public policy. Keep private source excerpts, tokens and reviewer identities out of public evidence.

**R4 — Match the final build.** The present public policy/listing describe no remote catalog endpoint. If the release enables one, name its purpose and operator, disclose request metadata and actual retention/providers, add the exact-origin justification, verify headers/logging, and rerun the configured-build/browser/package checks. The extension's local delete button cannot delete hosting access logs or external support messages.

R4 status (phase 3, M5): the draft policy and the public site's privacy page now describe both builds, name the operator (the AI Checkout project, github.com/evanxliu1/AICheckout) and providers (Render hosts the API; Supabase stores the catalog), disclose the request metadata (IP address, user agent, request time in the host's access logs) and defer retention to the providers' log retention. Still open before release: confirm the providers' actual log retention, the store listing's exact-origin justification, and the configured-build/browser/package checks on the release build.

These are concrete release gates. Wording that admits a gap does not resolve the underlying gap. No remote data transfer, blanket permission or analytics feature should be added merely to make the policy more elaborate.

## Final verification record

For each finding, attach the final source revision, implementation decision, meaningful tests, inspected final ZIP, public URL/effective date and owner approval of operational practices. Reconcile the in-product text, store checkboxes, policy and actual behavior. [Chrome's privacy dashboard guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) expects these disclosures to agree.

No passwords or shopping data are needed to review this document. Live provider retention review belongs to the separately gated LLM deployment work; `store: false` alone must not be described as zero provider retention.
