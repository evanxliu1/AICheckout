# Private extraction ledger and recovery

Migration `20260926052106_curation_run_ledger.sql` adds durable extraction records, atomic admission limits, and a narrow server execution role. The authenticated HTTP path and dedicated-login connection are verified **locally only**. The OpenAI SDK adapter is implemented with intercepted-transport verification; the extraction review/application screen is verified locally, while live model checks and deployment credentials remain pending. Migration `20260926070014_reviewed_extraction_application.sql` adds the separate human application audit and operations. Default policy is disabled with zero daily and lifetime spending; no provider profiles or credentials are seeded.

## Authority and records

The `aicheckout_curation_executor` role has no login, password, table mutation/read grants, membership-administration authority, or publication permission. It can execute only three private operations: claim a run, check an execution claim, and record its result. A separately provisioned server login may be granted membership at deployment. Do not connect the application as `postgres`, use a generic service-role key, expose this credential in the browser, or give it to model tools. PostgreSQL owner membership in this role supports migration/testing and does not grant the executor owner privileges in reverse.

The authenticated Node route verifies the human JWT through the existing signed-session review RPC before decoding and matching its user/session IDs. It loads the exact saved draft's captures; client identity/source/profile assertions are rejected. The executor is a trusted server identity, not a replacement for human authentication. Claiming and checking a run additionally lock and recheck current reviewer membership, live session, anonymous-account status, and bans in the database. The existing signed-human publication path is unchanged.

Every new pool connection verifies that its actual login has only executor membership, no administrative attributes or membership administration, no direct sensitive-table grants, and no human application or publication permission, then selects the executor role. Use a direct or session connection; transaction pooling is incompatible with this session state. The pool has at most two connections and bounded connection/statement/query timeouts. Non-loopback databases require verified TLS, optionally using the configured CA file. See [API configuration](../apps/api/README.md). Hosted credentials and TLS connectivity remain unverified. The metered OpenAI option requires a separate explicit server switch/key and an enabled, funded database policy; current authorized spending remains $0.

All ledger tables are in the non-exposed `catalog_private` schema, have RLS enabled, and have no client table policies/grants:

| Table | Purpose |
| --- | --- |
| `curation_policy` | Operator-controlled enable flag, daily/lifetime micro-USD budgets, daily request count, concurrent-run limit |
| `curation_profiles` | Operator-controlled provider/model, price ceilings, attempt/token/time limits; every run stores its own snapshot |
| `curation_runs` | Immutable request identity, human/session attribution, context and hashes, profile snapshot, reservation, execution state, final trace or recovery note |
| `curation_run_sources` | Foreign-key references preserving the exact immutable source captures used |
| `extraction_applications` | One audited human application per run: original/result revision, result hash, actor, time, overall note, and every condition decision |

The claim transaction checks that the context's document bodies, hashes, keys, URLs, dates, and IDs exactly match the referenced database captures. A caller cannot substitute text under an existing document ID. The TypeScript layer separately enforces curated issuer/card source packs and extraction contracts. Context and trace records are bounded; they contain issuer text and provider output and must remain private. No checkout wallet, cart, card account number, or credential belongs in them.

An authorized reviewer can inspect a run through `get_curation_run`. Neither the execution token nor its stored hash is exposed by that read. Reviewers cannot claim executions or forge server-produced traces, even when they know a run ID. The executor cannot publish a catalog, and extraction success does not approve a draft.

## Human application and recovery

The UI lists the latest 20 runs for the selected draft through `list_draft_extractions` and reads a draft-bound run through `get_draft_extraction`. The fragment URL retains draft/run IDs without credentials. Reads do not execute the provider. A reload requires sign-in and can recover the saved outcome, original evidence, blockers, and recorded application review. The execution token/hash is never returned.

`apply_reviewed_extraction` is a signed-human operation unavailable to the executor, anonymous clients, and service role. It requires a finished mechanically valid trace with known facts, no findings/issues, unchanged target rules/categories, and sources still attached to the originating draft revision/hash. The API also revalidates input/context/raw output/provider/citation integrity before offering a proposal. These checks rely on the narrowly authorized server executor for recorded trace integrity; they are not semantic proof of model output.

Every condition requires an ordered coverage review, references to actual target rules, and a meaningful explanation. The overall review note is also required. These human attestations are preserved in the private audit. Unknown facts and unsupported conditions must be corrected or handled through manual draft maintenance; they cannot be silently dropped. The database derives only rate/activation/supported-cap changes from its stored trace and preserves catalog dates, metadata, and other cards.

The transaction locks the draft then run, rechecks live reviewer/session authority and signed token expiry after waiting, writes one new revision, and inserts one audit record. The public head is unchanged. If an apply response is lost, repeat the exact original review body: it returns the same application while its resulting revision/hash is still current. Different decisions or later edits return a conflict; reload and inspect rather than overwriting newer work. Publication remains a distinct human action bound to the resulting revision/hash/head.

## Admission, retries, and accounting

All claims lock the single policy row, which serializes admission across API instances and profiles. The database reserves the configured worst-case cost of **all allowed attempts** before granting execution. Budgets are integer micro-USD; a profile's price inputs are maximum micro-USD per million tokens. Both lifetime and UTC daily budgets apply. Daily request and concurrent-run limits also apply to free fixture runs.

A `(reviewer, request key)` pair identifies one logical run. Repeating the same request returns its existing state without an execution token; changed source/context/profile/card input under the same key fails. HTTP context additionally records the originating draft ID/revision/catalog hash, so reuse across draft revisions also conflicts. That provenance is outside the model prompt. This is at-most-once admission, not a promise that a provider executed successfully. A process may fail after claiming but before calling the provider. That ambiguity must never be repaired by blindly replaying the same run.

The first claimant receives an opaque random execution token. Before each attempt, the TypeScript orchestrator checks that token, the live human authority, enabled policy/profile, running state, and the two-minute claim deadline. Cancellation while that check is pending cannot start a late provider call. The kernel's shorter attempt/total deadlines still apply.

Completion writes the bounded trace and its hash, bound to the exact run/context. Repeating the same completion is idempotent; rewriting a completed/interrupted history fails. Result recording remains possible after sign-out or a deadline so an already-started outcome can be retained. Completion never refunds the reservation based on client/provider-reported usage. Actual reported usage is recorded separately in the trace. A real provider must respect its configured ceilings; these controls cannot retroactively cap charges from a misconfigured or nonconforming adapter.

## Uncertain completion and operator recovery

If result persistence fails, `executeRecordedExtraction` returns `curation_result_unconfirmed` with the run ID. A retry reads the existing run and never invokes the provider again. Its reservation and concurrency slot remain held. A deadline or stale status row alone is not evidence that the old process stopped.

For an overdue running record:

1. Inspect that exact run and its owning process/job. Confirm the operation is terminal or the owning process no longer exists; record evidence. An observation timeout is insufficient.
2. If a bounded original result is available, retry the identical completion using the original server-held execution token. Do not reconstruct a success result or start another provider request.
3. If the process is confirmed stopped and its result cannot be recovered, the database operator can execute `catalog_private.interrupt_curation_run(run_id, recovery_note)`. It requires an overdue running record and a meaningful note. This function is unavailable to reviewers and the executor role.
4. The interrupted record remains immutable, its spending reservation stays counted, and retries still cannot execute it. Its concurrency slot is released. A deliberate new attempt uses a new request key and must fit the remaining limits.

This conservative recovery trades unattended replay for accountable spending. Any future automatic recovery must prove ownership/termination and preserve the same at-most-once and budget guarantees. Budget changes require the owner's spending authorization; passing a local fixture test does not authorize paid calls.

## Verification

```sh
npm run db:test
npm run db:test:curation
# Requires built API/review app and the local Auth/Data API stack:
npm run db:test:curation:http
npm run db:test:curation:application
npm run db:lint
npm run db:advisors
```

The ledger adds 44 transactional pgTAP checks to the existing 64 publication/access checks; human application adds 29, for 137 total. Four integration scenarios use separate PostgreSQL connections and the actual TypeScript orchestrator: concurrent duplicate admission, shared concurrency, uncertain result persistence/recovery, and competing full-run budget reservations. Replies are scripted fixtures, including when testing metered-price accounting; no paid provider is contacted.

The extraction HTTP test adds the compiled Node entrypoint, real signed Auth sessions, and a separately created scoped LOGIN rather than an owner connection with `SET ROLE`. It verifies invalid/forged/ordinary/revoked sessions, strict input, saved source identity, private trace inspection, duplicate requests, changed-revision conflicts, and unchanged public publication. It runs with both the local refusal and the actual OpenAI SDK under a test-only preload that intercepts provider requests and blocks other external fetches. Synthetic metered prices exercise durable reservations and trace accounting without actual billing. Connection checks reject missing membership, administrative attributes, membership administration, direct sensitive-table grants, publication/application permission, and extra role membership. Fixtures and temporary logins are removed and the prior policy restored. These tests do not establish model quality or hosted connectivity.

The application HTTP test proves concurrent identical reviews produce one revision/audit, old retries cannot overwrite later edits, and session expiry during a real draft-lock wait prevents mutation. Two built React browser flows verify manual review and extraction through separate publication. Their SDK responses are synthetic and all external provider traffic is blocked.

Current implementation references: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [custom database roles](https://supabase.com/docs/guides/database/postgres/roles), and [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html). Deployment must also recheck the current [PostgreSQL patch guidance](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes); local rebuild evidence is not a hosted database upgrade claim.
