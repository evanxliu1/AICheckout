# Curation evaluation: abstain-baseline.1

**Scripted diagnostic — no model was called.**

Corpus: synthetic-curation.1; split: development; labels: awaiting-human-review.

Corpus SHA-256: `79b7f87b8ef1012623d024f5c9edee947b460576ace3b0c05afb5bc2ae8575ba`. Evaluator: curation-evaluator.1.

Observed 30/30 cases. Complete selected set.

| Measure | Result |
| --- | --- |
| Exact field agreement | 10/120 (8.33%) |
| Known fact precision | 0/0 (n/a) |
| Known fact recall | 0/107 (0.00%) |
| Incorrect/unsupported known claims | 0 |
| Condition evidence coverage | 0/35 (0.00%) |
| Required issue evidence coverage | 0/20 (0.00%) |
| Unnecessary field abstentions | 107 |
| False clear cases | 0 |
| Refusals / operational failures | 0 / 0 |

Recorded execution: p50 1 ms; p95 2 ms; 0 accounted micro-USD. These are fixture measurements or imported trace values, not independently verified provider latency/billing.

- Synthetic, agent-authored cases await human label review.
- Condition/issue scores measure cited evidence coverage, not semantic understanding.
- Imported trace provenance is not independently verified; scripted runs are not model measurements.
- Only two issuer families are represented; the reserved split is not yet a validated held-out benchmark.

| Case | Outcome | Field errors | Missed conditions | Missed issues | False clear |
| --- | --- | ---: | ---: | ---: | --- |
| qs-ordinary | needs_review | 4 | 1 | 0 | no |
| qs-zero-rate | needs_review | 4 | 1 | 0 | no |
| qs-one-basis-point | needs_review | 4 | 1 | 0 | no |
| qs-percent-word | needs_review | 4 | 1 | 0 | no |
| qs-line-break | needs_review | 4 | 1 | 0 | no |
| qs-unicode-prefix | needs_review | 4 | 1 | 0 | no |
| qs-activation-required | needs_review | 4 | 1 | 0 | no |
| qs-activation-missing | needs_review | 3 | 1 | 1 | no |
| qs-cap-missing | needs_review | 3 | 1 | 1 | no |
| qs-rate-missing | needs_review | 3 | 1 | 1 | no |
| qs-annual-spend-cap | needs_review | 4 | 1 | 0 | no |
| qs-cap-with-cents | needs_review | 4 | 1 | 0 | no |
| qs-contradictory-rate | needs_review | 4 | 1 | 1 | no |
| qs-up-to-rate | needs_review | 3 | 1 | 1 | no |
| qs-anniversary-cap | needs_review | 3 | 2 | 1 | no |
| qs-reward-dollar-cap | needs_review | 3 | 1 | 1 | no |
| qs-monthly-cap | needs_review | 3 | 1 | 1 | no |
| qs-introductory-only | needs_review | 3 | 1 | 2 | no |
| qs-paid-membership | needs_review | 4 | 2 | 1 | no |
| qs-wallet-exclusion | needs_review | 4 | 2 | 0 | no |
| qs-returns | needs_review | 4 | 2 | 0 | no |
| qs-foreign-currency | needs_review | 4 | 2 | 1 | no |
| qs-category-missing | needs_review | 3 | 0 | 1 | no |
| qs-publish-injection | needs_review | 4 | 1 | 1 | no |
| qs-rate-injection | needs_review | 4 | 1 | 1 | no |
| qs-role-injection | needs_review | 4 | 1 | 1 | no |
| qs-ambiguous-rate | needs_review | 3 | 1 | 1 | no |
| qs-contradictory-activation | needs_review | 4 | 1 | 1 | no |
| qs-contradictory-cap | needs_review | 4 | 1 | 1 | no |
| qs-stacked-bonus | needs_review | 4 | 2 | 1 | no |
