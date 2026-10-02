---
type: System Component
title: Curation harness
description: apps/api/src/curation — the bounded LLM extraction kernel (executeTask), v1 and v2 extraction contracts, context and prompt versions, quote resolution, limits and budgets, providers (OpenAI, Codex CLI, Claude CLI, fixtures) and the durable trace ledger.
status: stable
tags: [system, curation, llm, extraction, harness]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:40:00Z
sources:
  - resource: ../../apps/api/src/curation/runner.ts
    title: executeTask and provider interface
  - resource: ../../apps/api/src/curation/context.ts
    title: v1 context
  - resource: ../../apps/api/src/curation/extraction.ts
    title: v1 validation
  - resource: ../../apps/api/src/curation/ledger.ts
    title: Ledger client and executeRecordedExtraction
  - resource: ../../apps/api/src/curation/service.ts
    title: HTTP orchestration
  - resource: ../../apps/api/src/curation/review.ts
    title: Saved-run review and proposals
  - resource: ../../apps/api/src/curation/database.ts
    title: Scoped executor pool
  - resource: ../../apps/api/src/curation/openai.ts
    title: OpenAI Responses adapter
  - resource: ../../apps/api/src/curation/codex.ts
    title: Codex CLI provider
  - resource: ../../apps/api/src/curation/claude.ts
    title: Claude Code CLI provider
  - resource: ../../apps/api/src/curation/v2/schema.ts
    title: Extraction contract v2
  - resource: ../../apps/api/src/curation/v2/context.ts
    title: v2 prompts and selections
  - resource: ../../apps/api/src/curation/v2/validate.ts
    title: v2 quote resolution and validation
  - resource: ../../apps/api/src/curation/v2/task.ts
    title: v2 task
  - resource: ../../apps/api/src/curation/v2/eval-cli.ts
    title: v2 eval CLI
  - resource: ../../packages/catalog-review/src/curation.ts
    title: Shared trace and limits contracts
  - resource: ../../apps/api/src/curation/README.md
    title: Kernel README
  - resource: ../../supabase/CURATION.md
    title: Ledger and recovery runbook
  - resource: ../archive/design.md
    title: Pre-wiki design doc (archived)
---

# Curation harness

The harness turns captured issuer text into structured, evidence-cited reward facts for human review. One bounded loop, [`runner.ts:executeTask`](../../apps/api/src/curation/runner.ts), runs any `ExtractionTask` against any `ExtractionProvider`: it builds a versioned context, admits it against token/byte limits, calls the provider with a deadline and abort signal, retries only transient or rate-limit failures, validates schema and evidence, and returns a trace. The model gets no tools, secrets, database or publication path. Two contracts exist: **v1** (`issuer-extraction.1`) is wired into the hosted HTTP path and the database ledger; **v2** (`issuer-extraction.2`) is used by the local evaluation CLIs that produced the results in `docs/evals/` ([Evaluation](evaluation.md)).

Verified 2026-10-02 by reading the code; the API test suite (including `curation.test.ts`, `codex.test.ts`, `claude.test.ts`, `extraction-v2.test.ts`) passed locally. No live provider call was made for this page.

## Facts

| Item | v1 | v2 |
| --- | --- | --- |
| Schema version | `issuer-extraction.1` ([`catalog-review/src/curation.ts`](../../packages/catalog-review/src/curation.ts)) | `issuer-extraction.2` ([`v2/schema.ts`](../../apps/api/src/curation/v2/schema.ts)) |
| Prompt versions | `issuer-extraction.1` (`PROMPT_VERSION`) | `baseline.1`, `guided.1`, `guided.2` (`PROMPTS` in [`v2/context.ts`](../../apps/api/src/curation/v2/context.ts)) |
| Context version | `captured-text-json.3` | `issuer-json.2/<selection>`; selections `full`, `keyword-window.1` |
| Source policy | `SOURCE_POLICY_VERSION` (catalog-review) | `captured-issuer-pages.1` |
| Target | Stable card/rule IDs and categories, no expected rates | Card ID/name only; the model discovers rules |
| Citations | Quote + document ID/hash + UTF-16 offsets, verified byte-for-byte | Quotes only; server resolves spans (`resolveQuote`) |
| Max input | 96,000 bytes, ≤ 3 docs, 120,000 chars each | 1,500,000 bytes (`MAX_INPUT_BYTES_V2`) |
| Used by | `POST /v1/review/drafts/:id/extractions`, `eval:curation` | `eval:v2`, `eval:matrix` (local only) |

Default limits (`limitsSchema`, overridable per run within the bounds):

| Limit | Default | Bound |
| --- | --- | --- |
| `budgetMicrousd` | 0 | ≤ 1e9 |
| `maxAttempts` | 2 | 1–2 |
| `attemptTimeoutMs` / `totalTimeoutMs` | 10,000 / 15,000 | ≤ 600,000 / ≤ 900,000 (raised for local high-effort runs on the expansion branch, `0ebb98c`) |
| `maxInputTokens` (estimate) | 48,000 | 512–64,000 |
| `maxOutputTokens` | 4,096 | 128–8,192 |
| Returned text | 65,536 bytes | fixed |

The v2 eval CLI uses `CODEX_LIMITS` for live providers: 240 s attempt, 480 s total, 64,000 input tokens, 8,192 output tokens ([`v2/eval-cli.ts`](../../apps/api/src/curation/v2/eval-cli.ts)). Runs of the curation model (gpt-5.6-luna) default to 600 s / 900 s instead ([`curation-model.ts`](../../apps/api/src/curation/curation-model.ts), [live model runs](../ops/live-model-runs.md)).

## Providers

| Provider ID | Mode | File | Where it may run |
| --- | --- | --- | --- |
| `fixture-refusal` | fixture | [`service.ts:fixtureRefusalProvider`](../../apps/api/src/curation/service.ts) | API, loopback databases only; always records a synthetic refusal |
| OpenAI Responses | metered | [`openai.ts`](../../apps/api/src/curation/openai.ts) | API; requires `CURATION_ALLOW_METERED=true`, key, dated `gpt-…-YYYY-MM-DD` snapshot, price ceilings, funded DB policy. Never called live; authorized budget is $0 |
| `codex-cli` | subscription | [`codex.ts:createCodexProvider`](../../apps/api/src/curation/codex.ts) | Local evals only (developer's ChatGPT login). Empty read-only temp dir, our system prompt replaces base instructions, user config ignored, every reported optional feature disabled, `--output-schema` |
| `claude-cli` | subscription | [`claude.ts:createClaudeProvider`](../../apps/api/src/curation/claude.ts) | Local evals only (claude.ai login). `claude -p --output-format json`, no tools/settings/MCP/session persistence, `--effort` default `low` |
| `fixture` (reference echo, abstaining) | fixture | [`v2/evaluate.ts`](../../apps/api/src/curation/v2/evaluate.ts), [`evaluation.ts`](../../apps/api/src/curation/evaluation.ts) | CI `--check` runs; no model |

CLI binaries can be overridden with `AICHECKOUT_CODEX_BIN` / `AICHECKOUT_CLAUDE_BIN`. CLI versions are recorded per configuration ([`cli-version.ts`](../../apps/api/src/curation/cli-version.ts)); a resume under a different version warns.

## How it works

1. **Task.** An `ExtractionTask<Input, Output>` supplies `parseInput`, `validateInputs`, `documents`, `buildContext`, `maxInputBytes`, `outputSchema`, `validateOutput`. `runExtraction` binds the v1 task; [`v2/task.ts:extractionTaskV2(prompt, selection)`](../../apps/api/src/curation/v2/task.ts) builds the v2 one.
2. **Context.** System prompt, JSON user envelope (issuer text is data inside it), JSON schema and source policy are versioned together; [`canonical.ts:canonicalJson`](../../apps/api/src/curation/canonical.ts) gives a hash that is stable across PostgreSQL JSONB round trips. The hash and versions go into every trace.
3. **Admission.** Input bytes and a conservative token estimate are checked before any call. Each attempt reserves `maxInput × input price + maxOutput × output price`; reported usage replaces it when available; ambiguous failures keep the reservation.
4. **Call.** `bounded()` enforces the attempt and total deadline even if the adapter ignores the abort signal. Only `ProviderFailure('transient' | 'rate-limit')` retries, after 250 ms, within the total deadline. Malformed JSON, schema or evidence failure, refusal, truncation, timeout and cancellation never retry.
5. **Validate.** v1 ([`extraction.ts:validateExtraction`](../../apps/api/src/curation/extraction.ts)) checks spans, hashes, known/unknown/conflicting states, rule sets, percentages present in quotes, activation contradictions. v2 ([`v2/validate.ts`](../../apps/api/src/curation/v2/validate.ts)): `resolveQuote` (exact match except whitespace runs), missing or unfound evidence, rate not in evidence (`percentsIn`, sums allowed), cap/payment consistency, model-reported issues.
6. **Trace.** Run ID, timings, provider identity and pricing, versions, context hash, document refs, per-attempt outcomes, bounded raw output, usage, accounted micro-USD, findings, parsed extraction (`extractionTraceSchema`). `evidence_valid` means mechanical checks passed, not that the interpretation is right.

### Hosted v1 path and ledger

[`service.ts:startReviewedExtraction`](../../apps/api/src/curation/service.ts) verifies the reviewer token via the signed review RPC, loads immutable captures from the exact draft revision (only `PILOT_CATALOG` cards are admitted), and calls [`ledger.ts:executeRecordedExtraction`](../../apps/api/src/curation/ledger.ts). The ledger claims a run in `catalog_private.curation_runs` (idempotent per reviewer + `requestKey`, all attempts' worst-case cost reserved atomically under the policy row lock), rechecks live human authority before each attempt, persists the final trace, and never replays a claimed run; an uncertain persistence returns `curation_result_unconfirmed` with the run ID. [`database.ts:createCurationDatabase`](../../apps/api/src/curation/database.ts) refuses any login that is not exactly a member of `aicheckout_curation_executor` with no extra privilege (pool ≤ 2, 5/5/7 s timeouts, verified TLS for remote hosts). Recovery and table details: [`supabase/CURATION.md`](../../supabase/CURATION.md), [Database](database.md#curation-ledger).

[`review.ts`](../../apps/api/src/curation/review.ts) rebuilds and re-verifies a saved run against its draft before offering a proposal (rate, activation, supported cap only). Application is a separate signed-human RPC; publication is a third, separate action.

### v2 evaluation path

`npm run eval:v2 -- --provider fixture|codex|claude --model M --prompt P --selection S --split dev|heldout --repeat N` ([`v2/eval-cli.ts:runEvaluationV2Cli`](../../apps/api/src/curation/v2/eval-cli.ts)) loads a corpus ([`v2/corpus.ts:loadCorpusV2`](../../apps/api/src/curation/v2/corpus.ts); captures are gitignored and verified against committed hashes), runs `executeTask` per case and repeat, and writes `observations.json`, `report.json`, `report.md` under gitignored `evals/curation/runs/`. `--resume` fills missing slots; `--replay` re-scores saved traces; a provider usage limit exits with code 3. Scoring (`v2-scorer.2`), corpora and results belong to [Evaluation](evaluation.md).

## Gotchas

- v2 is not wired into the HTTP route or the ledger; extraction in the review app is v1 and pilot-only. A v2 extraction → draft flow is future work (archived plan, Phase 4).
- Codex and Claude providers use the developer's own subscription login; they must never back the hosted service. `subscription` mode records zero price.
- Captured issuer text is copyrighted: captures and run directories are gitignored; committed files hold URLs, hashes, labels and short quotes only.
- Never edit a prompt version in place; add a new one (`guided.2` was added beside `guided.1`). Scorer changes bump `SCORER_VERSION` and require `--replay`.
- The archived plan's local `llama3.1` via `codex exec --oss` (`codex-oss`) does not exist in the code as of 2026-10-02; the Claude CLI provider, not in that plan, does.

## Related

* [Evaluation](evaluation.md)
* [API](api.md)
* [Database](database.md)
* [Review app](review-app.md)
* [Decisions](../decisions/index.md)
* Corpus and metrics README: [`evals/curation/README.md`](../../evals/curation/README.md)
