---
type: Decision
title: One labeller per store, five stores per labeller agent
description: Evan, 2026-10-08 — Phase 12.4 labels each captured store once (one labeller subagent per five stores) instead of two independent labellers plus an adjudicator, for speed. Final labels come from agreement.mjs --single; no agreement report or adjudication; the currency-undetermined stop rule stays.
status: accepted
tags: [decision, phase-12, merchants, eval, labels]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-08T20:00:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (status notes of 2026-10-08)
  - resource: 2026-10-08-pause-capture-quality-target.md
    title: Capture paused at about 300 stores; the ≥ 99% bar becomes a quality target
---

# One labeller per store, five stores per labeller agent (2026-10-08)

## Context
The protocol asked for two independent labellers per split and an adjudicator for every disagreement (about 950 page-states, so about 670 labeller sessions at one store each). Evan in chat, 2026-10-08: "i think we do not need two labelers per store, in fact i would want one labeler to do 5 stores at once, to help speed up".

## Decision
- Each captured store is labelled by **one** labeller subagent, which labels **five stores** per session from the rebuilt-page screenshots, tiles, the [labeller digest](../../evals/merchants/capture/digest-pane.mjs) and the export ([brief](../../evals/merchants/labels/workflows/labeller-brief.md), [workflow](../../evals/merchants/labels/workflows/label.workflow.txt)).
- Its labels are the final labels (`agreement.mjs --single`): no agreement counts, no adjudication; the 90% expected-agreement stop rule no longer applies. The currency-undetermined stop rule (more than 10% of a split's real `cart-1`) and every other rule of the freeze still apply. Low-confidence labels are listed in the split's report.
- Recorded as a dated status note in the protocol, not an amendment (Evan's instruction of the same day).

## Consequences
- Label errors are no longer caught by a second labeller, so a wrong label can count against (or for) the reader. Reports say the labels are single agent labels, agent-verified, and list low-confidence labels; a label later found wrong goes in a dated erratum as before.
- Labelling takes about a fifth of the agent sessions.
