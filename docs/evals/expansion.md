# Expansion eval: 173 agent-verified cards

Phase 7 Stage 2 milestone M9, measured 2026-10-02. Data: [`expansion.json`](expansion.json), which holds every number below. It is written by `scripts/score-expansion-traces.mjs`, and its `pipeline` section is checked against the committed files by `npm test`. Sections (a) and (b) called no model. Section (c) is one live gpt-5.5 run collected 2026-10-02T22:31Z–22:42Z.

## Setup

- **Corpus** `expansion.v1` (`evals/curation/expansion/corpus.json`): 173 cards from the ten largest U.S. issuers. The pages were captured on 2026-10-02 (321 sources; captures are gitignored and hash-checked at load). Labels are **agent-verified, not human-verified**. `scripts/draft-expansion-labels.mjs` drafted them from gpt-5.6-luna extractions, one Claude verifier agent per issuer checked them against the captures, and a second agent pass adjudicated the findings ([catalog expansion](../../wiki/system/catalog-expansion.md)).
- **Never used for prompt tuning.** `guided.2` came out of the `real.v2.2` dev error analysis on 2026-09-29 (commit `0655c32`), and the prompt code (`apps/api/src/curation/v2/context.ts`) has not changed since. The expansion pages were captured later, on 2026-10-02. The eval loader therefore treats every expansion case as held-out (layout `expansion`), so any run on them needs `--allow-heldout`.
- **Scorer** `v2-scorer.2`, unchanged, with the same metrics as [`results.md`](results.md). The expansion has no mechanical variants (no planted injections or conflicts).
- This page reports three measurements separately. (a) The pipeline metrics show how much verification changed the drafts. (b) The re-scored luna traces measure agreement with labels seeded from those same traces, so they are an upper bound. (c) A cross-model run uses gpt-5.5, which neither drafted nor verified the labels.

## (a) Pipeline metrics: draft → verified

`node scripts/expansion-pipeline-metrics.mjs` reads committed files only: `cards.json`, `corpus.draft.json`, `corpus.json` and `verification/*.json`. Each draft rule that survives verification is compared value by value with its verified counterpart. Anchors are evidence, so they are not counted. The script fails if any changed value has no applied finding on it, or if a card's rule counts do not reconcile.

| Cards | Count |
| --- | --- |
| Researched | 180 |
| In the verified corpus | 173 |
| Drafted (labels seeded from a luna extraction) | 158 |
| Undrafted (no anchored draft; the verifier wrote every label from the captures) | 15 |
| Confirmed unchanged (verdict `confirmed`: no label fix or addition; 3 had product-note changes only) | 10 |
| Drafted cards whose values all stayed the same (anchors may differ) | 34 |
| Dropped by verification (1 drafted, 6 undrafted) | 7 |

| Rules and items (drafted cards) | Count |
| --- | --- |
| Draft rules | 735 |
| Removed by verifiers | 54 (7.3%) |
| Kept with every value unchanged | 408 (55.5%) |
| Added by verifiers (drafted cards) | 121 |
| Added on the 15 undrafted cards | 61 |
| Verified rules (all 173 cards) | 863 |
| Exclusions removed / added | 1 / 62 |
| Issues removed / added | 245 / 82 |
| Findings accepted / modified / rejected | 1,216 / 83 / 37 |

Correction rate per field, over the 681 draft rules that survive verification:

| Field | Changed | Rate |
| --- | --- | --- |
| `activation` | 144 | 21.1% |
| `issuerWording` | 84 | 12.3% |
| `rateBps` | 31 | 4.6% |
| `category` | 22 | 3.2% |
| `limitedTime` | 21 | 3.1% |
| `cap` | 12 | 1.8% |
| `usMerchantsOnly` | 7 | 1.0% |
| `paidOnPaymentBps` | 0 | 0.0% |
| **All rule fields** | 321 / 5,448 | **5.9%** |
| `pointValueHundredthsOfCent` (per drafted card) | 31 / 158 | 19.6% |
| `rewardCurrency` (per drafted card) | 14 / 158 | 8.9% |

By issuer:

| Issuer | Cards | In corpus | Drafted | Undrafted | Confirmed | Dropped | Draft rules | Removed | Added | Rule-field correction | Card-field correction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| American Express | 11 | 11 | 11 | 0 | 0 | 0 | 43 | 4 | 14 | 3.5% (11/312) | 18.2% (4/22) |
| Bank of America | 19 | 19 | 19 | 0 | 1 | 0 | 88 | 0 | 24 | 7.8% (55/704) | 7.9% (3/38) |
| Barclays | 26 | 26 | 25 | 1 | 3 | 0 | 106 | 1 | 16 | 11.1% (93/840) | 12.0% (6/50) |
| Capital One | 21 | 20 | 19 | 1 | 2 | 1 | 64 | 4 | 8 | 4.0% (19/480) | 13.2% (5/38) |
| Chase | 29 | 29 | 24 | 5 | 1 | 0 | 104 | 9 | 57 | 4.5% (34/760) | 4.2% (2/48) |
| Citi | 16 | 16 | 14 | 2 | 0 | 0 | 70 | 0 | 11 | 3.4% (19/560) | 14.3% (4/28) |
| Discover | 6 | 6 | 5 | 1 | 0 | 0 | 46 | 22 | 3 | 4.2% (8/192) | 0.0% (0/10) |
| Synchrony | 28 | 23 | 20 | 3 | 0 | 5 | 74 | 2 | 21 | 6.4% (37/576) | 42.5% (17/40) |
| U.S. Bank | 18 | 17 | 16 | 1 | 3 | 1 | 105 | 12 | 22 | 5.7% (42/744) | 9.4% (3/32) |
| Wells Fargo | 6 | 6 | 5 | 1 | 0 | 0 | 35 | 0 | 6 | 1.1% (3/280) | 10.0% (1/10) |

"Added" counts rules on drafted and undrafted cards. The rule-field rate covers the drafted cards' surviving rules × 8 fields; the card-field rate covers drafted cards × 2 fields.

- Most `activation` changes apply general convention 7 (`verification/conventions/general.md`): `none` when a capture says rewards are earned automatically, and `enroll-once` only for a one-time rewards enrollment. They are not rate errors.
- `pointValueHundredthsOfCent`: 20 of the 31 changes set a draft value to null, mainly store cards whose terms state a percentage back (convention 1: cash back, no point value) and travel-only redemption values (convention 20). The other 11 added a value the draft lacked.
- Discover's 22 removed rules are rotating-quarter rules from past 2026 quarters (convention 5 keeps only Q4 2026). Synchrony's card-field rate comes mostly from store cards whose terms state a percentage back: their currency went from `points` to `cash-back` and their point value to null.

## (b) Re-scored gpt-5.6-luna traces (upper bound)

> **Bias disclosure.** This is an upper bound, not an independent accuracy measure. The labels of the 158 drafted cards were seeded from these same gpt-5.6-luna extractions and then corrected by Claude verifier agents, so wherever a verifier left a luna value unchanged, it scores as correct. The 15 undrafted cards had no draft: verifiers wrote their labels from the captures. All labels are agent-verified, not human-verified.

`scripts/score-expansion-traces.mjs` turns the 180 saved traces into one observation bundle. The traces came from `scripts/extract-cards.mjs`: Codex CLI 0.158.0, gpt-5.6-luna, `xhigh`, `guided.2`, `keyword-window.1`, visible output tokens, one repeat, collected 2026-10-02. `evaluate()` checks each trace's document hashes and context hash against the corpus and the local captures, and all 173 match. The 7 traces of dropped cards are skipped. Provenance is `imported-unverified` because `eval:v2` did not collect these traces, although the inputs are verified.

| Set (agreement with labels seeded from luna) | Cards | Field acc. (e2e) | Field acc. (matched) | Rule recall | Rule prec. | Card fields | Claim prec. | Evidence valid | Issue recall | Exclusion recall | False-clean | p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All | 173 | 80.8% (4493/5559) | 94.8% | 85.6% (739/863) | 90.3% | 83.5% | 83.7% | 97.6% | 56.9% (111/195) | 88.1% | 5 | 183 s / 340 s |
| Drafted: upper bound | 158 | 81.1% (4211/5193) | 94.7% | 86.0% (690/802) | 90.1% | 85.8% | 83.4% | 97.6% | 60.4% (110/182) | 89.1% | 5 | 183 s / 353 s |
| Undrafted: labels written from the captures | 15 | 77.0% (282/366) | 95.9% | 80.3% (49/61) | 94.2% | 60.0% | 89.0% | 97.5% | 7.7% (1/13) | 71.4% | 0 | 172 s / 274 s |

- **Field errors (all 173):** `activation` 140, `rateBps` 59, `pointValueHundredthsOfCent` 32, `rewardCurrency` 25, `capKind` 16, `limitedTime` 16, `usMerchantsOnly` 9, other cap parts 5, `paidOnPaymentBps` 2. The largest groups mirror the corrections in (a). Labels say `activation: none` where luna gave no value (72), or `none` where luna said `enroll-once` (32). Luna also gave a 1-cent point value where the label is null (18).
- **Missed rules:** 124, of which 78 are `other` (the category that holds merchant- and partner-specific rules). Extra rules: 79.
- **False-clean (5):** `boa-customized-cash-rewards`, `capital-one-t-mobile-visa`, `capital-one-bjs-one-mastercard`, `disney-visa`, `us-bank-elan-fidelity-rewards`. Each passed the harness checks while the labels expect an issue.
- **Undrafted cards (n = 15):** the sample is small. Their card fields score low (60.0%, 18/30; 11 of the 12 errors are `rewardCurrency`), and their issue recall is 1/13.
- Field accuracy on matched rules (94.8%) is far above end to end (80.8%). Most of the gap is rules that luna missed and verifiers added.
- Per issuer, end to end: Wells Fargo 99.6%, Discover 95.5%, Citi 92.5%, Capital One 91.2%, U.S. Bank 84.0%, Synchrony 81.6%, Amex 80.1%, Barclays 77.5%, Chase 72.0%, Bank of America 69.7% (`expansion.json` `lunaRescore.byIssuer`).
- These numbers are not comparable with the `real.v2.2` rows in [`results.md`](results.md): the corpus, the labelling process and the card mix (102 points cards, merchant rules) all differ.

## (c) Cross-model run: gpt-5.5 low

Decision 4 of the [Stage 2 plan](../../wiki/product/phase-7-stage-2.md#decisions-on-the-plans-open-questions) calls for this run: gpt-5.5, effort `low`, prompt `guided.2`, selection `keyword-window.1`, through Codex CLI 0.158.0 on a ChatGPT subscription, all 173 cards, **one repeat**, with **visible output tokens** (hidden reasoning tokens are not counted against the 8,192 limit; the Phase 2c gpt-5.5 rows counted total tokens). It was collected by `eval:v2` (`live-collected`) on 2026-10-02 between 22:31Z and 22:42Z at concurrency 8. All 173 slots completed, with no timeouts, provider errors or retries; the largest visible output was 5,920 tokens.

gpt-5.5 neither drafted nor verified the labels, so this is the **less biased number**. It is not bias-free. The labels of 158 cards started from gpt-5.6-luna drafts, and anchoring on a draft can leave luna-style choices in place wherever the captures allow more than one reading, which favours luna. All labels are agent-verified, not human-verified.

| Set | Model | Field acc. (e2e) | Field acc. (matched) | Rule recall | Rule prec. | Card fields | Claim prec. | Evidence valid | Issue recall | Exclusion recall | False-clean | p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All 173 | **gpt-5.5 low** | **76.2%** (4236/5559) | 94.3% | 81.6% (704/863) | 93.3% | 81.8% | 87.0% | 92.6% | 15.4% (30/195) | 79.0% | 11 | 28 s / 64 s |
| All 173 | luna (upper bound) | 80.8% (4493/5559) | 94.8% | 85.6% (739/863) | 90.3% | 83.5% | 83.7% | 97.6% | 56.9% (111/195) | 88.1% | 5 | 183 s / 340 s |
| Drafted 158 | **gpt-5.5 low** | **76.7%** (3983/5193) | 94.4% | 82.2% (659/802) | 93.2% | 82.9% | 86.8% | 92.5% | 15.4% (28/182) | 79.2% | 10 | 29 s / 64 s |
| Drafted 158 | luna (upper bound) | 81.1% (4211/5193) | 94.7% | 86.0% (690/802) | 90.1% | 85.8% | 83.4% | 97.6% | 60.4% (110/182) | 89.1% | 5 | 183 s / 353 s |
| Undrafted 15 | **gpt-5.5 low** | **69.1%** (253/366) | 93.7% | 73.8% (45/61) | 93.8% | 70.0% | 89.8% | 94.1% | 15.4% (2/13) | 76.2% | 1 | 24 s / 47 s |
| Undrafted 15 | luna | 77.0% (282/366) | 95.9% | 80.3% (49/61) | 94.2% | 60.0% | 89.0% | 97.5% | 7.7% (1/13) | 71.4% | 0 | 172 s / 274 s |

- **On matched rules the two models tie** (94.3% vs 94.8%). The end-to-end gap of 4.6 points is mostly rule recall: gpt-5.5 missed 159 rules (114 `other`, the category that holds merchant- and partner-specific rules) against luna's 124. It has fewer extra rules (51 vs 79) and higher rule precision.
- **Issues are gpt-5.5's weak point:** it found 15.4% of labelled issues against luna's 56.9% (`ambiguous` 10/115, `out-of-scope` 13/60, `missing` 6/14, `conflicting` 1/6). It also had 11 false-clean cards against luna's 5: Capital One 5, Synchrony 3, Discover 2, Chase 1. The issue labels came from luna-seeded drafts plus verifier additions, so part of this gap may be the anchoring bias above.
- **Field errors (all 173):** `activation` 161, `rateBps` 43, `pointValueHundredthsOfCent` 37, `rewardCurrency` 26, `capKind` 16, `paidOnPaymentBps` 16, `usMerchantsOnly` 7, other cap parts 7, `limitedTime` 5.
- **Undrafted cards** have no luna seeding, but n = 15 is too small to separate the models: luna leads end to end (77.0% vs 69.1%), and gpt-5.5 leads on card fields (70.0% vs 60.0%).
- **Per issuer, end to end (gpt-5.5 / luna):** Amex 90.5% / 80.1%, Citi 90.5% / 92.5%, Capital One 90.4% / 91.2%, Wells Fargo 92.3% / 99.6%, Discover 90.0% / 95.5%, Synchrony 73.6% / 81.6%, Bank of America 73.5% / 69.7%, Chase 68.6% / 72.0%, U.S. Bank 67.8% / 84.0%, Barclays 66.8% / 77.5% (`expansion.json` `crossModel.byIssuer`).
- **Speed:** gpt-5.5 low is about 6× faster per case (28 s vs 183 s at p50). The whole run took about 11 minutes.
- With one repeat per model, and repeat noise of up to 5.8 points on `real.v2.2`, differences of a few points are not firm.

Command (from the repository root, `EXPANSION_CAPTURES` = the local expansion captures folder; `node scripts/score-expansion-traces.mjs --print-command` prints it):

```sh
npm run eval:v2 -- --provider codex --model gpt-5.5 --effort low --prompt guided.2 --selection keyword-window.1 --codex-output-tokens visible --corpus evals/curation/expansion --captures $EXPANSION_CAPTURES --split heldout --allow-heldout --concurrency 8 --output evals/curation/runs/expansion/codex.gpt-5.5.low.guided.2.keyword-window.1.heldout
```

The run directory is gitignored. `node scripts/score-expansion-traces.mjs --captures DIR --traces DIR --run <run dir>` re-scores it into `crossModel`.

## Reproduce

```sh
npm run eval:v2 -- --check                                          # harness self-check, unchanged
node scripts/expansion-pipeline-metrics.mjs --check                 # (a) from committed files
node scripts/score-expansion-traces.mjs --captures <captures dir> --traces <extractions dir>   # (a)+(b) → expansion.json
node scripts/score-expansion-traces.mjs --print-command             # (c) the cross-model command
```

The captures and the luna traces are gitignored. On 2026-10-02 they were in `evals/curation/expansion/captures/` and `extractions/` of the `AICheckout-expansion` worktree. The script also reads `AICHECKOUT_EXPANSION_CAPTURES` and `AICHECKOUT_EXPANSION_TRACES`.
