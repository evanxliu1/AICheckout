---
type: Decision
title: Make catalog v2 a separate product schema built from gold labels
description: Catalog v2 holds reviewed values the engine computes with, generated deterministically from the verified corpus labels, never from model output; v1 stays readable.
status: accepted
tags: [decision, catalog, schema]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Make catalog v2 a separate product schema built from gold labels (2026-09-30)

## Context
Extraction v2 keeps evidence and nulls for review; the engine needs computable values.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Reuse extraction schema in product | One schema | Engine would handle evidence and nulls |
| **Separate catalog v2, built by `scripts/build-catalog-v2.mjs` from corpus base cases** | Chosen | Deterministic and checkable in CI |

## Decision
- `schemaVersion: 1 | 2` discriminated union across extension, API, DB and review app.
- Null semantics: `cap: none | spend | unstated`; `activation: none | enroll-once | recurring | unstated`. Unstated cap on a bonus rule adds `cap-unstated` uncertainty.
- New Supabase migration mirrors the v2 validator in SQL; parity cases cover both versions.

## Consequences
- `npm run catalog:v2:check` guards the generated file in CI. See [rewards engine](../system/rewards-engine.md).

## Status
Accepted 2026-09-30. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
