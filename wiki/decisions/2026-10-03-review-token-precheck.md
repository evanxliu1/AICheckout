---
type: Decision
title: The API checks the review token before reading large bodies
description: Stage 2 M10 adds an onRequest token pre-check on the review routes that take ~1.1–1.5 MB bodies, verified locally against the project's JWKS when the project signs with asymmetric keys and otherwise by asking Supabase Auth, with no new environment variable.
status: accepted
tags: [decision, api, security, review]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T02:00:00Z
sources:
  - resource: ../../apps/api/src/review-auth.ts
    title: createTokenVerifier
  - resource: ../../apps/api/src/review-routes.ts
    title: signedIn onRequest hook
  - resource: ../../apps/api/tests/review-auth.test.ts
    title: Verifier tests
  - resource: ../../apps/api/tests/review.test.ts
    title: Route ordering tests (401 before 413, real socket)
  - resource: ../../scripts/test-catalog-http.mjs
    title: Local-stack check with forged and non-reviewer tokens
---

# The API checks the review token before reading large bodies (2026-10-03)

## Context
Stage 2 M8 raised the review body limits to 1,516,384 bytes for `POST /v1/review/sources` and 1,114,112 bytes for draft saves, and allowed 200 captures a minute. The API only had a format check on the bearer header; the database verified the token after the API had read the whole body and forwarded it to the Data API. The M8 review flagged that anyone could push ~1.5 MB bodies through Render to Supabase at that rate. The hosted project's JWKS (`/auth/v1/.well-known/jwks.json`) was empty on 2026-10-03: it signs access tokens with the legacy HS256 secret. The local CLI stack (v2.118) signs ES256 and publishes its key.

## Options considered
| Option | Chosen | Why not |
| --- | --- | --- |
| Verify ES256/RS256 locally against the cached JWKS; otherwise ask `GET /auth/v1/user`, cache a valid answer 60 s; run in `onRequest` on the large-body routes | Yes | — |
| Put the HS256 JWT secret on Render and verify locally | | The secret mints tokens for any user and role; the project rule keeps privileged keys off Render |
| Ask Auth on every request, no local path | | A network call per capture even after the project moves to asymmetric keys |
| Pre-check every review route | | Read routes and small bodies gain nothing; the database already verifies them |
| Lower the body limits or rate | | The real captures need them (largest 204,334 characters) |

## Decision
`createTokenVerifier(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)` ([`review-auth.ts`](../../apps/api/src/review-auth.ts)) runs as a route `onRequest` hook on `POST /sources`, `POST /drafts`, `PUT /drafts/:id` and the extraction apply route, after the rate limit and before the body is read. A token with an expired or missing `exp` is refused without a request. An ES256/RS256 token whose `kid` is in the JWKS must verify and carry `iss` = `<SUPABASE_URL>/auth/v1`, `role` `authenticated` and a `sub`. Anything else (HS256, unknown `kid` after one refetch per minute, JWKS unreadable) is checked with `GET /auth/v1/user`; a 200 is cached by token hash for 60 s (at most 256 entries). Invalid → 401 `sign_in_required`; Auth unreachable → 503 `review_unavailable`. The database remains the authority: membership and live session are still checked in every RPC. `createApp` refuses review routes without a verifier.

## Consequences
- No new environment variable on Render. On hosted today every new token costs one Auth call (then cached a minute); switching the hosted project to asymmetric JWT signing keys in the Supabase dashboard makes the check local with no code change.
- A revoked session can pass the pre-check for up to a minute, then fails in the database as before.
- Unauthenticated callers can still send headers and are rate-limited per socket IP; they can no longer make the API read or forward a body.

## Related
* [API](../system/api.md)
* [Review app](../system/review-app.md)
* [Decision: review app for the large catalog](2026-10-02-review-large-catalog.md)
