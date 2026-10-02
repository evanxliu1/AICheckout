---
type: Decision
title: Cut expansion quotes to 25-word evidence windows; per-issuer findings files with a second-pass adjudication
description: The expansion drafts are committed with every capture quote cut to a verbatim window of at most 25 words that keeps the value's token; verifiers write structured findings per issuer, a second agent adjudicates each finding, and only adjudicated cards enter the agent-verified corpus.
status: accepted
tags: [decision, catalog, curation, expansion, copyright, verification]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T18:30:00Z
sources:
  - resource: ../system/catalog-expansion.md
    title: Catalog expansion (Phase 7)
  - resource: ./2026-09-29-agent-verified-labels.md
    title: Agent-verified labels
---

# Cut expansion quotes to 25-word evidence windows; per-issuer findings files with a second-pass adjudication (2026-10-02)

## Context

The expansion drafts (`corpus.draft.json`, `product-notes.json`, `verify/*.md`) were gitignored because their anchors ran up to 400 characters, beyond the project's 25-word limit for committed issuer quotes. Per-issuer verifier subagents come next and need a findings format that a script can check and apply, and the real corpus (`real.v2.2`) was verified by agents, so provenance must stay `agent-verified`.

## Options considered

| Option | Why not / why |
| --- | --- |
| Cut each quote to its first 25 words | Often loses the rate or cap amount, which sit mid-sentence; the anchor would no longer support the value |
| Re-extract with a 25-word quote limit in the prompt | New live runs and a new prompt version for a formatting problem |
| **Best 25-word window that carries the value's token** (chosen) | Deterministic, no model call; keeps the rate, cap amount, activation, location or time-limit words; a quote with no such window is dropped and flagged |
| Free-form verifier notes (as the packets first asked) | Cannot be validated or applied mechanically |
| **JSON findings per issuer, Zod-validated, with per-finding adjudication** (chosen) | Every quote checked against its named capture; stale findings caught by the `current` value; a second agent decides each finding |

## Decision

- `draft-expansion-labels.mjs` writes every anchor, issuer wording and hint anchor as a verbatim capture span of at most 25 words (same matching as the corpus: whitespace and quotation-mark insensitive). A longer quote becomes its 25-word window that matches the field's evidence pattern (the rate in basis points as "4X", "4%", "four"; the cap amount as "$50,000"; activation, U.S.-only, time-limit or currency words), ranked by keyword hits from the rule's wording. If only a different rate or dollar amount is stated, the window is kept and flagged as a mismatch; if nothing fits, the quote is dropped and flagged in `draftNotes`. Research and extraction free text is clipped to 25 words. Issuer wordings that do not resolve are clipped and flagged for the verifier.
- `scripts/check-expansion-quotes.mjs` must pass before committing the expansion outputs: no string repeats more than 25 consecutive words of any capture.
- Verifiers write `verification/<issuer-slug>.json` (format in `evals/curation/expansion/verification/README.md`). For points and miles cards `rateBps` stays the per-dollar multiple × 100; a point value is recorded only when a capture states one. A second agent adjudicates each finding (`accepted`, `rejected`, `modified`). `apply-expansion-verification.mjs` includes a card in `corpus.json` only when its file has an adjudicator, every finding is decided and the card is not dropped; a card without an entry is never marked verified.

## Consequences

- The drafts, packets and findings are committed and reviewable in PRs; captures and extraction traces stay gitignored.
- Some anchors start or end mid-clause; verifiers read the capture around them. 31 evidence quotes were dropped and 4 kept with a mismatch flag (including the `amex-gold` cap errors), all listed in `draftNotes`.
- The cut changed a few labels: one unsupported rule dropped, three point values and one time limit set to null.
- The points-valuation decision stays open; the rate convention keeps it reversible because a stated point value is stored separately.
