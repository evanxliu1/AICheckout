---
type: Guide
title: How to use this wiki
description: Read order, the query/ingest/lint operations, and where each kind of knowledge lives.
status: stable
tags: [guide, wiki, memory]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T02:13:55Z
sources:
  - resource: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
    title: Karpathy, LLM wiki pattern
  - resource: https://github.com/GoogleCloudPlatform/open-knowledge-format
    title: Open Knowledge Format v0.2
---

# How to use this wiki

This directory is the project's long-term memory. It follows Karpathy's LLM-wiki pattern (raw sources are immutable, the wiki is agent-maintained, a schema file governs it) and the Open Knowledge Format (one concept per markdown file with YAML frontmatter, `index.md` for navigation, `log.md` for history). The schema is [`AGENTS.md`](../../AGENTS.md) plus the four guides in this directory.

## Read order for a new session

1. [`now.md`](../now.md): what is true right now, what is in progress, what is open. Working memory.
2. [`index.md`](../index.md): the catalog. Find the pages for your task.
3. The owning page(s): `system/` for how code works, `domain/` for problem-domain rules, `ops/` for procedures, `product/` for goal and user directives, `decisions/` for why.
4. Only then the code. The wiki should let you skip most exploratory grepping; if it did not, that is a gap to fix at the end of the task.

## Layout

| Directory | Holds | Memory role |
| --- | --- | --- |
| `now.md` | Current state, active work, open questions, next steps | Working memory (replace in place) |
| `log.md` | Dated, newest-first history of wiki and project changes | Episodic memory (append only) |
| `product/` | Goal, users, workflow, user directives, roadmap | Intent |
| `domain/` | Problem-domain rules, terminology and data semantics (optional) | Semantic memory |
| `system/` | Architecture, code map, components, data model, API, testing, security | Semantic memory |
| `ops/` | Runbooks: setup, deploy, migrations, backups, CLIs | Procedural memory |
| `decisions/` | Dated decision records with context, options, outcome | Why things are the way they are |
| `reviews/` | Audits and code reviews with findings and verdicts (optional) | Evaluations |
| `guides/` | These four pages | Schema |
| `archive/` | Superseded documents and retired pages, immutable | Raw sources and history |

Everything outside `wiki/` that is still documentation (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, the `AGENTS.md`/`CLAUDE.md` files) is a thin entry point that links here.

## The three operations

**Query.** Answer a question by reading `index.md`, then the relevant pages, then code if needed. Cite pages by path. If the answer took real synthesis (an audit, a comparison, a design analysis), file it back as a page in `reviews/` or the owning directory so the next session does not redo it.

**Ingest.** New knowledge arrives as a user statement, an external document, a provider check, a review, or a code change. Fold it into the pages that own the concept (update, do not duplicate), record the source in `sources`, bump `generated.at`, add a decision record if a choice was made, append to `log.md`, and adjust `now.md`. A single ingest often touches several pages; that is expected.

**Lint.** Run `python3 scripts/lint_wiki.py` for mechanical checks (frontmatter, links, index coverage, orphans, log order, stale dates, unfinished `TODO(llm-wiki)` markers). Periodically ask an agent to lint semantically: contradictions between pages, claims the code no longer supports, concepts mentioned in three places but owned by none, pages nobody links to. Fix what you find and log it as a `Lint` entry.

## Where facts go

- A behavior of the code: the `system/` page for that component, with file paths.
- A rule about the problem domain or what the product may claim: `domain/`.
- Something the user authorized, forbade or preferred: `product/user-directives.md` (dated) and, if it was a real choice among options, a `decisions/` record.
- A procedure someone will repeat: `ops/`.
- A verified fact with an expiry (deployment IDs, plan limits, entitlements, versions): the owning page with `stale_after` set.
- Anything superseded: `archive/` via the [archive policy](archive-policy.md).

## For humans

GitHub renders every page. The directory also opens as an Obsidian vault (frontmatter and relative links work unchanged). Read `now.md` for status and `log.md` for history; ask an agent to query or lint rather than editing by hand, unless you are recording a directive, in which case add it to `product/user-directives.md` and let the agent propagate it.
