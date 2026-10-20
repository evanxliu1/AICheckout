---
type: Decision
title: "Phase 15.2 implementer choices: one JSON-schema branch per event type built in SQL, the amount rule on recommendation_shown, a whole-batch refusal, a fixed-window limiter of the API's own, the client IP at a configurable proxy hop, reviewer reads through the catalog_private pattern"
description: Choices of 2026-10-20 made within the Phase 15 plan's milestone 15.2 while building the telemetry backend. The SQL validator builds the thirteen-branch event schema from one envelope definition; the amount view must carry an amount and no reason and the rates view the reverse; a batch with one invalid event is refused whole; the API keeps its own 60-per-IP and 600-global fixed-window counters instead of a second @fastify/rate-limit instance; the client address comes from X-Forwarded-For at TELEMETRY_PROXY_HOPS entries from the right; the two reviewer reads are security-definer functions in the telemetry schema behind public security-invoker wrappers, like catalog_private.
status: accepted
tags: [decision, phase-15, telemetry, database, api, privacy]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-20T01:30:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan (milestone 15.2 and the event dictionary draft)
  - resource: 2026-10-19-release-a-telemetry-design.md
    title: Decision, Release A telemetry design choices
  - resource: ../../supabase/migrations/20261020004702_telemetry_events.sql
    title: Migration telemetry_events
  - resource: ../../packages/catalog-review/src/telemetry.ts
    title: Shared Zod envelope and limits
  - resource: ../../apps/api/src/telemetry-routes.ts
    title: Telemetry routes
---

# Phase 15.2 implementer choices (2026-10-20)

## Context
Milestone 15.2 of the [plan](../product/phase-15-release-a.md#4-milestones) and the [telemetry decision](2026-10-19-release-a-telemetry-design.md) fix the shape: a private `telemetry` schema, `ingest_events` as the only write path (security definer, granted to `anon`, validating with `jsonb_matches_schema`, capping the batch at 50 events and 64 KiB and the install's day at 500, pruning 90-day-old rows on every call), `delete_install`, two reviewer reads, a shared Zod envelope with parity cases, and the API's `Origin` filter, body limit, per-IP and global buckets with `trustProxy` still false, and the 410 kill switch. The event set is the plan's [section 5](../product/phase-15-release-a.md#5-event-dictionary-draft). Several details were left to the implementer.

## Options considered

| Question | Chosen | Alternatives |
| --- | --- | --- |
| How SQL states thirteen event shapes that share an envelope | `telemetry.event_schema()` builds a `oneOf` of thirteen `additionalProperties: false` objects from one envelope definition and a per-type field list; `install_id` is `uuid_or_null` on the two tap events only. `telemetry.valid_event_v1(payload)` runs it, then the checks a JSON schema cannot state (a real timestamp by cast, the category against `catalog_v3_merchant_categories()`, the amount rule) | Thirteen hand-written schemas (the envelope repeated thirteen times); `allOf` of an envelope and a type branch (`additionalProperties: false` does not compose across `allOf`) |
| The amount rule on `recommendation_shown` | `view: amount` requires `amount_cents` and `amount_kind` and a null `withheld_reason`; `view: rates` requires the reverse (Zod `refine`, SQL imperative). The dictionary says "`withheld_reason` (reader code when `rates`)" and "`amount_cents` (when `amount`)" | Nullable fields with no cross-field rule (an amount could arrive on a rates view, or a rates view with no reason) |
| Codes that are strings, not enums | `withheld_reason`, `error.code` and `error.surface` match `^[a-z][a-z0-9-]{0,39}$` (a machine code; the reader's reason codes live in the extension and may grow). Everything else that the dictionary lists as a closed set is an enum in both validators | Enums for the reader codes (a new code would need a migration); free text (where personal data arrives) |
| Upper-case UUIDs | Accepted by both validators (Zod's `uuidv4()` is case-insensitive); the table stores the `uuid` column lower-cased and the CHECK compares by cast | Refusing them in SQL (a parity disagreement) |
| The database's byte cap | 128 KiB of JSONB text for the batch (`octet_length(p_batch::text)`), twice the wire limit, because PostgreSQL renders JSONB with a space after every `:` and `,`; each event ≤ 8 KiB of JSONB text | 64 KiB in SQL (a legitimate 64 KiB request could be refused after the API accepted it) |
| A batch with one invalid event | Refused whole (`22023`, the API answers `400 invalid_request`): the API has already validated with Zod, so a disagreement is a bug or a forged request, never a shopper | Storing the valid events and dropping the rest (hides a parity bug) |
| Repeated event ids and the day cap | `dropped` counts both; the counter counts stored rows only (`insert … on conflict do nothing` first, then the counter); the `install_days` row is read `for update` so concurrent batches of one install serialise on the cap | A unique-violation error (a client retry of a lost response would fail); counting before storing (duplicates would consume the cap) |
| Events without an install id | Stored with `install_id null`, not counted against any day cap (there is no install to count); bounded by the API's buckets | A sentinel install (its cap would stop every declining shopper's taps after 500 a day) |
| Rate limiting on the anonymous routes | A small fixed-window counter of the API's own (`createLimiter`: 60 a minute per client key and 600 across all clients per process, at most 10,000 keys, `Retry-After` in seconds, the clock injectable) | A second `@fastify/rate-limit` instance (one per encapsulation context, its own `onRequest` ordering, no global bucket) |
| The client IP behind Render | `TELEMETRY_PROXY_HOPS` (default 0, `1` in `render.yaml`): the address is the entry that many places from the right of `X-Forwarded-For`, so entries a client forges on the left never move its bucket; 0 uses the socket address. Fastify's `trustProxy` stays false server-wide | `trustProxy: 1` server-wide (changes the review routes' keys); the leftmost entry (forgeable) |
| Order of the checks | 410 (kill switch, `/v1/events` only) → 403 (`Origin`) → 429 (buckets) → 413 (body) → 400 (Zod) → RPC. Delete my data keeps working while ingest is off | Rate limiting before the `Origin` filter (a hostile origin would consume the buckets) |
| Reviewer reads | `telemetry.store_suggestions()` and `telemetry.summary(p_days)` are security definer in the `telemetry` schema (`require_reviewer()` first) behind `public.telemetry_store_suggestions()` and `public.telemetry_summary(p_days)`, security invoker, execute for `authenticated` only; the schema grants `usage` to `authenticated`, as `catalog_private` does | Public security-definer functions directly (differs from every other reviewer function) |
| Route shapes | `POST /v1/events` takes `{ "events": [...] }` (room for later fields), `POST /v1/events/delete` takes `{ "install_id" }`; `GET /v1/review/telemetry/summary?days=30` defaults to 30 days, 1–90 | A bare array body; a path parameter for the window |
| Where the shared cases live | `packages/catalog-review/test-cases.ts` (`TELEMETRY_EVENT_FIXTURES`, 96 `telemetryEventCases`), beside the contract, as `packages/rewards-core/test-cases.ts` does for catalogs | Inside `rewards-core` (the telemetry contract is the API's, not the engine's) |

## Decision
As in the table.

## Consequences
- `packages/catalog-review` exports `TELEMETRY_LIMITS`, the thirteen event schemas with `.describe()` texts (the source of 15.3's generated dictionary), `telemetryEventSchema`, `eventBatchSchema`, `ingestResultSchema`, `deleteInstallInputSchema`, `storeSuggestionsSchema`, `telemetrySummarySchema`.
- `db:lint` now covers `public,catalog_private,telemetry`.
- Changing an enum in the dictionary is a Zod change plus a new migration replacing `telemetry.event_schema()` (and `valid_event_v1` if the imperative checks change) plus parity cases, in one change.
- 15.3 sends `{ events }` batches of at most 50 events and 64 KiB, treats 410 as a 7-day pause, 429 as "try at the next flush", and posts `{ install_id }` to `/v1/events/delete`.
- Found while testing: the shared local Supabase stack was still running PostgREST v14.5 from an older CLI, where a `40001` raise spins for 60 seconds (Kong 504; `db:test:http` failed on `main` too). Recreating the stack (`supabase stop`, `db:start:api`) brought the pinned v16.3 and the suite passed ([database migrations](../ops/database-migrations.md#gotchas)).

## Status
Accepted 2026-10-20 (implementer, within the plan and the 2026-10-19 decision; agent-verified by tests).
