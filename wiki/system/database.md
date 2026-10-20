---
type: System Component
title: Database
description: supabase/ — PostgreSQL schema for immutable catalog and merchant releases and their head pointers, the private review and curation schema, the private telemetry schema (Phase 15.2), RLS and grants, publish_catalog, the executor role, and SQL parity with the Zod contracts.
status: stable
tags: [system, database, supabase, postgres, security]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-20T02:30:00Z
sources:
  - resource: ../../supabase/migrations
    title: Migrations
  - resource: ../../supabase/config.toml
    title: Supabase CLI config
  - resource: ../../supabase/seed.sql
    title: Generated seed
  - resource: ../../supabase/tests
    title: pgTAP tests
  - resource: ../../supabase/README.md
    title: Database README
  - resource: ../../supabase/CURATION.md
    title: Ledger and recovery runbook
  - resource: ../../scripts/test-catalog-parity.mjs
    title: Zod/SQL parity test
  - resource: ../archive/design.md
    title: Pre-wiki design doc (archived)
---

# Database

PostgreSQL 17 under Supabase (Auth + Data API). Three schemas: `public` holds the published, immutable catalog and merchant history and their single-row head pointers, readable by anyone; `catalog_private` holds reviewers, source captures, drafts, publications and the extraction ledger, is not exposed through the Data API, has RLS on with no client policies, and is reached only through narrow `SECURITY DEFINER` functions called via `SECURITY INVOKER` public wrappers; `telemetry` (Phase 15.2) holds the extension's consented events for 90 days and per-install day counters, written only by the anon-granted `security definer` RPC `public.ingest_events`, read only by two reviewer functions and pruned daily by a pg_cron job (15.5b). Publication is one transaction bound to an exact draft revision, payload hash and current head, so stale approvals fail rather than overwrite. Wallet and shopping data never enter this database.

**Hosted, 2026-10-20:** all 14 migrations are applied; the coordinator pushed the 14th, `20261020061616_telemetry_scheduled_prune` (15.5b, PR #101), with `./scripts/db-push.sh` after the merge (the `cron.job` row is confirmed by Evan in the dashboard; the coordinator does not read the database password). Earlier that day: all 13 migrations are applied; `20261020004702_telemetry_events` was pushed by the coordinating session with `./scripts/db-push.sh` after PR #95 merged, and the deployed `POST /v1/events` answers an empty batch with 400 `invalid_request` (reported by the coordinator). Verified 2026-10-02 by reading the migrations and tests. Ten migrations are on `main` and, as reported by the coordinating session, all ten are applied to hosted Supabase: the two Stage 2 migrations `20261002222425_catalog_v3` (M1, PR #22) and `20261002230334_review_summary` (M8, PR #24) were pushed with `./scripts/db-push.sh` after their merges. Rechecked 2026-10-03 on `main` `5f1f4fb`: `db:test:http`, `db:test:curation:http` and `db:test:curation:application` pass on the local stack with all ten applied; the hosted review bundle offers `CATALOG_V3` (M8 code live).

## Facts

| Migration | Adds |
| --- | --- |
| `20260926032620_baseline_legacy_catalog` | Preserves MVP `public.credit_cards`; tightens grants and trigger `search_path` |
| `20260926032621_reviewed_catalog` | `catalog_private` schema, `reviewers`, `source_documents`, `drafts`, `publications`; `public.catalog_releases`, `public.catalog_head`; `valid_catalog_v1` (pg_jsonschema + checks); `require_reviewer`; `publish_catalog` |
| `20260926033105_catalog_review_operations` | `capture_catalog_source`, `get_catalog_review`, `save_catalog_draft` (+ private versions) |
| `20260926043657_review_snapshot_context` | `get_catalog_review` returns the head joined to its snapshot |
| `20260926052106_curation_run_ledger` | Role `aicheckout_curation_executor` (NOLOGIN); `curation_policy`, `curation_profiles`, `curation_runs`, `curation_run_sources`; claim/check/finish/get/interrupt functions |
| `20260926070014_reviewed_extraction_application` | `extraction_applications`; `list_draft_extractions`, `get_draft_extraction`, `apply_reviewed_extraction` |
| `20260930225732_catalog_v2` | `valid_catalog_v2` mirroring `catalogV2Schema`; `valid_catalog` = v1 or v2; replaces CHECKs on `catalog_releases.catalog` and `drafts.catalog` |
| `20261001010350_source_body_limit` | `source_documents.body` 1–120,000 chars (was 60,000), matching `MAX_SOURCE_BODY_CHARS` |
| `20261002222425_catalog_v3` | `valid_catalog_v3` mirroring `catalogV3Schema`; `catalog_v3_reward_categories()`, `catalog_v3_merchant_categories()` (replaceable category lists), `catalog_v3_unconditional_rule()`; `valid_catalog` = v1, v2 or v3; `drafts.source_document_ids` ≤ 600 and `save_catalog_draft` to match; `source_documents.body` 1–250,000 chars |
| `20261011111247_merchant_releases` | Phase 14.6 ([decision](../decisions/2026-10-11-hosted-merchant-release-details.md)): `public.merchant_releases` (immutable; generated `version` unique and `release_hash`), `public.merchant_head`, private `merchant_publications`; `valid_merchant_release_v1` mirroring `merchantReleaseSchema` (schema, evidence rule incl. `definition`, processor rules, unique ids and hosts, cited sources, 2 MiB) and `valid_merchant_release` (by `schemaVersion`); `publish_merchant_release(release, expected_head, expected_hash, note)` under `require_reviewer()`, idempotent for identical content; RLS: anon and authenticated read only. **Pushed to hosted by the coordinator after merge (pending)** |
| `20261011220614_merchant_release_mcc_basis` | Phase 14.8 ([decision](../decisions/2026-10-11-mcc-evidence-basis.md)): replaces `valid_merchant_release_v1` whole (the applied migration is never edited): source kind `mcc-dataset`, basis `mcc` citing at least one dataset and on a marketplace only for dining. Not yet pushed to hosted |
| `20261020004702_telemetry_events` | Phase 15.2 ([decision](../decisions/2026-10-20-telemetry-backend-details.md)): schema `telemetry` (usage to `authenticated` only, default execute revoked); `telemetry.events` (`event_id` PK, `install_id` nullable, `type`, `client_at`, `received_at`, `event jsonb` CHECK object ≤ 8 KiB, indexes on `received_at`, `install_id`, `(type, received_at)`), `telemetry.install_days` (`install_id`, `day`, `count` 1–500, index on `day`) and `telemetry.days` (`day`, `count` 0–20,000), RLS on, no client grants; `telemetry.event_schema()` (one `oneOf` branch per event type built from one envelope), `event_rules_v1`, `valid_event_v1` and `valid_batch_v1` mirroring `telemetryEventSchema`; `telemetry.prune(limit)`; `public.ingest_events(p_batch)` (anon: 1–50 events, 128 KiB JSONB text, each event valid or the batch is refused with 22023, `event_id` stored once, 500 per install and 20,000 in all per UTC day, prunes 1000 rows older than 90 days and the old counters) and `public.delete_install(p_install_id)`; reviewer `telemetry.store_suggestions()` / `telemetry.summary(p_days)` (security definer, `require_reviewer()`) behind `public.telemetry_store_suggestions()` / `public.telemetry_summary(p_days)` (invoker, execute for `authenticated`). Pushed to hosted 2026-10-20 |
| `20261020061616_telemetry_scheduled_prune` | Phase 15.5b ([decision](../decisions/2026-10-20-privacy-fixes-delete-order-and-scheduled-prune.md)): `create extension if not exists pg_cron with schema pg_catalog` and the two Supabase-documented grants on schema `cron` to `postgres`; `telemetry.prune_expired()` (invoker, `search_path = ''`, execute revoked from `public`, `anon`, `authenticated`, `service_role`): locks today's `telemetry.days` row first, as `ingest_events` does (since the 15.5b review: an ingest call then waits for the run, seconds under the day cap, instead of risking a deadlock over tied `received_at` rows), then loops `telemetry.prune(1000)` until a round removes fewer than 1000 rows (ceiling 1,000,000) and returns the rows removed; `cron.schedule('telemetry-prune', '17 3 * * *', 'select telemetry.prune_expired()')`, an upsert by job name, run as `postgres` in database `postgres`. **Not yet pushed to hosted** (the coordinator after merge) |
| `20261002230334_review_summary` | `get_catalog_review_summary(draft)`: the draft review with source metadata and `body_chars` instead of text; `get_catalog_review_source(draft, source)`: one capture attached to that draft (P0002 otherwise); public `SECURITY INVOKER` wrappers, execute for `authenticated` only. `get_catalog_review` unchanged ([decision](../decisions/2026-10-02-review-large-catalog.md)) |

| Table | Key columns and constraints | Access |
| --- | --- | --- |
| `public.catalog_releases` | `sequence` identity PK; `catalog jsonb` CHECK `valid_catalog`; generated `version` (unique), `catalog_hash` (SHA-256 of `catalog::text`); `published_at` | SELECT to `anon`, `authenticated`; no mutation grants |
| `public.catalog_head` | `singleton boolean` PK (always true); `release_sequence` FK | SELECT only; changed only by `publish_catalog` |
| `catalog_private.source_documents` | `source_key`, `title`, `url`, `checked_on`, `body` (≤ 250,000 chars after `catalog_v3`), generated `content_hash`; unique `(source_key, content_hash, checked_on)` | Reviewer RPCs |
| `catalog_private.drafts` | `catalog` CHECK `valid_catalog`, generated `catalog_hash`, `source_document_ids uuid[]` (≤ 30; ≤ 600 after `catalog_v3`), `base_sequence`, `revision`, `status` (`draft`/`published`/`rejected`) | Reviewer RPCs |
| `catalog_private.publications` | `release_sequence` PK, unique `draft_id`, `draft_revision`, `reviewed_by`, `review_note` (10–2000 chars) | Written by `publish_catalog` |
| `catalog_private.reviewers` | Operator-provisioned membership | No self-enrollment |
| `public.merchant_releases` (14.6) | `sequence` identity PK; `release jsonb` CHECK `valid_merchant_release`; generated `version` (unique), `release_hash` (SHA-256 of `release::text`); `published_at` | SELECT to `anon`, `authenticated`; no mutation grants |
| `public.merchant_head` (14.6) | `singleton`, `release_sequence` FK | SELECT only; changed only by `publish_merchant_release` |
| `catalog_private.merchant_publications` (14.6) | `release_sequence` PK, `reviewed_by`, `review_note` (10–2000 chars), `published_at` | Written by `publish_merchant_release` |
| `telemetry.events` (15.2) | `event_id uuid` PK (the client's id, so a repeat is stored once), `install_id uuid` null only on the two tap events, `type`, `client_at`, `received_at` (server), `event jsonb` (a JSON object of at most 8 KiB; the schema itself runs once per batch in `ingest_events`, the only writer) and a CHECK that the columns equal the JSON | No client grant; written by `ingest_events`, deleted by `delete_install` and pruning, aggregated by the two reviewer functions; never read raw through any client role |
| `telemetry.install_days` (15.2) | `(install_id, day)` PK, `count` 1–500 | Written by `ingest_events` (read `for update` before the insert), deleted by `delete_install` and pruning |
| `telemetry.days` (15.2, added in review) | `day` PK, `count` 0–20,000: stored events per UTC day across every install | Locked `for update` for the whole `ingest_events` call (calls serialise; about 15 ms for 50 events locally), pruned after 90 days; holds no install id |

`config.toml`: Postgres `major_version = 17`; Data API `schemas = ["public"]`; local `site_url` `http://127.0.0.1:3000`.

## How it works

### Authority

Every private operation calls `catalog_private.require_reviewer()` (or the curation equivalent), which checks `auth.uid()`, current membership in `reviewers`, a live matching Supabase session, and rejects anonymous or banned users. Elevated functions use an empty `search_path`; default execute grants are revoked from `public`, `anon`, `authenticated`, `service_role` and re-granted narrowly. A service-role key has neither publication execute nor catalog table mutation privileges. The API forwards the reviewer's token; see [API](api.md).

### Publication

`publish_catalog(draft_id, expected_revision, expected_hash, expected_head, review_note)`:

1. Lock the head row, then the draft (one lock order for concurrent publishers).
2. Revision or hash differs → `40001` "review it again". Already published → return the original release (idempotent retry).
3. Head differs from `expected_head` or the draft's `base_sequence` → `40001` "rebase".
4. Re-check reviewer authority **after** the lock wait, then catalog validity at `clock_timestamp()`.
5. Every `catalog.sources[]` entry must match an attached capture by `source_key`, `url`, `title`, `checked_on` (provenance, not correctness).
6. Insert release, insert publication, mark draft published, advance head — one transaction.

Corrections are new drafts based on the current head; releases are never edited and the head never moves backwards.

### Merchant publication (Phase 14.6)

`publish_merchant_release(p_release, p_expected_head, p_expected_hash, p_review_note)` has no draft: the release (`merchant-release.1`, built and reviewed in the repository as `MERCHANTS_V1`) is the argument. It requires a note, re-validates the release, locks the head, returns the existing row when the version is already published with semantically identical content (`jsonb =`; a lost response can be retried) and raises `40001` for the same version with other content; `p_expected_head` and `p_expected_hash` must equal the head's `sequence` and `release_hash` (both null before the first release) or it raises `40001`; after the lock it re-checks the reviewer and refuses a release verified in the future (`22023`); then inserts the release and the publication and advances the head in one transaction. The CLI reads `GET /v1/merchants` for the expected head ([runbook](../ops/catalog-release.md#merchant-release-phase-146)).

### Telemetry (Phase 15.2)

`ingest_events(p_batch jsonb)`: refuses a non-array, an empty or 51-event batch, more than 128 KiB of JSONB text (`Event batch is too large`), or any invalid event (22023; the API has already validated with Zod, so a disagreement is a bug or a forgery). `valid_batch_v1` matches the whole batch against the array form of the schema once (one match per event cost about 1 s for 50 events, since `jsonb_matches_schema` compiles the thirteen-branch schema on every call), then `event_rules_v1` on each event; the parity script checks it agrees with `valid_event_v1` on every case. It then locks today's `telemetry.days` row: once 20,000 events are stored that UTC day, every further event is dropped whatever its install id (anyone can mint install ids, so this is the bound on growth). For each event: an install at 500 stored events for the UTC day drops the event (`install_days` read `for update`); `insert … on conflict (event_id) do nothing` drops a repeat; a stored event with an install id increments the counter. Then `telemetry.prune(1000)` deletes up to 1000 rows with `received_at` older than 90 days and the counters older than 90 days. Returns `{"accepted", "dropped"}`. Events without an install id (tap events from a shopper who is not sharing) are stored and count against the global day cap only. `delete_install(p_install_id)` deletes the install's events and counters, prunes, and returns `{"deleted"}`. Both reviewer functions prune before reading and read only the last 90 days. Since 15.5b the retention no longer depends on calls: the pg_cron job `telemetry-prune` runs `telemetry.prune_expired()` daily at 03:17 (server clock, GMT locally and UTC on hosted), which loops `prune(1000)` until nothing older than 90 days remains, so a row is gone within about a day of turning 90 days old whether or not ingest is on; `select * from cron.job_run_details order by start_time desc` shows the runs. pg_cron reports a failed run only there (no alert), so after the hosted push and now and then afterwards check that `cron.job` has `telemetry-prune` active and that the latest `job_run_details` row says `succeeded`; ingest, delete and the reviewer reads still prune 1000 rows a call as a backstop. `job_run_details` is not cleaned up by pg_cron (one row a day here). pg_cron lives in `pg_catalog`; the local CLI image (`pg_cron 1.6.4`, preloaded, the launcher running) and the CI workflow's identical stack schedule it on `db reset`, and the pgTAP suite checks the job row. `telemetry.store_suggestions()` groups `store_suggested` by domain (count, distinct installs, last seen; ≤ 500, most suggested first); `telemetry.summary(p_days)` (1–90) counts events and distinct installs, by type and by UTC day. Both call `require_reviewer()` first; `anon` and `service_role` cannot execute them or read the tables.

### Curation ledger

`aicheckout_curation_executor` has no login, no table grants and no publication or application permission; it may only claim, check and finish runs. A dedicated server login is granted membership at deployment; [`apps/api/src/curation/database.ts`](../../apps/api/src/curation/database.ts) verifies that on every connection. Claims lock the single `curation_policy` row, reserve the worst-case cost of all attempts against daily and lifetime micro-USD budgets, and enforce request-count and concurrency limits (free fixture runs included). Default policy: disabled, zero budget, no profiles seeded. `interrupt_curation_run` is operator-only recovery. Full procedure: [`supabase/CURATION.md`](../../supabase/CURATION.md); harness side: [Curation harness](curation-harness.md).

### Parity with Zod

`valid_catalog_v1` / `valid_catalog_v2` / `valid_catalog_v3` mirror `catalogV1Schema` / `catalogV2Schema` / `catalogV3Schema` in [`packages/rewards-core/src/schema.ts`](../../packages/rewards-core/src/schema.ts) with `extensions.jsonb_matches_schema` plus imperative checks (size ≤ 262,144 bytes for v1/v2 and ≤ 1,048,576 for v3, IDs, base rule, rate bounds, references, dates). v3 checks categories against `catalog_v3_reward_categories()` / `catalog_v3_merchant_categories()` instead of a JSON-schema enum, so a later migration can extend them with `create or replace`. [`scripts/test-catalog-parity.mjs`](../../scripts/test-catalog-parity.mjs) (`npm run db:test:catalog`) runs the shared `catalogCases` (28), `catalogV2Cases` (53) and `catalogV3Cases` (101) from `packages/rewards-core/test-cases.ts` through both validators, requires agreement, and compares the two SQL category lists with `REWARD_CATEGORIES_V3` / `MERCHANT_CATEGORIES_V3`. Since 14.6 it also runs the 69 `merchantReleaseCases` through `valid_merchant_release_v1`, `valid_merchant_release` and `merchantReleaseSchema`, and checks that the bundled `MERCHANTS_V1` passes both within 2 MiB of JSONB text. The SQL validator reuses `catalog_v3_merchant_categories()`. Since 15.2 it runs the 96 `telemetryEventCases` from `packages/catalog-review/test-cases.ts` through `telemetry.valid_event_v1` and `telemetryEventSchema` (`packages/catalog-review/src/telemetry.ts`); `valid_event_v1` checks `recommendation_shown.category` against `catalog_v3_merchant_categories()` too.

### Seed

[`seed.sql`](../../supabase/seed.sql) is generated by `npm run db:seed:generate` from the bundled `CATALOG_V3` (178 cards, since Stage 2 M5 on 2026-10-02; before that `CATALOG_V2`). It inserts one **unapproved** private draft: no reviewers, users, captures or published release. CI runs `db:seed:check`.

## Gotchas

- Never edit an applied migration; create one with `npm run supabase -- migration new <name>`. Hosted pushes go through [`scripts/db-push.sh`](../../scripts/db-push.sh), run by the operator.
- A change to either catalog schema needs a Zod change, a new SQL migration and a parity case in the same change, or `db:test:catalog` fails.
- `db:start:api` excludes unused services; if a DB-only stack (`db:start`) is already running, stop it first (`npm run supabase -- stop --project-id AICheckout`).
- `db:reset` is local-only and discards local data.
- `catalog_hash` identifies the stored payload; it is not a signature.
- The pgTAP files use `no_plan()`, so assertion counts in `supabase/README.md` are not enforced by the tests.
- `supabase/README.md` (checked 2026-10-05) has the ten migrations and the v3 seed right, but still says the hosted project serves release 1; since 2026-10-05 it serves release 3. Hosted status is owned by [now.md](../now.md) and [hosting](../ops/hosting.md).

## Tests

| Command | What |
| --- | --- |
| `npm run db:test` | pgTAP: `supabase/tests/catalog.test.sql`, `catalog_v2.test.sql`, `catalog_v3.test.sql`, `curation.test.sql`, `extraction_application.test.sql`, `review_summary.test.sql`, `merchant_releases.test.sql` (14.6: validator cases, public read and no writes, non-reviewer refused, publish, head, idempotent retry, different content and stale head refused, revocation; 14.8: the `mcc` basis cases), `telemetry.test.sql` (15.2: validator spot checks, no client role reads or writes the tables or calls the private functions, anon ingest with the batch caps, whole-batch refusal, dedupe within and across batches, tap events without an id, the 500-a-day cap, pruning on ingest, reviewer-only reads with the right counts, delete, revocation; 15.5b: the `telemetry-prune` cron job row, pg_cron in `pg_catalog`, `prune_expired()` removing 2,500 old rows and the counters in one run, no client role can call it) |
| `npm run db:test:concurrency` | Competing publication, expiry and session expiry while blocked (real row locks) |
| `npm run db:test:catalog` | Zod/SQL parity (catalog v1–v3 and, since 14.6, merchant release 1) |
| `npm run db:test:http` | Signed sessions through the Node API: capture, save, review (summary without text, one capture by ID), publish, stale approval 409, sign-out revocation; since 15.2 an anonymous ingest through the real anon RPC, a non-reviewer refused and a reviewer reading the summary and suggestions, Delete my data |
| `npm run db:test:curation[:http\|:application]` | Ledger races; compiled API with scoped login; concurrent application |
| `npm run db:lint`, `npm run db:advisors` | `supabase db lint` on `public,catalog_private,telemetry`; security advisors |

All run in CI's "Database checks" workflow ([Testing](testing.md#ci)).

## Related

* [Rewards engine](rewards-engine.md)
* [API](api.md)
* [Review app](review-app.md)
* [Curation harness](curation-harness.md)
* [Local setup](../ops/local-setup.md)
