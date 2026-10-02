---
type: Decision
title: Keep the LLM out of checkout; use it only to curate the catalog
description: A deterministic engine ranks cards at checkout; the LLM drafts catalog changes from issuer terms for human review.
status: accepted
tags: [decision, architecture, llm]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
  - resource: ../archive/design.md
    title: Design (archived)
---

# Keep the LLM out of checkout; use it only to curate the catalog (2026-09-28)

## Context
The 2025 prototype sent the cart and the whole catalog to GPT and displayed whatever card it picked: rates were strings, eligibility was the model's opinion, and nothing was reproducible.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| LLM picks the card at checkout | Prototype | Unreproducible, needs a key and network, can hallucinate money |
| **Deterministic engine at checkout; LLM drafts catalog changes, human publishes** | Chosen | Language work stays with the model; arithmetic and ranking stay testable |

## Decision
- `packages/rewards-core` ranks owned cards with integer cents and basis points; unknowns become explicit ranges. No model, key or network at checkout.
- The curation harness (`apps/api/src/curation`) turns captured issuer terms into structured drafts where every fact cites a resolvable source span. The model has no tools and no write path.
- Applying a draft and publishing a release are separate signed-in human actions.

## Consequences
- The extension works offline on a bundled or cached catalog.
- Every change to card facts goes through review; extraction quality is measured offline (see [evaluation](../system/evaluation.md)).

## Status
Accepted (in the pre-wiki design doc, consolidated 2026-09-28). Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
