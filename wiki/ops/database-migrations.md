---
type: Runbook
title: Database migrations
description: Create a Supabase migration, test it locally, keep the seed in sync, and hand the hosted push to Evan or the coordinator.
status: stable
tags: [ops, database, supabase, migrations]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../../package.json
    title: db:* scripts
  - resource: ../../scripts/db-push.sh
    title: Hosted migration push script
  - resource: ../../scripts/generate-db-seed.mjs
    title: Seed generator
  - resource: ../../supabase/README.md
    title: Catalog database (seed and migration discipline)
  - resource: ../../.github/workflows/database.yml
    title: Database checks workflow
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived), hosted rollout rules
---

# Database migrations

Schema changes are new files in [`supabase/migrations/`](../../supabase/migrations/), created with the Supabase CLI and never edited once applied. They are verified against the local Docker stack with the full DB suite, then pushed to hosted Supabase after merge by Evan or the coordinator with [`scripts/db-push.sh`](../../scripts/db-push.sh). Agents never push migrations or sign in to hosted services.

## Facts

| Item | Value |
| --- | --- |
| Migrations | 8 files as of 2026-10-02, `20260926032620_baseline_legacy_catalog.sql` to `20261001010350_source_body_limit.sql` |
| pgTAP tests | [`supabase/tests/`](../../supabase/tests/) (`catalog`, `catalog_v2`, `curation`, `extraction_application`) |
| Seed | [`supabase/seed.sql`](../../supabase/seed.sql), generated from `packages/rewards-core/src/catalog-v2.ts`: one **unapproved** private draft, no users or secrets |
| Hosted push | `./scripts/db-push.sh` runs `npx supabase db push --linked --skip-vault`; DB password from the macOS Keychain item `aicheckout-supabase-db` |
| Hosted state | All 6 migrations that existed on 2026-09-28 were applied ([archive](../archive/phase2-goal.md)). Whether the two later ones are applied is not recorded in the repo; check with `--dry-run` |

## Create a migration

1. `npm run supabase -- migration new descriptive_name` (writes a timestamped file in `supabase/migrations/`).
2. Write the SQL. Never edit an already-applied migration; to change one, add a new migration that alters or replaces (for example drop/add a constraint).
3. Add or extend pgTAP tests in `supabase/tests/`.
4. If the bundled catalog changed, run `npm run db:seed:generate` and commit `supabase/seed.sql`. `npm run db:seed:check` fails CI when the seed is stale.

## Test locally (Docker)

1. `npm run db:start:api`
2. `npm run db:reset` (reapplies every migration and the seed to the **local** database; discards local data).
3. `npm run db:test`
4. `npm run db:test:concurrency`, `npm run db:test:catalog`, `npm run db:test:http`, `npm run db:test:curation`
5. Build API and review (`npm run build --workspace=@ai-checkout/api && npm run build --workspace=@ai-checkout/review`), then `npm run db:test:curation:http` and `npm run db:test:curation:application`.
6. `npm run db:lint` and `npm run db:advisors`
7. `npm run supabase -- stop`

This mirrors [`.github/workflows/database.yml`](../../.github/workflows/database.yml); full context in [Local setup](local-setup.md#database-suite-docker). Not run for this page on 2026-10-02 (needs Docker); only `npm run db:seed:check` was run (exit 0).

## Push to hosted (Evan or coordinator only)

The agent stops at a merged PR and hands over these commands.

1. Once per machine, store the DB password in the Keychain: `security add-generic-password -a "$USER" -s aicheckout-supabase-db -w` (prompts; nothing lands in shell history).
2. After the PR merges to `main`: `./scripts/db-push.sh --dry-run` lists pending migrations.
3. `./scripts/db-push.sh` applies them.
4. Confirm the API still serves: `GET https://ai-checkout-api.onrender.com/v1/catalog` returns 200.

## Gotchas

- The auto-mode classifier blocks agents from pushing migrations to the hosted database; that is intended. Give Evan the exact commands instead.
- `db:reset` is local only. Never point it, or any test script, at the hosted project.
- The Supabase CLI on this project needs the DB password; the login-role fallback fails (2026-09-28), hence the Keychain wrapper.
- The catalog validator exists in both SQL and Zod (`packages/rewards-core`); `db:test:catalog` runs the shared parity cases, so a validator change needs both sides.

## Related

* [Local setup](local-setup.md)
* [Hosting](hosting.md)
* [Catalog v2 decision](../decisions/2026-09-30-catalog-v2-from-gold-labels.md)
