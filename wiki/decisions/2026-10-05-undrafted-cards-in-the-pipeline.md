---
type: Decision
title: Undrafted cards in the pipeline (Phase 9 milestone 3b)
description: A card the draft script writes no case for is draft done and undrafted, verified from the empty reference applyVerification already used in Phase 7; verify packets mark it, and a batch whose verify was already accepted gets a second verify and adjudicate packet that appends to the issuer's findings file.
status: accepted
tags: [decision, catalog, pipeline, verification, phase-9]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T01:47:35Z
sources:
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (Built so far, Phase 9 milestone 3b)
  - resource: ../../evals/curation/expansion/verification/README.md
    title: Verifier brief and findings format
---

# Undrafted cards in the pipeline (2026-10-05)

## Context
In the Phase 9 renewal run 13 of about 90 refreshed cards got no draft case: `draft-expansion-labels.mjs` writes none when no extracted value resolves to an anchor (21 cards in Phase 7). The pipeline marked them draft `failed-gate` (`no-draft-case`); verify packets take only drafted cards, so they could never be verified and `next` looped. `applyVerification` already handled such a card in Phase 7: its labels are an empty reference plus the verifier's accepted fixes and additions.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Draft status of a card without a case | `failed-gate`; `done` with a marker | **`done` with `undrafted: true`** (state schema, text-free) after a successful run; a script failure stays `failed-gate` (`draft-error`) |
| Its draft labels hash | None; the hash of the empty reference | **The empty reference** (`undraftedCase(card)`, exported from `expansion-verification.mjs` and used by `applyVerification`), so verify and apply hash it stably |
| Telling the verifier | A note in the prompt; a packet field | **`undraftedCardIds` in verify and adjudicate packets**; the verify gate refuses `confirmed` for such a card |
| A batch whose verify was already accepted | Re-verify the whole issuer; a second packet for the new cards | **A second verify packet** (claim already takes only pending cards), then a second adjudicate packet. The verifier appends to `verification/<issuer>.json`; the scope gate keeps accepted entries byte for byte and refuses a second entry for a card |
| Adjudicator ≠ verifier with two verify runs | The issuer's latest verify run; each packet card's verify run too | **Both**: `accept adjudicate` refuses a run that verified any packet card |
| The file's `verifier` block | Keep the first; the latest verifier writes its own | **The latest verifier's**; each card's verify run, model and packet stay in `state.json` |

## Decision
As in the table. `next` re-runs a legacy `no-draft-case` record instead of handing it to the session after two attempts, so the renewal run's 13 cards move on with one `run draft`.

## Consequences
- The verifier brief (`evals/curation/expansion/verification/README.md`) is unchanged, so no verify input hash moves; the guidance for undrafted cards is in `.claude/agents/card-verifier.md`.
- While a second verify packet is open or accepted but not yet adjudicated, the file's `adjudicator` may be null, so `apply --check` reports the issuer's earlier cards as awaiting adjudication until the second adjudicate is accepted; their apply and overlay records do not change.

## Status
Accepted 2026-10-05 by the implementing session (claude-code/claude-opus-5-5) under the Phase 9 milestone 3b brief.
