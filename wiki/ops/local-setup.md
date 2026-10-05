---
type: Runbook
title: Local setup
description: Install, build, lint, test, run the database suite and load the extension on a development machine.
status: stable
tags: [ops, setup, testing]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:26:46Z
sources:
  - resource: ../../package.json
    title: Root scripts and Node engine
  - resource: ../../.nvmrc
    title: Node version
  - resource: ../../.github/workflows/extension.yml
    title: Application checks workflow
  - resource: ../../.github/workflows/database.yml
    title: Database checks workflow
  - resource: ../../supabase/README.md
    title: Catalog database local setup
  - resource: ../../apps/api/.env.example
    title: API environment template
  - resource: ../../apps/api/src/index.ts
    title: API environment parsing
  - resource: ../../extension/vite.config.ts
    title: Extension build config
---

# Local setup

One npm workspace (root `package-lock.json`) covers `extension/`, `packages/*`, `apps/*` and `tools/*`. Application checks need only Node and npm; the database suite needs Docker for the local Supabase stack. Commands come from [`package.json`](../../package.json) and the two CI workflows ([`extension.yml`](../../.github/workflows/extension.yml), [`database.yml`](../../.github/workflows/database.yml)), which run them in the order below.

## Prerequisites

| Tool | Version / note | Needed for |
| --- | --- | --- |
| Node | 24 ([`.nvmrc`](../../.nvmrc); `engines: ">=24 <25"`) | Everything |
| npm | Ships with Node 24 | Install, scripts |
| Docker daemon | Running | `db:*` scripts; the pinned `supabase` CLI (2.118.0) is an npm devDependency and pulls images on first start |
| Playwright Chromium | `npx playwright install chromium` (CI adds `--with-deps`) | `test:browser`, `test:catalog:browser` |
| ffmpeg, ffprobe | On `PATH` | `release:media`, `release:portfolio` only ([Release media](release-media.md)) |
| Codex CLI / Claude Code CLI | Signed in | Live evals only ([Live model runs](live-model-runs.md)) |

## Install and check

1. `nvm use` (or otherwise select Node 24).
2. `npm ci`
3. `npm run lint` (ESLint over `extension/src`, `extension/tests`, `extension/e2e`, `extension/scripts`, `packages`, `apps`, `scripts`, `tools`).
4. `npm run format:check` (Prettier; fix with `npm run format`). `docs/` and build output are excluded by [`.prettierignore`](../../.prettierignore).
5. `npm run typecheck` (every workspace's `typecheck`).
6. `npm test` (every workspace's Vitest suite, the extension package test, the `packages/ui` icon check, then `test:scripts` = `node --test scripts/lib/*.test.mjs`).
7. Offline eval gates, no model call: `npm run eval:curation -- --check`, `npm run eval:v2 -- --check`, `npm run catalog:v2:check`, `npm run catalog:v3:check`.
8. Card-expansion pipeline (maintainer only): `npm run pipeline -- status` and `npm run pipeline -- next --json`; commands in [card-expansion pipeline](../system/card-expansion-pipeline.md#built-so-far).
9. `npm run build` (every workspace's `build`; the extension lands in `extension/dist/`).
10. Browser tests, after `npx playwright install chromium`:
   - `npm run test:browser --workspace=@ai-checkout/ui`
   - `npm run test:browser --workspace=@ai-checkout/site`
   - `npm run test:browser --workspace=ai-checkout-extension`
   - `npm run test:browser --workspace=@ai-checkout/review -- e2e/a11y.spec.ts` (the other review specs need the local database)
   - `npm run test:catalog:browser`
   - `npm run test:package:browser --workspace=ai-checkout-extension` (packages the zip into `extension/artifacts/`, then tests it)

### Verified 2026-10-02

Run in the `llm-wiki` worktree on macOS with Node v24.6.0:

| Command | Result |
| --- | --- |
| `npm ci` | exit 0; 513 packages added, 0 vulnerabilities |
| `npm run lint` | exit 0 |
| `npx prettier --check .` (same as `format:check`) | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0; 714 Vitest tests in 43 files across five workspaces, plus 14 `node --test` tests (re-run at `7322dec`) |
| `npm run db:seed:check` | exit 0 ("Database seed matches the bundled catalog.") |

Not run 2026-10-02 (taken from `package.json` and CI): steps 7–9, everything that needs Docker, running the API, and loading the extension in Chrome.

## Database suite (Docker)

1. `npm run db:start:api` starts Postgres, Auth, Data API and gateway (realtime, storage, studio and other unused services excluded). `npm run db:start` starts only Postgres, for SQL-only work.
2. `npm run db:seed:check`
3. `npm run db:test` (pgTAP files in [`supabase/tests/`](../../supabase/tests/))
4. `npm run db:test:concurrency`, `npm run db:test:catalog`, `npm run db:test:http`, `npm run db:test:curation`
5. `npm run build --workspace=@ai-checkout/api && npm run build --workspace=@ai-checkout/review`, then `npm run db:test:curation:http` and `npm run db:test:curation:application`
6. `npm run test:browser --workspace=@ai-checkout/review` (full review-app suite against the local stack)
7. `npm run db:lint` and `npm run db:advisors` (fail on warning / error)
8. `npm run supabase -- stop` (keeps local volumes)

`npm run db:reset` rebuilds the **local** database from migrations and seed, discarding local data. Migration and seed procedures: [Database migrations](database-migrations.md).

## Run locally

- API: copy [`apps/api/.env.example`](../../apps/api/.env.example) to `apps/api/.env` (gitignored), point `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` at the local stack (`npm run supabase -- status` prints them), `npm run build --workspace=@ai-checkout/api`, then start `node apps/api/dist/index.js` with those variables in the environment. `GET /health` answers when it is up. Inferred from [`apps/api/src/index.ts`](../../apps/api/src/index.ts).
- Site: `npm run dev --workspace=@ai-checkout/site` (Vite). UI component gallery: `npm run gallery --workspace=@ai-checkout/ui`.
- Extension: `npm run dev --workspace=ai-checkout-extension`, or build once and load it (below).

## Load the extension in Chrome

1. `npm run build --workspace=ai-checkout-extension` (bundled catalog only), or `npm run build:hosted --workspace=ai-checkout-extension` to bake in the hosted `/v1/catalog` endpoint. A custom `VITE_CATALOG_API_URL` must be a fixed HTTPS `/v1/catalog` URL ([`extension/vite.config.ts`](../../extension/vite.config.ts)).
2. Open `chrome://extensions` and enable Developer mode.
3. Load unpacked and select `extension/dist/`.
4. After each rebuild, press reload on the extension card.

## Gotchas

- If a DB-only stack (`db:start`) is running, stop it with `npm run supabase -- stop --project-id AICheckout` before `db:start:api`; the CLI does not add services to a running stack ([`supabase/README.md`](../../supabase/README.md)).
- DB HTTP and concurrency tests are fixed to local ports 54321/54322 and never read hosted credentials.
- `db:test:curation:http` and `db:test:curation:application` need the API and review builds first.
- No model key or paid service is needed for any test.

## Related

* [Architecture](../system/architecture.md)
* [Code map](../system/code-map.md)
* [Database migrations](database-migrations.md)
* [Hosting](hosting.md)
