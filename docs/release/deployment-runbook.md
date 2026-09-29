# Deployment, maintenance and recovery

Prepared against the current Node 24 / Fastify API, React review app, Supabase migrations and extension build. **No hosted deployment or migration has been performed.** Commands marked hosted are procedures for the named, reviewed target, not commands already executed. Current service/model spending authorization is $0.

## Deployment shape

Use one long-running Node process serving the public catalog API and built review UI, behind an HTTPS reverse proxy. The current entrypoint listens on a socket and uses a PostgreSQL pool when extraction is enabled; do not upload it unchanged as an assumed serverless handler. Keep review UI and review API on the same origin. Publish privacy/support pages separately as static public content once identity and policy decisions are complete.

The extension only needs the public `/v1/catalog` endpoint if online updates are configured. Shopper wallet and purchase data stay outside the backend. Supabase supplies Auth/PostgREST/PostgreSQL; the Node public/review paths use a publishable key plus signed reviewer sessions. A model provider and dedicated database LOGIN are needed only for enabled extraction.

## 1. Identify the target before changing it

Record the source revision, deployment host/origin, Supabase project reference, current database/migration versions, owner/reviewer identity, maintenance window, backup/restore evidence, secret store and rollback operator. Choose hosting within the authorized budget; do not assume a free tier or create paid resources.

Inspect the hosted schema against the six repository migrations and retain existing records. Confirm `catalog_private` is not exposed by the Data API, public/client grants are explicit, and RLS is enabled as designed. Verify current platform/database patch guidance and relevant extensions. The September 25 [PostgreSQL 15.19/17.11 advisory](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) supersedes the locally observed 17.6 patch level; a local passing test does not prove the hosted database was upgraded.

Confirm usable backups and rehearse restore in an approved isolated environment. Do not run the project's reset/seed/concurrency/browser test scripts against hosted credentials: they are deliberately local and create synthetic records. Never use `db reset` as a hosted deployment step.

## 2. Build immutable application artifacts

From the repository root on Node 24:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run db:seed:check
npm run build --workspace=@ai-checkout/api
npm run build --workspace=@ai-checkout/review
```

The API build is `apps/api/dist/index.js`; the review build is `apps/review/dist/`. Fastify, Zod, PostgreSQL, OpenAI and Fastify plugins remain external runtime dependencies. Preserve a lockfile-based runtime installation; copying only `index.js` is insufficient. Install/build in a controlled directory, not a publicly served repository. Serve only the designated review build directory; never expose `.env`, source, migrations or `node_modules` through the proxy.

Use the existing application/database workflows for the full local-stack checks. Record the actual remote run URLs and results before calling CI verified. A deployed model key must never be present during ordinary CI or bundled in either frontend.

## 3. Review and apply hosted migrations

The installed Supabase CLI's `db push --help` was checked during this preparation. After confirming the linked project, inspect the pending set:

```sh
npm run supabase -- db push --linked --dry-run --skip-vault
```

Review the printed migrations, target and backup/restore plan. `--skip-vault` avoids the CLI's separate vault synchronization behavior. Do not add `--include-all`, `--include-roles` or `--include-seed` to bypass drift. If migration history and schema disagree, investigate and document the baseline reconciliation first.

Only after the exact target/change set is approved and recoverable, the hosted application command is:

```sh
npm run supabase -- db push --linked --skip-vault
```

Do not silently link to a different project. Keep database-owner credentials in the operator's secret tooling; do not put passwords in these docs, shell history, client builds or application logs. The seed is an unapproved engineering draft, not a production publication. Apply real source captures and explicit human review before exposing a release.

Provision reviewer membership for the owner's verified existing Auth user UUID through an operator-only path. User-editable metadata is not authorization. Keep curation policy disabled, budgets zero and no enabled metered profiles until separately authorized. [Database authority model](../../supabase/README.md).

## 4. Configure and start the API/review service

Set server environment values using the host's secret/configuration system. `apps/api/.env.example` documents names. Public configuration is still specific to the selected project; placeholders are not deployable credentials.

| Setting | Production intent |
| --- | --- |
| `SUPABASE_URL` | Actual HTTPS project origin, no path/query/credentials |
| `SUPABASE_PUBLISHABLE_KEY` | Modern publishable key; never a service-role key |
| `REVIEW_DIST_DIR` | Absolute directory containing the built review app |
| `HOST`, `PORT` | Interface/port appropriate for the selected host; `127.0.0.1` behind a local proxy, or `0.0.0.0` inside a controlled container/network |
| `CURATION_ADAPTER` | `disabled` initially |
| `CURATION_ALLOW_METERED` | `false` initially |
| Provider/database extraction credentials | Omit until the separately reviewed, funded extraction rollout |

Start from the repository/runtime root with the injected environment:

```sh
node apps/api/dist/index.js
```

For a private local environment file only, the documented equivalent is `node --env-file=apps/api/.env apps/api/dist/index.js`. The file must not be publicly served or committed. Use a process supervisor, a non-administrative OS identity, controlled outbound access and graceful SIGTERM/SIGINT handling.

Configure HTTPS end to end for external services, with verified database certificate/hostname checks. Enable and verify Supabase SSL enforcement through its settings; changing it can restart the database. [SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).

The Fastify app deliberately leaves `trustProxy` false. Review limits are per process and socket IP; behind a proxy, users may share one bucket. Do not enable blanket trust in forwarded headers. Configure bounded ingress limits and a known proxy topology, then test spoofed forwarding headers and multiple clients. Multi-instance HTTP limits are not globally shared; the extraction ledger's spending/concurrency controls are durable and separate.

Do not cache `/review`, `/v1/review` or `/v1/catalog`. Preserve no-store/security headers and Authorization forwarding only to the application. Prevent proxy/body/header logging of credentials and source text. Verify actual provider access-log fields/retention. Allow the bounded extraction request to finish if enabled: route cancellation is 75 seconds, with an 85-second socket bound; use a compatible proxy/supervisor grace period and test disconnect/shutdown behavior on that host. Do not advertise long-running extraction support from a default short serverless timeout.

## 5. Hosted smoke checks

Perform read-only checks first, recording responses without secrets:

| Check | Expected result / meaning |
| --- | --- |
| `GET /health` | 200 with `status: ok`; **liveness only**, no database/readiness proof |
| `GET /v1/catalog` before first publication | 200 with `release: null` if database access works; not shopper catalog readiness |
| `GET /v1/catalog` after publication | 200, valid current release/version/hash/sequence/dates, no-store and nosniff; expired/unavailable terms return 503 |
| `GET /v1/review/` without bearer token | 401; never a private queue |
| `/review/` and `/review/config.json` | HTTPS; only public origin/publishable key exposed; restrictive CSP/no-referrer/no-store/nosniff |
| Private files and dotfiles | Not publicly retrievable from API/proxy/static origin |
| Ordinary account / revoked reviewer session | Denied review/publication; test with authorized nonproduction fixtures before release |

Then use the actual reviewer flow for source capture, exact draft review and separate publication. This is a deliberate data mutation: approve the specific catalog before publishing. Do not infer success from a healthy process. Record one actual extension refresh against the published HTTPS endpoint, changed-input invalidation and offline use of the valid cached release.

## 6. Build and verify the extension that will ship

First verify the default build with `VITE_CATALOG_API_URL` unset in both the environment and extension environment files. It gets rule updates only through extension releases:

```sh
npm run build --workspace=ai-checkout-extension
npm run test:browser --workspace=ai-checkout-extension
npm run test:catalog:browser
npm run test:package:browser --workspace=ai-checkout-extension
```

The default browser suite expects no host permissions; the configured-catalog command builds an isolated HTTPS fixture variant. After the public endpoint and its privacy practices are verified, set `VITE_CATALOG_API_URL` to the actual HTTPS `/v1/catalog` URL and rebuild the final hosted variant. It adds one host origin, requiring the corresponding listing/privacy revision. Verify its exact origin, live refresh and native flow, then run `npm run test:package:browser --workspace=ai-checkout-extension` on that intended build. The ZIP test accepts the inventory's exact catalog origin but does not exercise live refresh. Do not mistake the local configured fixture for a production connection or accidentally package `dist-catalog-test`.

Run normal Chrome and tester procedures against the actual release artifact. Capture the ZIP/inventory hashes and update [package evidence](../verification/release-package.md). Publishing privacy pages or a ZIP does not submit the extension to the store.

## Maintenance and incident recovery

| Situation | Action and completion evidence |
| --- | --- |
| Terms approaching expiry | Assign a weekly owner check and reverify at least a week before expiry; retain actual source captures and publish a new reviewed version. This document does not schedule an automation. |
| Incorrect published rule | Disable affected service output if necessary; warn via support; create a corrected higher-sequence version, review and publish. Never overwrite immutable releases or move the head backward. Offline clients keep cached terms until refresh/expiry, so an outage is not immediate revocation. |
| Catalog/API unavailable | Diagnose deployment, database, grants and dates. Restore service; valid cached/bundled terms work only until expiry. Do not extend dates without source review. |
| Bad API/UI deployment | Restore the last known compatible application artifact and config; verify health, catalog, authorization and UI. Do not roll back database history by dropping migrations. Use a reviewed forward repair if schema compatibility requires it. |
| Merchant structure changed | Reproduce with minimal anonymous data, disable/limit that reader in a new extension version if needed, retain manual entry, and add sanitized observed fixtures. Do not widen all-site access to hide the failure. |
| Provider error/uncertain extraction | Disable curation policy/admission; inspect saved run/accounting. Never replay an uncertain request automatically or release its reservation on a guess. Follow [ledger recovery](../../supabase/CURATION.md). |
| Reviewer credential concern | Revoke sessions and membership, inspect audit records, rotate affected secrets, then verify access is denied. Deleting a user alone is not the revocation plan. |
| Database recovery | Restore to the approved environment using the verified backup procedure, preserve audit/history, compare release sequences/hashes and reconcile clients before resuming publication. Record recovery time and data loss; no RTO/RPO guarantee has been measured. |

Assign actual log retention and alerts for recurring 5xx/429 responses, unavailable/expiring catalogs, stale runs and budget exhaustion after a host is chosen. Current app logs omit sensitive payloads, but host/proxy defaults are not verified. Record dependencies and patch updates; re-run checks proportional to each change. No live model deployment is authorized by this runbook.
