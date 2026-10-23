---
type: Runbook
title: Hosting
description: What runs on the Render web service and hosted Supabase, how deploys happen, and which environment variables they need.
status: stable
tags: [ops, hosting, render, supabase]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
sources:
  - resource: ../../render.yaml
    title: Render Blueprint
  - resource: ../../apps/api/src/index.ts
    title: API environment schema
  - resource: ../../apps/api/.env.example
    title: API environment template
  - resource: ../../extension/package.json
    title: build:hosted script
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived), hosted state as of 2026-09-28
---

# Hosting

One Render web service, `ai-checkout-api`, runs a single Node process that serves the catalog API (`/v1/catalog`, `/v1/review/*`), the review app (`/review/`) and the public site (`/`). Data and reviewer auth live in a hosted Supabase project. Render auto-deploys `main`; migrations reach hosted Supabase only when Evan, or the coordinating session with his authorization, runs [`scripts/db-push.sh`](../../scripts/db-push.sh). Why this setup: [decision](../decisions/2026-09-28-render-and-hosted-supabase.md).

## Facts

| Item | Value | Source |
| --- | --- | --- |
| Public URL | `https://ai-checkout-api.onrender.com` | [`extension/package.json`](../../extension/package.json) `build:hosted` |
| Plan | Render free tier; sleeps when idle, first request after sleep took ~50 s (observed 2026-09-28) | [`render.yaml`](../../render.yaml), [archive](../archive/phase2-goal.md) |
| Build | `npm ci && npm run build` for `@ai-checkout/api`, `@ai-checkout/review`, `@ai-checkout/site` | `render.yaml` |
| Start | `node apps/api/dist/index.js` | `render.yaml` |
| Health check | `/health` | `render.yaml` |
| Auto-deploy | `autoDeploy: true` on the linked branch (`main`) | `render.yaml`, [archive](../archive/phase2-goal.md) |
| Database | Hosted Supabase (Postgres, Auth, Data API); public sign-ups disabled; one provisioned reviewer (as of 2026-09-28) | [archive](../archive/phase2-goal.md) |
| Published catalog | The head release, its version and expiry: [release history](catalog-release-history.md). If it expires before a fresh one is published, `/v1/catalog` answers 503 ([catalog release](catalog-release.md)) | `GET /v1/catalog` |
| Deployed code | Render deploys `main` on merge; the deployed commit isn't exposed, so check `/health`, `/v1/catalog` and that the `/review/` bundle contains the expected catalog version | `render.yaml` |
| Auth signing | Asymmetric JWT signing keys. The JWKS (`/auth/v1/.well-known/jwks.json`) publishes one ES256 P-256 key, `kid` `695ed5b6-5d96-497a-baa2-f0e6b1765c37`, so the API's review token pre-check verifies tokens locally, with no env change ([decision](../decisions/2026-10-03-review-token-precheck.md)). The legacy HS256 secret may still be active until Evan revokes it | Public JWKS endpoint, checked 2026-10-03 |
| Request size | Neither Render nor Supabase documents a request body limit for web services or PostgREST RPC calls that the review routes approach (Cloudflare, in front of both, allows 100 MB on its free plan). Release 1 captured bodies up to 74,938 characters through this path; the largest Stage 2 capture is about 206 KB as JSON and the v3 draft save about 0.62 MB, well under the API's own limits | Docs read 2026-10-03; not exercised on hosted |

## Environment variables (names only)

Set in [`render.yaml`](../../render.yaml); the two `sync: false` entries are entered in the Render dashboard, never committed.

| Name | Where set | Meaning |
| --- | --- | --- |
| `NODE_VERSION` | Blueprint | Node 24 |
| `HOST` | Blueprint | Bind address (`0.0.0.0` on Render; defaults to `127.0.0.1`) |
| `PORT` | Render runtime | Listen port (defaults to 3000 locally) |
| `REVIEW_DIST_DIR` | Blueprint | Built review app, served at `/review/` |
| `SITE_DIST_DIR` | Blueprint | Built public site, served at `/` |
| `CURATION_ADAPTER` | Blueprint | `disabled` on Render; LLM curation never runs hosted |
| `CURATION_ALLOW_METERED` | Blueprint | `false`; no paid model calls |
| `SUPABASE_URL` | Dashboard | Hosted Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Dashboard | Public (publishable) Supabase key |

Optional variables read by [`apps/api/src/index.ts`](../../apps/api/src/index.ts) and **not** set on Render: `CURATION_DATABASE_URL`, `CURATION_DATABASE_CA_FILE`, `CURATION_PROFILE_ID`, `OPENAI_API_KEY`, `CURATION_RATE_LIMIT`. The API refuses to start with curation enabled unless the database URL and profile are set.

## How a change reaches production

1. Code merges to `main`; Render rebuilds and restarts `ai-checkout-api` (auto-deploy).
2. If the change adds a migration, Evan or the authorized coordinating session pushes it after merge ([Database migrations](database-migrations.md)). Subagents never push migrations; no agent signs in to Render or Supabase or types Evan's password (the CLI publish uses a session he logs in himself).
3. Catalog content changes only when a release is published, and only on Evan's explicit approval of that release: the coordinating session runs `pipeline publish` after his chat message, or Evan publishes in the hosted review app ([catalog release](catalog-release.md), [decision](../decisions/2026-10-05-agent-publish-cli-session.md)).
4. The extension talks to production only when built with `npm run build:hosted --workspace=ai-checkout-extension`.

Detailed procedures (deploy verification, recovery, store publishing) live outside the wiki: [`docs/release/deployment-runbook.md`](../../docs/release/deployment-runbook.md) and [`docs/release/publish-runbook.md`](../../docs/release/publish-runbook.md).

## Gotchas

- Free-tier sleep: the first request after idle is slow; health checks and Playwright runs against the hosted API must allow for it.
- In the built-in browser pane, `computer` `type` did not register in Render/Supabase dashboard inputs; `form_input` worked (2026-09-28). Agents should not be driving those dashboards anyway.
- Do not put `OPENAI_API_KEY` or any service-role key on Render; curation stays `disabled` there ([decision](../decisions/2026-09-28-subscription-cli-providers-local-only.md)).

## Related

* [Local setup](local-setup.md)
* [Database migrations](database-migrations.md)
* [Architecture](../system/architecture.md)
