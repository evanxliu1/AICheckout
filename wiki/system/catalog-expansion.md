---
type: System Component
title: Catalog expansion (Phase 7)
description: The in-progress pipeline that grows the catalog from seven cards to 180 cards of the top-10 U.S. issuers — research, capture, LLM extraction, draft labels, verification — with results so far and the remaining work.
status: draft
tags: [system, catalog, curation, expansion, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:40:00Z
verified_commit: 93dd097
---

# Catalog expansion (Phase 7)

Phase 7 widens the card catalog to the consumer cards of the ten largest U.S. issuers ([scope decision](../decisions/2026-10-01-top-ten-issuer-card-expansion.md)). Work lives on branch `phase7-catalog-expansion` (worktree `../AICheckout-expansion`, cut from `main` at `ff0c9f7`, merged with `main` `3439b9f` on 2026-10-02, **not merged into `main`**). None of its files exist on `main`, so the paths below are named, not linked. Capture, extraction, the summary and the first draft labels are done; verification, engine work and the eval remain.

Read on 2026-10-02 from the expansion worktree; `draft-expansion-labels.mjs` was re-run on the luna extractions for this update (no model call, no re-capture).

## Facts

| Item | Value | Where (expansion branch) |
| --- | --- | --- |
| Issuers | Chase, American Express, Citi, Capital One, Bank of America, Wells Fargo, Discover, U.S. Bank, Barclays, Synchrony | `docs/research/cards-2026/<issuer>.json` (agent research drafts, unverified) |
| Cards | 180: 130 co-brand, 32 personal rewards, 10 secured, 8 student; 6 closed-loop store cards | `evals/curation/expansion/cards.json` |
| Cards by issuer | Chase 29, Synchrony 28, Barclays 26, Capital One 21, Bank of America 19, U.S. Bank 18, Citi 16, Amex 11, Discover 6, Wells Fargo 6 | same |
| Exclusions | 65: 44 closed to new applicants, 7 already in the real corpus, 7 earn no rewards, 4 Discover duplicates, 3 merged into another card | `exclusions.json` |
| Sources | 321 official pages, all captured (0 failed); captures gitignored | `sources.json`, `manifest.json`, `capture-report.md` |
| Extraction config | Codex CLI, gpt-5.6-luna, effort `xhigh`, prompt `guided.2`, selection `keyword-window.1`, visible output tokens; 600 s per attempt, 900 s total, concurrency 8; at most 4 documents and ~64k input tokens per card | `scripts/extract-cards.mjs`, `extraction-summary.json` |
| Extraction result | 180 cards: 168 `needs_review`, 12 `evidence_valid`; mean ~184 s per card | `extraction-summary.json` (committed; counts only, no issuer text) |
| Draft labels | 159 of 180 cards drafted (21 had no anchored rules or currency); product hints: 125 anchored, 50 unanchored (94/27 merchant-specific, 13 chosen-category, 10/17 relationship-tier, 4 rotating, 3 checkout-method, 6 closed-loop unanchored, 1 automatic top category) | `corpus.draft.json`, `product-notes.json`, `verify/<issuer>.md` — **gitignored** |

Scripts (all on the expansion branch):

| Script | Does |
| --- | --- |
| `scripts/build-expansion-cards.mjs` | Consolidates the issuer research drafts into `cards.json`, `exclusions.json`, `sources.json`. Research only chooses cards and pages; no research value enters the catalog |
| `scripts/capture-issuer-pages.mjs` | Captures the pages (one sequential run per issuer host, 2.5 s apart, per-source hints in `capture-hints.json`) |
| `scripts/merge-capture-manifests.mjs` | Merges per-run manifests from `parts/` into `manifest.json`, dropping entries whose file is missing or whose hash differs |
| `scripts/expansion-capture-report.mjs` | Writes `capture-report.md`: per-issuer counts and flagged sources, no captured text |
| `scripts/extract-cards.mjs` | Runs the v2 extraction per card with the curation defaults (`apps/api/src/curation/curation-model.ts`); traces to gitignored `extractions/`, a text-free summary to `extraction-summary.json`; resumable, pauses on usage limits |
| `scripts/draft-expansion-labels.mjs` | Turns extractions into `corpus.draft.json` (`annotationStatus: agent-drafted`, only values whose evidence resolves; its description names the extraction configuration from `extraction-summary.json`), `product-notes.json` (rules the extraction schema cannot express) and `verify/<issuer>.md` verifier packets. All three are gitignored: they quote issuer text beyond 25 words |

## Findings so far

Finding counts across the 180 extractions: `rate_not_in_evidence` 408 (on 98 cards), `reported_missing` 237, `quote_not_found` 123, `reported_ambiguous` 78, `reported_out-of-scope` 66, `reported_conflicting` 29, `missing_evidence` 17, `reported_untrusted-instruction` 1.

- **`rate_not_in_evidence` is mostly a validator gap, not model error.** Points and miles cards state rates like "4X Membership Rewards points"; the extraction maps them to basis points at an implicit 1 cent per point, but the check in `apps/api/src/curation/extraction.ts` only recognizes percentages (`N%` or `N percent`) in the cited quote. Fixing it needs a schema decision on points valuation (cents per point per currency, and whether the catalog ranks points cards by a stated or an assumed value).
- The extraction contract has no slot for merchant-specific rules, chosen or rotating categories, relationship tiers, store-only earning or checkout-method rules; `draft-expansion-labels.mjs` records those as product notes for the engine work.

## Remaining work

1. Trim quotes so the draft outputs can be committed: anchors run up to 400 characters (2026-10-02: 551 rule anchors, 166 exclusion anchors and 91 issue anchors over 25 words in `corpus.draft.json`; 46 hint anchors in `product-notes.json`), 15 issuer wordings run 26–36 words, and the verifier packets repeat those wordings and research summaries. Until then they are local only.
2. Independent verifier subagents per issuer against the captures, using `verify/<issuer>.md`; record as agent-verified ([decision](../decisions/2026-09-29-agent-verified-labels.md)).
3. Stage-2 engine and catalog work in [`packages/rewards-core`](rewards-engine.md): merchant-specific rules, cardholder-chosen and rotating categories, relationship tiers, closed-loop store cards, PayPal and Venmo rules, new merchant categories, points valuation; raise catalog limits from 30 cards / 30 sources (Zod `catalogV2Schema` and the SQL validator in `20260930225732_catalog_v2.sql`) to about 200 / 450 through a **new** migration (also check `MAX_CATALOG_BYTES`, 256 KiB, against the larger catalog); wallet search in the extension.
4. Evaluate on the 180 expansion cards plus the seven existing ones.
5. Evan publishes the release in the review app.

## Gotchas

- Captures, extraction traces and the draft outputs quote issuer text: all stay gitignored (`evals/curation/expansion/captures/`, `extractions/`, `corpus.draft.json`, `product-notes.json`, `verify/`). Committed files hold only URLs, hashes and counts.
- `extract-cards.mjs` redoes any saved extraction made with another configuration, so a set always comes from one configuration; the gitignored `extractions-gpt55/` (90 files on 2026-10-02) holds traces from an earlier configuration, by its name gpt-5.5. It was kept: `draft-expansion-labels.mjs` reads only `extractions/`, and the draft outputs from that trial were overwritten by the luna run's.

## Related

* [Cards](../domain/cards.md)
* [Curation harness](curation-harness.md)
* [Evaluation](evaluation.md)
* [Decision: gpt-5.6-luna for curation](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md)
* [Roadmap](../product/roadmap.md)
