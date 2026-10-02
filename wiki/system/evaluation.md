---
type: System Component
title: Evaluation
description: The curation eval corpora, splits, variants, scorer versions and metrics, the eval CLIs, what is committed, and a short summary of the 2026-09-29 results.
status: stable
tags: [system, evaluation, llm, curation]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:10:00Z
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
  - resource: ../archive/phase2-goal.md
    title: Phase 2 goal (archived)
---

# Evaluation

The evals measure how well an LLM extracts the earning rules for a card from captured issuer pages. Extraction contract `issuer-extraction.2` asks the model for every rule and card-level field, each backed by verbatim quotes. The harness resolves each quote to a span, and scorer `v2-scorer.2` compares the output with gold labels. The main corpus is `real.v2.2`: 15 real issuer pages for the seven [cards](../domain/cards.md), split dev/held-out by issuer. Its labels are **agent-verified, not human-verified**. The same labels generate the product catalog. Full results are in [`docs/evals/results.md`](../../docs/evals/results.md). That file is generated, the public site reads it, and it is not edited by hand.

## Facts

### Corpora

| Corpus | Path | Version | Cases | Labels | Purpose |
| --- | --- | --- | --- | --- | --- |
| Real v2 | [`evals/curation/real/`](../../evals/curation/real/) | `real.v2.2` | 37 (7 base + 30 variants) | agent-verified (7 reviewer agents, 2026-09-29) | Benchmark; source of `CATALOG_V2` |
| Fixture v2 | [`evals/curation/fixture.v2/`](../../evals/curation/fixture.v2/) | `fixture.v2.1` | 8 | agent-drafted, invented terms | Harness/scorer gate (`eval:v2 --check`); not a benchmark |
| Synthetic v1 | [`evals/curation/corpus.v1.json`](../../evals/curation/corpus.v1.json) | `synthetic-curation.1` | 60 (30 Quicksilver dev, 30 BCE reserved) | agent-authored, awaiting human review | v1 contract `issuer-extraction.1`. Sources declare themselves invented, so a capable model abstains. Measures the harness only |

### Splits (real v2)

| Split | Cards | Cases | Labeled rules |
| --- | --- | --- | --- |
| `dev` | Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver, Capital One Savor | 20 | 69 |
| `heldout` | Chase Freedom Unlimited, Amex BCE, Amex BCP | 17 | 77 |

`corpus.ts` rejects a source used in both splits. `eval:v2` refuses `heldout`/`all` without `--allow-heldout`. Prompts are tuned only on dev.

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
| `npm run eval:v2 -- --provider codex\|claude ...` | same | Live run. Options: `--prompt`, `--selection`, `--split`, `--repeat`, `--resume DIR`, `--replay FILE`. A usage limit exits with status 3 and the run can be resumed |
| `npm run eval:matrix` | [`scripts/run-eval-matrix.mjs`](../../scripts/run-eval-matrix.mjs) | Runs every config in [`matrix.dev.json`](../../evals/curation/matrix.dev.json) / [`matrix.heldout.json`](../../evals/curation/matrix.heldout.json) into `runs/matrix*/<slug>/`. Skips complete configs, resumes partial ones; `--wait-minutes` retries after usage limits |
| `npm run eval:summarize` | [`scripts/summarize-evals.mjs`](../../scripts/summarize-evals.mjs) → `v2/summarize.ts` | Re-scores saved observations with the current scorer and labels, then writes `docs/evals/results.json` and the SVG charts |
| `npm run eval:curation` | [`scripts/evaluate-curation.mjs`](../../scripts/evaluate-curation.mjs) → [`eval-cli.ts`](../../apps/api/src/curation/eval-cli.ts) | v1 evaluator: `--check`, `--mode replay\|ledger\|codex`, `--split development\|reserved\|all` (`--allow-reserved`) |

Live providers run through vendor CLIs on subscriptions (`codex exec`, `claude -p`), not metered APIs. They are for local use only and must not be wired into the hosted API. Scoring rebuilds each case's context and rejects observations whose source hashes, prompt or selection differ from what the corpus produces.

### Committed vs gitignored

| Path | Committed | Why |
| --- | --- | --- |
| `real/corpus.v2.json`, `manifest.json`, `sources.json`, `merchants.json`, `merchant-*.json` | yes | Labels with short anchors, URLs, SHA-256 hashes |
| `real/captures/`, `real/merchant-captures/`, `real/verification*.html` | **no** | Issuer page text is copyrighted. Re-capture with `scripts/capture-issuer-pages.mjs`. A hash mismatch fails loading |
| `fixture.v2/captures/` | yes | Invented text |
| `evals/curation/runs/` | **no** | Observations and reports (private) |
| `docs/evals/results.{md,json,svg}`, `results-heldout.svg` | yes | Metrics only, no issuer text |
| `evals/curation/baseline.v1.md` | yes | Synthetic v1 diagnostic summary |

## Results (2026-09-29, summary)

Full tables, failure analysis and disclosures are in [`docs/evals/results.md`](../../docs/evals/results.md). End-to-end field accuracy:

| Config | Dev | Held-out |
| --- | --- | --- |
| Any model, `baseline.1` | 65–83% | 83.1% (gpt-6-astra, full) |
| gpt-6-astra low, `guided.2` full | 99.0% | 97.2% |
| gpt-5.5 low, `guided.2` keyword-window | 98.8% | 97.5% |
| claude-opus-5-5, `guided.2` keyword-window | 96.9% | 99.2% (added after other held-out results were seen) |
| claude-sonnet-5, `guided.2` keyword-window | 94.4% | 93.2% |
| claude-haiku-4-5, `guided.2` keyword-window | 93.4% | 90.9% |

- The prompt is the biggest lever. Most baseline errors are conventions: null vs 0 for paid-on-payment, "none" written for silent fields, and Citi rates given as increments.
- Every guided row reports every planted injection (100% untrusted-instruction recall, dev and held-out).
- The main held-out errors are `cap: none` asserted where the page is silent, and the BCE cap period.
- Repeat noise reaches 5.8 points. Treat differences under about 3 points as ties.
- Not yet in `docs/evals/results.md`: gpt-5.6-luna `xhigh`, `guided.2` keyword-window, all 37 cases in one run (2026-10-02): 98.8% end-to-end, 1 false-clean, `capPeriod` 16/22, about 3 min per case. It became the curation model on 2026-10-02 ([decision](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md)).

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
