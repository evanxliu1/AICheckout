---
okf_version: "0.2"
---

# AI Checkout wiki

The project's long-term memory. Start with [`now.md`](now.md), then the directory you need. Schema: [`AGENTS.md`](../AGENTS.md) and [guides](guides/index.md). History: [`log.md`](log.md).

## Start here

* [now.md](now.md) — current state, active work, open questions, next steps (working memory).
* [Goal](product/goal.md) — why the project exists and who it serves.
* [Architecture](system/architecture.md) — components, runtimes and how they connect.
* [Code map](system/code-map.md) — every module and what it owns.
* [User directives](product/user-directives.md) — dated record of what the owner authorized, forbade or prefers.

## Directories

* [product/](product/index.md) — goal, users, workflow, user directives, roadmap.
* [domain/](domain/index.md) — problem-domain rules, terminology and data semantics.
* [system/](system/index.md) — architecture, code map and component pages.
* [ops/](ops/index.md) — runbooks: setup, deploy, maintenance.
* [decisions/](decisions/index.md) — dated decision records with context, options, decision, consequences, status.
* [reviews/](reviews/index.md) — audits and code reviews.
* [guides/](guides/index.md) — how to use, document, track changes, archive.
* [archive/](archive/index.md) — immutable superseded documents.

## Outside the wiki

* [`README.md`](../README.md) — human entry point and quickstart.
* [`AGENTS.md`](../AGENTS.md) — agent instructions (Codex and Cursor read it directly; Claude Code through a local, gitignored `CLAUDE.md`).
* `.cursor/rules/agents.mdc` — Cursor rule pointing at `AGENTS.md`.
* Package READMEs, kept as package entry points: [api](../apps/api/README.md), [curation harness](../apps/api/src/curation/README.md), [review app](../apps/review/README.md), [site](../apps/site/README.md), [rewards-core](../packages/rewards-core/README.md), [ui](../packages/ui/README.md), [supabase](../supabase/README.md), [supabase curation](../supabase/CURATION.md), [evals](../evals/curation/README.md).
* Design-tool files: [`extension/DESIGN.md`](../extension/DESIGN.md), [`apps/review/DESIGN.md`](../apps/review/DESIGN.md) and their `.impeccable/` sidecars.
* Generated eval results, read by the site build: [`docs/evals/results.md`](../docs/evals/results.md).
* Research report on the seven cards' terms: [`docs/research/cashback-card-terms-2026.md`](../docs/research/cashback-card-terms-2026.md).
* Chrome Web Store extension docs (public and release material, not development docs): [`docs/release/`](../docs/release/README.md), [`docs/verification/`](../docs/verification/), [`extension/README.md`](../extension/README.md).
