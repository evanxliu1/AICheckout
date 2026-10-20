---
type: Decision
title: "Phase 15.3 implementer choices: events derived in the worker around the requests it already handles, a typed amount is never a recommendation with an amount, `installedAt` anchors the envelope for id-less taps, Delete my data also stops sharing, the registrable domain by a short second-level list, the catalog e2e build carries the telemetry switch"
description: Choices of 2026-10-20 made within the Phase 15 plan's milestone 15.3 while building the telemetry client and consent. The worker derives the popup's events from the requests it handles (no page builds an event); a comparison of a typed amount is not reported because the contract's `amount_kind` names what was read; `installedAt` (ms) replaces the spec's `installMonth` and anchors `install_month` and the day bucket for a tap sent without an id; Delete my data resets to Stop sharing; the registrable domain comes from a short second-level list instead of the public suffix list; telemetry.spec.ts runs in the CI-only catalog build, not in dist-e2e.
status: accepted
tags: [decision, phase-15, telemetry, extension, privacy]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-20T04:30:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan (milestone 15.3 and the event dictionary)
  - resource: 2026-10-19-release-a-telemetry-design.md
    title: Decision, Release A telemetry design choices
  - resource: 2026-10-20-telemetry-backend-details.md
    title: Decision, 15.2 implementer choices (the amount rule)
  - resource: ../../extension/src/state/telemetry.ts
    title: Worker telemetry module
  - resource: ../../extension/src/background/index.ts
    title: Worker entry (emit points around the page requests)
  - resource: ../../docs/telemetry/events.md
    title: Generated public dictionary
---

# Phase 15.3 implementer choices (2026-10-20)

## Context
Milestone 15.3 of the [plan](../product/phase-15-release-a.md#4-milestones) and the [telemetry decision](2026-10-19-release-a-telemetry-design.md) fix the shape: a worker-only module with consent, a persistent random id and a queue in `checkoutTelemetryV1`; events built in the worker from what it holds, validated against the 15.2 contract, flushed by a `telemetry-flush` alarm through `packages/catalog-client`; a 410 pause; one consent screen after the cards are saved; Stop sharing and Delete my data in Settings; Suggest this store and Report a problem working for shoppers who chose Not now, with no id; a generated dictionary with a CI check; telemetry as a build-time switch. Evan's choices of 2026-10-20 (the recommendations adopted) are applied. Several details were left to the implementer.

## Options considered

| Question | Chosen | Alternatives |
| --- | --- | --- |
| Where the popup's events are built | In the worker, around the requests it already handles: `handlePage` in `background/index.ts` derives `recommendation_shown` from a `checkout:compare` with a read cart or a `checkout:rates`, `wallet_changed` from a `checkout:save-wallet`, `release_refresh` (manual, catalog) from `checkout:refresh-catalog`; the badge service derives the badge's events from its own requests. Pages send only three small typed requests the worker cannot infer (`telemetry:popup-opened` with the read outcome, the consent answer, the two taps with a tab id) and never a field of an event | Building events in the popup and posting them (a page would decide what leaves the device); threading the module through `createStateService` (touches `service.ts`, which 15.4 edits in parallel) |
| A comparison of a typed amount | Not reported as `recommendation_shown`: the contract's `amount_kind` (`total`, `estimated-total`, `subtotal`) names what the reader read, and the amount view requires it. The badge reports the typed amount as `amount_typed` (a difference bucket, `no-read` without a reading) and a recommendation only from a reading; the popup reports a comparison only when a read cart backs it and the rates view always. **Consequence:** popup comparisons from typed amounts are not counted in Release A | Sending `amount_kind: 'total'` for a typed amount (a guess that would blur the reader-quality metric); adding `typed` to the enum (a 15.2 contract change: Zod, a new migration replacing `telemetry.event_schema()`, parity cases) |
| `withheld_reason` on the rates view | Always `withheld`: the content scripts collapse the reader's detailed reasons (`credit-unclear`, …) into the probe's `withheld`, the only rates-view reason the worker sees | Carrying the reader's reason through the probe contract (a content-script change, out of 15.3's scope) |
| `page` on badge events | `cart` or `checkout` from a word in the sender URL's path or query (`checkout`, `payment`, `order`), decided in `content()` and stored on the tab entry as that one word; the URL itself is never stored | Leaving `page` at `cart` (loses the checkout share); storing the path |
| The envelope's install anchor | `installedAt` (ms, local storage) instead of the spec's `installMonth`: `install_month` and `days_since_install` are derived from it. For a tap sent without an id it is the time the consent question was first answered or the first tap, so an id-less event still carries a month and a bucket (both required by the contract) without an exact install time | Storing `installMonth` only (no day bucket); a fixed `0` bucket on id-less taps (a fabricated value) |
| Delete my data | Posts the current id to `/v1/events/delete`, then resets to the Stop sharing state (consent declined, id and queue cleared); the UI says so and the toggle offers Share again. A 429, 503 or network failure keeps the id and reports "nothing was deleted yet" so the shopper can retry | Deleting and minting a new id at once (the shopper did not ask to keep sharing) |
| Consent from Settings | The toggle's on sends `telemetry:consent` with `source: 'settings'`: a new id, `consent_granted` and `wallet_changed` (so the new id starts with the owned cards known), never `onboarding_completed` | The same events as onboarding (a false funnel step) |
| What a refused batch does | 2xx: the batch leaves the queue; 410: the queue is cleared and nothing is sent for 7 days; 429, 503 or any 5xx: the batch stays, `retryAt` = now + `Retry-After` (seconds, capped at a day) or 15 minutes; a network failure: the batch stays for the next alarm; any other 4xx (400 schema, 403 origin, 413): the batch is dropped, since it would never be accepted | Retrying a 400 forever; dropping on 503 |
| Events the contract would refuse | Never queued: every event is built, then parsed with `telemetryEventSchema`; a failure drops it silently (a fixture catalog version in a test build, an IP address on a tap). Browser tests cache fixture catalogs whose versions fail the release pattern, so this is also what keeps a stray event out of the API | Queueing and letting the API refuse the whole batch (one bad event would block fifty) |
| Registrable domain | `registrableDomain(host)`: the last two labels, or three when the TLD has two letters and the second level is one of `co com net org gov edu ac ne or`; null for an IP, a single label or anything the API's hostname rule refuses | Bundling the public suffix list (about 200 KiB in the worker); sending the full host (more than the dictionary allows) |
| Tap events and the alarm | A tap flushes at once (the shopper acted and expects it sent), as does consent and the 50th queued event; otherwise the `telemetry-flush` alarm (15 minutes, created when the queue becomes non-empty, cleared when it empties) | Alarm only (a tap could wait 15 minutes) |
| Where the browser test runs | `e2e/telemetry.spec.ts` runs in `npm run test:catalog:browser` (CI), whose isolated build now carries `VITE_TELEMETRY=1` beside the stub catalog origin; the spec is skipped by `test:browser` like `catalog.spec.ts`, and dist-e2e stays a build without telemetry (so every other spec's permissions and onboarding are unchanged). The stub API is a local HTTPS server, as in `catalog.spec.ts`: `context.route` does not see the worker's fetches | A telemetry build in dist-e2e for every spec (changes the permission set `any-store.spec.ts` pins and adds a consent step to every onboarding flow); a third CI build |
| `build:hosted` | Gains `VITE_TELEMETRY=1`, so the hosted build is the Release A build with usage reporting; 15.7 can drop the flag if Chrome review objects | Leaving the flag to 15.7's command line |

## Decision
As in the table.

## Consequences
- Open for the coordinator: whether `amount_kind` should gain `typed` (Zod + migration + parity cases) so popup comparisons from typed amounts count; until then `recommendation_shown` undercounts popup use and the dictionary says so.
- `extension/package.json` depends on `@ai-checkout/catalog-review` through a new `./telemetry` subpath export (the contract only; the package's index is not bundled).
- The tab entry carries three new fields (`page`, `reportedKey`, `suggested`) with defaults, so entries written before 15.3 still parse.
- `popup_opened` is not sent when the popup opens with no cards or keeps a cart already read or compared in that tab (the contract's `read_outcome` has no value for "did not read"); the dictionary says so.

## Status
Accepted 2026-10-20 (implementer, within the plan and the 2026-10-19 decision; agent-verified by tests).
