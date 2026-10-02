---
type: Runbook
title: Live model runs
description: Run live extraction evals locally through the Codex CLI and Claude Code CLI subscription providers, including the resumable matrix runner.
status: stable
tags: [ops, evals, llm]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../../evals/curation/README.md
    title: Curation evaluations
  - resource: ../../apps/api/src/curation/v2/eval-cli.ts
    title: eval:v2 CLI (providers, limits, exit codes)
  - resource: ../../apps/api/src/curation/codex.ts
    title: Codex CLI provider
  - resource: ../../apps/api/src/curation/claude.ts
    title: Claude Code CLI provider
  - resource: ../../scripts/run-eval-matrix.mjs
    title: Matrix runner
  - resource: ../../scripts/summarize-evals.mjs
    title: Results aggregator
  - resource: ../../evals/curation/matrix.dev.json
    title: Dev matrix
  - resource: ../../.gitignore
    title: Ignored run and capture directories
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived), Phase 2c experiment rules
---

# Live model runs

Live extraction evals call models only through vendor CLIs signed in to Evan's subscriptions: `codex exec` (ChatGPT plan, provider id `codex-cli`) and `claude -p` (claude.ai plan, provider id `claude-cli`). They run on Evan's machine only, never on Render, and never with a paid API key ([decision](../decisions/2026-09-28-subscription-cli-providers-local-only.md)). Runs land in the gitignored `evals/curation/runs/`; only aggregated metrics are committed.

## Facts

| Item | Value |
| --- | --- |
| Single-config CLI | `npm run eval:v2` → [`apps/api/src/curation/v2/eval-cli.ts`](../../apps/api/src/curation/v2/eval-cli.ts) |
| Matrix runner | `npm run eval:matrix` → [`scripts/run-eval-matrix.mjs`](../../scripts/run-eval-matrix.mjs) |
| Matrix configs | [`evals/curation/matrix.dev.json`](../../evals/curation/matrix.dev.json) (14 codex + 15 claude configs as of 2026-10-02), [`matrix.heldout.json`](../../evals/curation/matrix.heldout.json) |
| Output | `evals/curation/runs/<run>/` and `runs/matrix/<slug>/` (dev), `runs/matrix-heldout/<slug>/`: `observations.json`, `report.json`, `report.md`, `failures.jsonl`, `matrix-status.json` |
| Committed results | `npm run eval:summarize` → `docs/evals/results.json`, `results.svg` (metrics only) |
| Usage-limit exit | Status 3 (`EXIT_RATE_LIMITED`); partial results saved |
| Codex limits | `CODEX_LIMITS`: 240 s per attempt, 480 s total, 64k input / 8192 output tokens |
| Binary overrides | `AICHECKOUT_CODEX_BIN`, `AICHECKOUT_CLAUDE_BIN` (default `codex`, `claude` on `PATH`) |
| Real-corpus captures | `evals/curation/real/captures/` is gitignored and machine-local (copyrighted issuer text) |

## Prerequisites

1. Work in the main checkout, not a worktree: real-corpus captures exist only there, and loading fails if a capture's hash differs from `manifest.json`.
2. `npm ci`
3. Codex: `codex login` with the ChatGPT account. Claude: `claude` signed in with the claude.ai account.
4. Do not export metered credentials. The providers strip them anyway: Codex drops `OPENAI_API_KEY` / `CODEX_API_KEY`; Claude drops every `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` variable (keeps `CLAUDE_CODE_OAUTH_TOKEN`).

## Run one configuration

1. Check the harness without a model: `npm run eval:v2 -- --check`.
2. Smoke-test one or two cases, e.g. `npm run eval:v2 -- --provider codex --model gpt-5.5 --effort low --prompt guided.1 --selection keyword-window.1 --split dev --limit 2`.
3. Full run: same command with `--repeat 2` (add `--concurrency N`; the plan used 3 for Codex, 1 for local models).
4. If it exits with status 3, wait for the limit to reset and rerun with `--resume evals/curation/runs/<dir>` and the same `--corpus`. Only missing `caseId#repeat` slots run; files are rewritten as a superset.
5. After a scorer bug fix, re-score without calling a model: `npm run eval:v2 -- --replay evals/curation/runs/<dir>/observations.json`.

`--provider claude` takes `--effort low|medium|high|xhigh|max` and disables extended thinking (`MAX_THINKING_TOKENS=0`). `--split heldout` needs `--allow-heldout`. Full option list: [`evals/curation/README.md`](../../evals/curation/README.md).

## Run the matrix

1. Preview: `npm run eval:matrix -- --dry-run` (prints run/resume/skip per configuration).
2. Run one provider: `npm run eval:matrix -- --provider codex --wait-minutes 15`. With `--wait-minutes` a usage-limit stop sleeps and resumes by itself (up to `--max-waits`, default 12); without it, the runner exits and a plain rerun resumes.
3. Codex and Claude have separate limits, so start a second runner with `--provider claude` in another terminal.
4. Narrow with `--only SLUG-SUBSTRING`; use the held-out file with `--config evals/curation/matrix.heldout.json`.
5. Aggregate: `npm run eval:summarize -- --runs evals/curation/runs/matrix [more dirs]` and commit the `docs/evals/` outputs.

None of these were run for this page on 2026-10-02; they are taken from the scripts and README.

## Gotchas

- Never tune prompts on held-out results, never re-capture pages (hashes would invalidate labels), never edit corpus labels to fit a model (phase 2c rules, [archive](../archive/phase2-goal.md)).
- Codex adds roughly 2.5–2.6k harness tokens per call; subscription models are not pinned snapshots. Both are stated limitations of the results.
- `--model` is required for Codex. Unknown `--disable` feature flags are hard errors; the provider filters them against what the installed CLI reports.
- A Codex run in which the agent executes a tool is rejected; each call runs in an empty read-only directory.
- `observations.json` holds traces; keep `runs/` private and inspect before sharing anything from it.

## Related

* [Evaluation](../system/evaluation.md)
* [Local setup](local-setup.md)
* [Agent-verified labels decision](../decisions/2026-09-29-agent-verified-labels.md)
* [Code map](../system/code-map.md)
