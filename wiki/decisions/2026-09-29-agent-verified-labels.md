---
type: Decision
title: Verify corpus labels with independent reviewer agents instead of a human pass
description: Seven reviewer subagents checked every base-case field against captures; the corpus is marked agent-verified, not human-verified.
status: accepted
tags: [decision, evals, labels]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Verify corpus labels with independent reviewer agents instead of a human pass (2026-09-29)

## Context
The plan budgeted about an hour of owner verification; the owner preferred to trust independent agent review.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Owner verifies every field | Gold standard | Owner's time |
| **Independent reviewer agents, coordinator adjudicates** | Chosen | Must be labeled honestly as agent-verified |

## Decision
- `annotationStatus: agent-verified` in the corpus; results docs say so.
- The human verification page (`scripts/build-verification-page.mjs`) stays available for a later pass.

## Consequences
- Do not re-capture sources until a verification pass is applied: re-capturing changes hashes and invalidates labels.

## Status
Accepted 2026-09-29 by Evan Liu. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
