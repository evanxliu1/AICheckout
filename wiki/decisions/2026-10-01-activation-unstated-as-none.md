---
type: Decision
title: Treat activation `unstated` as `none`
description: Unstated activation no longer adds an `activation-unknown` uncertainty; only `enroll-once`/`recurring` rules ask the shopper to confirm.
status: accepted
tags: [decision, catalog, engine]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Treat activation `unstated` as `none` (2026-10-01)

## Context
The earlier rule made every unstated-activation bonus a range, which was noisy; issuers state activation requirements explicitly when they exist.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Unstated adds `activation-unknown` | Cautious | Noisy ranges for most rules |
| **Unstated behaves as none** | Chosen | UI can still say activation was not mentioned |

## Decision
- `unstated` stays in the catalog for display; the engine treats it as `none` for every rule.

## Consequences
- Supersedes the earlier plan wording. See [reward rules](../domain/reward-rules.md).

## Status
Accepted 2026-10-01 by the coordinating session. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
