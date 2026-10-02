---
type: Guide
title: How to document
description: Page anatomy, frontmatter schema, types, linking, writing rules, page templates and the create-versus-update decision.
status: stable
tags: [guide, wiki, schema]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T02:13:55Z
sources:
  - resource: https://github.com/GoogleCloudPlatform/open-knowledge-format
    title: Open Knowledge Format v0.2 specification
---

# How to document

One concept per file. The file path is the concept's identity. Directories are categories, not hierarchy for its own sake. Filenames are lowercase kebab-case; decision and review files are prefixed with their UTC date (`2026-01-31-…`). Every non-reserved markdown file under `wiki/` carries YAML frontmatter; `index.md` and `log.md` are reserved and carry none (the bundle root `index.md` may declare `okf_version`).

## Frontmatter

```yaml
---
type: System Component          # required; one of the types below
title: Background jobs           # display name
description: One sentence saying what the page covers.
status: stable                   # draft | stable | deprecated  (default stable)
tags: [jobs, backend]
generated:
  by: claude-code/<model-id>     # actor: <tool>/<model>, human:<id>, process:<id>
  at: 2026-01-31T18:00:00Z       # UTC; bump on every meaningful change
verified:                        # optional; a human or tool that checked the page against reality
  - by: human:<github-id>
    at: 2026-01-31T19:00:00Z
sources:                         # where the facts come from; file paths, URLs or archive pages
  - resource: ../../src/jobs.py
    title: Jobs implementation
  - resource: ../archive/DESIGN-v1.md
    title: Original design (archived)
stale_after: 2026-06-30T00:00:00Z   # only for facts with a known expiry
superseded_by: ../system/jobs.md    # required when status is deprecated
resource: https://example.com       # optional canonical external resource for the concept
---
```

`type` is the only required field. Consumers must tolerate missing optional fields and unknown keys, so add project-specific keys sparingly and consistently (`archived`, `superseded_by`, `supersedes`, `verified_commit` are the standard extras).

## Types

| type | Directory | Meaning |
| --- | --- | --- |
| `Working Memory` | root (`now.md`) | Current state; the only page rewritten wholesale |
| `Guide` | `guides/` | How to operate the wiki |
| `Product` | `product/` | Goal, users, workflow, directives, roadmap |
| `Domain Concept` | `domain/` | Problem-domain rules and data semantics |
| `System Component` | `system/` | How a part of the code works |
| `Runbook` | `ops/` | A repeatable procedure |
| `Decision` | `decisions/` | Context, options, choice, consequences, status |
| `Review` | `reviews/` | An audit or code review with findings |
| `Source Document` | `archive/` | An immutable pre-wiki or superseded document |

## Body

Lead with the current truth in two or three sentences. Then use the sections that apply, in this order: **Facts** (tables for parameters, limits, IDs, paths), **How it works** (mechanism, with `path/file.py:function` references), **Gotchas** (things that bit someone, constraints, non-obvious limits), **Open questions**, **Related** (links). Decision and review pages use the fixed templates below.

Writing rules:

- Absolute dates (`2026-01-31`), UTC. Never "now", "recently", "the latest".
- Say what is verified and what is assumed. "Verified 2026-01-31 against production" and "expected but untested" are different claims. Do not soften a fact into a hedge; do not harden an assumption into a fact.
- Prefer a table to a paragraph of numbers. Prefer a numbered list to a paragraph of steps.
- Name code by path and symbol (`src/jobs.py:Jobs.advance`) so an agent can jump to it. Name tests that cover the behavior.
- Keep pages under roughly 200 lines. Split by concept, not by length.
- No duplicated facts. If two pages need the same fact, one owns it and the other links.
- Plain prose. No filler, no marketing, no restating the title.

## Linking

Use relative markdown links (`../system/jobs.md`, `../../src/jobs.py`) so pages render on GitHub, in editors and in Obsidian. OKF also permits bundle-absolute links; this wiki does not use them because they break on GitHub. Link generously: a page with no inbound links is an orphan the linter reports. Link code and data by relative path from the page; link external references by URL and add them to `sources`.

## Create or update?

Update when the concept already has a page, even if the page needs restructuring. Create when a durable concept has no owner (a concept mentioned on three pages but owned by none is the usual prompt). Never create a second page for the same concept under a different name; if a name changes, rename the file with `git mv`, fix links, and log it. Retire pages through the [archive policy](archive-policy.md), never by deletion.

When new information contradicts a page, write the contradiction down with dates and sources rather than silently replacing the old claim: "Until 2026-01-10 the plan required X; on 2026-01-10 the owner removed the requirement (see decision …)." Then update `status`/`stale_after` on whatever became false.

## Indexes

Every directory has an `index.md` listing each page as `* [Title](file.md) — one-line description`, grouped by heading when useful. The root `index.md` lists the directories and the most-read pages. The linter fails when a page is missing from its directory index. Update the index in the same change that adds or renames a page.

## Templates

**Decision** (`decisions/YYYY-MM-DD-short-slug.md`):

```markdown
---
type: Decision
title: <Choice stated as an imperative>
description: <One sentence: what was chosen over what.>
status: accepted            # accepted | superseded | reversed
tags: [decision, <area>]
generated: {by: <actor>, at: <UTC timestamp>}
---

# <Title> (YYYY-MM-DD)

## Context
<What forced a choice; constraints; who asked.>

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |

## Decision
<What was chosen, concretely.>

## Consequences
<What changes, what it costs, what to watch.>

## Status
Accepted YYYY-MM-DD by <who>.
```

**Review** (`reviews/YYYY-MM-DD-short-slug.md`): frontmatter `type: Review` plus `verified_commit: <short sha>`; sections **Verdict**, **Scope and method**, **Findings** (High / Medium / Low / Checked and fine, each with `file:line` and verified-or-reported status), **Approach assessment**, **Docs versus code**, **Recommended next steps**, **Related**.
