---
type: Decision
title: Pipeline CLI skeleton choices (Phase 8 milestone 2)
description: How the tools/catalog-pipeline CLI runs TypeScript, which fields count as anchors in the labels/anchors split, how staleness and missing inputs are derived, the mechanical anchor rebase, extract pauses, and the lockfile edit for the new workspace.
status: accepted
tags: [decision, catalog, pipeline, phase-8, tooling]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T00:50:00Z
sources:
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (design and what is built)
  - resource: ../../tools/catalog-pipeline/src/derive.ts
    title: Status derivation, queue and next
  - resource: ../../tools/catalog-pipeline/src/hash.ts
    title: Input hashing and the labels/anchors split
---

# Pipeline CLI skeleton choices (Phase 8 milestone 2) (2026-10-04)

## Context
Milestone 2 builds the `tools/catalog-pipeline` workspace: `init`, `status`, `next`, `run <stage>`, the state schema and input hashing ([design](../system/card-expansion-pipeline.md)). The design fixes the shape; several details were left to the implementation.

## Options considered
| Question | Chosen | Alternatives |
| --- | --- | --- |
| How the CLI runs TypeScript | Node 24 type stripping (`node tools/catalog-pipeline/src/cli.ts`), `erasableSyntaxOnly` and `verbatimModuleSyntax` in its tsconfig so `tsc` rejects what Node cannot strip | `tsx` (new dependency); an esbuild bundle as the scripts do for the harness (unneeded: the pipeline imports only self-contained harness files) |
| Which fields are anchors | `anchors`, `anchor`, `anchorMethod`, `quote`, `quotes`, `evidence`, `draftNotes` (draft notes describe anchors). `issuerWording` is a label: a corpus rule field the verifier judges and `catalog-v3.ts` ships, so a new wording makes verify stale (changed after the PR #38 review) | Count `issuerWording` as an anchor (a re-draft with another wording would keep verify, adjudicate and overlay done) |
| Adjudicate input (findings hash) | The card's findings without adjudication fields and without `current` on anchor paths | The whole entry (adjudication would make adjudicate stale on itself; a rebase would re-adjudicate) |
| Anchor-only re-draft | Implemented: `next` returns a `cli` step and `pipeline rebase-anchors` re-points `current` on anchor paths to the new draft; a path missing from the new draft is reported and the card keeps its old anchors hash | Detection only, rebase in milestone 3 |
| Overlay after an anchor-only change | Apply goes stale (its input is the full draft case) but the overlay does not inherit that staleness, since it hashes the corpus labels itself; staleness that apply inherits from upstream still propagates | Plain propagation (would re-author the overlay after every anchor change) |
| Missing gitignored inputs | `inputs-missing` when a hashed gitignored input is absent (a trace, for draft), or when a stage that would run lacks one (captures, for extract); a stage done with a matching hash stays done; a computable hash that differs is `stale` even without the captures, so staleness shows and propagates in every checkout (`run` skips such a card and `next` names the missing inputs); only `stale` propagates | Treat absence as stale (would re-run model stages in a checkout without captures) |
| Extract usage limit | The CLI calls `extract-cards.mjs --wait-minutes 0`, marks unfinished cards `paused` with `pausedUntil` = now + `--wait-minutes` (15 when not given), and either exits 3 or sleeps and re-runs the paused cards | Let the script wait internally (state would show nothing while it sleeps) |
| Script flags | None added: capture, extract, draft, apply and the capture report already take `--dir`; capture and extract take `--only` | — |
| Repeated CLI gate failures | After 2 attempts (`GATE_ATTEMPTS`) a CLI stage in `failed-gate` is a `queue` step (`gate-failed`, owner session) instead of another `run` | Keep proposing `run` (loops on a cause a re-run cannot fix) |
| Lockfile | Add only the workspace entries to `package-lock.json` by hand | Commit `npm install`'s rewrite: npm 11.5.2 dropped about 1,300 lines of other platforms' optional packages (esbuild and others), which would break `npm ci` on Linux CI |

## Decision
As chosen above. Queue items `convention-needed` and `scope-question` are derived from a stage record's `reason` code (set by `accept` from milestone 3), `needs-reverify` from a rejected `drop-card` verdict in the findings, `capture-flagged` from a capture recorded `failed-gate` with that reason, and `publish` once build and eval are done.

## Consequences
- The pipeline needs no build step and no new dependency; `npm audit --audit-level=high` is unchanged.
- An anchor-only re-draft does not re-verify a card; the findings' `current` on anchor paths is rebased mechanically and `apply --check` re-checks it. A changed issuer wording re-verifies.
- The package has no programmatic export surface yet; milestone 3 adds the exports it needs.
- `inputs-missing` steps come from `next` as a `queue` step owned by the session (switch to the checkout that holds the captures).
- The next npm install that rewrites the lockfile must be checked for dropped platform packages.

## Status
Accepted 2026-10-04 (implementation choices within the approved design; agent-made, for Evan's review in the milestone 2 PR).
