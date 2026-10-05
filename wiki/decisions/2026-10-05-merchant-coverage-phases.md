---
type: Decision
title: Merchant coverage split into Phases 10–17; D4 and D6 approved
description: Evan split the ten-milestone Phase 10 plan into eight phases (10–17), each shippable with its own exit check and asking only its own decisions; Phases 10 and 11 run in parallel; real-page capture (D4) and the Tranco/CrUX retail list (D6) approved.
status: accepted
tags: [decision, plan, phase-10, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T19:14:03Z
sources:
  - resource: ../product/phase-10-merchant-expansion.md
    title: Merchant coverage plan (Phases 10–17)
---

# Merchant coverage split into Phases 10–17; D4 and D6 approved (2026-10-05)

## Context
Plan v6.1 was one phase of about 4–5 months of sessions with ten milestones, two Web Store releases and fourteen decisions, all needed before any work. Its done condition waited on 4 weeks of Release B field data, so the phase could not close for months. The coordinator's review proposed smaller phases; Evan wanted to tackle them one by one.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Shape | One phase with milestones (v6.1); sub-phases 10.1–10.8; separate roadmap phases | Separate Phases 10–17 |
| First work | Feasibility probe first; any-store typed amount first; both in parallel | Both in parallel (Phases 10 and 11 touch different code) |
| Decisions | All D1–D14 up front; each asked when its phase starts | Per phase; D4 and D6 now |
| D4 real-page capture | Approve as planned; probe only, then re-decide | Approve as planned |
| D6 merchant list | Tranco or CrUX ∩ agent-classified retail with NRF cross-check; NRF Top 100 only | Tranco or CrUX ∩ retail |

## Decision
Phases: 10 feasibility probe, 11 any store with a typed amount, 12 eval protocols and captures, 13 generic reader v1, 14 merchant database, 15 Release A (replaces Phase 5), 16 measured LLM merchant pipeline, 17 telemetry and Release B. The operating work (was milestone 10) becomes a runbook; field criteria 3 and 5 hold no phase open. The privacy memo and event dictionary move from the probe to Phase 17, the single-purpose statement to Phase 15.

## Consequences
- The [plan page](../product/phase-10-merchant-expansion.md) keeps its path and lists each phase's exit check and needed decisions; the [roadmap](../product/roadmap.md) lists Phases 10–17, with Phase 5 replaced and Phase 6 folded in.
- Phase 11 needs D5 (category evidence and ranges) before it starts.
- The "Rules kept and rules superseded" rows take effect as the phase that needs each decision is approved.

## Status
Accepted 2026-10-05 by Evan in chat (structure, order, D4, D6); recorded by the coordinator (claude-code/claude-opus-5-5).
