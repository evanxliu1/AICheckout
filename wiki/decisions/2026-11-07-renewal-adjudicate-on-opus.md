---
type: Decision
title: The renewal's remaining adjudications ran on Opus 5.5 instead of the pinned Fable 5.1 because of the Fable weekly limit
description: For catalog renewal 2026-11-07.renewal.2 only, the Synchrony and Bank of America adjudications (the two still open when the Fable 5.1 weekly limit ran out, until 2026-11-11T22:00Z) ran as card-adjudicator with the Opus 5.5 model under Evan's 2026-11-07 directive; each is a different run from its verifier, and the model is recorded honestly in the findings files and state.json.
status: accepted
tags: [decision, catalog, pipeline, phase-15, renewal, agents]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-11-07T20:00:00Z
sources:
  - resource: ./2026-10-04-pipeline-agent-models.md
    title: Pinned models of the pipeline subagents (the rule this is an exception to)
  - resource: ../../evals/curation/batches/synchrony-refresh-2026-11/pipeline/state.json
    title: Synchrony batch state (adjudicate run, model)
  - resource: ../../evals/curation/batches/bank-of-america-refresh-2026-11/pipeline/state.json
    title: Bank of America batch state (adjudicate run, model)
  - resource: ../ops/catalog-release-history.md
    title: Catalog release history (renewal 2026-11-07.renewal.2)
---

# The renewal's remaining adjudications ran on Opus 5.5 instead of the pinned Fable 5.1 (2026-11-07)

## Context
The [models decision](2026-10-04-pipeline-agent-models.md) pins `card-adjudicator` to `claude-fable-5-1`, a different model from the Opus 5.5 verifier. On 2026-11-07 the account's weekly Fable limit ran out (resets 2026-11-11T22:00Z) with two adjudications open: Synchrony (packet claimed by the stopped Fable driver, never written) and Bank of America (captured in the browser pane that day; its first Fable adjudicator run ended at the limit). The hosted catalog had been expired since 2026-11-04. Evan's instruction that day: "if the fable renewal runs out of usage, resume it/swap to opus for it".

## Options considered
| Option | Why not / why |
| --- | --- |
| Wait for the Fable limit to reset on 2026-11-11 | Four more days of a 503 catalog for every install |
| Ship without Synchrony's and Bank of America's refreshed labels | 41 cards would be held out or stale; the build refuses sources older than 30 days |
| **Run those two adjudications as `card-adjudicator` on Opus 5.5 (Agent `model: "opus"`), each a new run, and record the model as it ran** | Chosen, on Evan's directive. Independence from the verifier is kept at the run level (accept refuses the verifier's run); model diversity is lost for these two issuers |

## Decision
1. For renewal `2026-11-07.renewal.2` only, the Synchrony adjudication (run `a753487b216dee0e3`, 22 cards: 176 accepted, 3 rejected) and the Bank of America adjudication (run `af3d52bd14b6dab15`, 19 cards: 168 accepted, 1 modified, two `split-anchors` acks) ran on Opus 5.5. Their verifier runs were different runs, so `accept` accepted them.
2. Each findings file's `adjudicator` block and each `state.json` adjudicate record say `claude-opus-5-5`. The Synchrony run first wrote the pinned ID and was asked to correct it before accept.
3. The other eight issuers were adjudicated on Fable 5.1 before the limit. Overlays ran on their pinned Opus 5.5 as always. The agent file's pin is unchanged.

## Consequences
- The renewal's provenance stays `agent-verified`. For Synchrony and Bank of America the second pass is a second Opus run, not a second model.
- Any later renewal goes back to the pinned Fable adjudicator unless Evan decides otherwise.

## Status
Accepted 2026-11-07 under Evan's directive of the same day, by the renewal driver (claude-code/claude-opus-5-5).
