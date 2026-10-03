---
type: System Component
title: Database
description: supabase/ — PostgreSQL schema for immutable catalog releases and the head pointer, the private review and curation schema, RLS and grants, publish_catalog, the executor role, and SQL parity with the Zod catalog contract.
status: stable
tags: [system, database, supabase, postgres, security]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
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

PostgreSQL 17 under Supabase (Auth + Data API). Two schemas: `public` holds the published, immutable catalog history and a single-row head pointer, readable by anyone; `catalog_private` holds reviewers, source captures, drafts, publications and the extraction ledger, is not exposed through the Data API, has RLS on with no client policies, and is reached only through narrow `SECURITY DEFINER` functions called via `SECURITY INVOKER` public wrappers. Publication is one transaction bound to an exact draft revision, payload hash and current head, so stale approvals fail rather than overwrite. Wallet and shopping data never enter this database.

Verified 2026-10-02 by reading the migrations and tests. `20261002222425_catalog_v3` (Stage 2 M1) is on `main` since PR #22. On branch `s2-m8-review-large-catalog` (Stage 2 M8, not yet merged or pushed to hosted) the full local DB suite ran green with `20261002230334_review_summary` applied.

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
| `20261002230334_review_summary` (branch `s2-m8-review-large-catalog`) | `get_catalog_review_summary(draft)`: the draft review with source metadata and `body_chars` instead of text; `get_catalog_review_source(draft, source)`: one capture attached to that draft (P0002 otherwise); public `SECURITY INVOKER` wrappers, execute for `authenticated` only. `get_catalog_review` unchanged ([decision](../decisions/2026-10-02-review-large-catalog.md)) |

| Table | Key columns and constraints | Access |
| --- | --- | --- |
| `public.catalog_releases` | `sequence` identity PK; `catalog jsonb` CHECK `valid_catalog`; generated `version` (unique), `catalog_hash` (SHA-256 of `catalog::text`); `published_at` | SELECT to `anon`, `authenticated`; no mutation grants |
| `public.catalog_head` | `singleton boolean` PK (always true); `release_sequence` FK | SELECT only; changed only by `publish_catalog` |
| `catalog_private.source_documents` | `source_key`, `title`, `url`, `checked_on`, `body` (≤ 250,000 chars after `catalog_v3`), generated `content_hash`; unique `(source_key, content_hash, checked_on)` | Reviewer RPCs |
| `catalog_private.drafts` | `catalog` CHECK `valid_catalog`, generated `catalog_hash`, `source_document_ids uuid[]` (≤ 30; ≤ 600 after `catalog_v3`), `base_sequence`, `revision`, `status` (`draft`/`published`/`rejected`) | Reviewer RPCs |
| `catalog_private.publications` | `release_sequence` PK, unique `draft_id`, `draft_revision`, `reviewed_by`, `review_note` (10–2000 chars) | Written by `publish_catalog` |
| `catalog_private.reviewers` | Operator-provisioned membership | No self-enrollment |

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

### Curation ledger

`aicheckout_curation_executor` has no login, no table grants and no publication or application permission; it may only claim, check and finish runs. A dedicated server login is granted membership at deployment; [`apps/api/src/curation/database.ts`](../../apps/api/src/curation/database.ts) verifies that on every connection. Claims lock the single `curation_policy` row, reserve the worst-case cost of all attempts against daily and lifetime micro-USD budgets, and enforce request-count and concurrency limits (free fixture runs included). Default policy: disabled, zero budget, no profiles seeded. `interrupt_curation_run` is operator-only recovery. Full procedure: [`supabase/CURATION.md`](../../supabase/CURATION.md); harness side: [Curation harness](curation-harness.md).

### Parity with Zod

`valid_catalog_v1` / `valid_catalog_v2` / `valid_catalog_v3` mirror `catalogV1Schema` / `catalogV2Schema` / `catalogV3Schema` in [`packages/rewards-core/src/schema.ts`](../../packages/rewards-core/src/schema.ts) with `extensions.jsonb_matches_schema` plus imperative checks (size ≤ 262,144 bytes for v1/v2 and ≤ 1,048,576 for v3, IDs, base rule, rate bounds, references, dates). v3 checks categories against `catalog_v3_reward_categories()` / `catalog_v3_merchant_categories()` instead of a JSON-schema enum, so a later migration can extend them with `create or replace`. [`scripts/test-catalog-parity.mjs`](../../scripts/test-catalog-parity.mjs) (`npm run db:test:catalog`) runs the shared `catalogCases` (28), `catalogV2Cases` (53) and `catalogV3Cases` (101) from `packages/rewards-core/test-cases.ts` through both validators, requires agreement, and compares the two SQL category lists with `REWARD_CATEGORIES_V3` / `MERCHANT_CATEGORIES_V3`.

### Seed

[`seed.sql`](../../supabase/seed.sql) is generated by `npm run db:seed:generate` from the bundled `CATALOG_V3` (178 cards, since Stage 2 M5 on 2026-10-02; before that `CATALOG_V2`). It inserts one **unapproved** private draft: no reviewers, users, captures or published release. CI runs `db:seed:check`.

## Gotchas

- Never edit an applied migration; create one with `npm run supabase -- migration new <name>`. Hosted pushes go through [`scripts/db-push.sh`](../../scripts/db-push.sh), run by the operator.
- A change to either catalog schema needs a Zod change, a new SQL migration and a parity case in the same change, or `db:test:catalog` fails.
- `db:start:api` excludes unused services; if a DB-only stack (`db:start`) is already running, stop it first (`npm run supabase -- stop --project-id AICheckout`).
- `db:reset` is local-only and discards local data.
- `catalog_hash` identifies the stored payload; it is not a signature.
- The pgTAP files use `no_plan()`, so assertion counts in `supabase/README.md` are not enforced by the tests.
- `supabase/README.md` says "six migration files", "seed generated from the pilot catalog" and "migrations have not been applied to the hosted project"; as of 2026-10-02 there are eight migrations and the seed is generated from catalog v3 (catalog v2 until Stage 2 M5). Hosted status is owned by [now.md](../now.md).

## Tests

| Command | What |
| --- | --- |
| `npm run db:test` | pgTAP: `supabase/tests/catalog.test.sql`, `catalog_v2.test.sql`, `catalog_v3.test.sql`, `curation.test.sql`, `extraction_application.test.sql`, `review_summary.test.sql` |
| `npm run db:test:concurrency` | Competing publication, expiry and session expiry while blocked (real row locks) |
| `npm run db:test:catalog` | Zod/SQL parity |
| `npm run db:test:http` | Signed sessions through the Node API: capture, save, review (summary without text, one capture by ID), publish, stale approval 409, sign-out revocation |
| `npm run db:test:curation[:http\|:application]` | Ledger races; compiled API with scoped login; concurrent application |
| `npm run db:lint`, `npm run db:advisors` | `supabase db lint` on `public,catalog_private`; security advisors |

All run in CI's "Database checks" workflow ([Testing](testing.md#ci)).

## Related

* [Rewards engine](rewards-engine.md)
* [API](api.md)
* [Review app](review-app.md)
* [Curation harness](curation-harness.md)
* [Local setup](../ops/local-setup.md)
