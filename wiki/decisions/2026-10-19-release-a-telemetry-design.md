---
type: Decision
title: Release A telemetry on the existing Supabase and Render API, insert-only RPC for anon, retention by opportunistic pruning, a build-time switch, fixed problem reasons, tap events without an ID when sharing is off
description: The planner's choices for the minimal telemetry set within Evan's 2026-10-10 data-collection decision and his 2026-10-19 directive to use the hosted Supabase and the Render API: a private `telemetry` schema reached only through security-definer RPCs, caps and pruning inside the ingest RPC instead of pg_cron, a 410 kill switch, telemetry as a build-time switch so Release A can ship without it if Chrome review objects, no free text in problem reports, and the two tap features working without consent by sending no install ID.
status: accepted
tags: [decision, phase-15, telemetry, privacy, api, database]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-20T00:30:00Z
sources:
  - resource: 2026-10-10-data-collection.md
    title: Decision, data collection (binding answers)
  - resource: ../system/telemetry-design.md
    title: Telemetry design draft v6
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan (15.2, 15.3, event dictionary)
  - resource: ../../supabase/migrations/20261011111247_merchant_releases.sql
    title: The grant and RLS pattern the telemetry migration follows
  - resource: ../../apps/api/src/review-routes.ts
    title: Rate limiting with trustProxy false
  - resource: https://developer.chrome.com/blog/cws-policy-updates-2026
    title: Chrome Web Store 2026 policy update (strictly necessary to the single purpose)
---

# Release A telemetry design choices (2026-10-19)

## Context
Evan decided what is collected on 2026-10-10 ([decision](2026-10-10-data-collection.md)): one onboarding opt-in, a persistent random ID, exact amounts without a domain, owned card ids, recommendations, reader results, errors, domains only on a tap, no page snapshots, raw rows 90 days, Stop sharing and Delete my data, a minimal set in Release A. On 2026-10-19 he added: storage defaults to the hosted Supabase and the Render API, no new vendor. The [telemetry design](../system/telemetry-design.md) draft left mechanics open: how anon writes reach the database, how retention runs, what happens if Chrome review objects, whether problem reports carry free text, and how the tap features behave for a shopper who declined.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Where rows live | A new vendor (analytics SaaS); the hosted Supabase (Evan's directive) | **Supabase**, a private schema `telemetry` not exposed to the Data API, like `catalog_private` |
| How the extension writes | Direct Data API inserts with the publishable key (RLS insert policy); the Render API forwarding to a `security definer` RPC granted to `anon` | **RPC through the API**: the API validates with Zod, rate-limits by IP and checks `Origin`; the RPC re-validates with `jsonb_matches_schema`, caps the batch and the install's day, and is the only write path; no table grants to any client role (the publishable key is already on the server) |
| Retention | `pg_cron` daily delete (unconfirmed on the hosted plan); a Render cron (the free instance sleeps); pruning inside the ingest RPC | **Opportunistic pruning**: every ingest call deletes a bounded number of rows older than 90 days (`limit 1000`); a reviewer RPC can also prune; no scheduler to configure or verify |
| Delete my data | A signed request; an unauthenticated delete by install ID | **Unauthenticated by install ID**: the ID is a 122-bit random secret only that install holds; the route is rate-limited; the policy says a reset ID's earlier rows cannot be found and expire in 90 days |
| Incident stop | Redeploy; an env switch | `TELEMETRY_INGEST=off` makes `/v1/events` answer **410**; clients pause for 7 days on 410 |
| If Chrome review objects to collecting owned cards or amounts | Argue; remove telemetry from the code; a switch | **A build-time switch** (`VITE_TELEMETRY=1` in the hosted build): without it there is no consent screen, no queue and no request; Release A can be resubmitted with telemetry off and the policy amended |
| Problem reports | Free text with a warning; fixed reasons plus optional text; fixed reasons only | **Fixed reasons only** (wrong-amount, no-badge, wrong-store, wrong-card, other); free text is where names, order numbers and addresses would arrive |
| Tap features when sharing is off | Disabled until consent; work and send the domain with the install ID; work and send without an ID | **Work, no ID**: the tap is the shopper's own action on a named feature; `install_id` is nullable on `store_suggested` and `problem_reported` only. Listed as decision 3 for Evan |
| Event emission | Content scripts; the worker | **Worker only**, from state it already holds (readings, store kind, catalog slice); content scripts stay network-free and release-free |
| Batching | Per event; a queue flushed by an alarm | **Queue ≤ 200, oldest dropped; `telemetry-flush` alarm every 15 minutes while non-empty, immediately at 50**; the Render cold start is absorbed by the next flush |
| Reads for Evan and Phase 16 | A dashboard (Phase 17); SQL editor only; two reviewer RPCs | **Two reviewer RPCs** behind `require_reviewer()` and bearer routes: store suggestions (domain, count, distinct installs, last seen) for the merchant pipeline's growth list, and a daily summary; the dashboard stays in Phase 17 |
| `Origin` check | None; required `chrome-extension://<id>` | **Required when `EXTENSION_IDS` is set** (after the first upload assigns the id); a filter against casual abuse, not authentication; stated as such in the plan |
| Dictionary | Hand-written markdown; generated | **Generated** from the Zod schema's descriptions into `docs/telemetry/events.md` with a `--check` in CI, so the dictionary cannot drift from the code |

## Decision
As chosen above, carried out in Phase 15.2 (backend) and 15.3 (client). The envelope and event set are the plan's [section 5](../product/phase-15-release-a.md#5-event-dictionary-draft). Shared envelope cases run through both the Zod and SQL validators in the parity script, as catalog and merchant releases do.

## Consequences
- Two new migrations' worth of objects in one migration (`telemetry` schema, two tables, four functions); `./scripts/db-push.sh` by the coordinator after merge; `db:lint` and `db:advisors` must stay clean (RLS on, no client grants, empty `search_path`, revoked defaults).
- Three new routes on the API and three env names (`TELEMETRY_INGEST`, `EXTENSION_IDS`, and the review routes need nothing new); `render.yaml` gains the names, values are entered in the dashboard by Evan only if non-default.
- The extension's hosted build gains one storage key (`checkoutTelemetryV1`), one alarm and two requests; the privacy policy, consent screen and dictionary must agree (15.5 and the 15.7 reviewer pass).
- The `install_id` is pseudonymous personal data; wording everywhere is "a random identifier", never "anonymous".
- Watch: the anonymous ingest on a free instance (caps bound it; the kill switch stops it); Chrome's reading of "strictly necessary" (the build switch is the fallback).

## Status
Accepted 2026-10-19 (planner's choices within Evan's decisions; decisions 3 and 4 in the plan await Evan's confirmation, the recommendations above are assumed until he answers).

Evan confirmed plan decisions 3 and 4 on 2026-10-20 (the recommendations adopted; see [telemetry client details](2026-10-20-telemetry-client-details.md)). The Retention row is superseded in part 2026-10-20 by [privacy fixes](2026-10-20-privacy-fixes-delete-order-and-scheduled-prune.md): a daily pg_cron job prunes at 03:17 UTC (confirmed active on hosted by Evan 2026-10-22); pruning in the ingest RPC stays as a backstop. (Wiki audit 2026-10-23.)
