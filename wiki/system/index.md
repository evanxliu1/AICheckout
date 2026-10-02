# System

How the code works. One page per component; name code by path and symbol.

## Overview

* [Architecture](architecture.md) — components, runtimes, data stores and how they connect.
* [Code map](code-map.md) — every top-level module, what it owns, its entry points and tests.
* [Testing](testing.md) — test layers, the commands that run them, and the two CI workflows.

## Shopper side

* [Extension](extension.md) — MV3 popup, onboarding, service worker, local state and optional vault, site adapters, catalog refresh.
* [Cart badge](cart-badge.md) — automatic badge: content script, sender-based routing, isolated iframe, order detection and savings.
* [Rewards engine](rewards-engine.md) — `packages/rewards-core`: catalog v1/v2 contract, `compareRewards`, ranges and ranking.
* [UI library](ui-library.md) — `packages/ui`: Helios-token React components shared by all frontends.

## Maintainer side

* [API](api.md) — Fastify routes, catalog read, review auth, static hosting and security headers.
* [Curation harness](curation-harness.md) — bounded LLM extraction kernel, v1/v2 contracts, providers, budgets and ledger.
* [Evaluation](evaluation.md) — curation eval corpora, splits, variants, scorer versions, metrics, CLIs and results summary.
* [Card-expansion pipeline (design draft)](card-expansion-pipeline.md) — Phase 8 design: `tools/catalog-pipeline` CLI with per-card state, input hashing, gates, review queue and hash-only freshness, driven by the `expand-catalog` skill and subagents; import boundary rule.
* [Catalog expansion](catalog-expansion.md) — Phase 7, in progress: 180 cards of the top-10 U.S. issuers; research, capture, extraction, draft labels, findings and remaining work.
* [Database](database.md) — Supabase schema, releases and head, private review/curation tables, RLS, `publish_catalog`, Zod parity.
* [Review app](review-app.md) — maintainer SPA for drafts, source capture, extraction review and explicit publication.
* [Public site](public-site.md) — static landing, results, architecture, privacy and support pages served at `/`.
