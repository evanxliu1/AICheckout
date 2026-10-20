---
type: Decision
title: "Phase 15.5b privacy fixes: Delete all local data deletes the server reports first and stops when it cannot, with Try again or Clear this device anyway; a daily pg_cron prune makes the 90-day retention unconditional"
description: Choices of 2026-10-20 made within milestone 15.5b (the two open risks of the 15.5 review). Delete all local data runs the Delete my data flow first while sharing is on and clears the device only after a 2xx; otherwise nothing is cleared and the popup offers Try again or Clear this device anyway (the worker decides, by a keepReports flag on the clear requests, so the order holds whichever page asks). Migration telemetry_scheduled_prune enables pg_cron in pg_catalog and schedules telemetry.prune_expired() daily at 03:17 UTC, a loop over the bounded prune; no new grant to any client role. The public docs say "within about a day after 90 days".
status: accepted
tags: [decision, phase-15, telemetry, extension, database, privacy]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-20T07:00:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan (the 15.5 review's open risks)
  - resource: 2026-10-20-release-docs-choices.md
    title: Decision, 15.5 choices (the amendment that named both risks)
  - resource: 2026-10-20-telemetry-client-details.md
    title: Decision, 15.3 choices (Delete my data on a 2xx only)
  - resource: ../../supabase/migrations/20261020061616_telemetry_scheduled_prune.sql
    title: Migration telemetry_scheduled_prune
  - resource: ../../extension/src/background/index.ts
    title: Worker entry (reportsDeletedFirst)
---

# Phase 15.5b privacy fixes (2026-10-20)

## Context
The 15.5 independent review left two risks open ([amendment](2026-10-20-release-docs-choices.md#amended-after-the-independent-review-2026-10-20)): **Delete all local data** ran `chrome.storage.local.clear()`, which took the usage-reporting identifier with it, so reports already sent could never be deleted afterwards (the docs could only say "use Delete my data first"); and rows older than 90 days were pruned only inside `ingest_events`, `delete_install` and the reviewer reads, so with the kill switch on and no reviewer a report could outlive the 90 days the policy states. The coordinator asked for both fixes in one branch, `phase15-5b-privacy-fixes`, with the docs made to match.

## Options considered

| Question | Chosen | Alternatives |
| --- | --- | --- |
| Where the order "server first, then the device" is enforced | In the worker: [`background/index.ts:reportsDeletedFirst`](../../extension/src/background/index.ts) runs before `handlePage` passes `checkout:vault-delete` or `checkout:clear` to the vault service; it calls the module's `deleteData()` (a batch in flight lands, no new one starts, the id goes to `/v1/events/delete`) and lets the clear proceed on anything but `unavailable`. With sharing off there is no id, `deleteData` answers `nothing-to-delete` and the behaviour is as before | The popup sending `telemetry:delete` and then the clear (two requests a closed popup could split; the order would hold only for pages that remember to do it) |
| How the page learns the deletion failed | `{ ok: false, error: REPORTS_NOT_DELETED_MESSAGE }` on the existing error branch; `Popup` compares the vault or clear error to the exported constant and renders [`ReportsNotDeleted`](../../extension/src/components/DeleteSavedData.tsx) at the top of the popup (role `alert`, the message as the title, "Clearing anyway keeps the reports already sent; they expire after 90 days.") with **Try again** (the same request) and **Clear this device anyway** | An error `code` on both response schemas and both clients (more plumbing for one case); the alert inside the collapsed Delete saved data disclosure (hidden after the remount) |
| What "Clear this device anyway" sends | `keepReports: true` on `checkout:vault-delete` and `checkout:clear` (Zod `z.literal(true).optional()`); the worker skips the service and clears. The id is lost knowingly, and the copy says the reports expire | A separate request type; clearing everything but the telemetry key (then the device would still hold an id after "delete all") |
| What failure means | Exactly what Delete my data means since the 15.3 review: anything but a 2xx (429, 503, 400, 403) or a network failure; the id stays | Treating a 4xx as deleted |
| The scheduler | pg_cron, bundled and preloaded in Supabase Postgres hosted and locally (`pg_cron 1.6.4` in the pinned CLI image, the launcher running), created `with schema pg_catalog` (the advisor's "extension in public" never applies) and the two grants Supabase documents for the `postgres` role; `cron.schedule('telemetry-prune', '17 3 * * *', 'select telemetry.prune_expired()')`, an upsert by name so a reset or a repeated push keeps one job; the job runs as `postgres` (the tables' owner) in database `postgres` | A Render cron job calling an RPC (a new network path and a new grant); the API pruning on a timer (the kill switch stops the API's calls); a trigger (no rows arrive while ingest is off, which is the case the fix is for) |
| What the job runs | `telemetry.prune_expired()`: a loop over the existing `telemetry.prune(1000)` until a round removes fewer than 1000 (ceiling 1,000,000 rows a run), returning the rows removed; `security invoker`, `search_path = ''`, execute revoked from `public`, `anon`, `authenticated`, `service_role`. The per-call pruning in ingest, delete and the reads stays | `prune(1000000)` in one statement (one long delete and lock); removing the per-call pruning (the daily job alone would leave up to a day) |
| What the docs claim | "A scheduled job deletes older reports once a day (03:17 UTC) … so a report is gone within about a day after it turns 90 days old", in the policy (file and site), `/support/`, `/uninstalled/` and the support file; Delete all local data described as above in the same places, the extension README and the reviewer script. `scripts/check-release-docs.mjs` stays clean and `apps/site/tests/pages.test.tsx` pins "Clear this device anyway", "deletes older reports once a day" and "once a day" on the uninstalled page | "Deleted after 90 days" (false by up to a day) |

## Decision
As in the table.

## Consequences
- The migration `20261020061616_telemetry_scheduled_prune` is on the branch and **not on hosted**: the coordinator runs `./scripts/db-push.sh` after the merge. On hosted, `create extension if not exists pg_cron` must be allowed for `postgres` (Supabase's documented path); if the push refuses it, enable pg_cron from the dashboard's Integrations page first and push again (the schedule call is idempotent).
- The cron job's clock is the server's `cron.timezone` (GMT on the local stack; UTC on hosted), so "03:17 UTC" holds in both.
- `supabase/tests/telemetry.test.sql` proves the job row (name, schedule, command, active), the extension's schema, that `prune_expired()` removes 2,500 rows older than 90 days in one run with the counters, and that `anon` and `authenticated` cannot call it.
- Reviewer runbook: `select * from cron.job_run_details order by start_time desc limit 10` shows the daily runs on hosted (the `postgres` role reads it); the function returns the rows removed.
- With sharing on, Delete all local data now takes one network round trip (up to about 40 s when a batch is in flight: see the amendment) before clearing, and a shopper offline sees the choice instead of a cleared device.
- `extension/tests/background-clear.test.ts` (the worker: 503 and a network failure clear nothing; a 2xx deletes then clears, in that order; `keepReports` skips the service) and `vault-gate.test.tsx` (the two buttons and their requests); `e2e/telemetry.spec.ts` drives the refused deletion against the stub (503, nothing cleared, the id kept, axe on the alert) and Try again at 200 (the id posted again, the device cleared, card setup back).

## Amended after the independent review (2026-10-20)
Independent Opus reviewer, agent-verified (not human-verified):
- **The worker deleted before validating.** `reportsDeletedFirst` ran on the raw message, so a malformed clear (a `checkout:vault-delete` without `confirmed`, or `checkout:clear` with an unknown field) deleted the reports and stopped sharing before the vault service refused it. It now parses the request with `vaultRequestSchema` or `requestSchema` first and lets a malformed one through untouched to be refused. The worker test that sent `checkout:clear` with `confirmed` (itself malformed) now sends the real shape, and a new case pins the malformed path.
- **Not sharing now skips the telemetry module entirely** (`telemetry.status()` first): `deleteData()` with no id still wrote the Stop sharing state, so a clear that then failed left an unanswered consent recorded as declined.
- **Ingest and the cron run could deadlock.** Both prune the oldest rows; a batch shares one `received_at`, so `order by received_at limit 1000` can pick different tied rows in the two transactions, each locking some and waiting on the other's. `prune_expired()` now locks today's `telemetry.days` row first, the row `ingest_events` locks before it prunes, so ingest simply waits for the run (seconds: a day's backlog is at most 20,000 rows under the cap). `delete_install` takes no such row and can still, rarely, deadlock with the run; Postgres aborts one side, and either retries (Try again, or the next day's run). pgTAP pins that today's counter is unchanged by the run.
- **Focus:** the Delete all local data button unmounts while the worker waits, so focus fell to the page; `ReportsNotDeleted` now focuses Try again when it appears and is not busy (unit test).
- **The wait is up to about 40 s, not 20 s:** `deleteData()` first lets a batch in flight land (its own 20 s timeout) and then posts the delete (20 s). The popup shows "Updating saved data…" throughout.
- **Kept as decided:** recognising the error by the shared constant (both sides import it; an error code would touch two response schemas, two clients and a new `Popup` prop for one case). pg_cron enabling matches Supabase's documented SQL (`create extension pg_cron with schema pg_catalog` and the two grants to `postgres`, [Supabase Cron install](https://supabase.com/docs/guides/cron/install)); the public "within about a day after it turns 90 days old" stays, since ingest, delete and the reviewer reads still prune as a backstop, but pg_cron reports a failed run only in `cron.job_run_details`, so the post-push check in [database migrations](../ops/database-migrations.md) is now written down.

## Status
Accepted 2026-10-20 (implementer, within the plan; agent-verified by the gates). Amended 2026-10-20 after the independent Opus review (agent-verified).
