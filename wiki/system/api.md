---
type: System Component
title: API
description: apps/api — the Fastify process that serves /health, /v1/catalog, the protected /v1/review routes, and the static review app and public site, with its auth model and security headers.
status: stable
tags: [system, api, fastify, security]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../apps/api/src/index.ts
    title: Entrypoint and env schema
  - resource: ../../apps/api/src/app.ts
    title: createApp
  - resource: ../../apps/api/src/review-routes.ts
    title: Review routes
  - resource: ../../apps/api/src/review-repository.ts
    title: Review RPC client
  - resource: ../../apps/api/src/catalog-repository.ts
    title: Public catalog read
  - resource: ../../apps/api/src/review-site.ts
    title: Review app static context
  - resource: ../../apps/api/src/public-site.ts
    title: Public site static context
  - resource: ../../apps/api/src/static-errors.ts
    title: Static error handling
  - resource: ../../apps/api/README.md
    title: API README
  - resource: ../../render.yaml
    title: Render blueprint
---

# API

`apps/api` (`@ai-checkout/api`) is one long-running Node 24 process: Fastify 5, bundled by esbuild to `apps/api/dist/index.js` with runtime deps external. It serves the public catalog, the reviewer-only review/extraction routes, and two static builds on the same origin. It holds no wallet or purchase endpoints and no privileged database credential: catalog reads use the Supabase publishable key, and review routes forward the reviewer's own bearer token to signed RPCs where the database decides authority. Request/response contracts and error semantics are documented in [`apps/api/README.md`](../../apps/api/README.md); this page is the map.

Verified 2026-10-02 by reading the code and running `npm test --workspace=@ai-checkout/api` (15 files, 265 tests, passing) on branch `s2-m8-review-large-catalog` (Stage 2 M8), and `db:test:http` on the local stack. Hosted behaviour not checked; the M8 routes need migration `20261002230334_review_summary` on hosted ([large catalog decision](../decisions/2026-10-02-review-large-catalog.md)).

## Facts

| Env var | Default | Meaning |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | required | Data API base (HTTPS, or `http://127.0.0.1`/`localhost` locally) and publishable key |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Listen address (Render sets `HOST=0.0.0.0`) |
| `REVIEW_DIST_DIR` | unset | Serve the review app at `/review/` |
| `SITE_DIST_DIR` | unset | Serve the public site at `/`; startup fails without `index.html` |
| `CURATION_ADAPTER` | `disabled` | `disabled`, `fixture-refusal` (loopback DBs only), `openai-responses` |
| `CURATION_ALLOW_METERED`, `OPENAI_API_KEY` | `false`, unset | Both required (plus a funded DB policy) before any paid call |
| `CURATION_DATABASE_URL`, `CURATION_PROFILE_ID`, `CURATION_DATABASE_CA_FILE` | unset | Scoped executor login, operator profile, optional CA; required when curation is enabled |
| `CURATION_RATE_LIMIT` | `3` | Extraction requests per minute per IP per process (1–60) |

| Server limit | Value |
| --- | --- |
| Default body limit | 256 KiB (per-route overrides: sources 1,516,384 bytes = 250,000 chars × 6 + 16 KiB (`MAX_CAPTURE_REQUEST_BYTES`), drafts 1,114,112 bytes = 1 MiB catalog + 64 KiB (`MAX_DRAFT_REQUEST_BYTES`), apply 192 KiB, extraction 4 KiB, publish 16 KiB) |
| Request / connection timeout | 10 s / 10 s |
| Review rate limit | 60 requests/min per IP per process (in-memory, `trustProxy` off); `POST /sources` 600/min (one draft's sources) |
| Catalog read timeout | 7 s (`AbortSignal.timeout`) |
| Catalog read cap | 2 MiB for the Data API row (`MAX_CATALOG_READ_BYTES`; JSONB text adds spaces); the catalog itself ≤ 1 MiB for v3 |
| Request log fields | request ID, route template, method, status, duration (no bodies, tokens or source text) |

## Routes

| Route | Handler | Auth |
| --- | --- | --- |
| `GET /health` | [`app.ts:createApp`](../../apps/api/src/app.ts) | none; liveness only |
| `GET /v1/catalog` | `createApp` + [`catalog-repository.ts:createCatalogRepository`](../../apps/api/src/catalog-repository.ts) | none |
| `GET /v1/review/` | [`review-routes.ts:reviewRoutes`](../../apps/api/src/review-routes.ts) | bearer |
| `GET /v1/review/drafts/:id` | `get_catalog_review_summary`: draft, head, snapshot, source metadata without text | bearer |
| `GET /v1/review/drafts/:id/sources/:sourceId` | `get_catalog_review_source`: one capture attached to the draft, with text | bearer |
| `POST /v1/review/sources` | | bearer |
| `POST /v1/review/drafts`, `PUT /v1/review/drafts/:id` | | bearer |
| `POST /v1/review/drafts/:id/publish` | | bearer |
| `POST /v1/review/drafts/:id/extractions` | [`curation/service.ts:startReviewedExtraction`](../../apps/api/src/curation/service.ts) | bearer; 503 when curation disabled |
| `GET /v1/review/drafts/:id/extractions[/:runId]` | [`curation/review.ts`](../../apps/api/src/curation/review.ts) | bearer |
| `POST /v1/review/drafts/:id/extractions/:runId/apply` | | bearer |
| `GET /v1/review/runs/:id` | | bearer |
| `GET /review/config.json`, `/review/*` | [`review-site.ts:reviewSite`](../../apps/api/src/review-site.ts) | none (static) |
| `/*` | [`public-site.ts:publicSite`](../../apps/api/src/public-site.ts) | none (static) |

## How it works

- **Catalog.** One PostgREST query reads `catalog_head?singleton=eq.true` joined to its `catalog_releases` row through `catalog_head_release_sequence_fkey`, so head and snapshot come from one statement (read with a 2 MiB cap, so a 1 MiB v3 catalog is served; 793,160 bytes for the synthetic 180-card catalog on the local stack). The result is parsed with `publishedReleaseSchema` and rechecked against the clock; a timeout, malformed body, inconsistent head, or expired/future release returns `503 {"error":"catalog_unavailable"}`. Responses carry `Cache-Control: no-store`, `nosniff`. Bodies are read with `readBoundedJson` from `@ai-checkout/catalog-client`.
- **Review auth.** Every `/v1/review/*` request needs `Authorization: Bearer <access token>`. [`review-repository.ts`](../../apps/api/src/review-repository.ts) calls the public RPC wrappers with that token; the Data API verifies the JWT and the private functions check reviewer membership and a live session ([Database](database.md#authority)). The draft review is the body-free summary RPC; the extraction routes still read `get_catalog_review` with full capture text. Errors map to stable codes (`sign_in_required`, `reviewer_access_required`, `invalid_request`, `review_changed` → 409, `draft_not_found`, `source_not_found`, `invalid_catalog_evidence`, `too_many_requests`, `review_unavailable`); SQL messages never pass through. No CORS, no cookies.
- **Extraction.** Disabled by default. When enabled, the route verifies the token through the signed review RPC, loads captures from the exact draft revision, and runs [`executeRecordedExtraction`](../../apps/api/src/curation/ledger.ts) with a 75 s route abort above the kernel's own deadlines; client disconnect and SIGTERM cancel it. Ledger errors map to 403/409/422/429/503. Details: [Curation harness](curation-harness.md).
- **Static contexts.** Each static build is its own Fastify plugin with its own `onSend` headers and [`static-errors.ts:staticErrorHandling`](../../apps/api/src/static-errors.ts) (403/404 → JSON 404 that never echoes the path; other 4xx keep status; 5xx → 500). `/review/config.json` exposes only the Supabase origin and a `sb_publishable_` key (validated by `reviewConfigSchema`, which rejects secret or legacy JWT keys).

## Security headers

| Context | CSP | Other |
| --- | --- | --- |
| Review app | `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' <supabase origin>; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'` | `Referrer-Policy: no-referrer`, `nosniff`, `Cache-Control: no-store` |
| Public site | Same, with `connect-src 'self'` (`SITE_CSP`) | `no-referrer`, `nosniff`, `Cross-Origin-Opener-Policy: same-origin`; `/assets/*` 200/304 cached `immutable` for a year, everything else `no-cache` |
| API JSON | none | `no-store`, `nosniff` on catalog and review routes |

## Gotchas

- Route precedence does not depend on registration order: Fastify prefers static and prefixed routes over the site's `/*` wildcard, and the site's `allowedPath` also refuses `/v1`, `/review`, `/health` (case-insensitive), so an unknown API path is a JSON 404, never a page. Covered by `tests/public-site.test.ts` over a real socket.
- Rate limits are per process and per socket IP; behind Render's proxy all clients may share one IP. The ledger enforces durable global limits separately.
- `fixture-refusal` refuses to start unless both `CURATION_DATABASE_URL` and `SUPABASE_URL` are loopback.
- `/health` returning 200 says nothing about the database.
- The API README's statements "No hosted API is deployed yet" and "202 tests" are stale relative to the code and [`render.yaml`](../../render.yaml) as of 2026-10-02.

## Tests

`apps/api/tests/`: `catalog.test.ts`, `review.test.ts`, `review-site.test.ts`, `public-site.test.ts`, `curation.test.ts`, `curation-http.test.ts`, `openai.test.ts`, `codex.test.ts`, `claude.test.ts`, `evaluation.test.ts`, `extraction-review.test.ts`, `extraction-v2.test.ts`, `summarize-v2.test.ts`. Integration against a real local stack: `db:test:http`, `db:test:curation:http`, `db:test:curation:application` ([Testing](testing.md)).

## Related

* [Curation harness](curation-harness.md)
* [Database](database.md)
* [Review app](review-app.md)
* [Public site](public-site.md)
* [Architecture](architecture.md)
* [Local setup](../ops/local-setup.md)
