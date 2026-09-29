# Curation evaluations

This local evaluator scores saved extraction traces against versioned references. It includes **60 synthetic, agent-authored cases awaiting human annotation review**. It can collect live runs through the Codex CLI (below), but the synthetic corpus cannot establish model accuracy; the [roadmap](../../docs/design.md#roadmap) replaces it with hand-labeled real issuer terms.

The current corpus has 30 development Quicksilver examples and 30 reserved BCE examples. Related issuer/document families cannot cross splits; identical source bodies after Unicode/whitespace normalization cannot cross splits either. The two sets deliberately share scenario templates. Two issuer families and paired synthetic templates are **not a validated independent held-out benchmark**. The reserved flag prevents accidental use in ordinary development commands; it is not secrecy or a guarantee against leakage.

Cases cover numeric conversions, UTF-16 offsets, missing facts, conflicting terms, ambiguous rates, activation, spending/reward/anniversary caps, introductory terms, exclusions, membership, stacked rewards, and source prompt injection. All source bodies say they are invented. Their registered URLs only exercise source admission; they do not establish that the invented terms came from those issuers.

## Run without a model or API key

From the repository root after `npm ci`:

```sh
# CI diagnostic; no artifacts, API key, database, or network needed.
npm run eval:curation -- --check

# Save the development baseline and its full observations.
npm run eval:curation

# Analyze previously saved observations without making provider requests.
npm run eval:curation -- --mode replay --observations evals/curation/runs/EXPERIMENT/observations.json

# Explicitly exercise all synthetic fixtures, including the reserved split.
npm run eval:curation -- --split all --allow-reserved --check
```

`--corpus PATH` selects another compatible corpus. `--output PATH` selects a **new** output directory; existing directories are never overwritten. Default split is `development`. `reserved` and `all` require `--allow-reserved`. Do not tune prompts on reserved model results.

The fixture provider receives the model-visible context only, never reference labels. It emits unknown facts and no conditions. `--check` verifies that this deliberately weak baseline completes, costs zero, remains in review, and has zero known-fact recall. **This is a harness/scorer regression gate, not a model quality threshold.** The application CI includes it; remote CI execution remains unverified.

Each saved experiment contains `observations.json`, `report.json`, and `report.md`. Reports retain every observed case and list missing cases. An incomplete run exits unsuccessfully and withholds aggregate quality metrics. Unknown/duplicate case IDs, duplicate run IDs, changed corpus/input content, inconsistent prompt hashes or raw/parsed output, impossible accounting, and mixed prompt/model/limit configurations are rejected. Use separate experiments for each prompt/model configuration.

The private `runs/` directory is ignored by Git; new experiment directories/files request owner-only permissions. Observations include captured text and bounded raw output. Keep these files private and inspect any artifact before sharing it. The checked-in [baseline report](baseline.v1.md) contains only the explicitly synthetic diagnostic summary.

## Import a saved database run

The authenticated API returns a `run` from `GET /v1/review/runs/:id`. Export finished runs from that authorized path and create a local manifest:

```json
{
  "schemaVersion": 1,
  "corpusHash": "<SHA-256 from a report for this unchanged corpus>",
  "experiment": "my-experiment.1",
  "runs": [
    { "caseId": "qs-ordinary", "run": "<replace with the complete saved run object>" }
  ]
}
```

The angle-bracket values are placeholders, not runnable data. Include exactly one finished run for every case in the selected split, using that case's exact source text, URL, source key, and capture date. The evaluator allows database-generated capture IDs/timestamps to differ; it binds actual saved IDs and hashes to their trace and context. Titles/creation metadata reconstructed from a run are clearly marked placeholders, not original metadata.

```sh
npm run eval:curation -- --mode ledger --observations /absolute/path/manifest.json
```

Both `replay` and `ledger` forcibly label results **imported traces, provenance unverified**. The evaluator can check internal consistency, but an editable JSON file cannot prove that a provider executed the request. Retain the authoritative private ledger and independently confirm model identity/accounting before describing results as live model measurements. Database-owned `context_hash`/`trace_hash` use PostgreSQL's own serialization; they are not falsely treated as external signatures.

Context `captured-text-json.3` uses a canonical JSON hash so PostgreSQL JSONB key ordering does not break replay. The exact system/user strings are still bound to that hash. Earlier context versions remain inspectable but are rejected by this scorer because their schema object serialization was not portable across the database round trip. No historical trace is rewritten. The importer also checks saved provider/profile/limit/reservation identity. Local compiled HTTP tests verify the real JSONB round trip for fixture and intercepted-SDK runs.

Replaying a run does not invoke a model, refund a reservation, modify the ledger, or publish a catalog.

## Run live through the Codex CLI (ChatGPT subscription)

`codex` mode runs each case through the same harness (context, runner, validation) using `codex exec`, so a signed-in ChatGPT plan pays for it instead of a metered API key. Sign in once with `codex login`, then:

```sh
# Smoke test two cases
npm run eval:curation -- --mode codex --model gpt-5.5 --limit 2

# Full development split, three cases in flight
npm run eval:curation -- --mode codex --model gpt-5.5 --effort low --concurrency 3
```

`--model` is required and is recorded in every trace; `--effort` is `minimal|low|medium|high|xhigh` (default `low`). Results are labeled **live-collected** with provider `codex-cli` and mode `subscription` (zero per-token price). Each call runs in an empty read-only directory with Codex's base instructions replaced by the extraction prompt, user config ignored, and every optional tool the installed CLI reports disabled; a run in which the agent executes a tool is rejected. `OPENAI_API_KEY`/`CODEX_API_KEY` are removed from the child environment so billing cannot silently switch to an API key. Token counts include roughly 2.5k tokens of Codex harness overhead.

This is for local experiments only. The CLI uses your personal login, so never wire it into the hosted API.

**Known limitation of the synthetic corpus:** every synthetic source body opens by declaring itself invented and "not issuer evidence". A capable model following the prompt's evidence rules correctly abstains on all facts, so live runs against this corpus measure harness behavior, not extraction quality. Real, hand-labeled issuer terms are required for model comparisons.

## What the scores mean

| Measure | Definition and limits |
| --- | --- |
| Exact field agreement | Exact state/value match for rate, category, activation, and cap per expected rule; missing output is an error. |
| Known-fact precision / recall | Correct known values divided by predicted / expected known values. Extra or duplicate known rules count against precision. Correct values alone do not prove valid evidence. |
| Incorrect/unsupported known claims | Predicted known claims that disagree with the reference, including claims where the reference is unknown/conflicting. |
| Unnecessary field abstentions | Returned unknown/conflicting claims where a known value was expected. Whole-run refusals/failures are counted separately and reduce recall. |
| Condition evidence coverage | Reference condition kind plus an exact valid citation containing an authored anchor. This does **not** grade whether the condition text correctly explains that quote. |
| Required issue evidence coverage | Expected issue code/field plus a valid anchored citation; missing-information issues may have no citation. |
| Unmatched conditions | Returned conditions that do not match a reference kind/anchor, for inspection; this is not semantic precision. |
| False clear cases | Kernel status `evidence_valid` despite reference-required review, field errors, missed conditions/issues, or failed evidence revalidation. `evidence_valid` never means approved for publication. |
| Latency / accounted cost | Recorded p50/p95 duration and conservative micro-USD accounting. Fixture values are not provider performance. Imported values are not independently verified billing. |

References describe `known`, `unknown`, and `conflicting` states explicitly. `requiresReview` means the kernel should flag an unresolved extraction; **every output still needs human publication review**, even when this label is false. Reference conditions include both a human-readable meaning and literal source anchors. The meaning is available for human review; no model-as-judge or semantic matching is silently implied by the automated coverage score.

Reports preserve evaluator/corpus hashes, split, annotation status, model/provider/prices, prompt/context/schema/source-policy versions, configuration, per-case findings, and run/context identities. A changed corpus hash requires a separate collection/experiment; do not silently relabel old measurements.

## Annotation and next quality gates

`corpus.v1.json` is the checked-in fixture corpus. `scripts/author-curation-corpus.mjs` is its explicit authoring source; scoring and CI never regenerate labels. Regenerating it overwrites that JSON, so review the diff and version intentional changes. Do not overwrite a later independently reviewed corpus with the generator.

Before claiming model quality:

1. Have a human reviewer inspect source wording, state/value labels, every required condition, ambiguity, unsupported constraint, and evidence anchor. Absence is unknown; conflicting terms remain conflicting; an unrepresentable constraint must not disappear. Record disagreements and adjudication.
2. Add representative, immutable real issuer captures with their provenance and capture dates. Keep related documents, amendments, card families, and near-duplicate wording together. Exact duplicate checks alone do not detect paraphrase leakage.
3. Extend the corpus metadata/schema to record actual human annotation provenance and independent split design. The current schema intentionally only admits the existing synthetic/unreviewed provenance; changing a label string is not human validation.
4. Freeze development and held-out sets before comparing prompts. Include refusals and failed/missing cases. Inspect condition meaning manually, since evidence coverage is only a proxy. Define quality acceptance criteria before examining held-out model results.
5. With an authorized budget, verify a dated model and price ceilings, collect bounded real runs through the ledger, compare the same cases/configurations, and publish an honest failure analysis. Current spending authorization is $0.

This follows task-specific, representative, repeatable evaluation principles in [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices). The scorer runs locally and does not depend on a hosted evaluation service.
