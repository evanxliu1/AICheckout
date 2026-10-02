---
type: Product
title: User directives
description: Dated record of every explicit authorization, prohibition and preference the owner has given, with its scope and source.
status: stable
tags: [product, directives, memory]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T02:13:55Z
---

# User directives

Standing instructions from the owner, newest first. A directive stays in force until a later dated entry changes it. Agents add a row whenever the user authorizes, forbids or prefers something; non-obvious choices also get a [decision record](../decisions/index.md). The one-line versions agents must always see live in [`AGENTS.md`](../../AGENTS.md) under Project rules.

| Date | Directive | Scope | Source |
| --- | --- | --- | --- |
| 2026-10-02 | The wiki is for development. Do not distill, move or edit the Chrome Web Store extension's public docs (`docs/release/`, `docs/verification/`, `extension/README.md`); link to them. Package READMEs stay intact. | Documentation | Chat, 2026-10-02 |
| 2026-10-02 | Keep every `CLAUDE.md` gitignored (local assistant notes), including the root importer. | Repo config | Chat, 2026-10-02 |
| 2026-10-02 | Keep project knowledge in `wiki/`; agents read `now.md` first and update the wiki last. | All agents, all tasks | [Decision](../decisions/2026-10-02-llm-wiki-documentation.md) |
| 2026-10-01 | Evan publishes catalog releases himself in the hosted review app; publication is a deliberate human approval. | Catalog | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-30 | One branch and one PR per milestone, cut from the latest `main`; Evan (or the coordinating session) merges. Render auto-deploys `main`. | Git workflow | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-30 | Never edit an applied Supabase migration; add a new one. Migrations reach hosted only via `./scripts/db-push.sh`, run by Evan or the coordinator. | Database | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-29 | Verification and review steps are done by independent subagents and adjudicated by the agent, not handed to Evan; record provenance honestly (`agent-verified`, not `human-verified`). | Reviews, labels | Chat, 2026-09-29 |
| 2026-09-29 | Never re-capture issuer pages (hashes invalidate labels), never edit corpus labels to fit results, never tune prompts on held-out. | Evals | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Captured issuer text is copyrighted: keep captures gitignored; commit only URLs, hashes, labels and quotes of 25 words or fewer. | Evals, docs | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Live model calls only through the Codex / Claude Code subscription CLIs, locally; no paid API calls; never on Render. | LLM | [Decision](../decisions/2026-09-28-subscription-cli-providers-local-only.md) |
| 2026-09-28 | The agent never signs in to hosted services, never types API keys or passwords (Evan pastes secrets), never creates accounts, never permanently deletes data, never places orders on retailer sites. | All agents | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Prioritize measurable LLM results; add product schema only where the product needs it; no hedge-heavy agent-log docs. | Scope, docs | [Archived plan](../archive/phase2-goal.md) |
| 2026-09-28 | Use Helios via tokens and our own components; no HashiCorp logos or branding, no implied affiliation. | Frontend | [Decision](../decisions/2026-09-28-helios-design-system.md) |
