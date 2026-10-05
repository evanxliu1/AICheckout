---
type: Runbook
title: Database migrations
description: Create a Supabase migration, test it locally, keep the seed in sync, and push it to hosted Supabase (Evan, or the coordinating session when authorized).
status: stable
tags: [ops, database, supabase, migrations]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T02:00:00Z
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

Schema changes are new files in [`supabase/migrations/`](../../supabase/migrations/), created with the Supabase CLI and never edited once applied. They are verified against the local Docker stack with the full DB suite, then pushed to hosted Supabase after merge with [`scripts/db-push.sh`](../../scripts/db-push.sh) by Evan or by the coordinating session when Evan has authorized it (standing since 2026-09-29, see [user directives](../product/user-directives.md)). Subagents never push migrations, and no agent signs in to hosted services.

## Facts

| Item | Value |
| --- | --- |
| Migrations | 10 on `main` (checked 2026-10-05; none added since 2026-10-02), `20260926032620_baseline_legacy_catalog.sql` to `20261002230334_review_summary.sql` (Stage 2: `20261002222425_catalog_v3`, PR #22; `20261002230334_review_summary`, PR #24) |
| pgTAP tests | [`supabase/tests/`](../../supabase/tests/) (`catalog`, `catalog_v2`, `catalog_v3`, `curation`, `extraction_application`, `review_summary`) |
| Seed | [`supabase/seed.sql`](../../supabase/seed.sql), generated from `packages/rewards-core/src/catalog-v3.ts` (since Stage 2 M5): one **unapproved** private draft, no users or secrets |
| Hosted push | `./scripts/db-push.sh` runs `npx supabase db push --linked --skip-vault`; DB password from the macOS Keychain item `aicheckout-supabase-db` |
| Hosted state | All 10 applied. The 6 that existed on 2026-09-28 were applied that day ([archive](../archive/phase2-goal.md)); `20260930225732_catalog_v2`, `20261001010350_source_body_limit`, `20261002222425_catalog_v3` and `20261002230334_review_summary` were pushed by the coordinating session with `./scripts/db-push.sh` after their PRs merged (reported by the coordinator; not re-listed by the M10 session, which does not sign in to hosted services). Confirm with `npx supabase migration list --linked` before a catalog release ([catalog release](catalog-release.md)) |

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

This mirrors [`.github/workflows/database.yml`](../../.github/workflows/database.yml); full context in [Local setup](local-setup.md#database-suite-docker). Steps 1–6 ran green on 2026-10-02 on branch `s2-m1-catalog-v3` with `20261002222425_catalog_v3` applied, and again on branch `s2-m8-review-large-catalog` with `20261002230334_review_summary` applied (plus `npm run test:browser --workspace=@ai-checkout/review`).

Every worktree uses the same Supabase `project_id`, so they share one local Docker stack; `db:reset` in one worktree replaces the schema another worktree is testing.

## Push to hosted (Evan or the authorized coordinating session)

A subagent stops at a ready branch and hands over these commands.

1. Once per machine, store the DB password in the Keychain: `security add-generic-password -a "$USER" -s aicheckout-supabase-db -w` (prompts; nothing lands in shell history).
2. After the PR merges to `main`: `./scripts/db-push.sh --dry-run` lists pending migrations.
3. `./scripts/db-push.sh` applies them.
4. Confirm the API still serves: `GET https://ai-checkout-api.onrender.com/v1/catalog` returns 200.

## Gotchas

- The auto-mode classifier may block an agent from pushing migrations to the hosted database; that is intended for subagents. Give Evan (or the coordinator) the exact commands instead.
- `db:reset` is local only. Never point it, or any test script, at the hosted project.
- The Supabase CLI on this project needs the DB password; the login-role fallback fails (2026-09-28), hence the Keychain wrapper.
- The catalog validator exists in both SQL and Zod (`packages/rewards-core`); `db:test:catalog` runs the shared parity cases, so a validator change needs both sides.

## Related

* [Local setup](local-setup.md)
* [Hosting](hosting.md)
* [Catalog v2 decision](../decisions/2026-09-30-catalog-v2-from-gold-labels.md)
