---
type: Guide
title: How to track changes
description: The log, working memory, page timestamps, decision records, and how wiki changes ride with code changes.
status: stable
tags: [guide, wiki, history]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T02:13:55Z
---

# How to track changes

Four mechanisms, each with one job. Do not invent a fifth (no "update banners" at the top of pages; those belong in the log).

## 1. `log.md`: what happened, when

Append-only, newest first, grouped by UTC date. Format:

```markdown
## 2026-01-31
* **Create** `system/jobs.md` — background job design extracted from archived DESIGN-v1.md. (claude-code/<model-id>)
* **Decision** [2026-01-31-postgres-over-sqlite](decisions/2026-01-31-postgres-over-sqlite.md) — recorded storage choice.
* **Release** v1.4.0 deployed; see [deploy](ops/deploy.md).
```

Actions: `Create`, `Update`, `Deprecate`, `Rename`, `Decision`, `Review`, `Release`, `Ingest` (external source folded in), `Lint`, `Directive` (user instruction recorded). One bullet per meaningful change, not per file save. Link the page. Name the actor in parentheses when it is not obvious from context.

## 2. `now.md`: what is true right now

Working memory. Rewritten in place at the end of every session: current branch and deployment, active work with owner, open questions for the user, agreed next steps. It never carries history; if you remove something from `now.md`, its trace is already in `log.md`. Keep it under a screen.

## 3. Page-level fields

- `generated.at`: bump on any change of substance. Formatting-only edits do not bump it.
- `verified`: add an entry when a human or a scripted check confirmed the page against the running system. Verification is a fact about a moment; it does not need removing later, the newest entry wins.
- `verified_commit`: optional short SHA of the code the page was last checked against; useful for `system/` pages.
- `status`: `draft` while incomplete, `stable` normally, `deprecated` when superseded (then set `superseded_by`).
- `stale_after`: set for time-bound facts such as deployment IDs, plan limits, entitlements, versions. The linter warns when it passes.

## 4. Decision records

Any non-obvious choice by the user or an agent gets a page in `decisions/`, dated, with the sections **Context**, **Options considered**, **Decision**, **Consequences**, **Status** (`accepted`, `superseded by …`, `reversed`). Decisions are not edited after acceptance except their status line; a change of mind is a new record that supersedes the old one. Standing user instructions are also summarised in [`product/user-directives.md`](../product/user-directives.md), which links to the decision that established each.

## Wiki changes ride with code changes

A pull request that changes behavior, setup, contracts or data semantics includes the wiki updates in the same diff; the PR template asks for it. The pre-commit hook and CI run `scripts/lint_wiki.py`, so a broken link or a missing index entry fails the check before review. Git history is the audit trail for the wiki itself; the log is the human-readable summary of it.

## Time

All wiki timestamps and log dates are UTC. Convert local times (commit times, the user's clock) before writing; an event late in the evening locally may belong to the next UTC date.
