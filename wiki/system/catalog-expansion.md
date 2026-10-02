---
type: System Component
title: Catalog expansion (Phase 7)
description: The in-progress pipeline that grows the catalog from seven cards to the consumer cards of the top-10 U.S. issuers — research, capture, LLM extraction, draft labels with 25-word quotes, per-issuer agent verification and adjudication, and the 173-card agent-verified corpus `expansion.v1` — with results, known gaps and the remaining work.
status: draft
tags: [system, catalog, curation, expansion, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:00:00Z
verified_commit: 4b487da
---

# Catalog expansion (Phase 7)

Phase 7 widens the card catalog to the consumer cards of the ten largest U.S. issuers ([scope decision](../decisions/2026-10-01-top-ten-issuer-card-expansion.md)). The capture, extraction and first drafts merged into `main` with PR #16 (`be5de25`, branch `phase7-catalog-expansion`). The 25-word drafts, the verification findings, the conventions and the agent-verified corpus are on branch `phase7-verify` (worktree `../AICheckout-expansion`, cut from `be5de25`; committed, not pushed), so the paths below are named, not linked. Engine work and the eval remain.

Read on 2026-10-02 from the `phase7-verify` worktree at `4b487da` (no model call, no re-capture).

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
| Draft labels | 159 of 180 cards drafted (21 had no anchored rules or currency), 736 rules, 335 exclusions; product hints: 125 anchored, 50 unanchored (94/27 merchant-specific, 13 chosen-category, 10/17 relationship-tier, 4 rotating, 3 checkout-method, 6 closed-loop unanchored, 1 automatic top category). Every quote is at most 25 words | `corpus.draft.json`, `product-notes.json`, `verify/<issuer>.md` — committed |
| 25-word cut (2026-10-02) | Evidence quotes processed: value anchors 1,168 kept, 693 shortened, 4 kept with a mismatch flag, 31 dropped; issuer wordings 751 kept, 14 shortened, 18 not verbatim (clipped, flagged); exclusion anchors 420 kept, 212 shortened; issue anchors 268 kept, 103 shortened; hint anchors 87 kept, 38 shortened, 8 lines dropped (the research quote itself was used instead; no hint lost its anchor). Labels changed: one rule dropped (`amex-hilton-honors-surpass` all-purchases at 300 bps, which no quote supports), three point values and one time limit set to null (no 25-word window states them); all flagged in `draftNotes` | `product-notes.json` `draftNotes` |
| Verification findings | One file per issuer, all 10 adjudicated (`apply-expansion-verification.mjs --check` clean): 1,211 findings accepted, 83 modified, 37 rejected; additions 187 rules, 62 exclusions, 85 issues, 203 product-note changes | `verification/<issuer-slug>.json`, format and verifier brief in `verification/README.md`, conventions in `verification/conventions/` |
| Verified corpus | `corpus.json`, corpus v2 `expansion.v1`, `agent-verified`: 173 cards (180 − 7 dropped), 863 rules, 396 exclusions, 195 issues; at most 20 rules per card (`us-bank-edward-jones-triple-rewards` has exactly 20); no `cash-back` card has a point value; every category is a shared one | `corpus.json`, `product-notes.verified.json`, `verification-report.md` |

Scripts (all on the expansion branch):

| Script | Does |
| --- | --- |
| `scripts/build-expansion-cards.mjs` | Consolidates the issuer research drafts into `cards.json`, `exclusions.json`, `sources.json`. Research only chooses cards and pages; no research value enters the catalog |
| `scripts/capture-issuer-pages.mjs` | Captures the pages (one sequential run per issuer host, 2.5 s apart, per-source hints in `capture-hints.json`) |
| `scripts/merge-capture-manifests.mjs` | Merges per-run manifests from `parts/` into `manifest.json`, dropping entries whose file is missing or whose hash differs |
| `scripts/expansion-capture-report.mjs` | Writes `capture-report.md`: per-issuer counts and flagged sources, no captured text |
| `scripts/extract-cards.mjs` | Runs the v2 extraction per card with the curation defaults (`apps/api/src/curation/curation-model.ts`); traces to gitignored `extractions/`, a text-free summary to `extraction-summary.json`; resumable, pauses on usage limits |
| `scripts/draft-expansion-labels.mjs` | Turns extractions into `corpus.draft.json` (`annotationStatus: agent-drafted`, only values whose evidence resolves; its description names the extraction configuration from `extraction-summary.json`), `product-notes.json` (rules the extraction schema cannot express) and `verify/<issuer>.md` verifier packets. Every anchor, issuer wording and hint anchor is a verbatim capture span of at most 25 words that keeps the value's evidence (helpers in `scripts/lib/expansion-quotes.mjs`, [decision](../decisions/2026-10-02-expansion-quote-limit-and-verification-format.md)) |
| `scripts/check-expansion-quotes.mjs` | Fails if any committed expansion file (drafts, packets, findings, verified corpus, report) repeats more than 25 consecutive words of a capture, or has a corpus anchor or issuer wording over 25 words. Needs the local captures; run before committing those files |
| `scripts/apply-expansion-verification.mjs` | Validates `verification/*.json` (Zod schema in `scripts/lib/expansion-verification.mjs`), checks every quote is at most 25 words and verbatim in the capture it names, applies accepted and modified fixes, and writes `corpus.json` (`expansion.v1`, `agent-verified`, only cards whose verification is complete and adjudicated), `product-notes.verified.json` and `verification-report.md`. `--check` writes nothing; any error stops it before writing |

## Findings so far

Finding counts across the 180 extractions: `rate_not_in_evidence` 408 (on 98 cards), `reported_missing` 237, `quote_not_found` 123, `reported_ambiguous` 78, `reported_out-of-scope` 66, `reported_conflicting` 29, `missing_evidence` 17, `reported_untrusted-instruction` 1.

- **`rate_not_in_evidence` is mostly a validator gap, not model error.** Points and miles cards state rates like "4X Membership Rewards points"; the extraction maps them to basis points at an implicit 1 cent per point, but the check in `apps/api/src/curation/extraction.ts` only recognizes percentages (`N%` or `N percent`) in the cited quote. Fixing it needs a schema decision on points valuation (cents per point per currency, and whether the catalog ranks points cards by a stated or an assumed value).
- The extraction contract has no slot for merchant-specific rules, chosen or rotating categories, relationship tiers, store-only earning or checkout-method rules; `draft-expansion-labels.mjs` records those as product notes for the engine work.

## Verification (done 2026-10-02)

Process ([decision](../decisions/2026-10-02-expansion-verification-conventions.md), [agent-verified labels](../decisions/2026-09-29-agent-verified-labels.md)): nine verifier subagents (one per issuer, plus a second, independent opinion on Chase) checked every draft value against the captures and wrote `verification/<issuer-slug>.json`; eight adjudicator subagents decided every finding (all Claude Code subagents on claude-opus-5-5). The coordinator set the general conventions after the first verifier pass (`verification/conventions/general.md` rules 1–12) and clarified them after adjudication (rules 13–19); issuer-specific decisions live in one conventions file per issuer. A final consistency pass (2026-10-02) applied rules 13–19 across all issuers and recorded each change in the issuer's findings file as an accepted finding: Gap Inc. Encore family point value 20 plus a store-only issue (rule 14), store-only issues on Barnes & Noble, Macy's and Bloomingdale's (14), Prime and Walmart+ gate issues on the Amazon Store, Amazon Secured and OnePay cards (17), partial-option issues on Cash+, Cash+ Secured and Strata (19), and the issues without a problem-stating anchor on Marriott Bonvoy Bold and the Amazon Store Card removed (16).

| Issuer | Cards | Confirmed | Fixed | Dropped |
| --- | --- | --- | --- | --- |
| American Express | 11 | 0 | 11 | 0 |
| Bank of America | 19 | 1 | 18 | 0 |
| Barclays | 26 | 3 | 23 | 0 |
| Capital One | 21 | 2 | 18 | 1 |
| Chase | 29 | 1 | 28 | 0 |
| Citi | 16 | 0 | 16 | 0 |
| Discover | 6 | 0 | 6 | 0 |
| Synchrony | 28 | 0 | 23 | 5 |
| U.S. Bank | 18 | 3 | 14 | 1 |
| Wells Fargo | 6 | 0 | 6 | 0 |
| **Total** | 180 | 10 | 163 | 7 |

Dropped: `capital-one-kohls-rewards-visa`, `synchrony-mylowes-rewards-credit-card`, `synchrony-dicks-mastercard`, `synchrony-belk-rewards-mastercard` and `us-bank-state-farm-good-neighbor` (captures state no earn rate); `synchrony-phillips-66-credit-card` and `synchrony-techron-advantage-visa` (cents-per-gallon fuel rewards).

Known gaps in the verified labels:

- **Gated rates (rule 17).** Rates that need a paid membership or a spend tier (Prime on Prime Visa and the Amazon Store and Secured cards, Walmart+ on OnePay, Sam's Club Plus, J.Crew Passport tiers, store loyalty tiers) keep the stated rate with an `out-of-scope` or `ambiguous` issue until the engine supports conditions (Stage 2).
- **Redemption values that are not point values (rule 18)** sit in the closest existing product-note type until a redemption note type exists (Stage 2).
- **Time-limited rotating rules.** Chase Freedom Flex and the Discover it rotating cards keep only the Q4 2026 categories, which end 2026-12-31; the corpus needs a refresh before then.
- **Upromise 1.529%** (`barclays-upromise-world-mastercard`, linked College Savings Plan) has `rateBps` null, because 152.9 bps is not an integer; the base rule is 125.
- **Marriott Bonvoy Bold** (Chase) has no base rate: the captures state none, and the anchorless `missing` issue was removed under rule 16.
- **Key Rewards** (Williams Sonoma, Pottery Barn, West Elm, Key Rewards Visa) are four near-duplicate cards with byte-identical captures and the same labels.

## Remaining work

1. Stage-2 engine and catalog work in [`packages/rewards-core`](rewards-engine.md): merchant-specific rules, cardholder-chosen and rotating categories, relationship tiers, closed-loop store cards, PayPal and Venmo rules, new merchant categories, points valuation; raise catalog limits from 30 cards / 30 sources (Zod `catalogV2Schema` and the SQL validator in `20260930225732_catalog_v2.sql`) to about 200 / 450 through a **new** migration (also check `MAX_CATALOG_BYTES`, 256 KiB, against the larger catalog); wallet search in the extension; gated rates (rule 17) and a redemption note type (rule 18).
2. Evaluate on the 173 verified expansion cards plus the seven existing ones.
3. Evan publishes the release in the review app.

## Gotchas

- Captures and extraction traces stay gitignored (`evals/curation/expansion/captures/`, `extractions/`). The drafts, packets and findings are committed only because every quote in them is at most 25 words; run `node scripts/check-expansion-quotes.mjs` before committing a change to them.
- The cut keeps the longest window (25 words) around the value's token, so an anchor may start or end mid-clause; verifiers must read the capture around it. A long quote that only states another rate or amount than the draft is kept and flagged as a mismatch (how the `amex-gold` cap errors show up), not dropped.
- `loadCorpusV2` reads `corpus.v2.json` and a manifest of at most 100 sources; the expansion has 321 sources and writes `corpus.json`. The eval step needs a loader or limits that fit.
- `extract-cards.mjs` redoes any saved extraction made with another configuration, so a set always comes from one configuration; the gitignored `extractions-gpt55/` (90 files on 2026-10-02) holds traces from an earlier configuration, by its name gpt-5.5. It was kept: `draft-expansion-labels.mjs` reads only `extractions/`, and the draft outputs from that trial were overwritten by the luna run's.

## Related

* [Cards](../domain/cards.md)
* [Curation harness](curation-harness.md)
* [Evaluation](evaluation.md)
* [Decision: gpt-5.6-luna for curation](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md)
* [Decision: 25-word expansion quotes and the verification format](../decisions/2026-10-02-expansion-quote-limit-and-verification-format.md)
* [Decision: expansion verification conventions](../decisions/2026-10-02-expansion-verification-conventions.md)
* [Roadmap](../product/roadmap.md)
