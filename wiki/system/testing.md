---
type: System Component
title: Testing
description: Test layers in AI Checkout (unit, contract parity, SQL, signed HTTP, browser, accessibility, eval checks), the commands that run each, and the two CI workflows.
status: stable
tags: [system, testing, ci]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:10:00Z
sources:
  - resource: ../../package.json
    title: Root scripts
  - resource: ../../.github/workflows/extension.yml
    title: Application checks workflow
  - resource: ../../.github/workflows/database.yml
    title: Database checks workflow
  - resource: ../../.githooks/pre-commit
    title: Pre-commit hook
  - resource: ../../extension/playwright.config.ts
    title: Extension Playwright config
  - resource: ../../extension/e2e/global-setup.ts
    title: Extension e2e build
---

# Testing

Tests run at seven layers: Vitest unit/component tests per workspace; shared catalog cases run through both the Zod and SQL validators; pgTAP inside a real local Supabase; signed-session HTTP tests against the compiled API; Playwright browser tests (including a packaged-extension run and axe accessibility checks); fixture-provider evaluation checks; and the wiki linter. Nothing in CI calls a model or a hosted service. Two GitHub Actions workflows run on every push and pull request.

Verified 2026-10-02 by reading the workflows and scripts, and by running the unit layer locally (results below). The database, HTTP and browser layers were not run for this page.

## Layers and commands

| Layer | Command (from repo root) | Needs |
| --- | --- | --- |
| All workspace unit tests + script tests | `npm test` | Node 24 |
| Extension unit (vitest + package inspection) | `npm test --workspace=ai-checkout-extension` | |
| API unit | `npm test --workspace=@ai-checkout/api` | |
| Review / site / ui unit | `npm test --workspace=@ai-checkout/review` (or `/site`, `/ui`) | |
| Script unit tests | `npm run test:scripts` (`scripts/lib/*.test.mjs`) | Includes `import-boundary.test.mjs`, which lints sample imports with the real ESLint config: product code may not import `tools/` or `@ai-checkout/catalog-pipeline` ([pipeline design](card-expansion-pipeline.md#boundary-rule)) |
| Lint, format, types | `npm run lint`, `npm run format:check`, `npm run typecheck` | |
| Generated files current | `npm run catalog:v2:check`, `npm run db:seed:check` | |
| Eval plumbing (no model) | `npm run eval:curation -- --check`, `npm run eval:v2 -- --check` | |
| SQL (pgTAP) | `npm run db:test` | Docker, `npm run db:start:api` |
| Zod/SQL parity | `npm run db:test:catalog` | local DB |
| Concurrency | `npm run db:test:concurrency`, `npm run db:test:curation` | local DB |
| Signed HTTP | `npm run db:test:http`; `db:test:curation:http` and `db:test:curation:application` (build api and review first) | local Auth/Data API |
| DB lint and advisors | `npm run db:lint`, `npm run db:advisors` | local DB |
| Extension browser | `npm run test:browser --workspace=ai-checkout-extension` | `npx playwright install chromium` |
| Hosted-catalog refresh (local HTTPS stub) | `npm run test:catalog:browser` | |
| Packaged zip | `npm run test:package:browser --workspace=ai-checkout-extension` | |
| Review browser (real stack) | `npm run test:browser --workspace=@ai-checkout/review` | built api + review, local stack |
| Review a11y (mocked API) | `npm run test:browser --workspace=@ai-checkout/review -- e2e/a11y.spec.ts` | built review |
| UI gallery a11y | `npm run test:browser --workspace=@ai-checkout/ui` | |
| Site a11y | `npm run test:browser --workspace=@ai-checkout/site` | built api + site |
| Wiki | `python3 scripts/lint_wiki.py` | Python 3 |

Local results on 2026-10-02 at `f6d3f79`:

| Suite | Files | Tests | Result |
| --- | --- | --- | --- |
| extension vitest | 21 | 366 | pass |
| extension `scripts/package.test.mjs` | 1 | 5 | pass |
| api vitest | 13 | 250 | pass |
| review vitest | 6 | 41 | pass |
| site vitest | 2 | 9 | pass |
| ui vitest (+ icon check) | 1 | 36 | pass |
| `test:scripts` | 1 | 8 | pass |

Re-run on 2026-10-02 at `7322dec` (after PRs #13 and #14), all pass: extension vitest 21 files / 378 tests, extension package test 6, api 13 / 250, review 6 / 41, site 2 / 9, ui 1 / 36, `test:scripts` 8.

## CI

| Workflow | Name | Steps in order |
| --- | --- | --- |
| [`extension.yml`](../../.github/workflows/extension.yml) | Application checks | wiki lint; `npm ci`; lint; format:check; typecheck; `npm test`; `eval:curation --check`; `eval:v2 --check`; `catalog:v2:check`; `npm audit --audit-level=high`; build; Playwright install; review a11y; ui browser; site browser; extension browser; `test:catalog:browser`; `test:package:browser`; uploads `chrome-extension` and `browser-test-results` artifacts |
| [`database.yml`](../../.github/workflows/database.yml) | Database checks | `npm ci`; audit; `db:seed:check`; `db:start:api`; `db:test`; `db:test:concurrency`; `db:test:catalog`; `db:test:http`; `db:test:curation`; build api + review; `db:test:curation:http`; `db:test:curation:application`; review browser; `db:lint`; `db:advisors`; stop |

Both trigger on every `push` and `pull_request`. The wiki-lint step and the pre-commit hook were added with the `llm-wiki` branch on 2026-10-02. The pre-commit hook in [`.githooks/pre-commit`](../../.githooks/pre-commit) runs only the wiki linter. Enable it with `git config core.hooksPath .githooks`; in Evan's clone it is already set in the shared `.git/config`, so it applies to every worktree. The path is relative to each worktree, and Git silently skips a hook file that does not exist, so worktrees on branches without `.githooks/` (anything not yet merged with the wiki) run no pre-commit hook at all.

## How the browser layer works

- Extension specs load the unpacked build into Chromium. [`e2e/global-setup.ts`](../../extension/e2e/global-setup.ts) builds `dist-e2e` with `VITE_E2E_CATALOG_DATE` set to yesterday (UTC) so the bundled catalog is always valid; the release `dist/` used by package and release-asset specs is never re-dated.
- Merchant pages are fixtures served at the real hosts through `context.route` ([`e2e/badge.spec.ts`](../../extension/e2e/badge.spec.ts)); no live retailer is contacted. [`e2e/hosts.ts`](../../extension/e2e/hosts.ts) derives the expected permission set from the adapters.
- `e2e/lifecycle.spec.ts` covers popup closure and worker shutdown; `e2e/package.spec.ts` inspects the packaged zip's manifest and permissions.
- Review and site specs start the compiled API on an ephemeral loopback port so pages load under production headers; review real-stack specs create and delete disposable local accounts.

## Gotchas

- Node type-stripping in `scripts/test-*.mjs` needs explicit `.ts` import specifiers and no TS parameter properties.
- `db:test:curation:http` and `db:test:curation:application` require `npm run build` of api and review first.
- The HTTP and concurrency scripts are fixed to local ports 54321/54322 and ignore hosted credentials by design.
- `e2e/portfolio-demo.spec.mjs` is skipped unless `PORTFOLIO_DEMO=1`.
- Passing tests verify harness and contract behaviour, not model quality; model results belong to [Evaluation](evaluation.md).

## Related

* [Code map](code-map.md)
* [Database](database.md)
* [Extension](extension.md)
* [Local setup](../ops/local-setup.md)
