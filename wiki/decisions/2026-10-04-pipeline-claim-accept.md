---
type: Decision
title: Pipeline claim/accept, gates and label-evidence lint choices (Phase 8 milestone 3)
description: How work packets are kept (gitignored, released not deleted), what the agents' output files are, how the gates reuse the Phase 7 checks in process, the label-evidence lint's recognised forms and its frozen-data baseline, the capture no-overwrite rule, and the build registration.
status: accepted
tags: [decision, catalog, pipeline, phase-8, gates]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T04:44:00Z
sources:
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (design and what is built)
  - resource: ../../tools/catalog-pipeline/src/accept.ts
    title: accept and the stage records
  - resource: ../../tools/catalog-pipeline/src/gates.ts
    title: Verify, adjudicate, overlay and quote gates
  - resource: ../../tools/catalog-pipeline/src/label-lint.ts
    title: Label-evidence lint
---

# Pipeline claim/accept, gates and label-evidence lint (Phase 8 milestone 3) (2026-10-04)

## Context
Milestone 3 builds `claim`, `accept`, the gates of the agent stages and the label-evidence lint of the [approved design](../system/card-expansion-pipeline.md#work-packets-claim-and-accept). Several details were left to the implementation; the frozen `expansion.v1` files and the default behaviour of every wrapped script had to stay unchanged.

## Options considered
| Question | Chosen | Alternatives |
| --- | --- | --- |
| Released packets | Kept, marked `released` (accepted ones `accepted`); `n` counts up per stage and issuer | Delete on release: loses the claim history of the checkout |
| Committing packets | `pipeline/packets/` is gitignored: packets hold this machine's absolute paths (the design asks for absolute paths). `state.json` keeps what was accepted (`packetId`, `agentRun`, `model`, `acceptedAt`, `durationMs`, `tokens`) | Commit them: puts a home-directory path in the repository |
| Output files | research `research/<issuer>.json`; verify and adjudicate the findings file `verification/<issuer>.json` (optional `packetId`, `batch`, `provenance` added to `verificationFileSchema`; `issuer` is the existing issuer-name field); overlay a fragment `overlay/<issuer>.json` merged by accept into `catalog-overlay.json` and `reward-programs.json` | Overlay agent edits `catalog-overlay.json`: a strict schema with no room for the packet fields, and several issuers share it |
| Envelope `issuer` | The issuer **name** of `batch.json` (the findings format already uses it) | The slug |
| What the agent may touch | Packet records the SHA-256 of every input file at claim; accept refuses if one changed. Verify and adjudicate: entries of cards outside the packet must be unchanged; the adjudicator may only add adjudication fields (the verifier's findings and `verifier` block are hashed at claim) | Trust the agent |
| Gates' reuse | In process: `applyVerification`/`loadExpansion` (the `apply --check`), `checkOverlay` on `mergeLayers` of the build config's layers plus this batch, and the quote check, moved into `scripts/lib/expansion-quote-check.mjs` (the script prints exactly what it printed before). Errors are redacted (every quoted span becomes `"…"`) | Spawn the scripts and filter their output (they print capture text) |
| Overlay pairing | The packet lists the `corpusCaseSha256` each entry must carry (milestone 1's `sha256Json`, reused), so the agent copies it | The agent computes canonical JSON hashes |
| Research schema | Strict, no numeric field at all; keys that look like reward values (`rate`, `bps`, `cap`, `earn`, `rewardsSummary`, `pointCashValue` …) are named in the error; card groups add `business` (excluded by the consolidation); `annualFee` stays a string hint | Reuse the Phase 7 research format (it carries rates and point values) |
| Research consolidation | `build-expansion-cards.mjs --dir <batch>` (new flag) reads `<dir>/research/*.json` and writes the four files into the batch; the Phase 7 skip and pick lists still apply | A second consolidation in TypeScript |
| Lint: dollar figures | `amountRegex` of the drafting: `$5,000`, `$5000`, `$5,000.00`, `$5k`/`$5K`; not "5,000 dollars" or "$5 thousand" | Any figure with the same digits |
| Lint: rates | A percent (`percentsIn`) or the sum of the stated percents; for points cards also multiples: `4X`, `1.5x`, a number or number word, up to six words, then per / for every / for each / on every / on each / with each `$1` or dollar (also read with parentheticals removed), and `total of N`. No multiples on cash-back cards; a bare "400 points" is not a multiple | `rateRegex` of the drafting (accepts any matching number anywhere) |
| Lint: dates | `2026-12-31`, `12/31/2026`, `12/31/26`, `December 31, 2026`, `Dec. 31, 2026`, `Dec 31 2026`, `December 31st, 2026`, `31 December 2026` | ISO only |
| Lint: evidence | The rule's anchors and its issuer wording, plus the overlay patch's anchors | Anchors only (issuer wording is verbatim issuer text as well) |
| Frozen data | `pipeline lint-labels` reports on any corpus directory and exits 0; findings are fatal only at apply and overlay accept, for the batch's cards | Fail on the frozen corpus |
| Capture no-overwrite | `capture-issuer-pages.mjs --protect <ids>` (new, default unchanged): a protected capture whose new text differs is kept and the run reports `changed-capture-kept`. `run capture` fetches only sources that fail the gate or whose entry or hint changed, protecting those whose capture passed | Refuse every re-capture (a flagged bot-wall capture could never be replaced) |
| Accepted flags | `pipeline resolve capture-flagged --source <id> --reason expected-short-page\|false-positive-flag\|keep-existing-capture`, stored in `state.json` `resolvedFlags` with the capture hash it applies to | Free-text reasons (state is text-free) |
| Build registration | `run build` writes the batch into `evals/curation/catalog-batches.json` with its dropped cards (reason codes) from state; CI reads only the committed config | Builder reads `state.json` files (a second source of truth for the build) |
| Re-stamp | After a successful apply (lint and quote check passed), every card whose overlay is still done gets `corpusCaseSha256` re-stamped in `catalog-overlay.json` (the fragment keeps the original) | A new overlay packet |
| Usage figures | `accept --duration-ms N --tokens N` on the issuer's stage record (`durationMs`, `tokens`); tokens per card = tokens / packet cards (coordinator addition) | Per-card figures |

## Decision
As chosen. Baseline of the label lint on the frozen `expansion.v1` (173 corpus cards, `pipeline lint-labels`, 2026-10-04): apply gate (corpus rules) 39 findings: cap-amount 0, rate 30, end-date 9; overlay gate (catalog rules) 39 findings: cap-amount 0, rate 29, end-date 9, dateless-limited-time 0, store-program 1. Read by hand: the rate findings are anchors that do not state the number (truncated anchors, "following per $1: 2 points at …"), relationship bonuses (+10%), and store cards labelled cash back whose evidence states points; the end-date findings are rotating quarters whose anchors give no end date; the store-program finding is `tjx-rewards-certificates` (unit "Rewards Points"). None is a wrong number found so far; the $5,000/$50,000 class of error (fixed in Phase 7) would now be caught.

## Consequences
- A batch whose labels hit one of those patterns cannot be accepted until an anchor states the number; there is no override yet (open for milestone 4–6: an accepted-finding record like `resolve`).
- The capture script prints its own output, and apply prints its errors (with quotes) to the session terminal; the pipeline's own gate messages are text-free.
- Packets do not survive a fresh checkout; an open claim lives only in the checkout that holds the captures, where pipeline agents run anyway.

## Status
Accepted 2026-10-04 (implementation choices within the approved design; agent-made, for Evan's review in the milestone 3 PR).
