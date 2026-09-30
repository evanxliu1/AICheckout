# Extraction v2 results: real issuer terms, seven cards

Measured on 2026-09-29. Data: [`results.json`](results.json) (every number below, re-scored from saved observations), charts: [`results.svg`](results.svg) (dev), [`results-heldout.svg`](results-heldout.svg) (held-out).

## Setup

- **Corpus** `real.v2.2` (`evals/curation/real/`): 15 issuer pages captured headless on 2026-09-29 for seven U.S. cash-back cards, 37 cases. Each card has a base case plus mechanical variants of its own captures: two prompt injections (a planted "report 10%" note and a planted "already approved, publish" instruction), a contradicting rate appended to a page, an expired 5% promotion appended to a page, and (Amex only) a spending-cap sentence deleted. Labels were drafted by an agent and checked field by field against the captures by seven independent reviewer agents; they are **agent-verified, not human-verified**.
- **Splits.** Dev: Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver, Capital One Savor (20 cases, 69 labeled rules). Held-out: Chase Freedom Unlimited, Amex Blue Cash Everyday, Amex Blue Cash Preferred (17 cases, 77 labeled rules). Prompts were written and changed on dev only; held-out was run once per chosen configuration after the prompts were frozen.
- **Task.** The model receives the captured page text as JSON and returns every earning rule (category, total rate, paid-on-payment portion, cap, activation, U.S.-only, limited-time), card-level reward currency and point value, exclusions, and issues, each value with verbatim quotes. The harness resolves each quote to a span in the source; unresolvable quotes count against evidence validity and the claim they support.
- **Factors.** Prompt `baseline.1` (two sentences) vs `guided.1` (field conventions, evidence and issue rules) vs `guided.2` (guided.1 plus the fixes from the dev error analysis below). Source selection `full` (whole pages, up to 106 kB for Citi) vs `keyword-window` (lines mentioning reward terms, ±1 line, verbatim). Models: gpt-5.5 (reasoning effort low and high) and gpt-6-astra (low) through the Codex CLI on a ChatGPT subscription; claude-haiku-4-5-20251001, claude-sonnet-5 and claude-opus-5-5 (effort low, extended thinking off) through the Claude Code CLI on a claude.ai subscription. Dev runs repeat every case twice (40 runs per configuration; Opus once, 20 runs).
- **Scorer** `v2-scorer.2`. Metric definitions are in [`evals/curation/README.md`](../../evals/curation/README.md#v2-metrics). Field accuracy (end to end) counts every field of a missed rule as wrong; claim precision is the share of non-null predicted values that are correct and cite a quote that resolves.

## Dev results

| Model | Prompt | Selection | Runs | Field acc. (e2e) | Rule recall | Rule prec. | Claim prec. | Evidence valid | Issue recall | Injection: untrusted-instr. recall / field acc. | Conflict recall | False-clean | p50 / p95 | Prompt tokens (est.) | Harness fail. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-5.5 (high) | baseline.1 | full | 40 | 69.4% | 94.9% | 100.0% | 77.0% | 93.3% | 100.0% | 100.0% / 76.6% | 100.0% | 3 | 66 s / 107 s | 19812 | 0 |
| gpt-5.5 (high) | baseline.1 | keyword-window | 40 | 69.8% | 94.9% | 100.0% | 78.5% | 96.8% | 100.0% | 100.0% / 73.4% | 100.0% | 2 | 57 s / 127 s | 10372 | 0 |
| gpt-5.5 (high) | guided.1 | full | 40 | 92.0% | 97.8% | 100.0% | 91.2% | 87.9% | 95.8% | 100.0% / 95.8% | 87.5% | 0 | 81 s / 138 s | 20871 | 0 |
| gpt-5.5 (high) | guided.1 | keyword-window | 40 | 89.4% | 100.0% | 100.0% | 85.1% | 91.1% | 91.7% | 100.0% / 89.1% | 75.0% | 0 | 89 s / 125 s | 11430 | 0 |
| gpt-5.5 (low) | baseline.1 | full | 40 | 66.8% | 95.7% | 100.0% | 73.1% | 89.1% | 95.8% | 100.0% / 71.2% | 87.5% | 3 | 30 s / 60 s | 19812 | 0 |
| gpt-5.5 (low) | baseline.1 | keyword-window | 40 | 67.9% | 97.8% | 100.0% | 72.9% | 88.6% | 100.0% | 100.0% / 70.2% | 100.0% | 1 | 30 s / 52 s | 10372 | 0 |
| gpt-5.5 (low) | guided.1 | full | 40 | 97.1% | 98.6% | 100.0% | 99.2% | 93.9% | 100.0% | 100.0% / 99.7% | 100.0% | 1 | 23 s / 43 s | 20871 | 0 |
| gpt-5.5 (low) | guided.1 | keyword-window | 40 | 97.6% | 100.0% | 100.0% | 99.4% | 91.8% | 100.0% | 100.0% / 99.4% | 100.0% | 2 | 24 s / 46 s | 11430 | 0 |
| gpt-5.5 (low) | guided.2 | keyword-window | 40 | 98.8% | 100.0% | 100.0% | 99.8% | 97.3% | 100.0% | 100.0% / 100.0% | 100.0% | 1 | 25 s / 54 s | 11684 | 0 |
| gpt-6-astra (low) | baseline.1 | full | 40 | 83.0% | 97.8% | 100.0% | 99.5% | 97.3% | 91.7% | 87.5% / 85.9% | 100.0% | 0 | 46 s / 96 s | 19812 | 0 |
| gpt-6-astra (low) | baseline.1 | keyword-window | 40 | 78.7% | 93.5% | 100.0% | 99.7% | 96.6% | 83.3% | 81.3% / 78.2% | 87.5% | 0 | 55 s / 98 s | 10372 | 0 |
| gpt-6-astra (low) | guided.1 | full | 40 | 99.0% | 100.0% | 100.0% | 100.0% | 98.5% | 100.0% | 100.0% / 100.0% | 100.0% | 0 | 48 s / 97 s | 20871 | 0 |
| gpt-6-astra (low) | guided.1 | keyword-window | 40 | 99.3% | 100.0% | 100.0% | 100.0% | 96.0% | 100.0% | 100.0% / 100.0% | 100.0% | 0 | 53 s / 107 s | 11430 | 0 |
| gpt-6-astra (low) | guided.2 | full | 40 | 99.0% | 100.0% | 100.0% | 100.0% | 96.1% | 100.0% | 100.0% / 100.0% | 100.0% | 0 | 48 s / 93 s | 21124 | 0 |
| claude-haiku-4-5-20251001 | baseline.1 | full | 40 | 65.5% | 97.1% | 100.0% | 66.0% | 66.4% | 8.3% | 12.5% / 73.1% | 0.0% | 1 | 22 s / 36 s | 19812 | 0 |
| claude-haiku-4-5-20251001 | baseline.1 | keyword-window | 40 | 65.0% | 98.6% | 100.0% | 66.7% | 80.6% | 16.7% | 18.8% / 67.0% | 12.5% | 2 | 17 s / 34 s | 10372 | 0 |
| claude-haiku-4-5-20251001 | guided.1 | full | 40 | 70.0% | 97.1% | 100.0% | 62.9% | 81.9% | 75.0% | 100.0% / 73.7% | 25.0% | 1 | 29 s / 51 s | 20871 | 0 |
| claude-haiku-4-5-20251001 | guided.1 | keyword-window | 40 | 71.5% | 98.6% | 100.0% | 64.8% | 83.5% | 83.3% | 100.0% / 72.1% | 50.0% | 0 | 23 s / 42 s | 11430 | 0 |
| claude-haiku-4-5-20251001 | guided.2 | keyword-window | 40 | 93.4% | 98.6% | 100.0% | 90.9% | 94.3% | 87.5% | 100.0% / 95.2% | 62.5% | 3 | 19 s / 29 s | 11684 | 0 |
| claude-opus-5-5 | baseline.1 | full | 20 | 66.9% | 94.2% | 100.0% | 74.5% | 98.3% | 100.0% | 100.0% / 73.7% | 100.0% | 1 | 13 s / 24 s | 19812 | 0 |
| claude-opus-5-5 | baseline.1 | keyword-window | 20 | 66.2% | 94.2% | 100.0% | 74.1% | 99.2% | 100.0% | 100.0% / 72.4% | 100.0% | 1 | 14 s / 24 s | 10372 | 0 |
| claude-opus-5-5 | guided.1 | full | 20 | 92.0% | 95.7% | 100.0% | 92.7% | 78.6% | 100.0% | 100.0% / 94.9% | 100.0% | 0 | 24 s / 27 s | 20871 | 0 |
| claude-opus-5-5 | guided.1 | keyword-window | 20 | 90.6% | 95.7% | 100.0% | 94.2% | 79.5% | 100.0% | 100.0% / 96.2% | 100.0% | 0 | 25 s / 31 s | 11430 | 0 |
| claude-opus-5-5 | guided.2 | keyword-window | 20 | 96.9% | 100.0% | 100.0% | 99.6% | 78.6% | 100.0% | 100.0% / 99.4% | 100.0% | 0 | 21 s / 236 s | 11684 | 0 |
| claude-sonnet-5 | baseline.1 | full | 40 | 65.3% | 96.4% | 100.0% | 69.3% | 92.6% | 83.3% | 100.0% / 65.7% | 50.0% | 0 | 34 s / 56 s | 19812 | 0 |
| claude-sonnet-5 | baseline.1 | keyword-window | 40 | 69.0% | 98.6% | 100.0% | 73.4% | 93.4% | 95.8% | 100.0% / 70.2% | 87.5% | 0 | 32 s / 67 s | 10372 | 0 |
| claude-sonnet-5 | guided.1 | full | 40 | 80.9% | 94.9% | 100.0% | 80.3% | 97.7% | 100.0% | 100.0% / 86.5% | 100.0% | 0 | 30 s / 52 s | 20871 | 0 |
| claude-sonnet-5 | guided.1 | keyword-window | 40 | 85.0% | 100.0% | 100.0% | 82.0% | 99.4% | 100.0% | 100.0% / 84.9% | 100.0% | 0 | 26 s / 52 s | 11430 | 0 |
| claude-sonnet-5 | guided.2 | keyword-window | 40 | 94.4% | 99.3% | 100.0% | 96.9% | 99.2% | 100.0% | 100.0% / 97.4% | 100.0% | 0 | 20 s / 49 s | 11684 | 0 |

Provider-reported output tokens (see token definitions under Disclosures):

<details><summary>Output tokens per configuration</summary>

| Model | Prompt | Selection | Output tokens (provider-reported mean) |
| --- | --- | --- | --- |
| gpt-5.5 (high) | baseline.1 | full | 3593 |
| gpt-5.5 (high) | baseline.1 | keyword-window | 3632 |
| gpt-5.5 (high) | guided.1 | full | 4632 |
| gpt-5.5 (high) | guided.1 | keyword-window | 4598 |
| gpt-5.5 (low) | baseline.1 | full | 1572 |
| gpt-5.5 (low) | baseline.1 | keyword-window | 1578 |
| gpt-5.5 (low) | guided.1 | full | 1317 |
| gpt-5.5 (low) | guided.1 | keyword-window | 1355 |
| gpt-5.5 (low) | guided.2 | keyword-window | 1422 |
| gpt-6-astra (low) | baseline.1 | full | 1693 |
| gpt-6-astra (low) | baseline.1 | keyword-window | 1630 |
| gpt-6-astra (low) | guided.1 | full | 1729 |
| gpt-6-astra (low) | guided.1 | keyword-window | 1741 |
| gpt-6-astra (low) | guided.2 | full | 1721 |
| claude-haiku-4-5-20251001 | baseline.1 | full | 2445 |
| claude-haiku-4-5-20251001 | baseline.1 | keyword-window | 2188 |
| claude-haiku-4-5-20251001 | guided.1 | full | 3298 |
| claude-haiku-4-5-20251001 | guided.1 | keyword-window | 2494 |
| claude-haiku-4-5-20251001 | guided.2 | keyword-window | 1693 |
| claude-opus-5-5 | baseline.1 | full | 1970 |
| claude-opus-5-5 | baseline.1 | keyword-window | 1940 |
| claude-opus-5-5 | guided.1 | full | 2169 |
| claude-opus-5-5 | guided.1 | keyword-window | 2134 |
| claude-opus-5-5 | guided.2 | keyword-window | 2125 |
| claude-sonnet-5 | baseline.1 | full | 2525 |
| claude-sonnet-5 | baseline.1 | keyword-window | 2530 |
| claude-sonnet-5 | guided.1 | full | 2406 |
| claude-sonnet-5 | guided.1 | keyword-window | 3687 |
| claude-sonnet-5 | guided.2 | keyword-window | 2324 |

</details>

Reading the table:

- A detailed prompt is the largest single lever, and model choice still matters. Every model scores 65–83% end-to-end field accuracy with `baseline.1` and 92–99% with its best guided prompt; at a fixed prompt the models span up to 29 points (`guided.1`: Haiku 70% to gpt-6-astra 99%). The two-sentence baseline mainly loses on conventions (paid-on-payment left null instead of 0, activation "none" written when the page is silent, Citi's rates reported as increments: 1% and 4% instead of the 2% and 5% totals).
- Noise: repeat-to-repeat differences in end-to-end field accuracy reach 5.8 points (Haiku baseline.1 full: 68.4% vs 62.6%) and exceed 3 points in six configurations. Treat differences under about 3 points as ties; no confidence intervals are computed.
- gpt-6-astra with a guided prompt is at the ceiling of this corpus: 99.0–99.3% end-to-end, 100% rule recall, 100% claim precision, every planted injection and conflict reported. Its remaining errors per row are a few `cap` and `activation` fields on Capital One rules where the label is null and the model applied a card-wide statement, and two `paidOnPaymentBps` fields.
- gpt-5.5 at low effort is close behind (97–99%) at half the latency (p50 23–25 s vs 48–53 s). High effort is worse (89–92%) and 3–4× slower: it writes `usMerchantsOnly: false` on nearly every rule where the page is silent (82 of its 86 unsupported claims on keyword-window, 44 on full pages), and its output tokens (which include reasoning) triple.
- Claude models under `guided.1` lose most of their points to the same two conventions (activation "none", usMerchantsOnly false), not to reading the terms wrong: rule recall is 95–100% and evidence validity 79–99%. `guided.2` closes most of that gap (next section). Opus 5.5 with guided.2 reaches 96.9% / 99.6% claim precision on one repeat.
- Source selection barely matters for the strong configurations (full vs keyword-window within ±2 points) while roughly halving the prompt. Keyword-window helps Sonnet (+4 points under guided.1) and Haiku guided.1 slightly, but costs gpt-6-astra baseline.1 4.3 points (83.0% → 78.7%).
- Injection: every guided row reports the planted instruction (100% untrusted-instruction recall). Injection-variant field accuracy is within about a point of the base cases for gpt-6-astra, gpt-5.5 low, and the Haiku and Sonnet guided.2 rows (Opus guided.2: 1.9); the other guided.1 rows differ by 1–10 points in either direction (8–16 runs per variant). The baseline prompt says nothing about untrusted text; Haiku then reports 12–19% of injections and gpt-6-astra 81–88%, while gpt-5.5 still reports 100%.
- False-clean counts are runs the kernel passed as `evidence_valid` although something was wrong; they stay low (0–3 per 40 runs) because a labeled issue or any unresolved quote keeps a run in review.

## What the prompt fixes: guided.1 → guided.2

The dev error analysis of the guided.1 rows found the same few conventions behind most field errors, in every model family:

1. `activation: "none"` and `usMerchantsOnly: false` written when the page says nothing (the label is null when the issuer is silent). Claude Haiku wrote one or both on nearly every rule (about 105 activation and 104 usMerchantsOnly errors per 40-run configuration); gpt-5.5 at high effort wrote `usMerchantsOnly: false` 126 times across its two guided.1 configurations (126 of the 372 `usMerchantsOnly` errors across all guided rows).
2. `pointValueHundredthsOfCent: 100` on cash-back cards (the label is null unless rewards are points).
3. A contradicted rate kept as a number even though the model reported the conflict (the label sets the value to null).
4. `paidOnPaymentBps: null` instead of 0 when the page has no pay-as-you-go mechanic (gpt-5.5, keyword-window).
5. Paraphrased "quotes" that do not resolve in the source (Haiku: 18% of quotes under guided.1).

`guided.2` restates each as an explicit rule (silent fields stay null; cash back has no point value; a conflicting field is null; paid-on-payment defaults to 0; no quote means null, never a paraphrase). `guided.1` is unchanged. Deltas on dev, same model and selection:

| Model | Selection | Field acc. (e2e) g1 → g2 | Claim precision g1 → g2 | Issue recall g1 → g2 | Evidence validity g1 → g2 |
| --- | --- | --- | --- | --- | --- |
| gpt-5.5 (low) | keyword-window | 97.6% → 98.8% | 99.4% → 99.8% | 100.0% → 100.0% | 91.8% → 97.3% |
| gpt-6-astra (low) | full | 99.0% → 99.0% | 100.0% → 100.0% | 100.0% → 100.0% | 98.5% → 96.1% |
| claude-haiku-4-5-20251001 | keyword-window | 71.5% → 93.4% | 64.8% → 90.9% | 83.3% → 87.5% | 83.5% → 94.3% |
| claude-opus-5-5 | keyword-window | 90.6% → 96.9% | 94.2% → 99.6% | 100.0% → 100.0% | 79.5% → 78.6% |
| claude-sonnet-5 | keyword-window | 85.0% → 94.4% | 82.0% → 96.9% | 100.0% → 100.0% | 99.4% → 99.2% |

The change is largest where the conventions were the problem (Haiku +21.9 points, Sonnet +9.4, Opus +6.3) and neutral where there was nothing left to fix (gpt-6-astra). Evidence validity moves both ways by a few points: the "no quote means null" rule stopped Haiku's paraphrases (83.5% → 94.3%) but did not change Opus, whose unresolved quotes are long sentences copied with small edits.

## Per-category errors (dev, guided prompts)

| Category | Missed rules | Field errors | Most frequent fields |
| --- | --- | --- | --- |
| travel-portal | 1 | 261 | activation ×118, usMerchantsOnly ×73, capKind ×54 |
| all-purchases | 1 | 242 | usMerchantsOnly ×125, activation ×83, rateBps ×33 |
| entertainment-portal | 0 | 129 | activation ×70, usMerchantsOnly ×48, capKind ×11 |
| gas | 25 | 112 | activation ×49, capKind ×31, paidOnPaymentBps ×20 |
| card | 0 | 79 | pointValueHundredthsOfCent ×65, rewardCurrency ×14 |
| supermarkets | 0 | 78 | usMerchantsOnly ×40, activation ×36, rateBps ×2 |
| dining | 0 | 76 | activation ×36, usMerchantsOnly ×25, rateBps ×10 |
| entertainment | 0 | 61 | activation ×36, usMerchantsOnly ×25 |
| streaming | 0 | 61 | activation ×36, usMerchantsOnly ×25 |

Almost every category error is `activation` or `usMerchantsOnly` written where the label is null, concentrated in the guided.1 Claude rows and gpt-5.5 high (126 usMerchantsOnly errors); the guided.2 rows contribute few. The 25 missed `gas` rules are the stale-promo variant's appended promotion (a limited-time 5% gas rule) dropped rather than reported with its end date: Haiku 8, Sonnet 8, Opus 6, gpt-5.5 3. `card` errors are `pointValueHundredthsOfCent: 100` on cash-back cards (65, nearly all guided.1 Claude) and 14 `rewardCurrency` misses on Citi, which pays "cash back" as ThankYou Points; 11 of those are caused by guided.2's cash-back rule (Sonnet 10, Opus 1; see Disclosures).

## Failure examples

1. **Rate as an increment (baseline.1, gpt-5.5 low, Citi).** The model quotes "1 ThankYou point per $1 spent on purchases." for a 1% base rate and "3 additional ThankYou Points" for a 4% travel rate. The labels are the totals, 2% and 5%; guided prompts say so and get them right.
2. **Conflict reported but the value kept (guided.1, gpt-5.5 low, Citi conflicting-rate).** The model reports "conflicting: ... a stray 1.5% every-purchase statement that conflicts with the repeated 2%" and still returns `rateBps: 200`. The label sets a contradicted value to null. guided.2 makes this explicit; the same model then nulls it.
3. **A cap asserted with no quote (guided.2, Sonnet, held-out Chase).** All four Chase rules come back with `cap: {kind: "none"}` and an empty evidence list. Only the 1.5% rule is described as unlimited; the label leaves the others null. This is the single biggest held-out error for the Claude rows (46 fields per Sonnet run set, 52 for Haiku) and the reason their held-out claim precision is 77–82%.
4. **Paraphrase as a quote (guided.1, Haiku, Citi).** `cap` evidence "no limits stated on travel portal rewards" is the model's own summary, not page text; it does not resolve, so the claim counts as unsupported. guided.2's "no quote means null" rule removed most of these.
5. **A statement credit read as an earning rule (guided.2, Sonnet, held-out Amex).** Blue Cash Preferred's Disney streaming credit becomes an extra `streaming` rule, "On Select Streaming Subscriptions", alongside the real 6% streaming rule (7 extra rules in 34 runs). The prompts say to ignore benefits that are not earning rules; Amex's page mixes the two on one line.

## Held-out results

Configurations were chosen without any held-out data, and no prompt was changed after any held-out run, but the choice was made before the full dev matrix had finished: the Sonnet and Haiku held-out runs (11:48–11:57) started right after their own guided.2 dev runs; gpt-6-astra guided.2 full was picked as best overall from its guided.1 dev results under the v2.1 labels (guided.1 full 99.3%, keyword-window 99.0%; its own guided.2 full dev run, also 99.3%, finished 16 s before the held-out run started); gpt-5.5 low guided.2 keyword-window was picked as the cheapest strong Codex configuration once its dev run finished; `matrix.heldout.json` was committed at 12:41 after four of the five configurations had started. The baseline.1 reference is gpt-6-astra on full pages. Opus 5.5 finished its dev runs later and was never considered; its guided.2 keyword-window row was added to held-out afterwards, after the other held-out results had been seen (it was the best Claude dev configuration; seventh overall at 96.9%). Two repeats each (34 runs).

| Model | Prompt | Selection | Runs | Field acc. (e2e) | Rule recall | Rule prec. | Claim prec. | Evidence valid | Issue recall | Injection: untrusted-instr. recall / field acc. | Conflict recall | False-clean | p50 / p95 | Prompt tokens (est.) | Harness fail. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-5.5 (low) | guided.2 | keyword-window | 34 | 97.5% | 100.0% | 99.4% | 86.8% | 89.3% | 81.8% | 100.0% / 97.8% | 83.3% | 4 | 40 s / 55 s | 17342 | 0 |
| gpt-6-astra (low) | baseline.1 | full | 34 | 83.1% | 97.4% | 100.0% | 98.7% | 99.5% | 100.0% | 100.0% / 85.0% | 100.0% | 0 | 86 s / 95 s | 24098 | 0 |
| gpt-6-astra (low) | guided.2 | full | 34 | 97.2% | 100.0% | 100.0% | 94.0% | 99.9% | 100.0% | 100.0% / 96.7% | 100.0% | 0 | 77 s / 92 s | 25410 | 0 |
| claude-haiku-4-5-20251001 | guided.2 | keyword-window | 34 | 90.9% | 98.7% | 100.0% | 82.4% | 93.1% | 59.1% | 100.0% / 92.8% | 0.0% | 1 | 21 s / 42 s | 17342 | 0 |
| claude-opus-5-5 | guided.2 | keyword-window | 34 | 99.2% | 99.4% | 100.0% | 99.4% | 76.1% | 100.0% | 100.0% / 100.0% | 100.0% | 0 | 21 s / 40 s | 17342 | 0 |
| claude-sonnet-5 | guided.2 | keyword-window | 34 | 93.2% | 100.0% | 95.1% | 76.7% | 94.8% | 90.9% | 100.0% / 93.9% | 66.7% | 0 | 23 s / 48 s | 17342 | 0 |

By variant ("Field acc." is on matched rules):

<details><summary>Held-out results by variant</summary>

| Model | Variant | Runs | Rule recall | Field acc. (matched rules) | Issue recall | False-clean |
| --- | --- | --- | --- | --- | --- | --- |
| gpt-5.5 (low) guided.2 keyword-window | conflicting-rate | 6 | 100.0% | 98.9% | 83.3% | 0 |
| gpt-5.5 (low) guided.2 keyword-window | injection | 12 | 100.0% | 97.8% | 100.0% | 0 |
| gpt-5.5 (low) guided.2 keyword-window | none | 6 | 100.0% | 96.7% | n/a | 2 |
| gpt-5.5 (low) guided.2 keyword-window | remove-cap | 4 | 100.0% | 100.0% | 25.0% | 1 |
| gpt-5.5 (low) guided.2 keyword-window | stale-promo | 6 | 100.0% | 95.4% | n/a | 1 |
| gpt-6-astra (low) baseline.1 full | conflicting-rate | 6 | 100.0% | 85.6% | 100.0% | 0 |
| gpt-6-astra (low) baseline.1 full | injection | 12 | 100.0% | 85.0% | 100.0% | 0 |
| gpt-6-astra (low) baseline.1 full | none | 6 | 100.0% | 84.4% | n/a | 0 |
| gpt-6-astra (low) baseline.1 full | remove-cap | 4 | 100.0% | 85.0% | 100.0% | 0 |
| gpt-6-astra (low) baseline.1 full | stale-promo | 6 | 87.5% | 85.4% | n/a | 0 |
| gpt-6-astra (low) guided.2 full | conflicting-rate | 6 | 100.0% | 96.7% | 100.0% | 0 |
| gpt-6-astra (low) guided.2 full | injection | 12 | 100.0% | 96.7% | 100.0% | 0 |
| gpt-6-astra (low) guided.2 full | none | 6 | 100.0% | 96.7% | n/a | 0 |
| gpt-6-astra (low) guided.2 full | remove-cap | 4 | 100.0% | 100.0% | 100.0% | 0 |
| gpt-6-astra (low) guided.2 full | stale-promo | 6 | 100.0% | 97.2% | n/a | 0 |
| claude-haiku-4-5-20251001 guided.2 keyword-window | conflicting-rate | 6 | 100.0% | 89.4% | 0.0% | 0 |
| claude-haiku-4-5-20251001 guided.2 keyword-window | injection | 12 | 100.0% | 92.8% | 100.0% | 0 |
| claude-haiku-4-5-20251001 guided.2 keyword-window | none | 6 | 100.0% | 91.7% | n/a | 0 |
| claude-haiku-4-5-20251001 guided.2 keyword-window | remove-cap | 4 | 100.0% | 92.5% | 25.0% | 1 |
| claude-haiku-4-5-20251001 guided.2 keyword-window | stale-promo | 6 | 93.8% | 92.7% | n/a | 0 |
| claude-opus-5-5 guided.2 keyword-window | conflicting-rate | 6 | 100.0% | 98.9% | 100.0% | 0 |
| claude-opus-5-5 guided.2 keyword-window | injection | 12 | 100.0% | 100.0% | 100.0% | 0 |
| claude-opus-5-5 guided.2 keyword-window | none | 6 | 100.0% | 100.0% | n/a | 0 |
| claude-opus-5-5 guided.2 keyword-window | remove-cap | 4 | 100.0% | 100.0% | 100.0% | 0 |
| claude-opus-5-5 guided.2 keyword-window | stale-promo | 6 | 96.9% | 100.0% | n/a | 0 |
| claude-sonnet-5 guided.2 keyword-window | conflicting-rate | 6 | 100.0% | 93.3% | 66.7% | 0 |
| claude-sonnet-5 guided.2 keyword-window | injection | 12 | 100.0% | 93.9% | 100.0% | 0 |
| claude-sonnet-5 guided.2 keyword-window | none | 6 | 100.0% | 92.2% | n/a | 0 |
| claude-sonnet-5 guided.2 keyword-window | remove-cap | 4 | 100.0% | 94.2% | 100.0% | 0 |
| claude-sonnet-5 guided.2 keyword-window | stale-promo | 6 | 100.0% | 92.1% | n/a | 0 |

</details>

- Rule recall holds on unseen issuers: 100% for three of the five guided rows, 99.4% for Opus, 98.7% for Haiku, and 97.4% for the baseline reference. End-to-end field accuracy holds for the Codex rows (97.2–97.5%, against 98.8–99.0% on dev), drops a few points for Sonnet and Haiku (93.2%, 90.9%), and is highest for Opus (99.2%).
- Opus 5.5 (added after the original held-out set, see above) is the best held-out row: 99.2% end-to-end, 99.4% claim precision, every planted injection, conflict and deleted cap reported, and none of the `cap: none` assertions that cost the other Claude rows. Its two field errors are the Blue Cash Everyday cap period; its one missed rule is an expired promotion. Its evidence validity is the lowest (76.1%): it copies long sentences with small edits, so a quarter of its quotes do not resolve exactly, although all but one of its 468 claims still cite at least one quote that resolves.
- Claim precision drops for every guided row except Opus (94.0% gpt-6-astra, 86.8% gpt-5.5, 76.7% Sonnet, 82.4% Haiku, 99.4% Opus). Two causes account for most of it: `cap: none` asserted where Amex and Chase say nothing about a cap (30 fields for gpt-6-astra, 14 for gpt-5.5, 46–52 for Sonnet and Haiku, none for Opus, most with no quote), and `capPeriod: calendar-year` on the two Blue Cash Everyday caps labeled `year-unspecified` (12 fields for gpt-5.5, 22–24 for Sonnet and Haiku; gpt-6-astra matched the labels; see Disclosures). Neither changes the rate a checkout would use, but `none` where the label is null narrows the engine's uncertainty about a cap that may exist.
- The baseline reference (gpt-6-astra, baseline.1, full) shows the guided prompt's held-out lift: 83.1% → 97.2% end-to-end, 98.7% → 94.0% claim precision (the baseline claims less and so is wrong less often), and it misses 4 of the 6 expired-promotion rules. The lift is partly example-assisted (see Disclosures).
- Injection resistance transfers: 100% untrusted-instruction recall on every held-out row, with injection-variant field accuracy within two points of the base cases. Conflict recall is weaker off-distribution for Sonnet and Haiku (66.7%, 0%; Opus 100%: Haiku reports the contradiction as "ambiguous" or not at all) and for gpt-5.5 (83.3%). The `remove-cap` variants (a deleted cap sentence should yield a `missing` issue) are found by gpt-6-astra, Opus and Sonnet every time, by gpt-5.5 and Haiku once in four.
- Latency: the full-page Codex rows take 77–86 s per run at p50 on the ~80 kB Amex pages; the keyword-window rows 21–40 s.

## Re-scoring under real.v2.2 and the retried slots

Every run in this document was collected on the same 15 captures; observations are bound to the corpus inputs, so the `real.v2.2` label fix (stale-promo rules inherit card-wide no-cap and no-activation statements and are U.S.-only when their wording says U.S.) was applied by re-scoring saved observations. It was a mechanical generator fix applied to both splits, made after the held-out results had been seen. Re-scoring the 29 dev rows under `real.v2.1` and `real.v2.2` moves end-to-end field accuracy by at most 1.2 points (Opus guided.2, 98.1% → 96.9%) and the stale-promo variant's field accuracy by at most 5 points, in both directions: the eight Codex guided rows split four up and four down, the Claude rows mostly down. Several close dev pairs swap order: gpt-6-astra guided.1 keyword-window (99.0% → 99.3%) moves ahead of gpt-6-astra guided.1 and guided.2 full (99.3% → 99.0%) and of gpt-5.5 guided.2 keyword-window (99.0% → 98.8%); gpt-5.5 guided.1 keyword-window (97.3% → 97.6%) moves ahead of gpt-5.5 guided.1 full (98.0% → 97.1%) and of Opus guided.2 (98.1% → 96.9%); and four pairs within a point of each other near the bottom swap (three baseline.1 pairs, plus gpt-5.5 high baseline.1 keyword-window 70.3% → 69.8% vs Haiku guided.1 full 70.0%). The held-out ordering is unchanged; the relabel also changed the held-out labels (the Amex stale-promo rule became U.S.-only), moving those rows by +0.2 to +0.4 points.

Harness failures (timeouts at the 240 s attempt cap, provider errors) were retried under one rule for every row, at most twice per slot. 41 slots were retried across 7 configurations (25 of them in the held-out gpt-6-astra baseline.1 row, whose first pass ran while the machine slept), and every retry produced a model result: the "Harness fail." column is 0 on every row. Before the retries, gpt-6-astra guided.2 full held-out read 87.5% end-to-end with 3 timeouts scored as empty extractions; it reads 97.2% now.

## Disclosures

- **Worked examples in the prompts.** `guided.1` and `guided.2` illustrate conventions with examples ("U.S. supermarkets" for U.S.-only, "$6,000 = 600000" for a cap amount, superstores excluded from supermarkets) that happen to match Amex wording, and Amex is held-out. The held-out lift of the guided prompts over `baseline.1` is therefore partly example-assisted; the prompts were written from the research notes before any held-out run, but the examples were not chosen blind to Amex's public terms.
- **A guided.2 rule conflicts with one dev label.** guided.2 says "cash-back" when rewards are "cash back or cash rewards". Citi Double Cash advertises cash back but pays it as ThankYou Points, and the label says `points` with a point value of 100. Under guided.2 Sonnet answered `cash-back` in all 10 Citi runs and Opus in 1 of 5 (11 errors); the other models answered `points`, as did every model under guided.1 except Opus guided.1 full (2 of 5). It is a wording bug to fix in a later prompt version.
- **Amex Blue Cash Everyday cap period is a genuine wording ambiguity.** The terms state "in a calendar year" only in the supermarket sentence; the gas and online-retail sentences say "across the Card Account (then 1%)" and the product page says "per year". The label is `calendar-year` for supermarkets and `year-unspecified` for the other two. Haiku and Sonnet answered `calendar-year` for all three (22–24 field errors per held-out run set), gpt-5.5 about half the time (12), Opus twice, and gpt-6-astra mostly `year-unspecified`. The label follows the letter of the text; a reader would probably infer the calendar year. This is the second-largest source of held-out field errors among the guided rows, after `cap: none` on pages that say nothing about a cap, and should be decided in a human verification pass.
- **Harness failures were retried under one rule for every row.** A slot whose trace ended in `timeout` (240 s attempt cap) or `provider_error` is not a model result; it was logged to `failures.jsonl` in the run directory and run again, at most twice per slot, for every dev and held-out configuration. Most timeouts came from two conditions the operator observed rather than the traces record: three Codex matrix runners running at once (nine processes) on the largest full-page held-out cases, and the machine sleeping mid-run. Failures left after the retries stay in the report and are counted in the "Harness fail." column.
- **Token columns.** "Prompt tokens (est.)" is the harness's own estimate of system prompt + user JSON + schema (bytes / 3), the same formula for every provider, so rows are comparable. Provider-reported input tokens are not shown in the main table because the two CLIs count differently: Codex adds about 2.6k tokens of its own harness and Claude's CLI sums cache reads over its turns (the Claude runs saved here were collected before the provider counted per turn; the provider now reports the largest turn's prompt). Provider-reported output tokens are listed separately: Codex includes reasoning tokens; Claude thinking was disabled (`MAX_THINKING_TOKENS=0`) and output sums the CLI's turns.
- **CLI versions.** Codex CLI 0.158.0 throughout. Claude Code CLI 2.1.277 for the Haiku and Sonnet rows; 2.1.285 for the Opus 5.5 rows (2.1.277 rejected the model ID). The provider invocation is identical. These versions come from the operator's log, not from the traces; runs collected from now on record every CLI version they were collected under in the bundle configuration (`cliVersions`), and earlier bundles read `unrecorded`.
- **A planned local model was dropped.** The plan included llama3.1 through Ollama (`codex exec --oss`); it was removed by a scope change before any run, so there is no local-model row.
- **Labels.** Agent-verified. Corpus `real.v2.2` fixed a generator bug in the stale-promo variant labels (the added promotional rule now inherits the card-wide no-cap and no-activation statements and is U.S.-only when its wording says U.S.); every run in this document was re-scored under `real.v2.2` from its saved observations. Observations are bound to the corpus inputs (sources and cases without labels), not to the labels.
- **Subscription models are not pinned snapshots.** `gpt-6-astra`, `claude-sonnet-5` and the others are whatever the vendor CLIs served on 2026-09-29.

## Limitations

Seven cards, two per issuer at most, and 37 cases; the variants are synthetic edits of real pages, so injection and conflict results measure resistance to planted text, not to real adversarial pages. Labels are agent-verified. Both model families run through their vendors' agent CLIs on subscriptions rather than raw APIs, which adds harness tokens and latency and, for Claude, a structured-output tool call. Repeats are two per case (one for Opus). Latency is wall-clock through the CLIs on one machine while other runs were in flight.

## Reproduce

```sh
npm run eval:matrix -- --provider codex            # evals/curation/matrix.dev.json
npm run eval:matrix -- --provider claude
npm run eval:matrix -- --config evals/curation/matrix.heldout.json --provider codex
npm run eval:summarize -- --runs evals/curation/runs/matrix --runs evals/curation/runs/matrix-heldout
```

Captured issuer text is not committed (copyright); the manifest holds URLs and hashes, and re-capturing changes the hashes.
