---
type: Decision
title: Use gpt-5.6-luna at xhigh effort for curation
description: Move live curation and extraction from gpt-5.5 low to gpt-5.6-luna xhigh to keep the app on a frontier model, accepting equal accuracy and much slower runs.
status: accepted
tags: [decision, llm, curation, evaluation]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:10:00Z
sources:
  - resource: ../../docs/evals/results.md
    title: Published eval results (gpt-5.5 and Claude rows, 2026-09-29/30)
  - resource: ../system/evaluation.md
    title: Evaluation (harness, corpus, metrics)
---

# Use gpt-5.6-luna at xhigh effort for curation (2026-10-02)

## Context

Until 2026-10-02 the recommended live configuration was gpt-5.5 at `low` effort with prompt `guided.2` and selection `keyword-window.1`: 98.8% end-to-end field accuracy on dev, 97.5% on held-out, false-clean in 1 of 40 dev runs and 4 of 34 held-out runs, p50 25 s (dev) / 40 s (held-out) per case ([`docs/evals/results.md`](../../docs/evals/results.md)). claude-opus-5-5 with the same prompt reached 99.2% on held-out. Evan asked on 2026-10-02 (chat) to move curation to gpt-5.6-luna so the app stays current with frontier models.

The evidence for luna is one run of gpt-5.6-luna at `xhigh` effort, `guided.2`, `keyword-window.1`, visible output tokens (hidden reasoning not counted against the output limit), over all 37 cases of corpus `real.v2.2` (agent-verified labels), started 2026-10-02T04:38Z from the `phase7-catalog-expansion` worktree. The run report is gitignored (`evals/curation/runs/v2-2026-10-02T04-38-57-673Z-c03c0495/report.json` in that worktree); the numbers below are quoted from it.

| Metric | gpt-5.6-luna xhigh (all 37) | gpt-5.5 low (dev / held-out) |
| --- | --- | --- |
| End-to-end field accuracy | 98.8% (931/942) | 98.8% / 97.5% |
| Rule recall | 100% (146/146) | see results.md |
| Rule precision | 98.6% (146/148) | see results.md |
| Issue recall | 100% (23/23), including all 14 planted injections | 100% injections |
| `capPeriod` | 16/22 (72.7%), the main weakness | see results.md |
| False-clean runs | 1 of 37 (`wells-fargo-active-cash-stale-promo`, marked `evidence_valid`) | 1 of 40 / 4 of 34 |
| Latency per case | p50 165 s, p95 259 s (about 3 min) | p50 25 s / 40 s, p95 54 s / 55 s |

The luna run covers dev and held-out together in one repeat, so it is not split the same way as the published rows. Held-out results had already been seen, and repeat noise in earlier runs reached 5.8 points; differences under about 3 points are ties.

## Options considered

| Option | Fit | Why not / why |
| --- | --- | --- |
| Keep gpt-5.5 low | Same accuracy, similar false-clean rate, 4–6× faster at p50 | Not the current frontier OpenAI model |
| claude-opus-5-5 `guided.2` | Best held-out row (99.2%) | Its row was added after other held-out results were seen; Evan chose to move the OpenAI path |
| **gpt-5.6-luna xhigh** (chosen) | Ties on accuracy, frontier model | About 3 min per case; one false-clean; weaker `capPeriod` |

## Decision

Live curation and extraction runs use gpt-5.6-luna at `xhigh` effort with `guided.2` and `keyword-window.1`, through the Codex CLI on Evan's subscription, with visible output tokens. The catalog expansion extraction ([catalog expansion](../system/catalog-expansion.md)) already ran with this configuration. The choice is for frontier currency, not measured gain: on this corpus luna ties gpt-5.5.

## Consequences

- Runs are slow (about 3 min per case; about 184 s per card on the 180-card expansion), so batches need concurrency and longer deadlines (`extract-cards.mjs` uses 600 s per attempt, 900 s total, concurrency 8).
- One stale-promo case passed as clean. Every extraction still goes to human review before any catalog change, so a false-clean costs review attention, not correctness, but reviewers should not trust `evidence_valid` on promo pages.
- `capPeriod` is the weakest field (16/22); reviewers check cap periods by hand.
- The luna row is added to `docs/evals/results.*` with the code change that makes it the default; this record does not edit those files.
- Subscription models are not pinned snapshots; a later rerun may differ.

## Status

Accepted 2026-10-02 by Evan Liu (chat).
