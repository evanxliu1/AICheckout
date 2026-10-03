# Catalog API

Node 24, TypeScript, Fastify, PostgreSQL, the official OpenAI SDK, and shared Zod contracts. The API serves reviewed, immutable rule data, protected source/draft/review/publication operations, and the optional built React review app. It has no wallet/purchase endpoints. Extraction review and audited application are verified locally. The API, review app and public site are deployed on Render at https://ai-checkout-api.onrender.com (auto-deploying `main`), backed by hosted Supabase; live model verification of the metered adapter below remains pending (live evaluations run locally through subscription CLIs, see [`docs/evals/results.md`](../../docs/evals/results.md)).

A [bounded extraction kernel and ledger orchestrator](src/curation/README.md) are connected to authenticated invocation and inspection routes. Private traces, durable reservations, idempotency, and concurrency controls are verified against real local signed sessions and a dedicated PostgreSQL login. Extraction defaults to disabled. A local-only synthetic refusal and an OpenAI Responses adapter are implemented. The latter has been tested only with intercepted transport; live verification and labeled model evaluations remain pending.

## Run locally

From the repository root:

```sh
npm ci
npm run db:start:api
npm run build --workspace=@ai-checkout/api
npm run build --workspace=@ai-checkout/review
```

Copy `apps/api/.env.example` to `apps/api/.env`, set the local Supabase URL and publishable key from the CLI's local status output, then start:

```sh
node --env-file=apps/api/.env apps/api/dist/index.js
```

The process defaults to `127.0.0.1:3000`. `/health` is a liveness check, not a database readiness claim. `GET /v1/catalog` returns `{ "release": null }` before publication, or a validated release containing its sequence, catalog, version, database hash, and publication date. A fresh local seed is deliberately unapproved and does not appear as a published release.

The repository reads the public head and matching snapshot in a single joined Data API query. A timeout, malformed response, inconsistent head, or expired/future release returns a generic `503 catalog_unavailable` response. Responses use `Cache-Control: no-store`. Request logging records a generated request ID, route template, method, status, and duration; it does not log tokens, source text, or request bodies. The database hash identifies the publication; it is not a digital signature. HTTPS provides the publisher-origin boundary for extension downloads.

Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are required. A service-role key or owner database URL is neither needed nor supported. Local HTTP Supabase URLs are allowed for development; hosted connections require HTTPS. Production extension builds require an HTTPS `/v1/catalog` endpoint with an appropriate certificate and only that origin in host permissions. The hosted endpoint is `https://ai-checkout-api.onrender.com/v1/catalog` (`npm run build:hosted --workspace=ai-checkout-extension`).

Set `REVIEW_DIST_DIR=apps/review/dist` when starting from the repository root to serve the [review interface](../review/README.md) at `/review/`. Its runtime configuration contains only the Supabase origin and a modern `sb_publishable_` key; startup rejects a secret or legacy JWT key for this browser configuration. The site uses a restrictive Content Security Policy, no-referrer, no-store, and nosniff headers. Static files are restricted to the configured build directory; dotfiles are denied. Build that directory before starting the API.

Set `SITE_DIST_DIR=apps/site/dist` to serve the [public site](../site/README.md) at `/`. It runs in its own context. Precedence does not depend on registration order: the router always prefers the static and prefixed routes (`/health`, `/v1/*`, `/review/*`) over the site's `/*` wildcard, and the site also refuses those prefixes itself, so an unknown API path is a JSON 404 (`{"error":"not_found"}`, never echoing the path), never a page. Non-canonical paths are 404s; other client errors from the file sender (416, 412) keep their status. Startup fails if `SITE_DIST_DIR` has no `index.html`. The review app's static context uses the same error handling. Its headers are the review CSP without the Supabase origin (`connect-src 'self'`), no-referrer, nosniff and `Cross-Origin-Opener-Policy: same-origin`; hashed `/assets/` files (200 and 304) are cached immutably and everything else is `no-cache`. `tests/public-site.test.ts` covers precedence and headers, including raw, non-normalized paths over a real socket.

## Protected review routes

Every review request requires `Authorization: Bearer <human access token>`. Supabase's Data API verifies the signature; the database operation checks current reviewer membership and a live session in its transaction. The routes that accept large bodies (`POST /sources`, `POST /drafts`, `PUT /drafts/:id`, extraction apply) first check the token in an `onRequest` hook, before the body is read (`src/review-auth.ts`): ES256/RS256 tokens against the project's JWKS (cached), other tokens with `GET /auth/v1/user` (a valid answer cached for 60 seconds). A refused token is `401 sign_in_required` without reading or forwarding the body; an unreachable Auth server is `503 review_unavailable`. This is a pre-check, not the authority, and needs no extra configuration. The server does not trust user metadata, a supplied reviewer ID, browser cookies, or a service-role credential as publication authority. Review access is provisioned explicitly by the project operator in the private reviewers table; there is no self-enrollment route.

| Route | Behavior |
| --- | --- |
| `GET /v1/review/` | Current head and up to 30 pending draft summaries |
| `GET /v1/review/drafts/:id` | Exact draft revision/hash, captured source metadata (length and hash, no text), and joined published snapshot/head for comparison |
| `GET /v1/review/drafts/:id/sources/:sourceId` | One capture attached to the draft, with its text |
| `POST /v1/review/sources` | Capture bounded supplied source text; does not fetch the URL |
| `POST /v1/review/drafts` | Create a validated candidate with explicit source IDs and base sequence |
| `PUT /v1/review/drafts/:id` | Revise a draft only when its expected revision still matches |
| `POST /v1/review/drafts/:id/extractions` | Run bounded extraction on immutable captures attached to the exact draft revision |
| `GET /v1/review/drafts/:id/extractions` | Latest 20 saved runs for this draft, including outcome and application audit |
| `GET /v1/review/drafts/:id/extractions/:runId` | Saved facts, evidence, blockers, application audit, and a proposal when eligible |
| `POST /v1/review/drafts/:id/extractions/:runId/apply` | Record human condition decisions and apply to the originating draft revision; never publish |
| `GET /v1/review/runs/:id` | Authorized inspection of a private run and bounded trace; no execution capability exposed |
| `POST /v1/review/drafts/:id/publish` | Explicit approval bound to revision, hash, current head, and a review note |

The shared input/output contract is in `packages/catalog-review`. Request bodies, parsed output, source counts, and transport bytes are bounded. Errors expose stable categories: `sign_in_required`, `reviewer_access_required`, `invalid_request`, `review_changed`, `draft_not_found`, `invalid_catalog_evidence`, `too_many_requests`, or `review_unavailable`. SQL messages and private response details are not passed through. A stale approval returns HTTP 409 and requires another review. A successful publication retry returns its original release.

Review routes have an in-memory limit of 60 requests per minute per source IP per API process; `POST /sources` has its own 200 per minute and extraction a separate default of 3 per minute. Proxy headers are not trusted, so behind Render's proxy all callers may share one socket IP and these limits act as per-process limits; the single Render instance has not needed a shared ingress limit. The ledger separately enforces durable global run, concurrency, and spending limits. Database RPCs remain directly accessible to authorized reviewers and independently enforce authorization/publication invariants. No CORS or cookie-based review authentication is enabled; the review UI should use the same origin (or a local development proxy).

## Extraction invocation

The extraction request accepts only these fields (use the actual current draft revision and a new UUID for a deliberate new run):

```json
{
  "cardId": "capital-one-quicksilver",
  "expectedRevision": 1,
  "requestKey": "50000000-0000-4000-8000-000000000001"
}
```

The server verifies the same bearer token through the signed review RPC before decoding its user/session claims, then matches them to the verified reviewer. It loads captured source text from that returned draft; client-supplied identity, source bodies, profiles, and publication flags are rejected. The ledger independently rechecks live human authority. The draft ID, revision, and catalog hash join the request fingerprint as provenance; they are not expected model answers or prompt content.

A completed run returns HTTP 200 with `{ executed, run }`. A duplicate returns the same record with `executed: false`; an existing unfinished run returns HTTP 202. Reusing a key for different draft/source/profile input returns 409. Stale drafts also return 409. Missing required captures return 422; durable budget/capacity limits return 429. Disabled/unavailable curation returns 503. If final persistence is uncertain, `curation_result_unconfirmed` includes a run ID for inspection; retrying must not replay the provider. See [operator recovery](../../supabase/CURATION.md).

Requests cancel the kernel on client disconnect or server shutdown, with a 75-second route abort signal above the kernel's maximum 60-second deadline and bounded database operations. Already-started outcomes are still recorded when possible. Publication remains a separate signed human action. The review UI exposes invocation, saved-run recovery, evidence review, and audited application.

`CURATION_ADAPTER=disabled` is the default. `fixture-refusal` additionally requires a loopback Supabase URL, loopback `CURATION_DATABASE_URL`, and an operator-enabled fixture profile selected by `CURATION_PROFILE_ID`. It always records an explicit synthetic refusal: no model or reward facts. `npm run db:test:curation:http` provisions this setup temporarily and cleans it up. No credentials or enabled profiles are seeded.

`CURATION_ADAPTER=openai-responses` requires `CURATION_ALLOW_METERED=true`, a server-only `OPENAI_API_KEY`, the scoped database configuration, and an enabled operator profile with `provider=openai`, `mode=metered`, a dated `gpt-…-YYYY-MM-DD` snapshot, and positive input/output price ceilings. The ledger must also have an enabled policy and enough daily/lifetime budget for every allowed attempt. No default model or price is assumed. A key alone does not enable paid requests. **The current user-authorized spending budget is $0; do not enable a funded policy or make live calls until that changes.**

The adapter uses pinned SDK 7.23.0 at the fixed OpenAI Responses endpoint. It disables SDK retries/logging, provider response storage, background execution, tools, automatic input truncation, and implicit environment endpoint/organization/project overrides. It bounds the full response to 512 KiB before SDK parsing, passes cancellation/output limits, requires the returned model to match the configured snapshot, and records response identity and reported usage. Token accounting conservatively applies the configured ceiling to all reported input/output tokens; it is not an invoice or a guarantee against provider price changes. `store: false` disables response application state, not all provider retention; review current [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) before enabling live use.

The database client requires a dedicated login that belongs only to `aicheckout_curation_executor`, has no administrative attributes or membership administration, and has no direct access to sensitive tables, human extraction application, or publication. It verifies these properties for every new connection and selects the executor role. Maximum pool size is 2; connection/statement/query limits are 5/5/7 seconds. Use a direct or session connection, never a transaction pooler with session `SET ROLE`. Remote connections require verified TLS; optional `CURATION_DATABASE_CA_FILE` supplies a CA certificate. URL query parameters, including insecure TLS overrides, are rejected. Hosted connectivity is not yet verified, and the synthetic adapter cannot use it. `CURATION_RATE_LIMIT` accepts 1–60 for operator configuration; default 3.

## Human extraction application

Inspection reconstructs and verifies saved input/context/trace identity and exact evidence before proposing changes. Only a finished `evidence_valid` run with no findings/issues, known facts, and the same target rule set can be applied to its original unchanged draft. The proposal changes rate, activation, and supported annual cap fields only. It preserves freshness dates and all other catalog metadata. Mechanical validation does not prove complete or correctly interpreted terms.

The apply body has exactly `expectedRevision`, `expectedHash`, `reviewNote`, and `conditionReviews`. Use the originating draft revision/hash. The overall note is 10–2000 characters. Each condition has an ordered, zero-based review with exactly `index`, `coverage: "existing-rules"`, `ruleIds` (1–2 unique actual target IDs), and `note` (10–1200 characters). Supply one review per extracted condition, in original order; use an empty array only when there are no conditions. All notes are trimmed. Coverage is a recorded human attestation; an unsupported condition must not be dismissed to fit the schema.

The signed-human database operation locks the draft/run, rechecks live authority after waiting, builds the candidate from its immutable trace, and atomically records the application and new draft revision. It returns `{ draft, application }`. An exact retry returns that application while its resulting revision/hash is current. Different decisions, a stale origin, or a later edit return 409; unresolved facts/conditions return 422. The executor cannot call this operation, and it never advances the public head. Publication requires a fresh, separate review of the resulting draft.

## Deployment

The current application is a long-running Node process, not a serverless handler. Follow the [deployment and recovery runbook](../../docs/release/deployment-runbook.md) for the exact target, dependencies, TLS/proxy behavior, migration review, private configuration, publication and smoke checks. `/health` is liveness only. Provider/log retention remains unverified; the runbook does not authorize paid model calls.

## Verification

```sh
npm run test --workspace=@ai-checkout/api
npm run db:test:http
npm run db:test:curation:http
npm run db:test:curation:application
```

The 289 tests in this workspace (16 files, 2026-10-03) cover API/transport and review-token checks, the extraction kernel, extraction HTTP/configuration, real-SDK/intercepted transport, v1 and v2 evaluation, and extraction review/application. They cover strict boundaries, safe errors, evidence, limits, cancellation, and default zero spend. The local extraction HTTP test additionally uses the compiled server, real signed Auth sessions, immutable database captures, and an actual scoped LOGIN. It verifies forgery/revocation rejection, trace inspection, retry identity, changed-revision conflicts, and no publication, first with the local refusal and then with the real SDK under a test-only preload that intercepts the provider URL and blocks other external fetches. Synthetic prices/usage exercise reservation/accounting without billing. Real connection tests reject excessive privileges before startup. Fixtures are removed and disabled/zero policy restored. The review app has two compiled browser flows, and the ledger has separate multi-connection race tests. The application HTTP test uses real database locks to verify concurrent exact-retry idempotency, rejection after a later edit, and loss of authority when a session expires while waiting; none advances the public head. No live call through the metered OpenAI adapter and no hosted curation connection has been made; curation stays disabled on Render. The deployed endpoint answers `/health` and `/v1/catalog`.

The [local evaluation runner](../../evals/curation/README.md) includes 60 synthetic, unreviewed development/reserved cases, an abstention diagnostic, saved-trace replay, and finished-ledger import. It makes no live model calls. The compiled HTTP checks also verify canonical context hashes and importer identity after real PostgreSQL JSONB storage. Human annotation review, representative held-out cases, and actual model-quality measurements remain pending.
