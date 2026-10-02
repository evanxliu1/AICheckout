---
type: Decision
title: Run live models only through subscription CLIs, locally
description: Live evaluation uses the Codex CLI (ChatGPT plan) and Claude Code CLI (claude.ai plan) on the owner's machine, never paid API calls and never on Render.
status: accepted
tags: [decision, llm, evals, cost]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Run live models only through subscription CLIs, locally (2026-09-28)

## Context
Measured model results are the project's headline, but the owner does not want API spend; subscriptions are already paid.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Provider API keys | Standard | Per-token cost |
| **`codex exec` / `claude` CLI providers on the owner's machine** | Chosen | No extra spend; models are not pinned snapshots (stated as a limitation) |

## Decision
- `apps/api/src/curation/codex.ts` and the Claude CLI provider back `npm run eval:curation` / `eval:v2` live modes.
- Curation stays disabled on the hosted Render service.

## Consequences
- Live runs need the owner's logged-in CLIs and happen locally; see [live model runs](../ops/live-model-runs.md).
- Results report subscription models by name and date, not by snapshot ID.

## Status
Accepted 2026-09-28 by Evan Liu. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
