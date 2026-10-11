---
type: Decision
title: Merchant pipeline 14.3 details: 692 candidates, the prompt kept in the pipeline, dry-run records enter the release, held-out domains refused by init, blocked homepages fall back to the label, strict research schema instead of a key blacklist
description: Implementer choices in milestone 14.3 of Phase 14 that the plan left open or that the first run forced.
status: accepted
tags: [decision, phase-14, merchants, pipeline]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T02:30:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 5, 6, 8)
  - resource: ../system/merchant-pipeline.md
    title: Merchant pipeline
  - resource: ../../evals/merchants/db/candidates.json
    title: Frozen candidate list
---

# Merchant pipeline 14.3 details (2026-10-11)

## Context
Milestone 14.3 of the [Phase 14 plan](../product/phase-14-merchant-database.md) builds the candidate list, the tier-A builder, the tier-B stages, two agent files, the draft prompt and the apply rule, then dry-runs 10 development stores. The plan fixes the stages and the evidence rule but leaves several points to the implementer, and the dry run showed two things the plan did not anticipate.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Size of the list | Trim tier A to reach "about 500"; keep every U.S. eligible frame domain | Keep: 692 (tier A 380, tier B 312). The tier-B groups were authored to the plan's own group sizes (310 unique domains; the catalog-brand group alone is 126) and the frame's 361 U.S. eligible domains are the plan's stated tier-A source. Tier A costs no model time, so the count only costs capture time; Evan may trim before 14.4 |
| Where `merchant-draft.1` lives | `apps/api/src/curation/prompts/` (the plan's first suggestion); the harness's inline prompt table (`v2/context.ts`); the pipeline | `tools/catalog-pipeline/src/merchants/prompts/merchant-draft.1.md`: only the pipeline uses it, the API is deployed from `apps/api`, and a markdown file is hashed into every draft and `state.json`. The plan allowed "or the harness's prompt location" |
| Dry-run records | Write them to a scratch release; write them into `evals/merchants/db/records/` like any batch | Into the records: the apply, build and `review.md` stages are only tested end to end that way, and the 10 stores are development stores excluded from the audit anyway. The release version is bumped by hand to `2026-10-11.dev.1` |
| Held-out domains in `init` | Refuse always; refuse unless `--allow-heldout` | The latter, and never together with `--development`: 14.4 must build records for the 60 (they are the audit set), 14.3 must never touch them |
| Keeping values out of research | A blacklist of keys (`rate`, `cap`… as the card researcher's gate); strict Zod objects | Strict objects everywhere: a key the schema does not name is rejected, so no category, code, kind, goods flag or brand can be written at all |
| Blocked homepages in tier A | Fail the store; write the record with the label name | Write the record, name from the domain label, `(blocked)` in `tier-a-manifest.json`: a default record's only model-free field is its name, and the smoke test showed headless Chromium bot-walled on both tries (chewy.com 403, crocs.com 429) |
| Issuer sources | Research issuer pages again; mine the existing issuer captures by name | Mine (plan): a word-boundary match of the store name (and its domain label when 5+ letters) over every catalog capture, newest per source id, at most 5 per store, windows of ±500 characters for the drafter so a 90k-character terms page does not fill the context |
| Subagent types | Wait for a session that registers the new agent files; run a general-purpose subagent that reads the agent file | The latter for the dry run, on Opus (the pinned model), recorded as such in `state.json` |

## Decision
As chosen; recorded in the [merchant pipeline](../system/merchant-pipeline.md) page.

## Consequences
- The candidate list is larger than the plan's figure; the tier-A homepage run in 14.4 is about 380 renders and many will be `(blocked)`.
- Evan reads dry-run records in `review.md` like any others; they can be rebuilt in 14.4 if the prompt changes.
- Any field a model could abuse is refused by the schema rather than by a list that could miss a synonym.

## Status
Accepted 2026-10-11 (UTC) by the 14.3 implementer (Fable 5.1); agent-verified by tests. Evan may change any of it.
