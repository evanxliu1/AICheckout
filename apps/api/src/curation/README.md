# Issuer extraction kernel

The LLM curation harness includes a bounded kernel, durable ledger, authenticated HTTP invocation/inspection, a restricted PostgreSQL pool, and an OpenAI Responses SDK adapter. **The adapter is implemented but has not made a live model call.** Tests use explicitly synthetic source text and intercepted provider replies. There have been no paid calls, model-accuracy measurements, or automatic catalog publications.

## Contract and context

`packages/catalog-review/src/curation.ts` defines browser-safe strict extraction/trace/review contracts, re-exported by server modules. The extraction schema is separate from the published catalog schema. Rate, category, activation, and cap claims preserve `known`, `unknown`, or `conflicting` states. Unknown/conflicting values stay null. Conditions and unsupported/missing/ambiguous information are separate evidence-bearing records; they are not silently discarded to fit the rewards engine.

Input uses immutable source-document records. The server verifies their SHA-256 body hashes, source keys, exact curated URLs, uniqueness, dates, and completeness of the card's source pack. Only the two pilot card IDs and their registered issuer/category sources are admitted. No arbitrary URL fetch occurs. Pasted text with an allowed URL is still supplied by a maintainer; URL matching does not establish issuer authenticity. Historical captures can be analyzed, but this kernel never assigns catalog freshness dates.

`context.ts` versions the system instructions, JSON context envelope, output schema, and source policy together. A context hash binds the complete prompt, sources, target, and schema. The target contains stable card/rule IDs and supported categories, without expected rates that could bias extraction. Source text is untrusted data within a JSON envelope. Instructions to ignore restrictions or publish inside it do not acquire tool authority: the provider receives no tools, secrets, database client, or publication function.

Context version `captured-text-json.3` uses the pinned SDK's strict Zod schema normalization and a canonical JSON hash. The normalized wire schema is persisted and included in the input admission estimate; PostgreSQL JSONB key ordering no longer changes its hash. Exact system/user strings remain bound to the hash. The underlying extraction contract remains `issuer-extraction.1`; local validation still checks evidence and conditions after generation. Older saved contexts are not rewritten; the new evaluator explicitly requires version `.3` for portable replay.

Every known claim needs a citation with immutable document ID/hash and an exact, nonblank text span. Offsets are JavaScript UTF-16 code units into the original body, with an exclusive end. Validation rejects unknown documents, changed hashes, wrong spans/quotes, missing evidence, unexpected or missing rules, inconsistent null states, changed category assignments, and reported unsupported conditions. Narrow consistency checks catch a numeric percentage absent from its quote and activation values that reverse recognized explicit wording.

`evidence_valid` means these mechanical checks passed. It does **not** prove general semantic entailment, complete conditions, source authenticity, model accuracy, or publication eligibility. A valid quote can still be misinterpreted. Independent labeled evaluations and human review remain necessary. Extraction success never approves or publishes a catalog. The separate human review path can apply eligible changes to a draft revision.

## Execution and accounting

`runner.ts` accepts a narrow provider interface. Real adapters must send exactly the bounded context/schema, disable their own retries, honor the supplied abort signal and output-token ceiling, return actual usage/finish reason, and classify only retryable transport/provider failures as `ProviderFailure`. They must bound network response bytes before allocating/returning a body. Do not trust an adapter's `fixture` label from client input; provider identity/pricing is operator-controlled server configuration.

| Limit | Default / fixed boundary |
| --- | --- |
| Spending | 0 micro-USD; metered calls rejected before invocation |
| Attempts | At most 2; retry transient/rate-limit errors only |
| Attempt / total deadline | 10 seconds / 15 seconds |
| Input | At most 3 captured documents; 60,000 characters each; 96,000 combined JSON bytes |
| Input admission | 48,000 estimated tokens; conservative UTF-8 byte estimate including prompt/schema and framing allowance |
| Requested output | 4,096 tokens; at most 65,536 returned text bytes |
| Retry delay | 250 ms within the total deadline |
| Trace errors | Stable categories and field paths; no raw exception messages |

No retry follows malformed JSON, invalid schemas/evidence, refusal, truncation, timeout, or cancellation. Cancellation/deadline returns even if an adapter leaves an asynchronous request unresolved; the adapter must also abort the underlying network operation. Synchronous JavaScript cannot be preempted, so elapsed time is rechecked before processing a result.

Each attempt reserves its maximum configured input/output charge before invocation. Actual reported usage replaces that reservation when available. Ambiguous-charge failures retain the full reservation; another attempt must fit in the remaining run budget. If an adapter exceeds its declared token ceiling, the run stops and records the usage. This is conservative **per-run admission/accounting**, not a guaranteed provider billing cap or a shared daily quota. Token estimates and configured maximum price rates need verification for each real provider. Concurrent requests require an atomic durable budget outside this kernel.

Returned traces contain a unique run ID, timestamps/duration, provider/model/configuration, prompt/context/schema/source-policy versions, context hash, immutable source references, per-attempt outcomes, bounded raw output, token usage, accounted micro-USD, validation findings, and the parsed extraction when available. Oversized raw output is omitted; bounded malformed/refused/truncated text is retained. `runExtraction` returns the trace; `ledger.ts` now persists it through narrowly granted private database operations. No raw traces are written to public application logs.

`executeRecordedExtraction` is internal orchestration, not an authentication endpoint. It binds the kernel to a database run ID, checks live execution authority before each attempt, persists the final trace, and refuses to replay a previously claimed run. The database reserves all potential attempts atomically across instances. See [ledger authority, accounting, and operator recovery](../../../../supabase/CURATION.md).

`service.ts` verifies the supplied human token through the signed Data API before deriving actor/session IDs and reads immutable captures from the requested draft. Draft ID/revision/hash form additional idempotency provenance, outside the model prompt. `database.ts` checks each actual login for narrow privileges, uses at most two connections, selects the executor role, bounds queries, and requires verified TLS for remote connections. The serving entrypoint defaults to disabled. Its options are a loopback-only synthetic refusal or the separately gated metered OpenAI adapter. Client disconnect and shutdown propagate cancellation. [HTTP setup and contracts](../../README.md) document invocation and run inspection.

## Human review and draft application

`review.ts` verifies a saved run against its original input/context/trace and current draft before exposing a proposal. It rechecks citations, raw-output agreement, provider identity, source attachment/metadata, and the originating revision/hash. Unknown/conflicting facts, findings/issues, unsupported conditions, and changed rule sets block application. The shared browser contract imports neither the SDK nor database/crypto execution code.

The React review app displays facts, exact quotations, conditions, findings, full captured text, and provenance. Every extracted condition requires a human coverage decision, actual rule references, and a written explanation; an unrepresentable condition blocks application. Human coverage is an attestation, not semantic proof. A separate signed-human RPC derives the candidate from the immutable trace, increments the draft revision, and records the review atomically. It preserves freshness dates, other cards, and catalog metadata. Its live-authority/lock checks and exact-retry behavior are documented in [the ledger runbook](../../../../supabase/CURATION.md). The executor has no application or publication capability.

## OpenAI adapter

`openai.ts` uses official SDK 7.23.0 and the fixed Responses endpoint. It sends the exact versioned instructions/user envelope and strict JSON schema, no tools or prior conversation, explicit `store: false`, foreground non-streaming execution, disabled input truncation, and default service tier. SDK retries and logging are disabled; only the harness can retry. The transport bounds success and error bodies to 512 KiB before SDK parsing, rejects redirects and unexpected content, and propagates the attempt's abort signal. SDK timeout is capped at 30 seconds; the harness's shorter limits apply.

Completed text, refusal, output-token truncation, and content filtering retain reported token usage and response ID/model. Missing/inconsistent usage, unexpected model, tool output, malformed status/content, and mixed refusal/text fail closed. SDK timeout/cancellation, malformed transport, exhausted credit, and permanent errors do not retry. HTTP 408/409/429 and server/connection failures may retry within the existing full-attempt reservation and total deadline. Provider exception bodies and headers are never copied into traces or application logs. Reasoning items are not treated as extraction text; total reported output usage still includes their tokens.

The adapter requires a dated GPT snapshot and operator price ceilings, explicit metered enablement, a server key, and funded durable admission. No real model/price is selected or seeded. Returned model identity must match the configured snapshot. The test model `gpt-synthetic-2026-09-25`, key, replies, and prices are fictional test inputs. The user-authorized budget remains $0. Disabling response storage does not establish zero provider retention.

Contracts checked against [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), the [Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [token accounting](https://developers.openai.com/api/docs/guides/token-counting), and the installed SDK source. See [provider data controls](https://developers.openai.com/api/docs/guides/your-data) before live use.

## Verification and remaining gates

Run from the repository root:

```sh
npm run test --workspace=@ai-checkout/api -- tests/curation.test.ts
```

The 43 kernel checks use synthetic captures and scripted replies. They cover source packs, prompt boundaries, exact citations, unknown/conflicting facts, rate/activation contradictions, unsupported conditions, schema escapes, output/usage limits, refusal/truncation, retries, timeout/cancellation, default zero spend, conservative accounting, and authority checks between attempts. Thirty API/configuration checks cover the HTTP boundary; 32 SDK tests use intercepted transport with global network fallback blocked. `npm run db:test:curation` adds real multi-connection ledger/orchestrator checks. After building the API and review app, `npm run db:test:curation:http` verifies scoped login permissions, signed session authentication/revocation, immutable source loading, trace inspection, idempotency, draft-revision conflicts, and canonical context/import identity after the JSONB round trip, with both the fixture and intercepted real SDK. Twelve review/application tests cover proposals, blockers, provenance integrity, and signed-human RPC input. The compiled browser flow verifies extraction through separate publication. `npm run db:test:curation:application` uses actual HTTP requests and row locks to verify concurrent idempotency and session expiry while waiting. These test harness behavior, **not the model's ability to extract those facts**.

The [local evaluation suite](../../../../evals/curation/README.md) adds 60 synthetic development/reserved cases and 34 scorer/integrity tests. It supports a zero-cost abstention baseline, saved observation replay, and finished-ledger import. Reports include field agreement, evidence coverage, unsupported claims, abstentions, false-clear cases, and recorded cost/latency. Missing cases suppress aggregate scores; mixed configurations and inconsistent trace/input identity are rejected. The synthetic labels await human review, condition coverage is not semantic grading, and paired scenarios/two issuer families are not an independent held-out benchmark. This does not fulfill the planned 50–100 human-labeled evaluation corpus or its live held-out result.

Remaining before enabling a metered workflow:

1. Obtain human-reviewed labels and representative real issuer captures; establish an independent held-out split and predeclare quality thresholds. The runner and synthetic diagnostic corpus are ready, but their output is not model accuracy.
2. When a budget is authorized, select/verify a current dated model, actual price ceilings, and account access; run a bounded live smoke test and the held-out evaluation. Keep these gates unverified until real evidence exists.
3. Provision the hosted dedicated login, verify actual TLS/session connectivity and shutdown under the deployment proxy, and deliberately configure profiles/budgets. Local tests and TLS configuration tests do not establish hosted deployment readiness.
