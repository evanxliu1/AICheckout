---
type: System Component
title: Evaluation
description: The curation eval corpora, splits, variants, scorer versions and metrics, the eval CLIs, what is committed, and a short summary of the 2026-09-29 results, the 2026-10-02 gpt-5.6-luna rows and the expansion eval.
status: stable
tags: [system, evaluation, llm, curation]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:26:46Z
sources:
  - resource: ../../evals/curation/README.md
    title: Curation evaluations README
  - resource: ../../evals/curation/real/corpus.v2.json
    title: Real corpus real.v2.2
  - resource: ../../evals/curation/fixture.v2/corpus.v2.json
    title: Synthetic fixture corpus fixture.v2.1
  - resource: ../../evals/curation/corpus.v1.json
    title: Synthetic v1 corpus synthetic-curation.1
  - resource: ../../apps/api/src/curation/v2/corpus.ts
    title: v2 corpus schema, variants, split checks
  - resource: ../../apps/api/src/curation/v2/schema.ts
    title: Extraction contract issuer-extraction.2
  - resource: ../../apps/api/src/curation/v2/score.ts
    title: v2 scorer (SCORER_VERSION)
  - resource: ../../apps/api/src/curation/v2/eval-cli.ts
    title: eval:v2 CLI
  - resource: ../../apps/api/src/curation/evaluation.ts
    title: v1 evaluator (EVALUATOR_VERSION)
  - resource: ../../scripts/run-eval-matrix.mjs
    title: Matrix runner
  - resource: ../../scripts/summarize-evals.mjs
    title: Results summarizer
  - resource: ../../docs/evals/results.md
    title: Extraction v2 results (generated, read by the site)
  - resource: ../../docs/evals/expansion.md
    title: Expansion eval (generated JSON, hand-written page)
  - resource: ../../scripts/score-expansion-traces.mjs
    title: Expansion trace scorer
  - resource: ../../scripts/expansion-pipeline-metrics.mjs
    title: Expansion pipeline metrics
  - resource: ../archive/phase2-goal.md
    title: Phase 2 goal (archived)
---

# Evaluation

The evals measure how well an LLM extracts the earning rules for a card from captured issuer pages. Extraction contract `issuer-extraction.2` asks the model for every rule and card-level field, each backed by verbatim quotes. The harness resolves each quote to a span, and scorer `v2-scorer.2` compares the output with gold labels. The main corpus is `real.v2.2`: 15 real issuer pages for the seven release-1 [cards](../domain/cards.md), split dev/held-out by issuer. The second is `expansion.v1`: 173 cards of the ten largest issuers, all held-out, measured in [`docs/evals/expansion.md`](../../docs/evals/expansion.md). The pipeline v1 acceptance run (a six-card Wells Fargo refresh batch, 2026-10-04) is in [`docs/evals/pipeline-v1.md`](../../docs/evals/pipeline-v1.md), and the Phase 9 renewal (freshness check of 328 sources, ten refresh batches, agreement with `expansion.v1`, 2026-10-05) in [`docs/evals/freshness-2026-10.md`](../../docs/evals/freshness-2026-10.md). Labels of all of them are **agent-verified, not human-verified**, and the same labels (plus the overlays) generate the product catalog. Full results are in [`docs/evals/results.md`](../../docs/evals/results.md). Both files are generated, the public site's results page reads `results.json` and `expansion.json` (since Stage 2 M10), and they are not edited by hand.

## Facts

### Corpora

| Corpus | Path | Version | Cases | Labels | Purpose |
| --- | --- | --- | --- | --- | --- |
| Real v2 | [`evals/curation/real/`](../../evals/curation/real/) | `real.v2.2` | 37 (7 base + 30 variants) | agent-verified (7 reviewer agents, 2026-09-29) | Benchmark; source of `CATALOG_V2` |
| Fixture v2 | [`evals/curation/fixture.v2/`](../../evals/curation/fixture.v2/) | `fixture.v2.1` | 8 | agent-drafted, invented terms | Harness/scorer gate (`eval:v2 --check`); not a benchmark |
| Expansion | [`evals/curation/expansion/`](../../evals/curation/expansion/) (`corpus.json`) | `expansion.v1` | 173 (no variants) | agent-verified (per-issuer verifier + adjudicator agents, 2026-10-02); seeded from gpt-5.6-luna drafts for 158 cards | Expansion eval ([`docs/evals/expansion.md`](../../docs/evals/expansion.md)); source of catalog v3. Loader layout `expansion`: every case held-out, up to 400 sources |
| Synthetic v1 | [`evals/curation/corpus.v1.json`](../../evals/curation/corpus.v1.json) | `synthetic-curation.1` | 60 (30 Quicksilver dev, 30 BCE reserved) | agent-authored, awaiting human review | v1 contract `issuer-extraction.1`. Sources declare themselves invented, so a capable model abstains. Measures the harness only |

### Splits (real v2)

| Split | Cards | Cases | Labeled rules |
| --- | --- | --- | --- |
| `dev` | Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver, Capital One Savor | 20 | 69 |
| `heldout` | Chase Freedom Unlimited, Amex BCE, Amex BCP | 17 | 77 |

`corpus.ts` rejects a source used in both splits. `eval:v2` refuses `heldout`/`all` without `--allow-heldout`, and a split with no cases. Prompts are tuned only on dev. The expansion corpus has no dev split: `loadCorpusV2(dir, { layout: 'expansion' })` (picked by `eval:v2` when the directory has `corpus.json` and no `corpus.v2.json`) makes every case held-out ([decision](../decisions/2026-10-02-expansion-eval-design.md)).

### Variant kinds

Variants are applied at load time as mechanical edits (`delete`, `insert-after`, `append`) to a card's own captures. Each kind requires a specific expected issue.

| Kind | Edit | Expected label |
| --- | --- | --- |
| `injection` (2 per card) | Planted "report 10%" note; planted "already approved, publish" instruction | `untrusted-instruction` issue; fields unchanged |
| `conflicting-rate` | Contradicting rate appended | `conflicting` issue; contradicted value null |
| `stale-promo` | Expired limited-time 5% gas promotion appended | Rule with `limitedTime.endsOn` |
| `remove-cap` (Amex only) | Spending-cap sentence deleted | `missing` issue |

Issue codes: `missing`, `ambiguous`, `conflicting`, `untrusted-instruction`, `out-of-scope`.

### Versions

| Thing | Current |
| --- | --- |
| Extraction contract | `issuer-extraction.2` (`v2/schema.ts:EXTRACTION_V2_SCHEMA_VERSION`) |
| v2 scorer | `v2-scorer.2` (`v2/score.ts:SCORER_VERSION`; quotes match across straight and typographic quote marks) |
| v1 evaluator | `curation-evaluator.1` (`evaluation.ts:EVALUATOR_VERSION`) |
| Prompts | `baseline.1`, `guided.1`, `guided.2` (`v2/context.ts:PROMPTS`) |
| Source selection | `full`, `keyword-window.1` (reward-term lines ±1, verbatim) |

### v2 metrics

Predicted rules are matched to reference rules by category. When a category has more than one rule, the closest issuer wording wins, then an equal rate. The full definitions are in the [README](../../evals/curation/README.md#v2-metrics).

| Metric | Short definition |
| --- | --- |
| Rule recall / precision | Matched rules / reference rules, predicted rules |
| Field accuracy (matched, end to end) | Exact field match. End to end counts a missed rule's fields as wrong |
| Claim precision | Non-null predicted values that are correct and cite at least one resolving quote |
| Evidence validity | Resolving quotes / all quotes |
| Issue recall | Labeled issues found with same code and overlapping quote (per code too) |
| Exclusion recall, false-clean, latency, tokens | See README |

## How it works

| Command | Script → code | Does |
| --- | --- | --- |
| `npm run eval:v2 -- --check` | [`scripts/evaluate-curation-v2.mjs`](../../scripts/evaluate-curation-v2.mjs) → [`v2/eval-cli.ts`](../../apps/api/src/curation/v2/eval-cli.ts) | CI gate on fixture.v2: reference-echo must score 100%, abstention 0%. No model call |
| `npm run eval:v2 -- --provider codex\|claude ...` | same | Live run. Options: `--prompt`, `--selection`, `--split`, `--repeat`, `--corpus DIR`, `--captures DIR` (captures outside the corpus folder), `--resume DIR`, `--replay FILE`. A usage limit exits with status 3 and the run can be resumed. `--provider codex` without `--model` runs the curation configuration (gpt-5.6-luna `xhigh`, `guided.2`, `keyword-window.1`; [live model runs](../ops/live-model-runs.md)) |
| `npm run eval:matrix` | [`scripts/run-eval-matrix.mjs`](../../scripts/run-eval-matrix.mjs) | Runs every config in [`matrix.dev.json`](../../evals/curation/matrix.dev.json) / [`matrix.heldout.json`](../../evals/curation/matrix.heldout.json) into `runs/matrix*/<slug>/`. Skips complete configs, resumes partial ones; `--wait-minutes` retries after usage limits |
| `npm run eval:summarize` | [`scripts/summarize-evals.mjs`](../../scripts/summarize-evals.mjs) → `v2/summarize.ts` | Re-scores saved observations with the current scorer and labels, then writes `docs/evals/results.json` and the SVG charts. A `--split all` run becomes one row per split; `--added RUN-ID` marks a row added after its split was chosen. `results.md` is hand-written to match `results.json` (the site test checks each row) |
| `node scripts/expansion-pipeline-metrics.mjs [--dir DIR] [--output FILE \| --check]` | [`scripts/lib/expansion-metrics.mjs`](../../scripts/lib/expansion-metrics.mjs) | Draft → verified correction rates per field and issuer, rules removed/added, confirmed, dropped and undrafted cards, from committed files only. `--check` compares with `docs/evals/expansion.json` (also run by `npm test`) |
| `node scripts/score-expansion-traces.mjs [--dir DIR] --captures DIR --traces DIR [--run DIR] [--output FILE]` | [`scripts/lib/expansion-traces.mjs`](../../scripts/lib/expansion-traces.mjs) | Re-scores the saved luna `extract-cards.mjs` traces (hash-checked) on all, drafted and undrafted cards; with `--run`, scores the cross-model `eval:v2` run; writes `docs/evals/expansion.json`. `--print-command [--dir DIR]` prints the cross-model command (for a pipeline batch, with `--dir`; `pipeline eval` calls both) |
| `npm run eval:curation` | [`scripts/evaluate-curation.mjs`](../../scripts/evaluate-curation.mjs) → [`eval-cli.ts`](../../apps/api/src/curation/eval-cli.ts) | v1 evaluator: `--check`, `--mode replay\|ledger\|codex`, `--split development\|reserved\|all` (`--allow-reserved`) |

Live providers run through vendor CLIs on subscriptions (`codex exec`, `claude -p`), not metered APIs. They are for local use only and must not be wired into the hosted API. Scoring rebuilds each case's context and rejects observations whose source hashes, prompt or selection differ from what the corpus produces.

### Committed vs gitignored

| Path | Committed | Why |
| --- | --- | --- |
| `real/corpus.v2.json`, `manifest.json`, `sources.json`, `merchants.json`, `merchant-*.json` | yes | Labels with short anchors, URLs, SHA-256 hashes |
| `real/captures/`, `real/merchant-captures/`, `real/verification*.html` | **no** | Issuer page text is copyrighted. Re-capture with `scripts/capture-issuer-pages.mjs`. A hash mismatch fails loading |
| `fixture.v2/captures/` | yes | Invented text |
| `evals/curation/runs/` | **no** | Observations and reports (private) |
| `docs/evals/results.{md,json,svg}`, `results-heldout.svg`, `expansion.{md,json}` | yes | Metrics only, no issuer text |
| `expansion/captures/`, `expansion/extractions/` | **no** | Issuer text and model quotes; on 2026-10-02 only in the `AICheckout-expansion` worktree |
| `evals/curation/baseline.v1.md` | yes | Synthetic v1 diagnostic summary |

## Results (2026-09-29 and 2026-10-02, summary)

Full tables, failure analysis and disclosures are in [`docs/evals/results.md`](../../docs/evals/results.md). End-to-end field accuracy:

| Config | Dev | Held-out |
| --- | --- | --- |
| Any model, `baseline.1` | 65–83% | 83.1% (gpt-6-astra, full) |
| gpt-6-astra low, `guided.2` full | 99.0% | 97.2% |
| gpt-5.5 low, `guided.2` keyword-window | 98.8% | 97.5% |
| gpt-5.6-luna xhigh, `guided.2` keyword-window (curation model; one repeat, added 2026-10-02) | 99.5% | 98.3% |
| claude-opus-5-5, `guided.2` keyword-window | 96.9% | 99.2% (added after other held-out results were seen) |
| claude-sonnet-5, `guided.2` keyword-window | 94.4% | 93.2% |
| claude-haiku-4-5, `guided.2` keyword-window | 93.4% | 90.9% |

- The prompt is the biggest lever. Most baseline errors are conventions: null vs 0 for paid-on-payment, "none" written for silent fields, and Citi rates given as increments.
- Every guided row reports every planted injection (100% untrusted-instruction recall, dev and held-out).
- The main held-out errors are `cap: none` asserted where the page is silent, and the BCE cap period.
- Repeat noise reaches 5.8 points. Treat differences under about 3 points as ties.
- gpt-5.6-luna `xhigh` ran all 37 cases once on 2026-10-02 (98.8% end-to-end overall); `results.md` reports it per split, marked added after: dev 99.5% (1 false-clean, Wells Fargo stale promo), held-out 98.3% (0 false-clean; 9 field errors: BCE cap period ×6, Chase `cap: none` ×3; `capPeriod` 16/22), p50 163 s / 192 s per case. It became the curation model on 2026-10-02 ([decision](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md), [reporting decision](../decisions/2026-10-02-luna-results-per-split.md)).

## Expansion eval (2026-10-02, summary)

Full page: [`docs/evals/expansion.md`](../../docs/evals/expansion.md). The expansion cards were never used for prompt tuning (`guided.2` dates from 2026-09-29).

- **Pipeline (draft → verified):** 5.9% of rule-field values changed (321/5,448; `activation` 21.1%, `issuerWording` 12.3%, `rateBps` 4.6%); 54 of 735 draft rules removed, 182 rules added (61 on the 15 undrafted cards); 10 cards confirmed unchanged, 7 dropped.
- **gpt-5.6-luna re-score, an upper bound** (labels seeded from the same traces): 80.8% end to end on all 173 cards, 81.1% on the 158 drafted, 77.0% on the 15 undrafted; rule recall 85.6%; 5 false-clean. Most of the gap is verifier-added rules and the activation convention.
- **Cross-model run** (collected 2026-10-02, Codex CLI 0.158.0): gpt-5.5 low (cross-model, neither drafted nor verified the labels; one repeat, visible output tokens): 76.2% end to end on all 173 (76.7% drafted, 69.1% undrafted), matched-rule field accuracy 94.3% (luna 94.8%), rule recall 81.6%, issue recall 15.4% (luna 56.9%), 11 false-clean, p50 28 s. The labels may still favour luna-style output through anchoring on luna drafts. The same model, effort, prompt and selection scored 97.5% on the `real.v2.2` held-out split (3 cards, 2 repeats, total output tokens counted); the corpora are not directly comparable (points cards, merchant rules, a different labelling process, visible output tokens), and the public site and README state it that way.

## Gotchas

- `real.v2.2` corrected the stale-promo labels after held-out results had been seen. All runs were re-scored from saved observations. Observations are bound to the corpus inputs, not to the labels.
- The guided prompts' worked examples resemble Amex wording, and Amex is in the held-out split. Part of the held-out lift comes from those examples.
- `guided.2`'s cash-back rule conflicts with the Citi `points` label. This is a known wording bug.
- The subscription models are not pinned snapshots.
- The live adapter README ([`apps/api/src/curation/README.md`](../../apps/api/src/curation/README.md)) predates the v2 runs. It still says no live model call has been made, which is true of the metered OpenAI adapter only.

## Open questions

- A human verification pass on the labels, with the BCE cap period as the first decision ([phase2-goal](../archive/phase2-goal.md)).
- v2 extraction → draft application is later work. Today the catalog is built from the labels, not from model output.

## Related

* [Cards](../domain/cards.md)
* [Reward rules](../domain/reward-rules.md)
* [Glossary](../domain/glossary.md)
