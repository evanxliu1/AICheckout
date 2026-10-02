---
type: Decision
title: Adopt an LLM wiki (Open Knowledge Format) plus AGENTS.md as the documentation and memory system
description: Keep project knowledge in a wiki/ bundle that agents read first and update last, governed by AGENTS.md and four guides, with a linter in the hook and CI.
status: accepted
tags: [decision, documentation, agents, wiki]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T02:13:55Z
sources:
  - resource: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
    title: Karpathy, LLM wiki pattern
  - resource: https://github.com/GoogleCloudPlatform/open-knowledge-format
    title: Open Knowledge Format v0.2
  - resource: https://github.com/multica-ai/andrej-karpathy-skills
    title: Karpathy behavioral guidelines for coding agents
---

# Adopt an LLM wiki plus AGENTS.md (2026-10-02)

## Context

Before 2026-10-02, development knowledge lived in about 35 markdown files (~3,700 lines): a root README, `docs/design.md`, a 330-line working plan (`docs/plans/phase2-goal.md`) that mixed current state, decisions, gotchas and future phases, nine package READMEs, and private agent notes (gitignored `CLAUDE.md` files and per-user Claude memory). Each new session re-read the plan and the code to recover state. Evan asked on 2026-10-02 for the docs to be reorganized as an LLM wiki for development, in a separate branch, and directed that the Chrome Web Store extension's public docs (`docs/release/`, `docs/verification/`, `extension/README.md`) stay out of it. Agents in use: Claude Code, Codex, Cursor.

## Options considered

| Option | Fit | Why not / why |
| --- | --- | --- |
| Keep existing docs, add `AGENTS.md` only | Cheapest | Agents keep re-deriving facts each session; no change tracking or memory loop |
| Conventional `docs/` folder | Familiar | No governing schema, no index/log discipline, no ingest/query/lint operations; drifts |
| **LLM wiki in OKF under `wiki/`, governed by `AGENTS.md`** (chosen) | Agent-maintained, git-native, renders on GitHub and in Obsidian | More files; needs the linter and the session protocol to stay healthy |
| External knowledge tool (Notion, vector store) | Nice UI | Not versioned with the code; needs accounts or SDKs |

## Decision

- `wiki/` holds `index.md` (catalog), `log.md` (newest-first history), `now.md` (working memory) and category directories. One concept per file, YAML frontmatter with `type` required and OKF provenance fields, relative links.
- `AGENTS.md` is the schema and behavioral contract for every tool. Root `CLAUDE.md` imports it but stays local-only: `.gitignore` keeps every `CLAUDE.md` private (owner's choice, 2026-10-02), so each Claude Code checkout creates its own one-line importer.
- Cursor has an `alwaysApply` rule in `.cursor/rules/agents.mdc` pointing at `AGENTS.md`.
- Agents follow the session protocol: read `now.md` and `index.md` first; finish by updating `now.md`, `log.md`, affected pages and decision records.
- Superseded development documents (`docs/design.md`, `docs/plans/phase2-goal.md`) are archived verbatim under `wiki/archive/`; nothing is deleted. Package READMEs, `docs/research/`, `docs/evals/` and all release/store material stay where they are and are linked, not absorbed.
- `scripts/lint_wiki.py` enforces structure in the pre-commit hook and CI where available.

## Consequences

- Every behavior, setup or contract change includes a wiki change in the same diff.
- New sessions start from `now.md` instead of re-reading the codebase.

## Status

Accepted 2026-10-02.
