---
type: Decision
title: Run card expansion as a deterministic pipeline CLI driven by a Claude Code skill and subagents
description: Proposed — card expansion becomes a resumable CLI in tools/catalog-pipeline (per-card text-free state, input hashing, gates, review queue, hash-only freshness) driven by the expand-catalog skill and card-researcher, card-verifier and card-adjudicator subagents, ending at a ready branch Evan publishes; product code never imports tools/.
status: proposed
tags: [decision, catalog, curation, pipeline, phase-8]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:30:00Z
sources:
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (design draft)
  - resource: ../product/phase-7-stage-2.md
    title: Phase 7 Stage 2 plan (M11)
---

# Run card expansion as a deterministic pipeline CLI driven by a Claude Code skill and subagents (2026-10-02)

## Context
Phase 7 Stage 1 grew the catalog from 7 to 180 cards with eight standalone scripts (`build-expansion-cards`, `capture-issuer-pages`, `merge-capture-manifests`, `expansion-capture-report`, `extract-cards`, `draft-expansion-labels`, `apply-expansion-verification`, `check-expansion-quotes`) and a coordinating session that started verifier and adjudicator subagents by hand ([catalog expansion](../system/catalog-expansion.md)). The scripts are resumable one by one, but nothing records which card is at which step, what each output was computed from, or what is waiting on whom. Evan wants (2026-10-02) a natural-language request to his coding agent, "expand to issuer X, these cards", to run everything up to publish, with publish staying his click. The same pattern should carry a merchant-expansion pipeline later (Phase 9).

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Keep the scripts and a written runbook | Cheap | State lives in the session's head; a stopped run is hard to resume; gates are remembered, not enforced |
| An agent-only workflow (the skill does the bookkeeping in prose) | Flexible | Non-deterministic bookkeeping; hashes and gates done by a model; no reproducible status |
| A hosted job runner (queue on Render) | Automatic | Violates local-only model runs; captures are copyrighted and local; needs hosted credentials |
| **Deterministic CLI for state, hashing and gates; skill and subagents for judgment** | Chosen (shape agreed with Evan) | Mechanical parts are testable and reproducible; models only do judgment work and every output is gated; resumes from git; runs on Evan's machine with subscription CLIs |

## Decision
1. A CLI workspace `tools/catalog-pipeline` (`@ai-checkout/catalog-pipeline`) runs stages research → capture → extract → validate → draft → verify → adjudicate → apply → overlay → build → eval, then hands off to Evan for publish. It keeps one committed, text-free state record per card with input hashes; a stage re-runs only when its input hash changes, and staleness propagates downstream.
2. Every stage has a deterministic gate; failures go to a derived review queue. Evan's items are limited to scope questions and the publish step; content checks are done by subagents and recorded `agent-verified`.
3. Model calls happen only in research, extract, verify, adjudicate, overlay and an opt-in eval run, and only through Evan's local subscription CLIs (Codex for extraction and evals; Claude Code subagents for judgment). The CLI never starts Claude, never publishes, pushes, signs in or holds hosted credentials.
4. The Claude Code skill `expand-catalog` is the playbook; subagents `card-researcher`, `card-verifier` and `card-adjudicator` do the judgment steps. A verifier and its adjudicator are always separate runs.
5. Freshness after a release is a hash-only check (Stage 2 decision 1): pages are fetched to a temporary folder and compared by SHA-256; unchanged pages get a new `checkedOn` in a separate freshness file; changed pages become new dated captures in a new batch. Captures, released corpora, prompts and validator versions are never edited.
6. `rate_not_in_evidence` for "NX" multiples is fixed in a new validator version `v2-validator.2`; `validateExtractionV2` stays as `v2-validator.1` so published results do not move.
7. Boundary: product code (`extension`, `packages/*`, `apps/*`) never imports `tools/` or `@ai-checkout/catalog-pipeline`; the pipeline may import product packages. Enforced now by ESLint `no-restricted-imports` with a test.
8. The merchant-expansion pipeline (Phase 9) reuses the state, hashing, gate, queue and skill pattern, and ends in an extension release instead of a catalog publish.

Details, schemas, gates and the stage-to-script map: [card-expansion pipeline](../system/card-expansion-pipeline.md).

## Consequences
- The Stage 1 scripts move into the CLI as stage modules in Phase 8; until then they stay in `scripts/` unchanged.
- `.claude/skills/` and `.claude/agents/` are committed (draft definitions now); everything else under `.claude/` (local settings, agent worktrees) is gitignored.
- The boundary lint rule exists before the workspace, so no product import of `tools/` can appear in between.
- Open questions on the design page (batch layout, noisy pages under hash-only freshness, re-verification on convention changes, PR ownership, overlay authoring agent, research web scope) are Evan's to answer before Phase 8; the coordinator's recommended answers (2026-10-02) are on that page, pending his approval.

## Status
Proposed 2026-10-02 by the M11 agent (claude-code/claude-opus-5-5). Evan approves or amends; on approval this becomes `accepted` and the design page leaves draft once Stage 2 M5 has settled the overlay and builder.
