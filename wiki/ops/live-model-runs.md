---
type: Runbook
title: Live model runs
description: Run live extraction evals locally through the Codex CLI and Claude Code CLI subscription providers, including the resumable matrix runner.
status: stable
tags: [ops, evals, llm]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T18:30:00Z
sources:
  - resource: ../../evals/curation/README.md
    title: Curation evaluations
  - resource: ../../apps/api/src/curation/v2/eval-cli.ts
    title: eval:v2 CLI (providers, limits, exit codes)
  - resource: ../../apps/api/src/curation/codex.ts
    title: Codex CLI provider
  - resource: ../../apps/api/src/curation/curation-model.ts
    title: Curation defaults (gpt-5.6-luna xhigh)
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
| Curation defaults | [`apps/api/src/curation/curation-model.ts`](../../apps/api/src/curation/curation-model.ts) `CURATION_DEFAULTS`: gpt-5.6-luna, `xhigh`, `guided.2`, `keyword-window.1`, visible output tokens, 600 s / 900 s. Used by `eval:v2 --provider codex` with no `--model` (or `--model gpt-5.6-luna`) and by `scripts/extract-cards.mjs` (Codex only; `--provider claude` there needs `--model` and `--effort`); each flag overrides its part. A live `eval:v2` run prints the resolved configuration and deadlines before its first call |
| Committed results | `npm run eval:summarize` → `docs/evals/results.json`, `results.svg`, `results-heldout.svg` (metrics only); a `--split all` run becomes one row per split |
| Usage-limit exit | Status 3 (`EXIT_RATE_LIMITED`); partial results saved |
| Codex limits | `CODEX_LIMITS`: 240 s per attempt, 480 s total, 64k input / 8192 output tokens; the curation model gets 600 s / 900 s (new and resumed runs) |
| Binary overrides | `AICHECKOUT_CODEX_BIN`, `AICHECKOUT_CLAUDE_BIN` (default `codex`, `claude` on `PATH`) |
| Real-corpus captures | `evals/curation/real/captures/` is gitignored and machine-local (copyrighted issuer text) |

## Prerequisites

1. Work in the main checkout, not a worktree: real-corpus captures exist only there, and loading fails if a capture's hash differs from `manifest.json`.
2. `npm ci`
3. Codex: `codex login` with the ChatGPT account. Claude: `claude` signed in with the claude.ai account.
4. Do not export metered credentials. The providers strip them anyway: Codex drops `OPENAI_API_KEY` / `CODEX_API_KEY`; Claude drops every `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` variable (keeps `CLAUDE_CODE_OAUTH_TOKEN`).

## Run one configuration

1. Check the harness without a model: `npm run eval:v2 -- --check`.
2. Smoke-test one or two cases with the curation model: `npm run eval:v2 -- --provider codex --split dev --limit 2` (gpt-5.6-luna, `xhigh`, `guided.2`, `keyword-window.1`, visible output tokens, 600 s / 900 s; about 3 min per case). Another model needs `--model` and keeps the older defaults (`--effort low --prompt guided.1 --selection full`, 240 s / 480 s), e.g. `--model gpt-5.5 --effort low --prompt guided.1 --selection keyword-window.1`.
3. Full run: same command with `--repeat 2` (add `--concurrency N`; the plan used 3 for Codex). Since 2026-10-01 Evan prefers more concurrency over protecting subscription usage limits; local models are not used (directive 2026-09-29, [user directives](../product/user-directives.md)).
4. If it exits with status 3, wait for the limit to reset and rerun with `--resume evals/curation/runs/<dir>` and the same `--corpus`. Only missing `caseId#repeat` slots run; files are rewritten as a superset.
5. After a scorer bug fix, re-score without calling a model: `npm run eval:v2 -- --replay evals/curation/runs/<dir>/observations.json`.

`--provider claude` takes `--effort low|medium|high|xhigh|max` and disables extended thinking (`MAX_THINKING_TOKENS=0`). `--split heldout` needs `--allow-heldout`. Full option list: [`evals/curation/README.md`](../../evals/curation/README.md).

## Run the matrix

1. Preview: `npm run eval:matrix -- --dry-run` (prints run/resume/skip per configuration).
2. Run one provider: `npm run eval:matrix -- --provider codex --wait-minutes 15`. With `--wait-minutes` a usage-limit stop sleeps and resumes by itself (up to `--max-waits`, default 12); without it, the runner exits and a plain rerun resumes.
3. Codex and Claude have separate limits, so start a second runner with `--provider claude` in another terminal.
4. Narrow with `--only SLUG-SUBSTRING`; use the held-out file with `--config evals/curation/matrix.heldout.json`.
5. Aggregate: `npm run eval:summarize -- --runs evals/curation/runs/matrix [more dirs]` and commit the `docs/evals/` outputs. Mark rows added after their split was chosen with `--added RUN-ID`. The published set uses Evan's main-checkout `runs/matrix` and `runs/matrix-heldout` plus the luna run, kept in the expansion worktree at `evals/curation/runs/luna/codex.gpt-5.6-luna.xhigh.guided.2.keyword-window.1.all/` (a copy of `runs/v2-2026-10-02T04-38-57-673Z-c03c0495/`); the full command is under Reproduce in [`docs/evals/results.md`](../../docs/evals/results.md#reproduce). The gpt-5.6-luna rows are not in the matrix files, which stay as the Phase 2c experiment defined them.
6. Edit the tables and prose of `docs/evals/results.md` to match `results.json`; it is hand-written, and the site test checks every row against `results.json`.

None of these were run for this page on 2026-10-02; they are taken from the scripts and README.

## Gotchas

- Never tune prompts on held-out results, never re-capture pages (hashes would invalidate labels), never edit corpus labels to fit a model (phase 2c rules, [archive](../archive/phase2-goal.md)).
- Codex adds roughly 2.5–2.6k harness tokens per call; subscription models are not pinned snapshots. Both are stated limitations of the results.
- The curation model since 2026-10-02 is gpt-5.6-luna at `--effort xhigh` ([decision](../decisions/2026-10-02-gpt-5-6-luna-for-curation.md)); expect about 3 min per case. It is the `eval:v2` Codex default (with visible-output-token accounting and the longer deadlines, commit `0ebb98c`) on `main` since PR #16 (`be5de25`).
- `--model` is required for Claude, and for Codex on `main`; on the expansion branch Codex defaults to the curation model. Unknown `--disable` feature flags are hard errors; the provider filters them against what the installed CLI reports.
- A Codex run in which the agent executes a tool is rejected; each call runs in an empty read-only directory.
- `observations.json` holds traces; keep `runs/` private and inspect before sharing anything from it.

## Related

* [Evaluation](../system/evaluation.md)
* [Local setup](local-setup.md)
* [Agent-verified labels decision](../decisions/2026-09-29-agent-verified-labels.md)
* [Code map](../system/code-map.md)
