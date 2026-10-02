---
type: System Component
title: Catalog expansion (Phase 7)
description: The in-progress pipeline that grows the catalog from seven cards to 180 cards of the top-10 U.S. issuers — research, capture, LLM extraction, draft labels, verification — with results so far and the remaining work.
status: draft
tags: [system, catalog, curation, expansion, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:10:00Z
verified_commit: fc66e07
---

# Catalog expansion (Phase 7)

Phase 7 widens the card catalog to the consumer cards of the ten largest U.S. issuers ([scope decision](../decisions/2026-10-01-top-ten-issuer-card-expansion.md)). Work lives on branch `phase7-catalog-expansion` (worktree `../AICheckout-expansion`, cut from `main` at `ff0c9f7`, **not merged**; head `fc66e07` on 2026-10-02). None of its files exist on `main`, so the paths below are named, not linked. Capture, extraction and the first summary are done; labels, verification, engine work and the eval remain.

Read on 2026-10-02 from the expansion worktree (committed files plus the uncommitted `extraction-summary.json`); nothing was re-run for this page.

## Facts

| Item | Value | Where (expansion branch) |
| --- | --- | --- |
| Issuers | Chase, American Express, Citi, Capital One, Bank of America, Wells Fargo, Discover, U.S. Bank, Barclays, Synchrony | `docs/research/cards-2026/<issuer>.json` (agent research drafts, unverified) |
| Cards | 180: 130 co-brand, 32 personal rewards, 10 secured, 8 student; 6 closed-loop store cards | `evals/curation/expansion/cards.json` |
| Cards by issuer | Chase 29, Synchrony 28, Barclays 26, Capital One 21, Bank of America 19, U.S. Bank 18, Citi 16, Amex 11, Discover 6, Wells Fargo 6 | same |
| Exclusions | 65: 44 closed to new applicants, 7 already in the real corpus, 7 earn no rewards, 4 Discover duplicates, 3 merged into another card | `exclusions.json` |
| Sources | 321 official pages, all captured (0 failed); captures gitignored | `sources.json`, `manifest.json`, `capture-report.md` |
| Extraction config | Codex CLI, gpt-5.6-luna, effort `xhigh`, prompt `guided.2`, selection `keyword-window.1`, visible output tokens; 600 s per attempt, 900 s total, concurrency 8; at most 4 documents and ~64k input tokens per card | `scripts/extract-cards.mjs`, `extraction-summary.json` |
| Extraction result | 180 cards: 168 `needs_review`, 12 `evidence_valid`; mean ~184 s per card | `extraction-summary.json` |

Scripts (all on the expansion branch):

| Script | Does |
| --- | --- |
| `scripts/build-expansion-cards.mjs` | Consolidates the issuer research drafts into `cards.json`, `exclusions.json`, `sources.json`. Research only chooses cards and pages; no research value enters the catalog |
| `scripts/capture-issuer-pages.mjs` | Captures the pages (one sequential run per issuer host, 2.5 s apart, per-source hints in `capture-hints.json`) |
| `scripts/merge-capture-manifests.mjs` | Merges per-run manifests from `parts/` into `manifest.json`, dropping entries whose file is missing or whose hash differs |
| `scripts/expansion-capture-report.mjs` | Writes `capture-report.md`: per-issuer counts and flagged sources, no captured text |
| `scripts/extract-cards.mjs` | Runs the v2 extraction per card; traces to gitignored `extractions/`, a text-free summary to `extraction-summary.json`; resumable, pauses on usage limits |
| `scripts/draft-expansion-labels.mjs` | Turns extractions into `corpus.draft.json` (`annotationStatus: agent-drafted`, only values whose evidence resolves), `product-notes.json` (rules the extraction schema cannot express) and `verify/<issuer>.md` verifier packets |

## Findings so far

Finding counts across the 180 extractions: `rate_not_in_evidence` 408 (on 98 cards), `reported_missing` 237, `quote_not_found` 123, `reported_ambiguous` 78, `reported_out-of-scope` 66, `reported_conflicting` 29, `missing_evidence` 17, `reported_untrusted-instruction` 1.

- **`rate_not_in_evidence` is mostly a validator gap, not model error.** Points and miles cards state rates like "4X Membership Rewards points"; the extraction maps them to basis points at an implicit 1 cent per point, but the check in `apps/api/src/curation/extraction.ts` only recognizes percentages (`N%` or `N percent`) in the cited quote. Fixing it needs a schema decision on points valuation (cents per point per currency, and whether the catalog ranks points cards by a stated or an assumed value).
- The extraction contract has no slot for merchant-specific rules, chosen or rotating categories, relationship tiers, store-only earning or checkout-method rules; `draft-expansion-labels.mjs` records those as product notes for the engine work.

## Remaining work

1. Draft labels (`draft-expansion-labels.mjs`; outputs exist but were uncommitted on 2026-10-02).
2. Independent verifier subagents per issuer against the captures; record as agent-verified ([decision](../decisions/2026-09-29-agent-verified-labels.md)).
3. Stage-2 engine and catalog work in [`packages/rewards-core`](rewards-engine.md): merchant-specific rules, cardholder-chosen and rotating categories, relationship tiers, closed-loop store cards, PayPal and Venmo rules, new merchant categories, points valuation; raise catalog limits from 30 cards / 30 sources (Zod `catalogV2Schema` and the SQL validator in `20260930225732_catalog_v2.sql`) to about 200 / 450 through a **new** migration (also check `MAX_CATALOG_BYTES`, 256 KiB, against the larger catalog); wallet search in the extension.
4. Evaluate on the 180 expansion cards plus the seven existing ones.
5. Evan publishes the release in the review app.

## Gotchas

- Captures and extraction traces quote issuer text: both stay gitignored (`evals/curation/expansion/captures/`, `extractions/`). Committed files hold only URLs, hashes, counts and short anchors.
- `extract-cards.mjs` redoes any saved extraction made with another configuration, so a set always comes from one configuration; the gitignored `extractions-gpt55/` (90 files on 2026-10-02) holds traces from an earlier configuration, by its name gpt-5.5.

## Related

* [Cards](../domain/cards.md)
* [Curation harness](curation-harness.md)
* [Evaluation](evaluation.md)
* [Decision: gpt-5.6-luna for curation](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md)
* [Roadmap](../product/roadmap.md)
