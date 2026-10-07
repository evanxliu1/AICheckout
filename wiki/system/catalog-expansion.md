---
type: System Component
title: Catalog expansion (Phase 7)
description: How the catalog grew from seven cards to 178 cards of the top-10 U.S. issuers — research, capture, LLM extraction, draft labels with 25-word quotes, per-issuer agent verification and adjudication, the 173-card agent-verified corpus `expansion.v1`, valuation, overlay and the catalog v3 build — with results and known gaps. Done 2026-10-03 (hosted release 2); the Phase 9 pipeline renewal supersedes the build as the current catalog.
status: stable
tags: [system, catalog, curation, expansion, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
verified_commit: e940b6f
---

# Catalog expansion (Phase 7)

Phase 7 widens the card catalog to the consumer cards of the ten largest U.S. issuers ([scope decision](../decisions/2026-10-01-top-ten-issuer-card-expansion.md)). The capture, extraction and first drafts merged into `main` with PR #16 (`be5de25`, branch `phase7-catalog-expansion`). The 25-word drafts, the verification findings, the conventions and the agent-verified corpus merged with PR #17 (`23d3d52`, branch `phase7-verify`); the paths below are in `evals/curation/expansion/` and `scripts/`. The gitignored captures and extraction traces are still only in the `../AICheckout-expansion` worktree. Stage 2 (engine, catalog v3, eval, release) is planned in the [Phase 7 Stage 2 plan](../product/phase-7-stage-2.md); as of 2026-10-03 M1–M9 and the M11 draft are merged (PRs #18–#30), M10 part 2 is on `s2-m10b-finish`, the extension bundles the 178-card `CATALOG_V3`, and Evan's publish of the hosted release is left ([catalog release](../ops/catalog-release.md)). Stage 2 finished on 2026-10-03: M10 part 2 merged (PR #31) and `2026-10-02.expansion.1` was published as hosted release 2. Cards are now maintained by the [card-expansion pipeline](card-expansion-pipeline.md): the Phase 9 renewal `2026-10-05.renewal.1` (hosted release 3 since 2026-10-05) takes 111 cards from pipeline batches and the rest from this page's frozen `expansion.v1` and `real.v2.2` layers.

Read on 2026-10-02 from the `phase7-verify` worktree at `4b487da` (no model call, no re-capture).

## Facts

| Item | Value | Where |
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
| Verification findings | One file per issuer, all 10 adjudicated (`apply-expansion-verification.mjs --check` clean): 1,215 findings accepted, 83 modified, 37 rejected; additions 187 rules, 62 exclusions, 85 issues, 203 product-note changes | `verification/<issuer-slug>.json`, format and verifier brief in `verification/README.md`, conventions in `verification/conventions/` |
| Verified corpus | `corpus.json`, corpus v2 `expansion.v1`, `agent-verified`: 173 cards (180 − 7 dropped), 863 rules, 396 exclusions, 195 issues; at most 20 rules per card (`us-bank-edward-jones-triple-rewards` has exactly 20); no `cash-back` card has a point value; every category is a shared one | `corpus.json`, `product-notes.verified.json`, `verification-report.md` |

Scripts (on `main` since PR #17):

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

## Eval (Stage 2 M9, 2026-10-02)

[`docs/evals/expansion.md`](../../docs/evals/expansion.md), from committed files and the saved luna traces, no model call. Verification changed 5.9% of the surviving draft rule-field values (321/5,448), removed 54 of 735 draft rules and added 182 rules. Of the 21 undrafted cards, 15 are in the corpus and 6 were dropped; 1 drafted card was dropped. The luna traces score 80.8% end to end against the verified labels (81.1% on the 158 drafted cards, an upper bound because those labels were seeded from the same traces; 77.0% on the 15 undrafted). The gpt-5.5 cross-model run (one repeat, 2026-10-02) scores 76.2% end to end on all 173 cards (76.7% drafted, 69.1% undrafted); on matched rules it ties luna (94.3% vs 94.8%), and it trails on rule recall (81.6%) and issue recall (15.4%).

## Verification (done 2026-10-02)

Process ([decision](../decisions/2026-10-02-expansion-verification-conventions.md), [agent-verified labels](../decisions/2026-09-29-agent-verified-labels.md)): nine verifier subagents (one per issuer, plus a second, independent opinion on Chase) checked every draft value against the captures and wrote `verification/<issuer-slug>.json`; eight adjudicator subagents decided every finding (all Claude Code subagents on claude-opus-5-5). The coordinator set the general conventions after the first verifier pass (`verification/conventions/general.md` rules 1–12) and clarified them after adjudication (rules 13–19); issuer-specific decisions live in one conventions file per issuer. A final consistency pass (2026-10-02) applied rules 13–19 across all issuers and recorded each change in the issuer's findings file as an accepted finding: Gap Inc. Encore family point value 20 plus a store-only issue (rule 14), store-only issues on Barnes & Noble, Macy's and Bloomingdale's (14), Prime and Walmart+ gate issues on the Amazon Store, Amazon Secured and OnePay cards (17), partial-option issues on Cash+, Cash+ Secured and Strata (19), and the issues without a problem-stating anchor on Marriott Bonvoy Bold and the Amazon Store Card removed (16). A pre-merge review (2026-10-02, agent-verified) spot-checked 31 cards across all ten issuers against the captures and found no label the captures contradict; it set the Customized Cash family's automatic 2% grocery rule to activation `none` (general 7, four accepted findings).

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

**Copyright adjacency fix (2026-10-02).** A reviewer found anchors that are within 25 words each but, read together, repeat up to 50 consecutive capture words: two cut windows of one sentence that overlap, or consecutive sentences that abut. `check-expansion-quotes.mjs` now also checks every JSON array of quotes (strings or anchor `quote`s) for spans that overlap or abut into a run of more than 25 capture words, reads consecutive markdown lines and cells as one text, and scans `verification/README.md` and `verification/conventions/*.md` (general rule 22). Before the fix it flagged 154 anchor arrays in `corpus.json` (67 distinct passages: 30 abutting, 37 overlapping), 119 in `corpus.draft.json` (49 passages) and 79 in the findings files. `draft-expansion-labels.mjs` now keeps the first anchor and cuts a later one that runs on from it to its longest part clear of it (one-word gap) that still carries its evidence, or drops it (101 anchors cut, 19 dropped). In the findings, 83 findings had an anchor quote shortened or replaced by an equivalent draft anchor (reason marked "copyright adjacency fix 2026-10-02"), and 21 accepted fixes had their `current` rebased onto the regenerated drafts (removals of rules, issues or anchors the drafts now cut). Labels are unchanged apart from anchors (compared programmatically, 173 cases), except one rule-21 fix below.

**Caps (rule 21).** Of 332 rules with `cap.kind: "none"`, 298 have a no-cap anchor; of the other 34, 33 are backed by a capture sentence (card-wide terms such as "no limit to the total points you can earn", "No Mileage Cap", "unlimited 2X"); `marriott-bonvoy-boundless` 6X hotels had only a section heading, so its cap is now null (accepted finding in `chase.json`). The reviewer's examples (Prime Visa, Costco Anywhere, Atmos Ascent base rate, Gap Encore) all have such a statement and keep `none`. No airline or hotel card has a point value (rule 20).

Dropped: `capital-one-kohls-rewards-visa`, `synchrony-mylowes-rewards-credit-card`, `synchrony-dicks-mastercard`, `synchrony-belk-rewards-mastercard` and `us-bank-state-farm-good-neighbor` (captures state no earn rate); `synchrony-phillips-66-credit-card` and `synchrony-techron-advantage-visa` (cents-per-gallon fuel rewards).

Known gaps in the verified labels:

- **Gated rates (rule 17).** Rates that need a paid membership or a spend tier (Prime on Prime Visa and the Amazon Store and Secured cards, Walmart+ on OnePay, Sam's Club Plus, J.Crew Passport tiers, store loyalty tiers) keep the stated rate with an `out-of-scope` or `ambiguous` issue until the engine supports conditions (Stage 2).
- **Redemption values that are not point values (rule 18)** sit in the closest existing product-note type until a redemption note type exists (Stage 2).
- **Time-limited rotating rules.** Chase Freedom Flex and the Discover it rotating cards keep only the Q4 2026 categories, which end 2026-12-31; the corpus needs a refresh before then.
- **Upromise 1.529%** (`barclays-upromise-world-mastercard`, linked College Savings Plan) has `rateBps` null, because 152.9 bps is not an integer; the base rule is 125.
- **Marriott Bonvoy Bold** (Chase) has no base rate: the captures state none, and the anchorless `missing` issue was removed under rule 16.
- **Judgment calls left as labelled (2026-10-02, coordinator):** One Key's Expedia/Hotels.com/Vrbo portal rule has `usMerchantsOnly: true` (bookings through the U.S. version of the sites); Discover it Chrome has no separate EV-charging rule, EV charging is treated as inside its gas rule; Prime Visa's Amazon rule has `usMerchantsOnly: null`; the JCPenney Mastercard per-transaction maximum is not modelled as a cap; inflight purchase rebates (statement credits on airline cards) are not earning rules and are left out.
- **Key Rewards** (Williams Sonoma, Pottery Barn, West Elm, Key Rewards Visa) are four near-duplicate cards with byte-identical captures and the same labels.

## Reward-program valuation (M3)

Milestone M3 (branch `s2-m3-valuations`, 2026-10-02, merged with PR #20) mapped every card to one of 52 programs with a value basis. The bases, checks, verification and the per-program table moved to [reward-program valuation](reward-program-valuation.md) on 2026-10-07.

## Catalog overlay (M4)

Stage 2 M4 (branch `s2-m4-catalog-overlay`, 2026-10-02, merged with PR #25) adds [`catalog-overlay.json`](../../evals/curation/expansion/catalog-overlay.json) and [`merchants.json`](../../evals/curation/expansion/merchants.json), the product structure catalog v3 needs that the corpus labels cannot hold ([conventions decision](../decisions/2026-10-02-catalog-overlay-conventions.md)). The corpus, product notes and reward-programs files are unchanged (a test pins their SHA-256).

- **Format and check.** [`scripts/lib/catalog-overlay.mjs`](../../scripts/lib/catalog-overlay.mjs): Zod schemas, `checkOverlay` (every expansion card has an entry; every `other` rule, rule without a rate, spend cap without an after-cap rate, issue and hint has a disposition; patches guarded by the corpus category and rate; brand, gate, choice and program references resolve) and `draftCatalogV3`, which builds an unpublished catalog v3 from the corpora, programs, merchants and overlay and parses it with `catalogV3Schema`. Tests: `scripts/lib/catalog-overlay.test.mjs`. `check-expansion-quotes.mjs` scans both files and checks every overlay anchor and added-rule wording verbatim against the captures.
- **Process.** Eight authoring subagents wrote per-issuer fragments (Amex, Wells Fargo and Discover shared one), eight independent verifier subagents re-read them against the captures, and the coordinator adjudicated every finding; rules O1–O21 are in [`general.md`](../../evals/curation/expansion/verification/conventions/general.md) and each issuer's file has an "Overlay (Stage 2 M4)" section. Agent-verified, not human-verified.
- **Counts.** 173 card entries, 2 held out (Marriott Bonvoy Bold, U.S. Bank Shield: no base rate). `other` rules (284): 149 brand-scoped, 31 recategorized (home improvement, department stores, electronics, transit, PayPal/Venmo checkout as `all-purchases`), 101 held out (65 not at retail, 23 with no v3 category, the rest outside the U.S., peer-to-peer, purchase-level conditions or a fractional rate), 3 with the held-out card. All rule patches: 408 modelled, 103 held out, 7 field-unstated, 3 card-held-out. Issues: 84 modelled, 5 field-unstated, 106 noted. Hints: 161 modelled, 34 noted, 2 card-held-out.
- **Structure.** 140 brands; 24 gates (Prime, Amazon secured-card age, Sam's Club, Walmart+, Bank of America account for the Atmos boost, Gap Encore card level, CLUB, Macy's, Bloomingdale's, JCPenney, At Home, J.Crew, AAdvantage Executive spend, Smartly balance, and 10 per-card account-age gates for Customized Cash ×4, Key Rewards ×4, OnePay and JCPenney); 10 choices (Customized Cash ×4, Strata, Cash+ ×2 each, Edward Jones automatic); 4 closed-loop cards (Amazon Store, Amazon Secured, Newegg, Harbor Freight); 41 added rules (Freedom Flex Jan–Mar 2027 grocery and streaming from its product capture, tier and gated duplicates, Prime Visa without Prime, wholesale clubs); 18 store-credit cash-back programs (units in cents, except TJX Rewards Points worth one cent each); unit names and redemption brands for every program.
- **Merchants.** The three v2 profiles unchanged plus `brandIds` (`amazon-us` → `amazon`, `best-buy-us` → `best-buy`, `newegg-us` → `newegg`).
- **Categories.** No change: all four provisional v3 categories are used, none added, no migration.
- **Draft catalog.** 178 cards, 820 rules (at most 17 per card), about 607 KB (58% of 1 MiB).
- **Pre-merge review (2026-10-02, agent-verified).** Rankings at the three merchants hand-checked for 22 wallets with the merged engine. Two fixes ([decision](../decisions/2026-10-02-catalog-overlay-review.md)): account-age rates (Customized Cash first-year 6%, OnePay first-90-days 3% everywhere, Key Rewards first 30 days, JCPenney first 90 days) were always applied because the engine reads only `limitedTime` dates, so OnePay outranked Double Cash for every holder; they now need per-card gates (O20), and the check rejects a dateless limited-time rule without one. Store-credit unit names said dollars while the engine counts cents (O21).
- **For M5.** Rule IDs in the draft are long (`<cardId>-r<index>`); display names are corpus card names; Amex Platinum's $500,000 cap exceeds `MAX_AMOUNT_CENTS` and is carried as `unstated`; the Barnes & Noble 5% rebate sits in an unvalued points program; Discover's Q1 2027 categories were never captured; `programDetails` repeats the store-credit programs (use either, the check keeps them equal); BofA Customized Cash choice rules are also `enroll-once`, so a shopper who answers the choice still sees `activation-unknown` until the rule's activation is recorded.

## Catalog v3 build (M5)

Stage 2 M5 (branch `s2-m5-catalog-v3-build`, 2026-10-02, merged with PR #27) builds the release catalog `CATALOG_V3` ([`packages/rewards-core/src/catalog-v3.ts`](../../packages/rewards-core/src/catalog-v3.ts)) with `npm run catalog:v3` ([`scripts/build-catalog-v3.mjs`](../../scripts/build-catalog-v3.mjs), logic and tests in `scripts/lib/catalog-v3.mjs`); CI runs `catalog:v3:check`. The counts below are those of that first build, `2026-10-02.expansion.1` (hosted release 2); the current [build report](../../evals/curation/expansion/catalog-build-report.md) describes `2026-10-05.renewal.1` (816 rules, 71 programs, 602,925 bytes) ([decision](../decisions/2026-10-02-catalog-v3-build.md)).

- **Multi-batch since Phase 8 M1** (2026-10-04). The builder now reads the layers of [`evals/curation/catalog-batches.json`](../../evals/curation/catalog-batches.json) (this page's corpora are the frozen base layer `expansion.v1` + `real.v2.2`; pipeline batches follow), takes the version from that config and the dates from the capture manifests (newest issuer-source date, +30 days), keeps the seven dropped-card reasons there, and continues rule IDs against the append-only [`rule-id-ledger.json`](../../evals/curation/rule-id-ledger.json); `catalog:v3:check` also compares the ledger. Output unchanged byte for byte; the build report gained "Batches and dates" and "Rule-ID continuity" sections ([pipeline builder](card-pipeline-internals.md#multi-batch-catalog-builder), [decision](../decisions/2026-10-04-multi-batch-catalog-builder.md)).

- **Catalog.** Version `2026-10-02.expansion.1`, verified 2026-10-02, expires 2026-11-01T00:00Z (the 30-day maximum). 178 cards (171 expansion, 7 real), 820 rules (at most 17 per card), 328 sources, 70 programs (cash 19, published estimate 24, issuer-stated 11, none 16), 140 brands, 24 gates, 10 choices on 8 cards, 4 closed-loop cards, 18 cards with an issuer-stated value (19 before M10 part 2). Size 602,438 bytes JSON (57.5% of 1 MiB) and 643,324 bytes JSONB text (61.4%, the SQL measure; equal to the computed value in the parity harness).
- **Not in the catalog.** Held out by the overlay: `marriott-bonvoy-bold`, `us-bank-shield` (no base rate). Dropped in verification, never in the corpus: 5 cards with no stated earn rate and 2 fuel cards (cents per gallon).
- **Real cards** keep release 1's names, rule IDs and rule semantics; the build fails if they differ from `CATALOG_V2`. Since M10 part 2 all seven earn cash back: Double Cash maps to `cash-back` under general rule 1 (M3 had ThankYou points at its stated 1¢, as release 1); the check compares the value of one rate unit, so the cents are the same ([decision](../decisions/2026-10-03-double-cash-cash-back.md)). The version stayed `2026-10-02.expansion.1` because the catalog was not yet published. A test compares v2 and v3 engine results for the seven cards at the three merchants across six purchase variants.
- **IDs and names.** Rule IDs are `<prefix>-base` or `<prefix>-<choice option, brand or category>` plus gate answer, required path and start month where present (`prime-amazon-member`, `cash-plus-electronic-stores`, `freedom-flex-supermarkets-2026-10`); the prefix is the card ID without issuer and network words. Short names drop the issuer and network words ("Customized Cash Rewards", "Hilton Honors Surpass").
- **Quote limit.** Listed in one array, 8 corpus exclusions on 7 cards would join a neighbour into more than 25 capture words, so the catalog omits them (the corpus keeps them). `check-expansion-quotes.mjs` now scans the built catalog and the build report; pass the real capture folders too (`--captures` for `expansion/captures`, `real/captures`, `real/merchant-captures`).
- **Checks.** Zod (`catalogV3Schema`), SQL (`valid_catalog_v3` and `valid_catalog` in `scripts/test-catalog-parity.mjs`, local stack, 2026-10-02), pgTAP with the v3 seed (218 tests), quote check (338 captures).
- **Golden ladders** (`extension/tests/catalog-v3-golden.test.ts`, $100 on 2026-10-15). Hand-computed, then reviewed against the captures by an independent subagent: all 16 confirmed, no catalog, overlay or engine error; the reviewer added W17 (agent-verified, not human-verified).

| Wallet | Amazon | Best Buy | Newegg |
| --- | --- | --- | --- |
| W1 seven release-1 cards | Double Cash 2% (tied with Active Cash; BCE 1–3%) | same | same |
| W2 Prime member, BCE with cap room | Prime Visa 5%; Amazon Store Card 0–5% (cap unstated) | BCE 3%; store card not accepted | same as Best Buy |
| W3 not a Prime member | Prime Visa 3%; store card $0 | Double Cash 2% | same |
| W4 Prime unanswered | Prime Visa 3–5% | — | — |
| W5 Cash+ electronics chosen and active, My Best Buy | Double Cash 2% | Cash+ 5%; My Best Buy 1–5% | Cash+ 5% |
| W6 Newegg store card, Cash+ unanswered | Quicksilver 1.5% | Quicksilver 1.5%; Cash+ 1–5% | Quicksilver 1.5%; Newegg 0–4% |
| W7 points cards at 1¢ | Venture X 2X (tied with Active Cash) | same | same |
| W8 overrides UR 2.05¢, MR 1.5¢, miles 0.9¢ | Sapphire Preferred $2.05 | same | same |
| W9 unvalued Altitude, SKYPASS | Quicksilver; unvalued cards after, in units | same | same |
| W10 Altitude at 1.5¢ | Quicksilver tied with Altitude Go | same | same |
| W11 Customized Cash online, after year one | Customized Cash 3% | same | same |
| W12 Customized Cash online, first year | Customized Cash 6% | same | same |
| W13 PayPal Cashback, Venmo card by checkout method | card: BCE 3%; PayPal: PayPal Cashback 3%; Venmo: Venmo card 3% | card: BCE 3% | card: BCE 3% |
| W14 Smartly, tier unanswered | Double Cash 2% (Smartly 2–4%) | same | same |
| W15 Smartly $100,000 tier | Smartly 4% | same | same |
| W16 only store cards | Amazon Store Card 0–5% | no accepted card | Newegg 0–4% |
| W17 Customized Cash, year unanswered | 3–6%; through PayPal 1% | 3–6% | 3–6% |

- **Reviewer observations (no change made).** Closed-loop store cards with no stated cap guarantee $0 and rank below a flat 2% card (rule 21 plus the engine; M7 should show the 5%). NerdWallet values for bank currencies have no local capture. Customized Cash choice rules are also `enroll-once` (see M4 hand-off). My Best Buy certificates count at full cash value (O13).
- **Extension bundle.** After merging M6, M5 switched the extension's bundled fallback to `CATALOG_V3`. Under newest-valid-wins an installed extension with cached release 1 moves to it on update; the seven real cards keep their IDs and all 26 rule IDs, and usage rows are compared in v3 form, so their wallets keep every reported limit (test in `state-migration.test.ts`; [decision](../decisions/2026-10-03-bundled-catalog-v3.md)). Worker chunk 42,737 → 587,077 bytes; pages unchanged.
- **For M7 and M10.** M7: wallet search (178 cards in the editor), editors for choices, gates and point values. M10 publish, step by step in the [catalog release runbook](../ops/catalog-release.md): Evan starts a draft from `CATALOG_V3` in the review app and loads the capture folders `evals/curation/real/captures`, `evals/curation/real/merchant-captures` and `evals/curation/expansion/captures`: 328 sources, all present on Evan's machine on 2026-10-02 (312 expansion, 15 real, 2 merchant; `chase-rewards-category-faq` is in both the expansion and real folders with the same hash). The catalog expires 2026-11-01T00:00Z, so it must publish before then (target 2026-10-28).

## Remaining work

Superseded on 2026-10-02 by the milestones in the [Phase 7 Stage 2 plan](../product/phase-7-stage-2.md); the list below is the summary it was planned from.

1. Stage-2 engine and catalog work in [`packages/rewards-core`](rewards-engine.md): merchant-specific rules, cardholder-chosen and rotating categories, relationship tiers, closed-loop store cards, PayPal and Venmo rules, new merchant categories, points valuation; raise catalog limits from 30 cards / 30 sources (Zod `catalogV2Schema` and the SQL validator in `20260930225732_catalog_v2.sql`) to about 200 / 450 through a **new** migration (also check `MAX_CATALOG_BYTES`, 256 KiB, against the larger catalog); wallet search in the extension; gated rates (rule 17) and a redemption note type (rule 18).
2. Evaluate on the 173 verified expansion cards plus the seven existing ones. Stage 2 M9 (2026-10-02): pipeline metrics and the luna re-score are in [`docs/evals/expansion.md`](../../docs/evals/expansion.md); the gpt-5.5 cross-model run scores 76.2% end to end.
3. Evan publishes the release in the review app ([catalog release](../ops/catalog-release.md); target 2026-10-28, hard limit 2026-11-01T00:00Z). Done: release 2 on 2026-10-03.

## Gotchas

- Captures and extraction traces stay gitignored (`evals/curation/expansion/captures/`, `extractions/`). The drafts, packets and findings are committed only because every quote in them is at most 25 words; run `node scripts/check-expansion-quotes.mjs` before committing a change to them. The 25-word limit also applies to quotes read together: anchors of one item must not overlap or abut in the capture into a longer run (general rule 22).
- The cut keeps the longest window (25 words) around the value's token, so an anchor may start or end mid-clause; verifiers must read the capture around it. A long quote that only states another rate or amount than the draft is kept and flagged as a mismatch (how the `amex-gold` cap errors show up), not dropped.
- `loadCorpusV2` reads the expansion with layout `expansion` (`corpus.json`, up to 400 sources, every case held-out; `eval:v2 --corpus evals/curation/expansion --captures DIR`), added for Stage 2 M9 ([decision](../decisions/2026-10-02-expansion-eval-design.md)).
- `extract-cards.mjs` redoes any saved extraction made with another configuration, so a set always comes from one configuration; the gitignored `extractions-gpt55/` (90 files on 2026-10-02) holds traces from an earlier configuration, by its name gpt-5.5. It was kept: `draft-expansion-labels.mjs` reads only `extractions/`, and the draft outputs from that trial were overwritten by the luna run's.

## Related

* [Cards](../domain/cards.md)
* [Curation harness](curation-harness.md)
* [Evaluation](evaluation.md)
* [Decision: catalog overlay conventions](../decisions/2026-10-02-catalog-overlay-conventions.md)
* [Decision: NerdWallet as the primary valuation publisher](../decisions/2026-10-02-nerdwallet-primary-valuation-publisher.md)
* [Decision: gpt-5.6-luna for curation](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md)
* [Decision: 25-word expansion quotes and the verification format](../decisions/2026-10-02-expansion-quote-limit-and-verification-format.md)
* [Decision: expansion verification conventions](../decisions/2026-10-02-expansion-verification-conventions.md)
* [Roadmap](../product/roadmap.md)
