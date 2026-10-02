---
type: Decision
title: Publish the gpt-5.6-luna run per split, marked added after, and make it the Codex default
description: The single all-cases luna run is reported as separate dev and held-out rows marked "added after", the Phase 2c matrix files stay unchanged, and eval:v2 and extract-cards default to the curation configuration.
status: accepted
tags: [decision, evaluation, llm, curation]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:40:00Z
sources:
  - resource: ../../docs/evals/results.md
    title: Published eval results
  - resource: ../../apps/api/src/curation/v2/summarize.ts
    title: Results summarizer (per-split rows)
  - resource: ../../apps/api/src/curation/curation-model.ts
    title: Curation defaults
---

# Publish the gpt-5.6-luna run per split, marked added after, and make it the Codex default (2026-10-02)

## Context

The [curation model decision](2026-10-02-gpt-5-6-luna-for-curation.md) said the luna row would land in `docs/evals/results.*` with the code change that makes luna the default. The evidence is one run, `--split all`, one repeat, over all 37 cases. Every published row is per split, from the Phase 2c matrix files, and the site and charts only show `dev` and `heldout` rows. Held-out results had already been seen when luna was chosen.

## Options considered

| Option | Why not / why |
| --- | --- |
| Publish one "all" row | The site and charts drop it, and it mixes dev with held-out, unlike every other row |
| Re-run luna per split through the matrix | New live runs (about 3 min per case); not authorized for this change, and the existing run already covers both splits |
| Split the observations file by hand into two run directories | Works, but it is a manual edit of evidence |
| **Summarizer splits an `all` run into one row per split** (chosen) | Same scorer, same observations, no hand edits; reusable for later all-split runs |

For the defaults: a new `CURATION_DEFAULTS` module that both `eval:v2` and `extract-cards.mjs` read, applied when `--provider codex` has no `--model` (or names gpt-5.6-luna). Other models keep the Phase 2c defaults so matrix rows and saved commands mean the same as before.

## Decision

- `summarizeRuns` reports a `--split all` run as `<name>.dev` and `<name>.heldout` rows (a trailing `.all` in the directory name is dropped).
- Both luna rows are marked `--added` ("added after"), like the Opus held-out row, because they were run after all other results had been seen. `matrix.dev.json` and `matrix.heldout.json` are not changed; `results.md` gives the reproduce command for the luna run.
- `eval:v2 --provider codex` with no `--model` runs gpt-5.6-luna `xhigh`, `guided.2`, `keyword-window.1`, visible output tokens, 600 s / 900 s; a resumed luna run keeps the longer deadlines. Any flag overrides its part.

## Consequences

- Prior rows were byte-for-byte unchanged on regeneration (checked against the committed `results.json` and both SVGs before adding luna).
- Luna has one repeat per split (20 dev, 17 held-out runs); with noise up to 5.8 points, its rows tie gpt-5.5 low and gpt-6-astra.
- The site caveat now says Opus and gpt-5.6-luna were added after.
- `--provider codex` without `--model` no longer fails; it starts slow, long runs. A Codex command that relied on the old error now runs luna.

## Status

Accepted 2026-10-02 (Claude Code session acting on Evan's task to add the luna row and make luna the default).
