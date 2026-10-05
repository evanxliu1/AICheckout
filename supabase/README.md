# Catalog database

PostgreSQL 17 with Supabase Auth, ten reproducible migration files, explicit grants, RLS, and transactional review operations. The schema, signed-session publication, public Node API, extension refresh, protected React review flow, and private extraction ledger are verified locally. All ten migrations are applied to the hosted project (as of 2026-10-03), which serves published release 3 (`2026-10-05.renewal.1`, published 2026-10-05) through the hosted API. The extraction → human application → separate publication flow is verified with synthetic intercepted responses; live model invocation and quality remain unverified. See [extraction ledger and recovery](CURATION.md).

## Local setup

Requirements: Node 24 and a running Docker daemon. From the repository root:

```sh
npm ci
npm run db:start:api
npm run db:seed:check
npm run db:test
npm run db:test:concurrency
npm run db:test:catalog
npm run db:test:http
npm run db:test:curation
npm run db:lint
npm run db:advisors
```

The pinned Supabase CLI downloads its local service images on first start. `db:start:api` starts the database, Auth, Data API, and gateway, excluding unused services. For SQL-only work, `db:start` starts just the database. If that DB-only stack is already running, stop this project with `npm run supabase -- stop --project-id AICheckout` before `db:start:api`; the CLI does not add missing services to an existing DB-only stack. The normal stop preserves local volumes.

`npm run db:reset` rebuilds this project's **local** database and reapplies migrations and seed, discarding local development data. Do not use it against a hosted database. The connection-race and HTTP tests are deliberately fixed to local ports 54322/54321; they never read hosted environment credentials. HTTP tests create synthetic local users without sending email and remove their generated records afterward. A local service-role credential is used only for test-account provisioning/deletion, never for catalog publication.

One root npm workspace lockfile covers the extension, API, shared packages, and database tools. No model key or paid service is needed for these tests.

## Data and access

| Data | Location | Access |
| --- | --- | --- |
| Legacy MVP cards | `public.credit_cards` | Public active-row SELECT only; previous mutation/TRUNCATE grants removed by the baseline migration |
| Published snapshot history | `public.catalog_releases` | Public SELECT; no client mutation grants |
| Current published release | `public.catalog_head` | Public SELECT; advances only in the publication transaction |
| Reviewer membership | `catalog_private.reviewers` | Provisioned by the project operator; no user self-enrollment |
| Immutable issuer-text captures | `catalog_private.source_documents` | Reviewer RPCs only; content hash and exact source metadata retained |
| Catalog candidates | `catalog_private.drafts` | Reviewer RPCs; revision and payload hash bind an approval to the reviewed content |
| Extraction application | `catalog_private.extraction_applications` | Private run/draft revision, actor, condition decisions, note, result hash, and time; signed-human operation only |
| Approval record | `catalog_private.publications` | Private record of draft revision, approver, review note, release, and time |

`catalog_private` is absent from the Data API's exposed schemas. It has RLS with no client table policies/grants. Public RPC wrappers are `SECURITY INVOKER`. The narrow private operations use `SECURITY DEFINER` because they must check private membership/auth rows and update several otherwise inaccessible tables atomically. Every operation checks the caller's `auth.uid()`, current membership, and a matching live Supabase session; banned or anonymous users are rejected. Elevated functions use an empty `search_path` and explicitly revoked default execution grants. A service-role key has neither publication execution nor new catalog table mutation privileges.

The Node API forwards the reviewer's access token to these RPCs, where the Data API verifies its signature and the database checks its live authority. Do not give an LLM the publication RPC, a service-role key, owner credentials, or a tool that can change reviewer membership. User/app metadata does not establish reviewer authority. Wallets and shopping data never enter this database.

## Review operations

1. `get_catalog_review(null)` authorizes the reviewer and returns the latest 30 pending draft summaries and current head. This initial bounded queue is not a complete archival browser.
2. `capture_catalog_source(source_key, title, url, checked_on, body)` stores bounded supplied text with a SHA-256 content hash. It does not fetch URLs. Repeating identical input returns the same capture; metadata conflicts fail. Extraction admission separately enforces exact curated source packs; supplied text is not proof that a URL was fetched or authenticated.
3. `save_catalog_draft(id, expected_revision, catalog, source_document_ids, base_sequence)` creates or revises a supported full-catalog candidate. Updates use optimistic concurrency. Raw or invalid model output belongs in private run traces, not this validated candidate table.
4. `get_catalog_review(draft_id)` returns that candidate, its immutable sources, and the current head joined to its exact published snapshot for review. Expired published terms remain available as comparison context for authorized reviewers; the public shopper API still rejects expired terms. `get_catalog_review_summary(draft_id)` returns the same review with source metadata only (text length, no text) and `get_catalog_review_source(draft_id, source_id)` one capture attached to that draft; the review app uses these two, the extraction routes the full review (migration `20261002230334_review_summary`).
5. `publish_catalog(draft_id, expected_revision, expected_hash, expected_head, review_note)` requires an explicit, human-approved action (the review app's publish button, or `pipeline publish --confirm` run on Evan's chat instruction). It locks the head/draft, checks fresh authorization and catalog dates after waiting, verifies exact source metadata, inserts an immutable release and private approval, marks the draft published, and advances the head in one transaction. A stale review/base fails. Retrying a successful draft returns its original release and does not move the head again.

A correction is a new version/draft based on the current head. Review and publish it through the same path; do not overwrite old releases or move the head backwards. Field-level evidence validation and human application are implemented; representative, independently labeled live model evaluations remain required. Matching a capture proves provenance, not that a model interpreted it correctly.

Three catalog schemas are accepted (`valid_catalog`): v1, the original pilot contract (one unconditional base rate and at most one online-retail bonus); v2, the 7-card release 1 contract (`valid_catalog_v2`, migration `20260930225732_catalog_v2`); and v3, the 178-card contract with programs, brands, gates, choices and closed-loop cards (`valid_catalog_v3`, migration `20261002222425_catalog_v3`, catalogs up to 1 MiB, drafts up to 600 sources, captures up to 250,000 characters). All use integer basis points and cents, valid source references, unique stable IDs, and a freshness window of at most 30 days. The extension/API share the strict Zod validators in `packages/rewards-core`; 28 v1, 53 v2 and 117 v3 shared cases verify agreement with SQL validation (`npm run db:test:catalog`). Remote data is interpreted only by packaged extension logic.

The sixth migration adds `list_draft_extractions`, `get_draft_extraction`, and `apply_reviewed_extraction`. They require a live reviewer; the model executor and service role cannot apply changes. The application transaction binds a finished extraction to its original draft revision/hash, records every condition review, derives supported changes from the immutable trace, and creates one revision without publication. Exact retries acknowledge that result only while it is current. See [application authority and recovery](CURATION.md).

## Seed and migration discipline

`seed.sql` is generated from the bundled `CATALOG_V3` with `npm run db:seed:generate`. It creates one **unapproved private draft**. It supplies no fake issuer excerpts, reviewer identities, user accounts, or published release. Source evidence and human review are required to publish, and the original expiry date is preserved. Expired terms must be reverified, not silently redated.

Create new migrations using `npm run supabase -- migration new descriptive_name`. Do not edit an already deployed migration. The baseline preserves the inspected MVP columns and existing records; it tightens client grants and the timestamp trigger's search path. Local reset demonstrated a clean reconstruction. Hosted migrations are pushed after merge with `./scripts/db-push.sh` by the owner or the session he authorizes; see [database migrations](../wiki/ops/database-migrations.md).

## Verification scope

- 218 transactional pgTAP tests (run 2026-10-03, with the v3 seed) run against real Supabase roles/auth tables in `supabase/tests/` (catalog, catalog v2, catalog v3, review summary, extraction ledger, human application). They cover reviewer/executor separation, grants, source integrity, live authority, idempotency, budgets, concurrency, immutable results, and recovery.
- Three multi-connection scenarios use actual PostgreSQL row locks: competing publication, catalog expiry while blocked, and session expiry while blocked. Generated fixtures are removed afterward; other local data is preserved.
- Four additional extraction-ledger scenarios verify concurrent duplicate requests, shared capacity, uncertain persistence/recovery, and budget races through the TypeScript orchestrator and actual scoped database role. All provider replies are scripted and free; these are not signed HTTP invocation or model-quality results.
- A real HTTP integration test signs in synthetic local users, rejects non-reviewers/anonymous/tampered tokens, captures evidence, saves/reviews/publishes an exact draft, verifies retry idempotency, and reads the public release through the Node API. The full flow goes through the protected Node review routes and also checks HTTP 409 for a stale approval. Sign-out immediately removes review/publication authority despite an otherwise unexpired access token. This supplements, rather than substitutes for, SQL-role fixtures.
- 198 shared positive/negative cases (28 v1, 53 v2, 117 v3) pass through both the SQL and TypeScript catalog validators.
- Two [review-app browser flows](../apps/review/README.md) exercise the compiled React and Node artifacts against actual local Auth/PostgREST/PostgreSQL. They verify manual review and extraction review/application followed by separate publication, stale revision recovery, required decisions, memory-only browser storage, and sign-out revocation. Generated local accounts and catalog records are removed afterward.
- `npm run db:test:curation:application` verifies simultaneous identical HTTP applications create one revision/audit, a retry cannot overwrite a later edit, and session expiry during a real lock wait prevents application. It uses intercepted synthetic SDK responses; external provider traffic is blocked. Build both apps first.
- Database lint and security advisors report no warnings/errors at the configured thresholds after a clean migration/seed rebuild.
- `.github/workflows/database.yml` runs these checks in CI on every push and pull request.

The SQL tests set synthetic claims as the database owner and then switch to real roles. Signed HTTP behavior is covered separately by `db:test:http`, `db:test:curation:http`, and `db:test:curation:application`. These tests do not demonstrate a deployed review interface or model workflow. Security advisors also do not replace integration tests. The [deployment and recovery runbook](../docs/release/deployment-runbook.md) separates local verification from hosted migration review, patch/TLS checks and actual publication.

Current references: [Supabase explicit grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [JSON Schema validation](https://supabase.com/docs/guides/database/extensions/pg_jsonschema), and [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html).
