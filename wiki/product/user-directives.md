---
type: Product
title: User directives
description: Dated record of every explicit authorization, prohibition and preference the owner has given, with its scope and source.
status: stable
tags: [product, directives, memory]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T06:45:00Z
---

# User directives

Standing instructions from the owner, newest first. A directive stays in force until a later dated entry changes it. Agents add a row whenever the user authorizes, forbids or prefers something; non-obvious choices also get a [decision record](../decisions/index.md). The one-line versions agents must always see live in [`AGENTS.md`](../../AGENTS.md) under Project rules.

| Date | Directive | Scope | Source |
| --- | --- | --- | --- |
| 2026-10-03 | The coordinator may drive a catalog publish in the hosted review app in the browser after Evan signs in (start the draft, run the capture, review, verify, write the review note). Evan signs in, selects the capture folders and ticks the attestation himself; the attestation is never the agent's. Subagents still never touch hosted services. | Catalog release | [Catalog release runbook](../ops/catalog-release.md#assisted-flow-coordinator-drives-the-browser), chat 2026-10-03 |
| 2026-10-03 | Keep the Helios-blue cart mark (`#2563eb`) for the toolbar icons and promo tile with the Ocean theme. | Frontend, release | [Decision](../decisions/2026-10-03-keep-helios-blue-cart-mark.md) |
| 2026-10-02 | Use the Ocean theme (Mint layout: navy hero, pale sky page, sky accent; Bricolage Grotesque and Figtree) on the popup, badge, review app and site. Helios is not fixed; the best-looking UI wins. | Frontend | [Decision](../decisions/2026-10-02-ocean-theme.md), chat 2026-10-02 |
| 2026-10-02 | Card expansion runs from a natural-language request to the coding agent ("expand to issuer X, these cards") through the whole pipeline up to publish; publishing stays Evan's click. Shape: deterministic CLI in `tools/catalog-pipeline`, `expand-catalog` skill, researcher/verifier/adjudicator subagents; product code never imports `tools/`. A merchant-expansion pipeline follows the same pattern. | Catalog pipeline | [Design draft](../system/card-expansion-pipeline.md), [decision (proposed)](../decisions/2026-10-02-agent-driven-card-pipeline.md) |
| 2026-10-02 | Finish Phase 7 Stage 2 completely: the expansion corpus becomes a published catalog the extension ranks correctly, docs current, ready for the card-expansion pipeline. Then a card-expansion pipeline (CLI, skill, subagents), then a merchant-expansion pipeline, then the Web Store release and terms-change detection. | Roadmap | [Stage 2 plan](phase-7-stage-2.md), chat 2026-10-02 |
| 2026-10-02 | Value points with published cents-per-point estimates per rewards program, labelled as estimates with source and date; the shopper can override per program; issuer-stated cash values take precedence over estimates; rank by cash-equivalent value. | Catalog, engine, extension | [Decision](../decisions/2026-10-02-points-valuation-published-estimates.md) |
| 2026-10-02 | Keep every merchant and store card in the expansion, including the four Key Rewards cards. | Catalog | Chat, 2026-10-02 |
| 2026-10-02 | Defer the human spot-check of the agent-verified labels. | Labels | Chat, 2026-10-02 |
| 2026-10-02 | Move curation to gpt-5.6-luna at `xhigh` effort to keep the app on frontier models. | LLM, curation | [Decision](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md) |
| 2026-10-02 | The wiki is for development. Do not distill, move or edit the Chrome Web Store extension's public docs (`docs/release/`, `docs/verification/`, `extension/README.md`); link to them. Package READMEs stay intact. | Documentation | Chat, 2026-10-02 |
| 2026-10-02 | Keep every `CLAUDE.md` gitignored (local assistant notes), including the root importer. | Repo config | Chat, 2026-10-02 |
| 2026-10-02 | Keep project knowledge in `wiki/`; agents read `now.md` first and update the wiki last. | All agents, all tasks | [Decision](../decisions/2026-10-02-llm-wiki-documentation.md) |
| 2026-10-01 | Card expansion scope: top-10 U.S. issuers (Chase, Amex, Citi, Capital One, Bank of America, Wells Fargo, Discover, U.S. Bank, Barclays, Synchrony); personal rewards, co-branded, student and secured cards; no business cards. | Catalog | [Decision](../decisions/2026-10-01-top-ten-issuer-card-expansion.md) |
| 2026-10-01 | Do not worry about subscription usage limits; run more model calls concurrently. | LLM runs | Chat, 2026-10-01 |
| 2026-10-01 | Automatic zero-click cart badge: a small badge only, local-first, no account, optional vault off by default, savings from detected completed orders. | Extension | [Decision](../decisions/2026-10-01-automatic-cart-badge.md) |
| 2026-10-01 | Evan publishes catalog releases himself in the hosted review app; publication is a deliberate human approval. | Catalog | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-30 | One branch and one PR per milestone, cut from the latest `main`; Evan (or the authorized coordinating session) merges. Render auto-deploys `main`. | Git workflow | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-30 | Never edit an applied Supabase migration; add a new one. Migrations reach hosted only via `./scripts/db-push.sh`, run by Evan or the authorized coordinating session. | Database | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-29 | The coordinating session may merge PRs and deploy (push `main`, run `./scripts/db-push.sh`). Subagents still never merge, push `main` or push migrations. Signing in to hosted services and publishing catalogs remain Evan's. | Git workflow, hosting | Chat, 2026-09-29 |
| 2026-09-29 | No local models. Claude models run through Claude Code CLI subagents, OpenAI models through Codex. | LLM | Chat, 2026-09-29 |
| 2026-09-29 | Verification and review steps are done by independent subagents and adjudicated by the agent, not handed to Evan; record provenance honestly (`agent-verified`, not `human-verified`). | Reviews, labels | Chat, 2026-09-29 |
| 2026-09-29 | Never re-capture issuer pages (hashes invalidate labels), never edit corpus labels to fit results, never tune prompts on held-out. | Evals | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Captured issuer text is copyrighted: keep captures gitignored; commit only URLs, hashes, labels and quotes of 25 words or fewer. | Evals, docs | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Live model calls only through the Codex / Claude Code subscription CLIs, locally; no paid API calls; never on Render. | LLM | [Decision](../decisions/2026-09-28-subscription-cli-providers-local-only.md) |
| 2026-09-28 | The agent never signs in to hosted services, never types API keys or passwords (Evan pastes secrets), never creates accounts, never permanently deletes data, never places orders on retailer sites. | All agents | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Prioritize measurable LLM results; add product schema only where the product needs it; no hedge-heavy agent-log docs. | Scope, docs | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Use Helios via tokens and our own components; no HashiCorp logos or branding, no implied affiliation. Look replaced by the Ocean theme on 2026-10-02. | Frontend | [Decision](../decisions/2026-09-28-helios-design-system.md) |
