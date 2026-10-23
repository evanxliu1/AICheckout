# System

How the code works. One page per component; name code by path and symbol.

## Overview

* [Architecture](architecture.md) — components, runtimes, data stores and how they connect.
* [Code map](code-map.md) — every top-level module, what it owns, its entry points and tests.
* [Testing](testing.md) — test layers, the commands that run them, and the two CI workflows.

## Shopper side

* [Extension](extension.md) — MV3 popup, onboarding, service worker, local state and optional vault, the generic cart reader, store matching, catalog refresh.
* [Cart badge](cart-badge.md) — automatic badge on every https cart or checkout page: content script, sender-based routing, isolated iframe, amount and rates views.
* [Telemetry and value metrics design](telemetry-design.md) — consented telemetry, ingest and retention, value metrics and data room, affiliate rules: design rationale; the minimal set shipped in Release A, the rest is Phase 17.
* [Rewards engine](rewards-engine.md) — `packages/rewards-core`: catalog v1/v2/v3 contract, bundled `CATALOG_V2` and `CATALOG_V3`, `compareRewards`, ranges and ranking.
* [UI library](ui-library.md) — `packages/ui`: React components on Helios token names with the Ocean theme, shared by all frontends.

## Maintainer side

* [API](api.md) — Fastify routes, catalog read, review auth, static hosting and security headers.
* [Curation harness](curation-harness.md) — bounded LLM extraction kernel, v1/v2 contracts, providers, budgets and ledger.
* [Evaluation](evaluation.md) — curation eval corpora, splits, variants, scorer versions, metrics, CLIs and results summary.
* [Card-expansion pipeline](card-expansion-pipeline.md) — overview: `tools/catalog-pipeline` CLI driven by the `expand-catalog` skill and four pinned subagents; scope, commands in brief, stages, batch layout, agents, import boundary rule.
* [Merchant pipeline](merchant-pipeline.md) — the frozen two-tier candidate list, the tier-A builder and the `pipeline merchants` stages (research and verify packets, capture with issuer mining, luna draft `merchant-draft.2`, deterministic apply with the evidence and hold-out rules, build and `review.md`).
* [Card pipeline CLI commands](card-pipeline-commands.md) — what each `pipeline` command does, its inputs and its gates.
* [Card pipeline internals](card-pipeline-internals.md) — batch state record, input hashing and invalidation, work packets, gates and the label-evidence lint, derived queue, multi-batch builder with rule-ID continuity, resumability, freshness.
* [Reward-program valuation](reward-program-valuation.md) — the table of rewards programs, value bases (cash, published estimate, issuer-stated, none), checks and per-program values.
* [Database](database.md) — Supabase schema, releases and head, private review/curation tables, RLS, `publish_catalog`, Zod parity.
* [Review app](review-app.md) — maintainer SPA for drafts, source capture, extraction review and explicit publication.
* [Public site](public-site.md) — static landing, results, architecture, privacy, support, credits (`/credits/`) and uninstall (`/uninstalled/`) pages served at `/`.
