# System

How the code works. One page per component; name code by path and symbol.

## Overview

* [Architecture](architecture.md) — components, runtimes, data stores and how they connect.
* [Code map](code-map.md) — every top-level module, what it owns, its entry points and tests.
* [Testing](testing.md) — test layers, the commands that run them, and the two CI workflows.

## Shopper side

* [Extension](extension.md) — MV3 popup, onboarding, service worker, local state and optional vault, site adapters, catalog refresh.
* [Cart badge](cart-badge.md) — automatic badge: content script, sender-based routing, isolated iframe, order detection and savings.
* [Merchant coverage design (Phase 10, draft)](merchant-coverage-design.md) — proposed hosted merchant database, generic cart reader with a real-page eval, category evidence, optional all-sites permission, consented telemetry; not built.
* [Rewards engine](rewards-engine.md) — `packages/rewards-core`: catalog v1/v2/v3 contract, bundled `CATALOG_V2` and `CATALOG_V3`, `compareRewards`, ranges and ranking.
* [UI library](ui-library.md) — `packages/ui`: React components on Helios token names with the Ocean theme, shared by all frontends.

## Maintainer side

* [API](api.md) — Fastify routes, catalog read, review auth, static hosting and security headers.
* [Curation harness](curation-harness.md) — bounded LLM extraction kernel, v1/v2 contracts, providers, budgets and ledger.
* [Evaluation](evaluation.md) — curation eval corpora, splits, variants, scorer versions, metrics, CLIs and results summary.
* [Card-expansion pipeline](card-expansion-pipeline.md) — Phase 8 v1 design (approved 2026-10-03), overview: `tools/catalog-pipeline` CLI driven by the `expand-catalog` skill and four pinned subagents; scope, commands in brief, stages, batch layout, agents, import boundary rule.
* [Card pipeline CLI commands](card-pipeline-commands.md) — what each `pipeline` command does, milestone by milestone (Phase 8 M2–M6, Phase 9 M1–M3b and M5: `freshness`, `login`, `publish`).
* [Card pipeline internals](card-pipeline-internals.md) — batch state record, input hashing and invalidation, work packets, gates and the label-evidence lint, derived queue, multi-batch builder with rule-ID continuity, resumability, freshness.
* [Catalog expansion](catalog-expansion.md) — Phase 7, done 2026-10-03: 180 researched cards of the top-10 U.S. issuers; research, capture, extraction, draft labels, findings, valuation, overlay and the first catalog v3 build (release 2).
* [Database](database.md) — Supabase schema, releases and head, private review/curation tables, RLS, `publish_catalog`, Zod parity.
* [Review app](review-app.md) — maintainer SPA for drafts, source capture, extraction review and explicit publication.
* [Public site](public-site.md) — static landing, results, architecture, privacy and support pages served at `/`.
