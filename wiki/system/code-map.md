---
type: System Component
title: Code map
description: Every top-level module or package in AI Checkout, what it owns, its entry points and its tests.
status: stable
tags: [system, code-map]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:05:00Z
sources:
  - resource: ../../package.json
    title: Root workspaces and scripts
  - resource: ../../extension/package.json
    title: Extension package
  - resource: ../../apps/api/package.json
    title: API package
  - resource: ../../scripts
    title: Root scripts
---

# Code map

One npm workspace repo (`extension`, `packages/*`, `apps/*`), Node 24, TypeScript, Zod 4 everywhere. Packages are consumed as TypeScript source (`exports` points at `src/*.ts`); only the API is bundled for Node (esbuild). Built from reading the tree at commit `f6d3f79` on 2026-10-02.

## Workspaces

| Path | npm name | Owns | Entry points | Tests | Page |
| --- | --- | --- | --- | --- | --- |
| [`extension/`](../../extension) | `ai-checkout-extension` | MV3 extension: popup, onboarding, worker, state/vault, site adapters, cart badge | [`src/background/index.ts`](../../extension/src/background/index.ts), [`src/popup/index.html`](../../extension/src/popup/index.html), [`src/badge/content.ts`](../../extension/src/badge/content.ts), [`src/checkout/content.ts`](../../extension/src/checkout/content.ts) | `extension/tests/*.test.ts(x)` (vitest), `extension/e2e/*.spec.ts` (Playwright), `scripts/package.test.mjs` | [Extension](extension.md), [Cart badge](cart-badge.md) |
| [`packages/rewards-core/`](../../packages/rewards-core) | `@ai-checkout/rewards-core` | Catalog schemas v1/v2, engine, money math, bundled catalogs, parity cases | [`src/index.ts`](../../packages/rewards-core/src/index.ts), `./money` subpath | No own runner; covered by `extension/tests/rewards*.test.ts`, `catalog-schema.test.ts`, `scripts/test-catalog-parity.mjs` | [Rewards engine](rewards-engine.md) |
| [`packages/catalog-client/`](../../packages/catalog-client) | `@ai-checkout/catalog-client` | `createCatalogFetcher`, `readBoundedJson` (size-capped JSON read) | [`src/index.ts`](../../packages/catalog-client/src/index.ts) | `extension/tests/catalog-refresh.test.ts`, `apps/api/tests/catalog.test.ts` | [Extension](extension.md#catalog-refresh) |
| [`packages/catalog-review/`](../../packages/catalog-review) | `@ai-checkout/catalog-review` | Browser-safe Zod contracts: review RPC input/output, `MAX_SOURCE_BODY_CHARS`, extraction v1 schema, trace, `limitsSchema` | [`src/index.ts`](../../packages/catalog-review/src/index.ts), [`src/curation.ts`](../../packages/catalog-review/src/curation.ts) | Through API and review tests | [API](api.md), [Curation harness](curation-harness.md) |
| [`packages/ui/`](../../packages/ui) | `@ai-checkout/ui` | React components (Helios specs, Ocean theme), generated Flight icons, gallery | [`src/index.ts`](../../packages/ui/src/index.ts), `./styles.css` | `tests/components.test.tsx`, `e2e/gallery.spec.ts` (axe) | [UI library](ui-library.md) |
| [`apps/api/`](../../apps/api) | `@ai-checkout/api` | Fastify server, catalog/review repositories, static hosting, curation harness | [`src/index.ts`](../../apps/api/src/index.ts) → [`src/app.ts:createApp`](../../apps/api/src/app.ts) | `apps/api/tests/*.test.ts` (vitest) + root `db:test:*` scripts | [API](api.md), [Curation harness](curation-harness.md) |
| [`apps/review/`](../../apps/review) | `@ai-checkout/review` | Maintainer review SPA | [`src/main.tsx`](../../apps/review/src/main.tsx) | `tests/*.test.ts(x)`, `e2e/*.spec.*` | [Review app](review-app.md) |
| [`apps/site/`](../../apps/site) | `@ai-checkout/site` | Static public site, pre-rendered with React | [`src/render.tsx`](../../apps/site/src/render.tsx), [`vite.config.ts`](../../apps/site/vite.config.ts) | `tests/*.test.ts(x)`, `e2e/a11y.spec.ts` | [Public site](public-site.md) |

## Non-workspace directories

| Path | Owns | Page |
| --- | --- | --- |
| [`supabase/`](../../supabase) | `config.toml`, 8 migrations, generated `seed.sql`, pgTAP tests in `supabase/tests/` | [Database](database.md) |
| [`evals/curation/`](../../evals/curation) | v1 synthetic corpus, v2 fixture and real corpora (captures gitignored), matrix configs | [Evaluation](evaluation.md) |
| [`docs/evals/`](../../docs/evals) | Committed results (`results.json`, `results.md`, SVG charts); the site copies them at build | [Evaluation](evaluation.md), [Public site](public-site.md) |
| [`scripts/`](../../scripts) | Root Node scripts (below) and [`lint_wiki.py`](../../scripts/lint_wiki.py) | [Testing](testing.md) |
| [`.github/workflows/`](../../.github/workflows) | `extension.yml` ("Application checks") and `database.yml` ("Database checks") | [Testing](testing.md#ci) |
| [`.githooks/pre-commit`](../../.githooks/pre-commit) | Runs `python3 scripts/lint_wiki.py` | [Testing](testing.md) |
| [`render.yaml`](../../render.yaml) | Render blueprint for the single hosted service | [Architecture](architecture.md) |

## Root scripts

| Script | npm alias | Purpose |
| --- | --- | --- |
| [`build-catalog-v2.mjs`](../../scripts/build-catalog-v2.mjs) | `catalog:v2`, `catalog:v2:check` | Generates `packages/rewards-core/src/catalog-v2.ts` from gold labels; `--check` fails if stale |
| [`generate-db-seed.mjs`](../../scripts/generate-db-seed.mjs) | `db:seed:generate`, `db:seed:check` | Writes `supabase/seed.sql` (one unapproved draft of the bundled v2 catalog) |
| [`test-catalog-parity.mjs`](../../scripts/test-catalog-parity.mjs) | `db:test:catalog` | Runs shared cases through Zod and SQL validators |
| [`test-catalog-http.mjs`](../../scripts/test-catalog-http.mjs) | `db:test:http` | Signed-session review/publish flow over HTTP |
| [`test-db-concurrency.mjs`](../../scripts/test-db-concurrency.mjs) | `db:test:concurrency` | Multi-connection publication races |
| [`test-curation-ledger.mjs`](../../scripts/test-curation-ledger.mjs) | `db:test:curation` | Ledger orchestrator races against the scoped role |
| [`test-curation-http.mjs`](../../scripts/test-curation-http.mjs) | `db:test:curation:http` | Compiled API, signed sessions, dedicated login, intercepted SDK |
| [`test-curation-application.mjs`](../../scripts/test-curation-application.mjs) | `db:test:curation:application` | Concurrent extraction application with real locks |
| [`test-catalog-browser.mjs`](../../scripts/test-catalog-browser.mjs) | `test:catalog:browser` | Builds a test extension pointing at a local HTTPS catalog and runs `e2e/catalog.spec.ts` |
| [`evaluate-curation.mjs`](../../scripts/evaluate-curation.mjs), [`evaluate-curation-v2.mjs`](../../scripts/evaluate-curation-v2.mjs) | `eval:curation`, `eval:v2` | v1/v2 evaluation CLIs |
| [`run-eval-matrix.mjs`](../../scripts/run-eval-matrix.mjs), [`summarize-evals.mjs`](../../scripts/summarize-evals.mjs) | `eval:matrix`, `eval:summarize` | Resumable matrix runner; aggregate results into `docs/evals/` |
| [`capture-issuer-pages.mjs`](../../scripts/capture-issuer-pages.mjs), [`author-real-corpus.mjs`](../../scripts/author-real-corpus.mjs), [`author-curation-corpus.mjs`](../../scripts/author-curation-corpus.mjs), [`build-verification-page.mjs`](../../scripts/build-verification-page.mjs) | none | Corpus capture and authoring |
| [`build-release-media.mjs`](../../scripts/build-release-media.mjs), [`build-portfolio-demo.mjs`](../../scripts/build-portfolio-demo.mjs), [`render-full-stack-demo.mjs`](../../scripts/render-full-stack-demo.mjs) | `release:media`, `release:portfolio` | Screenshot and video generation |
| [`db-push.sh`](../../scripts/db-push.sh) | none | Pushes new migrations to the linked hosted project (operator only) |

## Related

* [Architecture](architecture.md)
* [Testing](testing.md)
* [Local setup](../ops/local-setup.md)
